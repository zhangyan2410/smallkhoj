"""Public API routes — frontend-facing endpoints under /api/v1/."""

import hashlib
import re
import secrets
import shlex
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    get_db, Account, AgentWorkspace, ActivityLog, ApiKey, Channel, ChannelMember,
    Computer, ConnectTicket, Member, Message, EventRecord, FileEntry, Reminder,
    Server, Task, ThreadSummary,
)
from routers.member_serialization import member_backend, member_computer_id, serialize_member
from services.daemon_control import (
    PENDING_RUNTIME_START_STATUS,
    RUNTIME_ACTIVE_STATUSES,
    daemon_control_hub,
    push_latest_events_for_server,
    runtime_start_command,
)
from services.thread_summary import (
    load_thread_metadata,
    resolve_thread_root,
    serialize_thread_summary,
    thread_reply_count,
)

router = APIRouter(prefix="/api/v1", tags=["public"])

PUBLIC_API_KEY = "sk_public_local"
DEFAULT_LOCAL_AGENT_ID = "aaaa0000-0000-0000-0000-000000000001"
DEFAULT_LOCAL_DAEMON_DIR = Path(__file__).resolve().parents[2] / "agent" / "daemon" / "aaa-daemon"
CONNECT_TICKET_TTL_SECONDS = 300
DEFAULT_SERVER_ID = uuid.UUID("3893c518-c8f8-43ba-af0d-54a7773bbb6d")
DEFAULT_SERVER_NAME = "Slock Server"
SESSION_COOKIE_NAME = "smallkhoj_session"
ACCOUNT_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")

PUBLIC_ACTIVITY_EVENT_TYPES = {
    "supervisor_message_sent": "message.created",
    "supervisor_task_created": "task.created",
    "supervisor_task_updated": "task.updated",
    "supervisor_member_updated": "member.updated",
    "supervisor_reminder_created": "reminder.created",
    "supervisor_reminder_updated": "reminder.updated",
}

HEARTBEAT_ACTIVITY_TYPES = {"workspace_heartbeat"}

EVENT_TYPE_ALIASES = {
    "message.created": "message_received",
    "task.created": "task_created",
    "task.updated": "task_updated",
    "member.updated": "member_updated",
    "reminder.created": "reminder_created",
    "reminder.updated": "reminder_updated",
}


def _computer_connection_command(
    token: str,
    server_url: str,
    agent_id: str = DEFAULT_LOCAL_AGENT_ID,
    daemon_dir: Path = DEFAULT_LOCAL_DAEMON_DIR,
) -> str:
    """Command shown in the UI for connecting this repo's local aaa-daemon."""
    return " ".join(
        [
            "cd",
            shlex.quote(str(daemon_dir)),
            "&&",
            f"SLOCK_AGENT_TOKEN={shlex.quote(token)}",
            "SLOCK_ALLOW_WRITES=1",
            "node",
            "dist/cmd/main.js",
            "start",
            "--foreground",
            "--runtime",
            "none",
            "--server",
            shlex.quote(server_url),
            "--ws",
            "auto",
            "--agent-id",
            shlex.quote(agent_id),
            "--register-daemon",
        ]
    )


def _computer_connect_command(connect_token: str, server_url: str, daemon_dir: Path = DEFAULT_LOCAL_DAEMON_DIR) -> str:
    """Command shown in the UI for connecting a daemon with a one-time ticket."""
    return " ".join(
        [
            "cd",
            shlex.quote(str(daemon_dir)),
            "&&",
            f"SLOCK_CONNECT_TOKEN={shlex.quote(connect_token)}",
            "SLOCK_ALLOW_WRITES=1",
            "node",
            "dist/cmd/main.js",
            "start",
            "--foreground",
            "--runtime",
            "none",
            "--server",
            shlex.quote(server_url),
            "--ws",
            "auto",
            "--proxy-port",
            "0",
            "--register-daemon",
        ]
    )

MENTION_RE = re.compile(r"(?<![\w@])@([A-Za-z0-9_.-]+)")


def _utcnow() -> datetime:
    return datetime.utcnow()


