"""Public API routes — frontend-facing endpoints under /api/v1/."""

import hashlib
import re
import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    get_db, AgentWorkspace, ActivityLog, Channel, Computer, Member, Message,
    EventRecord, FileEntry, Reminder, Server, Task,
)
from routers.member_serialization import member_backend, member_computer_id, serialize_member

router = APIRouter(prefix="/api/v1", tags=["public"])

PUBLIC_API_KEY = "sk_public_local"

PUBLIC_ACTIVITY_EVENT_TYPES = {
    "supervisor_message_sent": "message.created",
    "supervisor_task_created": "task.created",
    "supervisor_task_updated": "task.updated",
    "supervisor_member_updated": "member.updated",
    "supervisor_reminder_created": "reminder.created",
    "supervisor_reminder_updated": "reminder.updated",
}

EVENT_TYPE_ALIASES = {
    "message.created": "message_received",
    "task.created": "task_created",
    "task.updated": "task_updated",
    "member.updated": "member_updated",
    "reminder.created": "reminder_created",
    "reminder.updated": "reminder_updated",
}

MENTION_RE = re.compile(r"(?<![\w@])@([A-Za-z0-9_.-]+)")


def _utcnow() -> datetime:
    return datetime.utcnow()


async def verify_public_api_key(request: Request, db: AsyncSession = Depends(get_db)):
    """Validate public API key from X-Public-Key header or ?api_key query param."""
    key = request.headers.get("X-Public-Key") or request.query_params.get("api_key")
    if not key:
        raise HTTPException(401, "Missing API key: set X-Public-Key header or api_key param")
    # Check against seed public key
    if key == PUBLIC_API_KEY:
        return
    # Check against hashed api_keys table
    token_hash = hashlib.sha256(key.encode()).hexdigest()
    result = await db.execute(select(Member).limit(1))
    raise HTTPException(401, "Invalid API key")


async def _get_server(db: AsyncSession) -> Server:
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(404, "Server not found")
    return server


async def _resolve_member(db: AsyncSession, server: Server, handle_or_id: str | None) -> Member | None:
    if not handle_or_id:
        return None
    try:
        parsed_id = uuid.UUID(handle_or_id)
    except ValueError:
        parsed_id = None
    if parsed_id:
        result = await db.execute(
            select(Member).where(Member.id == parsed_id, Member.server_id == server.id)
        )
    else:
        result = await db.execute(
            select(Member).where(
                Member.server_id == server.id,
                Member.display_name == handle_or_id.lstrip("@"),
            )
        )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(404, f"Member {handle_or_id} not found")
    return member


async def _parse_mentions(db: AsyncSession, server: Server, content: str) -> list[uuid.UUID]:
    handles = sorted({match.group(1) for match in MENTION_RE.finditer(content or "")})
    if not handles:
        return []
    result = await db.execute(
        select(Member.id).where(
            Member.server_id == server.id,
            Member.display_name.in_(handles),
        )
    )
    return list(result.scalars().all())


async def _resolve_channel(db: AsyncSession, server: Server, channel_name: str) -> Channel:
    result = await db.execute(
        select(Channel).where(
            Channel.server_id == server.id,
            Channel.name == channel_name.lstrip("#"),
        )
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(404, f"Channel {channel_name} not found")
    return channel


async def _next_task_number(db: AsyncSession, channel_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Task.task_number), 0)).where(Task.channel_id == channel_id)
    )
    return int(result.scalar() or 0) + 1


def _serialize_workspace(workspace: AgentWorkspace, agent: Member | None = None) -> dict:
    agent_payload = None
    if agent:
        agent_payload = {
            "id": str(agent.id),
            "name": agent.display_name,
            "displayName": agent.display_name,
            "handle": f"@{agent.display_name}",
            "kind": agent.kind,
            "type": agent.kind,
            "status": agent.status,
            "backend": member_backend(agent),
            "computerId": member_computer_id(agent) or str(workspace.computer_id),
            "workspaceId": str(workspace.id),
            "profile": {
                "displayName": agent.display_name,
                "description": agent.description,
                "avatarUrl": agent.avatar_url,
            },
        }
    return {
        "id": str(workspace.id),
        "workspaceId": str(workspace.id),
        "computerId": str(workspace.computer_id),
        "agentId": str(workspace.agent_id),
        "agentName": agent.display_name if agent else None,
        "agentHandle": f"@{agent.display_name}" if agent else None,
        "agentStatus": agent.status if agent else None,
        "backend": member_backend(agent) if agent else None,
        "agent": agent_payload,
        "runtime": workspace.runtime,
        "runtimeCommand": workspace.runtime_command,
        "runtimeModel": workspace.runtime_model,
        "status": workspace.status,
        "sessionId": workspace.session_id,
        "cwd": workspace.cwd,
        "pid": workspace.pid,
        "startedAt": workspace.started_at.isoformat() if workspace.started_at else None,
        "stoppedAt": workspace.stopped_at.isoformat() if workspace.stopped_at else None,
    }