def _utcnow_aware() -> datetime:
    return datetime.now(timezone.utc)


def _lease_expired(value: datetime | None) -> bool:
    if not value:
        return False
    now = datetime.now(value.tzinfo) if value.tzinfo else _utcnow()
    return value <= now


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


async def _ensure_server(db: AsyncSession) -> Server:
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if server:
        return server
    server = Server(id=DEFAULT_SERVER_ID, name=DEFAULT_SERVER_NAME)
    db.add(server)
    await db.flush()
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


async def _ensure_human_member(db: AsyncSession, server: Server, handle_or_id: str) -> Member:
    name = handle_or_id.lstrip("@").strip()
    if not name:
        raise HTTPException(400, "Missing human member")

    result = await db.execute(
        select(Member).where(
            Member.server_id == server.id,
            Member.display_name == name,
        )
    )
    member = result.scalar_one_or_none()
    if member:
        return member

    member = Member(
        server_id=server.id,
        kind="human",
        display_name=name,
        status="online",
    )
    db.add(member)
    await db.flush()
    return member


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _normalize_account_name(raw_name: str | None) -> str:
    name = (raw_name or "").strip().lstrip("@")
    if not name:
        raise HTTPException(400, "Missing account name")
    if not ACCOUNT_NAME_RE.fullmatch(name):
        raise HTTPException(400, "Account name must use letters, numbers, dot, underscore, or dash")
    return name


async def _account_from_token(db: AsyncSession, token: str | None) -> Account | None:
    if not token:
        return None
    result = await db.execute(select(Account).where(Account.session_token_hash == _hash_token(token)))
    return result.scalar_one_or_none()


async def _current_account(db: AsyncSession, request: Request) -> Account | None:
    token = request.headers.get("X-Account-Token") or request.cookies.get(SESSION_COOKIE_NAME)
    return await _account_from_token(db, token)


async def _bootstrap_account(
    db: AsyncSession,
    *,
    name: str,
    display_name: str | None = None,
) -> tuple[Account, Server, Member, str]:
    account_name = _normalize_account_name(name)
    server = await _ensure_server(db)
    result = await db.execute(select(Account).where(Account.name == account_name))
    account = result.scalar_one_or_none()
    if account:
        member_result = await db.execute(select(Member).where(Member.id == account.member_id))
        member = member_result.scalar_one_or_none()
        if not member:
            member = await _ensure_human_member(db, server, account_name)
            account.member_id = member.id
        account.server_id = server.id
    else:
        member = await _ensure_human_member(db, server, account_name)
        account = Account(
            name=account_name,
            display_name=display_name or account_name,
            server_id=server.id,
            member_id=member.id,
        )
        db.add(account)
        await db.flush()

    member.status = "online"
    if display_name:
        account.display_name = display_name
    token = f"sk_session_{secrets.token_urlsafe(32)}"
    account.session_token_hash = _hash_token(token)
    account.last_login_at = _utcnow_aware()
    await db.flush()
    return account, server, member, token


async def _resolve_human_actor(
    db: AsyncSession,
    server: Server,
    request: Request,
    explicit_name: str | None,
    *,
    role: str,
    required: bool = True,
) -> Member | None:
    if explicit_name:
        return await _ensure_human_member(db, server, explicit_name)
    account = await _current_account(db, request)
    if account:
        member_result = await db.execute(
            select(Member).where(Member.id == account.member_id, Member.server_id == server.id)
        )
        member = member_result.scalar_one_or_none()
        if member:
            return member
        return await _ensure_human_member(db, server, account.name)
    if required:
        raise HTTPException(401, f"Login required for {role}")
    return None


async def _serialize_account(db: AsyncSession, account: Account, server: Server, member: Member) -> dict:
    return {
        "account": {
            "id": str(account.id),
            "name": account.name,
            "displayName": account.display_name or account.name,
        },
        "server": {
            "id": str(server.id),
            "name": server.name,
        },
        "member": await serialize_member(db, member),
    }


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