async def _serialize_computer(db: AsyncSession, computer: Computer) -> dict:
    workspaces_result = await db.execute(
        select(AgentWorkspace).where(AgentWorkspace.computer_id == computer.id)
    )
    workspaces = workspaces_result.scalars().all()

    workspace_items = []
    for workspace in workspaces:
        agent_result = await db.execute(select(Member).where(Member.id == workspace.agent_id))
        agent = agent_result.scalar_one_or_none()
        workspace_items.append(_serialize_workspace(workspace, agent))

    return {
        "id": str(computer.id),
        "serverId": str(computer.server_id),
        "name": computer.name,
        "os": computer.os,
        "daemonVersion": computer.daemon_version,
        "apiKeyPrefix": computer.api_key_prefix,
        "status": computer.status,
        "detectedRuntimes": computer.detected_runtimes or [],
        "agentWorkspaces": workspace_items,
        "createdAt": computer.created_at.isoformat() if computer.created_at else None,
        "updatedAt": computer.updated_at.isoformat() if computer.updated_at else None,
        "lastHeartbeatAt": computer.last_heartbeat_at.isoformat() if computer.last_heartbeat_at else None,
    }


async def _serialize_activity(db: AsyncSession, activity: ActivityLog) -> dict:
    agent_result = await db.execute(select(Member).where(Member.id == activity.agent_id))
    agent = agent_result.scalar_one_or_none()
    return {
        "id": str(activity.id),
        "serverId": str(activity.server_id),
        "agentId": str(activity.agent_id),
        "agentName": agent.display_name if agent else None,
        "type": activity.kind,
        "description": activity.description,
        "details": activity.details or {},
        "channelId": str(activity.channel_id) if activity.channel_id else None,
        "taskId": str(activity.task_id) if activity.task_id else None,
        "timestamp": activity.occurred_at.isoformat() if activity.occurred_at else None,
    }


def _serialize_file(file_entry: FileEntry) -> dict:
    return {
        "id": str(file_entry.id),
        "attachmentId": str(file_entry.id),
        "serverId": str(file_entry.server_id),
        "channelId": str(file_entry.channel_id) if file_entry.channel_id else None,
        "messageId": str(file_entry.message_id) if file_entry.message_id else None,
        "uploadedBy": str(file_entry.uploaded_by),
        "fileName": file_entry.file_name,
        "originalName": file_entry.original_name,
        "mimeType": file_entry.mime_type,
        "size": file_entry.size,
        "url": f"/api/attachments/{file_entry.id}/download",
        "previewUrl": f"/api/attachments/{file_entry.id}" if file_entry.mime_type.startswith("image/") else None,
        "metadata": file_entry.metadata_json or {},
        "createdAt": file_entry.created_at.isoformat() if file_entry.created_at else None,
    }


async def _serialize_reminder(db: AsyncSession, reminder: Reminder) -> dict:
    agent_result = await db.execute(select(Member).where(Member.id == reminder.agent_id))
    agent = agent_result.scalar_one_or_none()
    return {
        "id": str(reminder.id),
        "serverId": str(reminder.server_id),
        "agentId": str(reminder.agent_id),
        "agentName": agent.display_name if agent else None,
        "title": reminder.title,
        "description": reminder.description,
        "fireAt": reminder.fire_at.isoformat() if reminder.fire_at else None,
        "status": reminder.status,
        "repeat": reminder.repeat,
        "channelId": str(reminder.channel_id) if reminder.channel_id else None,
        "messageId": str(reminder.message_id) if reminder.message_id else None,
        "taskId": str(reminder.task_id) if reminder.task_id else None,
        "data": reminder.data or {},
        "createdAt": reminder.created_at.isoformat() if reminder.created_at else None,
        "updatedAt": reminder.updated_at.isoformat() if reminder.updated_at else None,
        "firedAt": reminder.fired_at.isoformat() if reminder.fired_at else None,
    }


async def _serialize_task(db: AsyncSession, task: Task) -> dict:
    creator_result = await db.execute(select(Member).where(Member.id == task.creator_id))
    creator = creator_result.scalar_one_or_none()
    creator_member = await serialize_member(db, creator) if creator else None
    assignee = None
    assignee_member = None
    if task.assignee_id:
        assignee_result = await db.execute(select(Member).where(Member.id == task.assignee_id))
        assignee = assignee_result.scalar_one_or_none()
        assignee_member = await serialize_member(db, assignee) if assignee else None
    channel_result = await db.execute(select(Channel).where(Channel.id == task.channel_id))
    channel = channel_result.scalar_one_or_none()
    return {
        "id": str(task.id),
        "number": task.task_number,
        "taskNumber": task.task_number,
        "channelId": str(task.channel_id),
        "channel": f"#{channel.name}" if channel and channel.kind == "public" else channel.name if channel else None,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "creator": creator.display_name if creator else "unknown",
        "creatorId": str(task.creator_id),
        "creatorMember": creator_member,
        "assignee": assignee.display_name if assignee else None,
        "assigneeId": str(task.assignee_id) if task.assignee_id else None,
        "assigneeMember": assignee_member,
        "data": task.data or {},
        "createdAt": task.created_at.isoformat() if task.created_at else None,
        "updatedAt": task.updated_at.isoformat() if task.updated_at else None,
    }


async def _record_activity(
    db: AsyncSession,
    server: Server,
    agent: Member,
    kind: str,
    description: str,
    details: dict | None = None,
    channel_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
) -> ActivityLog:
    details = details or {}
    activity = ActivityLog(
        server_id=server.id,
        agent_id=agent.id,
        kind=kind,
        description=description,
        details=details,
        channel_id=channel_id,
        task_id=task_id,
    )
    db.add(activity)
    await db.flush()

    event_type = PUBLIC_ACTIVITY_EVENT_TYPES.get(kind)
    if event_type:
        message_id = None
        raw_message_id = details.get("messageId") or details.get("message_id")
        if raw_message_id:
            try:
                message_id = uuid.UUID(str(raw_message_id))
            except ValueError:
                message_id = None
        payload = {
            "type": event_type,
            "legacyType": EVENT_TYPE_ALIASES.get(event_type, event_type.replace(".", "_")),
            "activityId": str(activity.id),
            "actorId": str(agent.id),
            "agentId": str(agent.id),
            "channelId": str(channel_id) if channel_id else None,
            "taskId": str(task_id) if task_id else None,
            "messageId": str(message_id) if message_id else details.get("messageId"),
            "description": description,
            "details": details,
            "createdAt": activity.occurred_at.isoformat() if activity.occurred_at else None,
            "occurredAt": activity.occurred_at.isoformat() if activity.occurred_at else None,
        }
        payload.update({key: value for key, value in details.items() if key not in payload or payload[key] is None})
        db.add(EventRecord(
            server_id=server.id,
            event_type=event_type,
            actor_id=agent.id,
            channel_id=channel_id,
            task_id=task_id,
            message_id=message_id,
            payload=payload,
        ))
    return activity


@router.get("/channels")
async def list_channels(_auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"channels": []}

    result = await db.execute(
        select(Channel).where(Channel.server_id == server.id, Channel.kind != "dm")
    )
    channels = result.scalars().all()

    return {
        "channels": [
            {
                "id": str(ch.id),
                "name": f"#{ch.name}" if ch.kind == "public" else ch.name,
                "type": ch.kind,
                "description": ch.description or "",
            }
            for ch in channels
        ]
    }