def _display_channel_target(channel: Channel) -> str:
    if channel.kind in {"public", "private"}:
        return f"#{channel.name}"
    return channel.name


def _message_target_for_runtime(channel: Channel, sender: Member, *, thread_ref: str | None = None) -> str:
    base = f"dm:@{sender.display_name}" if channel.kind == "dm" else _display_channel_target(channel)
    return f"{base}:{thread_ref}" if thread_ref else base


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


@router.post("/auth/register")
async def register_account(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    body = await request.json()
    account, server, member, token = await _bootstrap_account(
        db,
        name=body.get("name"),
        display_name=body.get("displayName"),
    )
    await db.commit()
    payload = await _serialize_account(db, account, server, member)
    payload["sessionToken"] = token
    return payload


@router.post("/auth/login")
async def login_account(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    body = await request.json()
    account, server, member, token = await _bootstrap_account(
        db,
        name=body.get("name"),
        display_name=body.get("displayName"),
    )
    await db.commit()
    payload = await _serialize_account(db, account, server, member)
    payload["sessionToken"] = token
    return payload


@router.get("/auth/me")
async def current_account(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    account = await _current_account(db, request)
    if not account:
        raise HTTPException(401, "Not logged in")
    server_result = await db.execute(select(Server).where(Server.id == account.server_id))
    server = server_result.scalar_one_or_none()
    member_result = await db.execute(select(Member).where(Member.id == account.member_id))
    member = member_result.scalar_one_or_none()
    if not server or not member:
        raise HTTPException(401, "Account is not linked to a server member")
    return await _serialize_account(db, account, server, member)


@router.post("/auth/logout")
async def logout_account(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    account = await _current_account(db, request)
    if account:
        account.session_token_hash = None
        await db.commit()
    return {"ok": True}


async def _next_task_number(db: AsyncSession, channel_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Task.task_number), 0)).where(Task.channel_id == channel_id)
    )
    return int(result.scalar() or 0) + 1


def _serialize_workspace(
    workspace: AgentWorkspace,
    agent: Member | None = None,
    *,
    effective_status: str | None = None,
) -> dict:
    status = effective_status or workspace.status
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
        "status": status,
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

    status = computer.status
    if (
        _lease_expired(computer.daemon_lease_expires_at)
        and status in {"online", "active"}
    ):
        status = "offline"

    workspace_items = []
    for workspace in workspaces:
        agent_result = await db.execute(select(Member).where(Member.id == workspace.agent_id))
        agent = agent_result.scalar_one_or_none()
        effective_status = (
            "offline"
            if status == "offline" and workspace.status in RUNTIME_ACTIVE_STATUSES
            else workspace.status
        )
        workspace_items.append(_serialize_workspace(workspace, agent, effective_status=effective_status))

    return {
        "id": str(computer.id),
        "serverId": str(computer.server_id),
        "name": computer.name,
        "machineId": computer.machine_id,
        "os": computer.os,
        "daemonVersion": computer.daemon_version,
        "apiKeyPrefix": computer.api_key_prefix,
        "status": status,
        "activeDaemonId": computer.active_daemon_id,
        "daemonLeaseExpiresAt": computer.daemon_lease_expires_at.isoformat() if computer.daemon_lease_expires_at else None,
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


def compact_activity_feed(items: list[ActivityLog], limit: int) -> list[ActivityLog]:
    latest_heartbeats_by_agent: dict[uuid.UUID, ActivityLog] = {}
    visible_items: list[ActivityLog] = []
    sort_key = lambda item: item.occurred_at or datetime.min.replace(tzinfo=timezone.utc)

    for item in items:
        if item.kind in HEARTBEAT_ACTIVITY_TYPES:
            latest_heartbeats_by_agent.setdefault(item.agent_id, item)
        else:
            visible_items.append(item)

    visible_items.sort(key=sort_key, reverse=True)
    heartbeats = sorted(latest_heartbeats_by_agent.values(), key=sort_key, reverse=True)
    remaining = max(limit - len(visible_items), 0)
    return [*visible_items[:limit], *heartbeats[:remaining]]


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


async def _serialize_public_message(
    db: AsyncSession,
    msg: Message,
    thread_metadata: dict[uuid.UUID, dict] | None = None,
) -> dict:
    sender_result = await db.execute(select(Member).where(Member.id == msg.sender_id))
    sender = sender_result.scalar_one_or_none()
    sender_member = await serialize_member(db, sender) if sender else None
    root_id = msg.parent_id or msg.id
    metadata = (thread_metadata or {}).get(root_id, {})
    return {
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
        "threadId": str(root_id),
        "threadShortId": msg.short_id if not msg.parent_id else None,
        "channelType": msg.channel_type,
        "replyCount": int(metadata.get("replyCount") or 0) if not msg.parent_id else 0,
        "threadSummary": metadata.get("threadSummary") if not msg.parent_id else None,
        "time": msg.created_at.strftime("%Y-%m-%d %H:%M:%S") if msg.created_at else "",
        "createdAt": msg.created_at.isoformat() if msg.created_at else None,
    }


async def _dm_channel_payload(db: AsyncSession, channel: Channel, viewer: Member) -> dict:
    peer_result = await db.execute(
        select(Member)
        .join(ChannelMember, ChannelMember.member_id == Member.id)
        .where(
            ChannelMember.channel_id == channel.id,
            Member.id != viewer.id,
        )
        .order_by(Member.kind.desc(), Member.display_name)
        .limit(1)
    )
    peer = peer_result.scalar_one_or_none()
    return {
        "id": str(channel.id),
        "name": channel.name,
        "type": "dm",
        "displayName": f"DM @{peer.display_name}" if peer else "DM",
        "peer": await serialize_member(db, peer) if peer else None,
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
        "messageId": str(task.message_id) if task.message_id else None,
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
    threadMode: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    name = channel_name.lstrip("#")
    ch_result = await db.execute(
        select(Channel).where(Channel.name == name)
    )
    ch = ch_result.scalar_one_or_none()
    if not ch:
        return {"messages": []}

    q = select(Message).where(Message.channel_id == ch.id)
    if threadMode == "roots":
        q = q.where(Message.parent_id.is_(None))
    msgs_result = await db.execute(q.order_by(Message.seq.desc()).limit(limit))
    messages = list(reversed(msgs_result.scalars().all()))

    root_ids = [msg.id for msg in messages if msg.parent_id is None]
    metadata = await load_thread_metadata(db, root_ids)
    result = [await _serialize_public_message(db, msg, metadata) for msg in messages]

    return {"messages": result, "channelName": name}


@router.get("/threads/{thread_id}")
async def get_public_thread(
    thread_id: str,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    root = await resolve_thread_root(db, server.id, thread_id)
    if not root:
        raise HTTPException(404, "Thread root not found")
    replies_result = await db.execute(
        select(Message).where(Message.parent_id == root.id).order_by(Message.seq)
    )
    replies = replies_result.scalars().all()
    summary_result = await db.execute(
        select(ThreadSummary).where(ThreadSummary.root_message_id == root.id)
    )
    summary = summary_result.scalar_one_or_none()
    metadata = {
        root.id: {
            "replyCount": len(replies),
            "threadSummary": serialize_thread_summary(summary),
        }
    }
    return {
        "thread": await _serialize_public_message(db, root, metadata),
        "replies": [
            await _serialize_public_message(db, item, metadata)
            for item in replies
        ],
        "messages": [
            await _serialize_public_message(db, item, metadata)
            for item in [root, *replies]
        ],
        "replyCount": len(replies),
        "threadSummary": serialize_thread_summary(summary),
    }


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
    sender = await _resolve_human_actor(db, server, request, body.get("sender"), role="message sender")
    parent_id = None
    thread_target_short_id = None
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
        root = parent
        if parent.parent_id:
            root_result = await db.execute(select(Message).where(Message.id == parent.parent_id))
            root = root_result.scalar_one_or_none() or parent
        thread_target_short_id = root.short_id

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
    event_target = _message_target_for_runtime(channel, sender, thread_ref=thread_target_short_id)
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
            "target": event_target,
            "channel": event_target,
            "channelType": msg.channel_type,
            "mentions": [str(item) for item in (msg.mentions or [])],
            "parentId": str(parent_id) if parent_id else None,
            "threadId": str(parent_id or msg.id),
        },
        channel_id=channel.id,
    )
    await db.commit()
    await db.refresh(msg)
    await push_latest_events_for_server(db, server_id=server.id)
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
    creator = await _resolve_human_actor(db, server, request, body.get("creator"), role="task creator")
    assignee = await _resolve_member(db, server, body.get("assignee"))
    parsed_message_id = None
    source_payload = None
    if body.get("messageId"):
        try:
            parsed_message_id = uuid.UUID(str(body.get("messageId")))
        except ValueError:
            raise HTTPException(400, "Invalid messageId")
        message_result = await db.execute(
            select(Message).where(Message.id == parsed_message_id, Message.channel_id == channel.id)
        )
        source_message = message_result.scalar_one_or_none()
        if not source_message:
            raise HTTPException(404, "Source message not found in task channel")
        source_payload = {
            "type": "message",
            "messageId": str(source_message.id),
            "messageShortId": source_message.short_id,
            "threadId": str(source_message.parent_id or source_message.id),
            "channelId": str(channel.id),
            "channel": f"#{channel.name}" if channel.kind == "public" else channel.name,
        }
    task_data = body.get("data") or {}
    if source_payload:
        task_data = {**task_data, "source": source_payload}
    task = Task(
        task_number=await _next_task_number(db, channel.id),
        channel_id=channel.id,
        message_id=parsed_message_id,
        title=title,
        description=body.get("description"),
        status=body.get("status") or "todo",
        creator_id=creator.id,
        assignee_id=assignee.id if assignee else None,
        data=task_data,
    )
    db.add(task)
    await db.flush()
    channel_target = f"#{channel.name}" if channel.kind == "public" else channel.name
    assignee_handle = f"@{assignee.display_name}" if assignee else None
    await _record_activity(
        db,
        server,
        creator,
        "supervisor_task_created",
        f"@{creator.display_name} created task #{task.task_number}",
        {
            "taskNumber": task.task_number,
            "title": task.title,
            "status": task.status,
            "assignee": assignee_handle,
            "assigneeId": str(assignee.id) if assignee else None,
            "targetAgentId": str(assignee.id) if assignee and assignee.kind == "agent" else None,
            "target": channel_target,
            "channel": channel_target,
            "messageId": str(parsed_message_id) if parsed_message_id else None,
            "source": source_payload,
        },
        channel_id=channel.id,
        task_id=task.id,
    )
    await db.commit()
    await db.refresh(task)
    await push_latest_events_for_server(db, server_id=server.id)
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

    actor = await _resolve_human_actor(db, server, request, body.get("actor"), role="task actor")
    assignee = None
    if task.assignee_id:
        assignee_result = await db.execute(select(Member).where(Member.id == task.assignee_id))
        assignee = assignee_result.scalar_one_or_none()
    await _record_activity(
        db,
        server,
        actor,
        "supervisor_task_updated",
        f"@{actor.display_name} updated task #{task.task_number}",
        {
            "taskNumber": task.task_number,
            "title": task.title,
            "status": task.status,
            "updates": body,
            "assignee": f"@{assignee.display_name}" if assignee else None,
            "assigneeId": str(assignee.id) if assignee else None,
            "targetAgentId": str(assignee.id) if assignee and assignee.kind == "agent" else None,
        },
        channel_id=task.channel_id,
        task_id=task.id,
    )
    await db.commit()
    await db.refresh(task)
    await push_latest_events_for_server(db, server_id=server.id)
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
    compact: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"activity": [], "count": 0}

    requested_limit = max(1, min(limit, 100))
    query_limit = min(max(requested_limit * 20, 250), 500) if compact else requested_limit
    q = select(ActivityLog).where(ActivityLog.server_id == server.id)
    if agent_id:
        try:
            parsed_agent_id = uuid.UUID(agent_id)
        except ValueError:
            raise HTTPException(400, "Invalid agentId")
        q = q.where(ActivityLog.agent_id == parsed_agent_id)
    q = q.order_by(ActivityLog.occurred_at.desc()).limit(query_limit)

    result = await db.execute(q)
    items = result.scalars().all()
    if compact:
        items = compact_activity_feed(items, requested_limit)
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

    actor = await _resolve_human_actor(db, server, request, body.get("actor"), role="member actor")
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


# ── Computer Credential ───────────────────────────────────────


@router.post("/computers/connect-command")
async def generate_computer_connect_command(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    server = await _ensure_server(db)
    body = await request.json()
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Missing name")

    token = f"sk_connect_{secrets.token_urlsafe(32)}"
    expires_at = _utcnow_aware() + timedelta(seconds=CONNECT_TICKET_TTL_SECONDS)
    db.add(ConnectTicket(
        server_id=server.id,
        key_prefix=token[:20],
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        requested_name=name,
        expires_at=expires_at,
    ))
    server_url = body.get("serverUrl", "http://localhost:8000")
    await db.commit()
    return {
        "connectToken": token,
        "command": _computer_connect_command(token, server_url),
        "expiresAt": expires_at.isoformat(),
    }


@router.post("/computers/{computer_id}/reconnect-command")
async def generate_computer_reconnect_command(
    computer_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_computer_id = uuid.UUID(computer_id)
    except ValueError:
        raise HTTPException(400, "Invalid computer id")

    result = await db.execute(
        select(Computer).where(Computer.id == parsed_computer_id, Computer.server_id == server.id)
    )
    computer = result.scalar_one_or_none()
    if not computer:
        raise HTTPException(404, "Computer not found")

    token = f"sk_connect_{secrets.token_urlsafe(32)}"
    expires_at = _utcnow_aware() + timedelta(seconds=CONNECT_TICKET_TTL_SECONDS)
    db.add(ConnectTicket(
        server_id=server.id,
        key_prefix=token[:20],
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        requested_name=computer.name,
        expires_at=expires_at,
    ))
    server_url = (await request.json()).get("serverUrl", "http://localhost:8000")
    await db.commit()
    return {
        "connectToken": token,
        "computerId": str(computer.id),
        "name": computer.name,
        "command": _computer_connect_command(token, server_url),
        "expiresAt": expires_at.isoformat(),
    }


@router.post("/computers/credential")
async def generate_computer_credential(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    server = await _ensure_server(db)
    body = await request.json()
    name = body.get("name", "unregistered-computer")
    existing = (await db.execute(
        select(Computer).where(Computer.server_id == server.id, Computer.name == name)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"Computer name {name} already exists")

    token = f"sk_machine_{secrets.token_urlsafe(32)}"
    key_prefix = token[:20]
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    computer_id = uuid.uuid4()
    computer = Computer(
        id=computer_id,
        server_id=server.id,
        name=name,
        os="unknown",
        daemon_version="unknown",
        api_key_prefix=key_prefix,
        status="offline",
        detected_runtimes=[],
    )
    db.add(computer)

    db.add(ApiKey(
        key_prefix=key_prefix,
        token_hash=token_hash,
        resource_type="computer",
        resource_id=computer_id,
        server_id=server.id,
    ))

    server_url = body.get("serverUrl", "http://localhost:8000")
    await db.commit()
    return {
        "created": True,
        "computerId": str(computer_id),
        "apiKey": token,
        "command": _computer_connection_command(token, server_url),
    }


# ── Agent Creation ────────────────────────────────────────────


@router.post("/members/agents")
async def create_agent(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    body = await request.json()
    name = body.get("name")
    if not name:
        raise HTTPException(400, "Missing name")
    existing_agent = (await db.execute(
        select(Member).where(Member.server_id == server.id, Member.display_name == name)
    )).scalar_one_or_none()
    if existing_agent:
        raise HTTPException(409, f"Member name {name} already exists")

    computer_id = body.get("computerId")
    if not computer_id:
        raise HTTPException(400, "Missing computerId")
    try:
        computer_id = uuid.UUID(computer_id)
    except ValueError:
        raise HTTPException(400, "Invalid computerId")

    computer_result = await db.execute(
        select(Computer).where(Computer.id == computer_id, Computer.server_id == server.id)
    )
    computer = computer_result.scalar_one_or_none()
    if not computer:
        raise HTTPException(404, "Computer not found")

    runtime = body.get("runtime", "claude_code")
    runtime_command = body.get("runtimeCommand")
    runtime_model = body.get("runtimeModel")

    agent = Member(
        server_id=server.id,
        kind="agent",
        display_name=name,
        status=body.get("status", "offline"),
        computer_id=computer_id,
        backend=body.get("backend"),
        config={
            "computerId": str(computer_id),
            "backend": body.get("backend"),
        },
    )
    db.add(agent)
    await db.flush()

    workspace = AgentWorkspace(
        computer_id=computer_id,
        agent_id=agent.id,
        runtime=runtime,
        runtime_command=runtime_command,
        runtime_model=runtime_model,
        status=PENDING_RUNTIME_START_STATUS,
        cwd=body.get("cwd"),
    )
    db.add(workspace)
    await db.flush()

    agent.config = {**(agent.config or {}), "workspaceId": str(workspace.id)}

    await db.commit()
    await db.refresh(agent)
    await db.refresh(workspace)
    await daemon_control_hub.push(computer.id, runtime_start_command(workspace, agent))
    return {
        "created": True,
        "member": await serialize_member(db, agent),
        "workspace": _serialize_workspace(workspace, agent),
    }


# ── Channel Creation ─────────────────────────────────────────


@router.post("/channels")
async def create_channel(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    body = await request.json()
    name = body.get("name")
    if not name:
        raise HTTPException(400, "Missing name")

    name = name.lstrip("#")
    kind = body.get("type") or body.get("kind", "public")
    if kind not in ("public", "private"):
        raise HTTPException(400, "Invalid channel type")

    existing = await db.execute(
        select(Channel).where(Channel.server_id == server.id, Channel.name == name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"Channel #{name} already exists")

    creator = await _resolve_human_actor(db, server, request, body.get("creator"), role="channel creator")

    channel = Channel(
        server_id=server.id,
        name=name,
        kind=kind,
        description=body.get("description", ""),
        creator_id=creator.id,
    )
    db.add(channel)
    await db.flush()

    db.add(ChannelMember(channel_id=channel.id, member_id=creator.id))

    member_ids = body.get("memberIds") or []
    for mid in member_ids:
        try:
            parsed_mid = uuid.UUID(mid)
        except ValueError:
            continue
        member = await db.execute(
            select(Member).where(Member.id == parsed_mid, Member.server_id == server.id)
        )
        if member.scalar_one_or_none():
            db.add(ChannelMember(channel_id=channel.id, member_id=parsed_mid))

    await db.commit()
    await db.refresh(channel)
    return {
        "created": True,
        "channel": {
            "id": str(channel.id),
            "name": f"#{channel.name}" if channel.kind == "public" else channel.name,
            "type": channel.kind,
            "description": channel.description or "",
        },
    }


# ── Channel Members ──────────────────────────────────────────


@router.post("/channels/{channel_id}/members")
async def add_channel_member(
    channel_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_channel_id = uuid.UUID(channel_id)
    except ValueError:
        raise HTTPException(400, "Invalid channel id")

    channel = await db.execute(
        select(Channel).where(Channel.id == parsed_channel_id, Channel.server_id == server.id)
    )
    ch = channel.scalar_one_or_none()
    if not ch:
        raise HTTPException(404, "Channel not found")

    body = await request.json()
    member_id = body.get("memberId")
    if not member_id:
        raise HTTPException(400, "Missing memberId")
    try:
        parsed_member_id = uuid.UUID(member_id)
    except ValueError:
        raise HTTPException(400, "Invalid memberId")

    member = await db.execute(
        select(Member).where(Member.id == parsed_member_id, Member.server_id == server.id)
    )
    if not member.scalar_one_or_none():
        raise HTTPException(404, "Member not found")

    existing = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == parsed_channel_id,
            ChannelMember.member_id == parsed_member_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"added": False, "reason": "already_member"}

    db.add(ChannelMember(channel_id=parsed_channel_id, member_id=parsed_member_id))
    await db.commit()
    return {"added": True, "channelId": str(parsed_channel_id), "memberId": str(parsed_member_id)}


@router.delete("/channels/{channel_id}/members/{member_id}")
async def remove_channel_member(
    channel_id: str,
    member_id: str,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_channel_id = uuid.UUID(channel_id)
        parsed_member_id = uuid.UUID(member_id)
    except ValueError:
        raise HTTPException(400, "Invalid id format")

    channel = await db.execute(
        select(Channel).where(Channel.id == parsed_channel_id, Channel.server_id == server.id)
    )
    if not channel.scalar_one_or_none():
        raise HTTPException(404, "Channel not found")

    existing = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == parsed_channel_id,
            ChannelMember.member_id == parsed_member_id,
        )
    )
    cm = existing.scalar_one_or_none()
    if not cm:
        return {"removed": False, "reason": "not_member"}

    await db.delete(cm)
    await db.commit()
    return {"removed": True, "channelId": str(parsed_channel_id), "memberId": str(parsed_member_id)}


# ── DM ───────────────────────────────────────────────────────


@router.get("/channels/{channel_id}/members")
async def list_channel_members(
    channel_id: str,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_channel_id = uuid.UUID(channel_id)
    except ValueError:
        raise HTTPException(400, "Invalid channel id")

    channel = await db.execute(
        select(Channel).where(Channel.id == parsed_channel_id, Channel.server_id == server.id)
    )
    if not channel.scalar_one_or_none():
        raise HTTPException(404, "Channel not found")

    result = await db.execute(
        select(ChannelMember).where(ChannelMember.channel_id == parsed_channel_id)
    )
    cms = result.scalars().all()
    member_list = []
    for cm in cms:
        m_result = await db.execute(select(Member).where(Member.id == cm.member_id))
        m = m_result.scalar_one_or_none()
        if m:
            member_list.append(await serialize_member(db, m))
    return {"members": member_list}


@router.get("/dms")
async def list_dms(
    request: Request,
    sender: str | None = Query(None),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    viewer = await _resolve_human_actor(db, server, request, sender, role="DM viewer")
    result = await db.execute(
        select(Channel)
        .join(ChannelMember, ChannelMember.channel_id == Channel.id)
        .where(
            Channel.server_id == server.id,
            Channel.kind == "dm",
            ChannelMember.member_id == viewer.id,
        )
        .order_by(Channel.updated_at.desc(), Channel.created_at.desc())
    )
    channels = result.scalars().all()
    return {
        "dms": [await _dm_channel_payload(db, channel, viewer) for channel in channels],
        "count": len(channels),
    }


@router.post("/dm")
async def create_or_get_dm(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    body = await request.json()
    peer_name = body.get("peer")
    if not peer_name:
        raise HTTPException(400, "Missing peer")

    sender = await _resolve_human_actor(db, server, request, body.get("sender"), role="DM sender")
    peer = await _resolve_member(db, server, peer_name)

    dm_name = f"dm:{min(str(sender.id), str(peer.id))}-{max(str(sender.id), str(peer.id))}"
    result = await db.execute(
        select(Channel).where(Channel.server_id == server.id, Channel.kind == "dm", Channel.name == dm_name)
    )
    channel = result.scalar_one_or_none()

    if not channel:
        channel = Channel(
            server_id=server.id,
            name=dm_name,
            kind="dm",
            creator_id=sender.id,
        )
        db.add(channel)
        await db.flush()
        db.add(ChannelMember(channel_id=channel.id, member_id=sender.id))
        db.add(ChannelMember(channel_id=channel.id, member_id=peer.id))
        await db.commit()
        await db.refresh(channel)

    return {
        "channel": await _dm_channel_payload(db, channel, sender),
    }