@router.get("/channels/{channel_name}/messages")
async def get_channel_messages(
    channel_name: str,
    limit: int = Query(50),
    db: AsyncSession = Depends(get_db),
):
    name = channel_name.lstrip("#")
    ch_result = await db.execute(
        select(Channel).where(Channel.name == name)
    )
    ch = ch_result.scalar_one_or_none()
    if not ch:
        return {"messages": []}

    msgs_result = await db.execute(
        select(Message).where(Message.channel_id == ch.id)
        .order_by(Message.seq.desc()).limit(limit)
    )
    messages = list(reversed(msgs_result.scalars().all()))

    result = []
    for msg in messages:
        sender_result = await db.execute(select(Member).where(Member.id == msg.sender_id))
        sender = sender_result.scalar_one_or_none()
        sender_member = await serialize_member(db, sender) if sender else None
        result.append({
            "seq": msg.seq,
            "id": str(msg.id),
            "shortId": msg.short_id,
            "channelId": str(msg.channel_id),
            "sender": f"@{sender.display_name}" if sender else "unknown",
            "senderId": str(msg.sender_id),
            "senderType": sender.kind if sender else "unknown",
            "senderMember": sender_member,
            "content": msg.content,
            "mentions": [str(item) for item in (msg.mentions or [])],
            "parentId": str(msg.parent_id) if msg.parent_id else None,
            "threadId": str(msg.parent_id or msg.id),
            "channelType": msg.channel_type,
            "time": msg.created_at.strftime("%Y-%m-%d %H:%M:%S") if msg.created_at else "",
            "createdAt": msg.created_at.isoformat() if msg.created_at else None,
        })

    return {"messages": result, "channelName": name}


@router.post("/channels/{channel_name}/messages")
async def create_channel_message(
    channel_name: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    body = await request.json()
    content = body.get("content")
    if not content:
        raise HTTPException(400, "Missing content")
    channel = await _resolve_channel(db, server, channel_name)
    sender = await _resolve_member(db, server, body.get("sender") or "zy-ean")
    parent_id = None
    thread_ref = body.get("threadId") or body.get("parentId")
    if thread_ref:
        try:
            parsed_thread_id = uuid.UUID(thread_ref)
        except ValueError:
            parsed_thread_id = None
        if parsed_thread_id:
            result = await db.execute(
                select(Message).where(Message.id == parsed_thread_id, Message.channel_id == channel.id)
            )
        else:
            result = await db.execute(
                select(Message).where(Message.short_id == thread_ref, Message.channel_id == channel.id)
            )
        parent = result.scalar_one_or_none()
        if not parent:
            raise HTTPException(404, "Thread root not found")
        parent_id = parent.parent_id or parent.id

    seq_result = await db.execute(select(func.coalesce(func.max(Message.seq), 0)))
    msg = Message(
        short_id=uuid.uuid4().hex[:8],
        channel_id=channel.id,
        sender_id=sender.id,
        parent_id=parent_id,
        content=content,
        channel_type="thread" if parent_id else channel.kind,
        mentions=await _parse_mentions(db, server, content),
        seq=int(seq_result.scalar() or 0) + 1,
    )
    db.add(msg)
    await db.flush()
    await _record_activity(
        db,
        server,
        sender,
        "supervisor_message_sent",
        f"@{sender.display_name} sent supervisor message to #{channel.name}",
        {
            "messageId": str(msg.id),
            "shortId": msg.short_id,
            "seq": msg.seq,
            "messageSeq": msg.seq,
            "senderId": str(sender.id),
            "content": msg.content,
            "messageSnippet": content[:200],
            "channelType": msg.channel_type,
            "mentions": [str(item) for item in (msg.mentions or [])],
            "parentId": str(parent_id) if parent_id else None,
            "threadId": str(parent_id or msg.id),
        },
        channel_id=channel.id,
    )
    await db.commit()
    await db.refresh(msg)
    return {
        "created": True,
        "message": {
            "id": str(msg.id),
            "shortId": msg.short_id,
            "seq": msg.seq,
            "channelId": str(channel.id),
            "channel": f"#{channel.name}",
            "sender": f"@{sender.display_name}",
            "senderId": str(sender.id),
            "senderType": sender.kind,
            "senderMember": await serialize_member(db, sender),
            "content": msg.content,
            "parentId": str(parent_id) if parent_id else None,
            "threadId": str(parent_id or msg.id),
            "channelType": msg.channel_type,
            "createdAt": msg.created_at.isoformat() if msg.created_at else None,
        },
    }


@router.get("/tasks")
async def list_tasks(_auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Task).order_by(Task.task_number))
    tasks = result.scalars().all()

    task_list = [await _serialize_task(db, task) for task in tasks]

    return {"tasks": task_list}


@router.post("/tasks")
async def create_task(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    server = await _get_server(db)
    body = await request.json()
    title = body.get("title")
    if not title:
        raise HTTPException(400, "Missing title")
    channel = await _resolve_channel(db, server, body.get("channel") or "#all")
    creator = await _resolve_member(db, server, body.get("creator") or "zy-ean")
    if not creator:
        raise HTTPException(400, "Missing creator")
    assignee = await _resolve_member(db, server, body.get("assignee"))
    task = Task(
        task_number=await _next_task_number(db, channel.id),
        channel_id=channel.id,
        title=title,
        description=body.get("description"),
        status=body.get("status") or "todo",
        creator_id=creator.id,
        assignee_id=assignee.id if assignee else None,
        data=body.get("data") or {},
    )
    db.add(task)
    await db.flush()
    await _record_activity(
        db,
        server,
        creator,
        "supervisor_task_created",
        f"@{creator.display_name} created task #{task.task_number}",
        {"taskNumber": task.task_number, "title": task.title, "assignee": assignee.display_name if assignee else None},
        channel_id=channel.id,
        task_id=task.id,
    )
    await db.commit()
    await db.refresh(task)
    return {"created": True, "task": await _serialize_task(db, task)}


@router.patch("/tasks/{task_id}")
async def update_task(task_id: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    server = await _get_server(db)
    body = await request.json()
    try:
        parsed_task_id = uuid.UUID(task_id)
    except ValueError:
        parsed_task_id = None

    q = select(Task).join(Channel).where(Channel.server_id == server.id)
    if parsed_task_id:
        q = q.where(Task.id == parsed_task_id)
    else:
        try:
            q = q.where(Task.task_number == int(task_id))
        except ValueError:
            raise HTTPException(400, "Invalid task id")
    result = await db.execute(q)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")

    if "title" in body:
        task.title = body["title"]
    if "description" in body:
        task.description = body["description"]
    if "status" in body:
        task.status = body["status"]
    if "assignee" in body:
        assignee = await _resolve_member(db, server, body.get("assignee"))
        task.assignee_id = assignee.id if assignee else None
    if "data" in body:
        task.data = body["data"] or {}

    actor = await _resolve_member(db, server, body.get("actor") or "zy-ean")
    await _record_activity(
        db,
        server,
        actor,
        "supervisor_task_updated",
        f"@{actor.display_name} updated task #{task.task_number}",
        {"taskNumber": task.task_number, "updates": body},
        channel_id=task.channel_id,
        task_id=task.id,
    )
    await db.commit()
    await db.refresh(task)
    return {"updated": True, "task": await _serialize_task(db, task)}


@router.get("/computers")
async def list_computers(_auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"computers": []}

    result = await db.execute(select(Computer).where(Computer.server_id == server.id))
    computers = result.scalars().all()
    return {
        "computers": [await _serialize_computer(db, computer) for computer in computers],
        "count": len(computers),
    }


@router.get("/activity")
async def list_activity(
    agent_id: str | None = Query(None, alias="agentId"),
    limit: int = Query(50),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"activity": [], "count": 0}

    q = select(ActivityLog).where(ActivityLog.server_id == server.id)
    if agent_id:
        try:
            parsed_agent_id = uuid.UUID(agent_id)
        except ValueError:
            raise HTTPException(400, "Invalid agentId")
        q = q.where(ActivityLog.agent_id == parsed_agent_id)
    q = q.order_by(ActivityLog.occurred_at.desc()).limit(limit)

    result = await db.execute(q)
    items = result.scalars().all()
    return {
        "activity": [await _serialize_activity(db, item) for item in items],
        "count": len(items),
    }


@router.get("/files")
async def list_files(
    channel_id: str | None = Query(None, alias="channelId"),
    limit: int = Query(50),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"files": [], "count": 0}

    q = select(FileEntry).where(FileEntry.server_id == server.id)
    if channel_id:
        try:
            parsed_channel_id = uuid.UUID(channel_id)
        except ValueError:
            raise HTTPException(400, "Invalid channelId")
        q = q.where(FileEntry.channel_id == parsed_channel_id)
    q = q.order_by(FileEntry.created_at.desc()).limit(limit)

    result = await db.execute(q)
    files = result.scalars().all()
    return {"files": [_serialize_file(item) for item in files], "count": len(files)}


@router.get("/reminders")
async def list_reminders(
    status: str | None = Query(None),
    limit: int = Query(50),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"reminders": [], "count": 0}

    q = select(Reminder).where(Reminder.server_id == server.id)
    if status:
        q = q.where(Reminder.status == status)
    q = q.order_by(Reminder.fire_at).limit(limit)
    result = await db.execute(q)
    reminders = result.scalars().all()
    return {
        "reminders": [await _serialize_reminder(db, item) for item in reminders],
        "count": len(reminders),
    }


@router.get("/members")
async def list_members(_auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"members": []}

    result = await db.execute(select(Member).where(Member.server_id == server.id))
    members = result.scalars().all()

    return {
        "members": [await serialize_member(db, member) for member in members],
        "count": len(members),
    }


@router.patch("/members/{member_id}")
async def update_member(member_id: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    server = await _get_server(db)
    member = await _resolve_member(db, server, member_id)
    if not member:
        raise HTTPException(404, "Member not found")
    body = await request.json()

    if "status" in body:
        member.status = body["status"]
    if "description" in body:
        member.description = body["description"]
    config = dict(member.config or {})
    if "permissions" in body:
        config["permissions"] = {**(config.get("permissions") or {}), **(body.get("permissions") or {})}
    if "actions" in body:
        config["actions"] = {**(config.get("actions") or {}), **(body.get("actions") or {})}
    if "backend" in body:
        config["backend"] = body["backend"]
        member.backend = body["backend"]
    member.config = config

    actor = await _resolve_member(db, server, body.get("actor") or "zy-ean")
    await _record_activity(
        db,
        server,
        actor,
        "supervisor_member_updated",
        f"@{actor.display_name} updated @{member.display_name}",
        {
            "memberId": str(member.id),
            "status": member.status,
            "permissions": body.get("permissions") or {},
            "actions": body.get("actions") or {},
        },
    )
    await db.commit()
    await db.refresh(member)
    return {"updated": True, "member": await serialize_member(db, member)}


@router.post("/reminders")
async def create_public_reminder(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    server = await _get_server(db)
    body = await request.json()
    title = body.get("title")
    if not title:
        raise HTTPException(400, "Missing title")
    agent = await _resolve_member(db, server, body.get("agent") or body.get("agentId") or "aaa")
    if not agent or agent.kind != "agent":
        raise HTTPException(400, "Reminder owner must be an agent")
    if body.get("fireAt"):
        try:
            fire_at = datetime.fromisoformat(str(body["fireAt"]).replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "Invalid fireAt")
    elif body.get("delaySeconds") is not None:
        fire_at = _utcnow() + timedelta(seconds=int(body["delaySeconds"]))
    else:
        raise HTTPException(400, "Missing fireAt or delaySeconds")

    channel_id = None
    if body.get("channel"):
        channel = await _resolve_channel(db, server, body["channel"])
        channel_id = channel.id
    reminder = Reminder(
        server_id=server.id,
        agent_id=agent.id,
        title=title,
        description=body.get("description"),
        fire_at=fire_at,
        repeat=body.get("repeat"),
        channel_id=channel_id,
        data=body.get("data") or {},
    )
    db.add(reminder)
    await db.flush()
    await _record_activity(
        db,
        server,
        agent,
        "supervisor_reminder_created",
        f"Supervisor scheduled reminder for @{agent.display_name}: {title}",
        {"reminderId": str(reminder.id), "fireAt": reminder.fire_at.isoformat()},
        channel_id=channel_id,
    )
    await db.commit()
    await db.refresh(reminder)
    return {"created": True, "reminder": await _serialize_reminder(db, reminder)}


@router.patch("/reminders/{reminder_id}")
async def update_public_reminder(reminder_id: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    server = await _get_server(db)
    try:
        parsed_id = uuid.UUID(reminder_id)
    except ValueError:
        raise HTTPException(400, "Invalid reminder id")
    result = await db.execute(
        select(Reminder).where(Reminder.id == parsed_id, Reminder.server_id == server.id)
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(404, "Reminder not found")
    body = await request.json()
    if "status" in body:
        reminder.status = body["status"]
    if "title" in body:
        reminder.title = body["title"]
    if "description" in body:
        reminder.description = body["description"]
    if "fireAt" in body:
        try:
            reminder.fire_at = datetime.fromisoformat(str(body["fireAt"]).replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "Invalid fireAt")
    if "delaySeconds" in body:
        reminder.fire_at = _utcnow() + timedelta(seconds=int(body["delaySeconds"]))
    if "repeat" in body:
        reminder.repeat = body["repeat"]
    if body.get("cancel"):
        reminder.status = "cancelled"
    await db.commit()
    await db.refresh(reminder)
    return {"updated": True, "reminder": await _serialize_reminder(db, reminder)}
