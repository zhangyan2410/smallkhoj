"""Agent API routes — daemon-facing endpoints under /internal/agent-api/."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import get_db, Channel, ChannelMember, Member, Message, Server, Task
from routers.auth import resolve_agent

router = APIRouter(prefix="/internal/agent-api", tags=["agent-api"])


# ── Schemas ──────────────────────────────────────────────────

class SendRequest(BaseModel):
    target: str
    content: str
    seenUpToSeq: int | None = None


class TaskClaimRequest(BaseModel):
    taskNumber: int | None = None
    messageId: str | None = None


class TaskUpdateRequest(BaseModel):
    status: str
    taskNumber: int | None = None


# ── Server info ──────────────────────────────────────────────

@router.get("/server")
async def get_server(
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent

    channels_result = await db.execute(
        select(Channel).where(Channel.server_id == server.id)
    )
    channels = channels_result.scalars().all()

    members_result = await db.execute(
        select(Member).where(Member.server_id == server.id)
    )
    members = members_result.scalars().all()

    # Group members
    agents_list = []
    humans_list = []
    for m in members:
        entry = {
            "id": str(m.id),
            "name": m.display_name,
            "status": m.status,
        }
        if m.kind == "agent":
            agents_list.append(entry)
        else:
            humans_list.append(entry)

    channels_list = []
    for ch in channels:
        channels_list.append({
            "name": f"#{ch.name}" if ch.kind == "public" else ch.name,
            "type": ch.kind,
            "description": ch.description or "",
        })

    return {
        "serverId": str(server.id),
        "channels": channels_list,
        "agents": agents_list,
        "humans": humans_list,
    }


# ── Send message ─────────────────────────────────────────────

@router.post("/send")
async def send_message(
    body: SendRequest,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    target = body.target

    # Resolve target channel
    channel_name = target.lstrip("#")
    if target.startswith("dm:"):
        # DM: find or create DM channel
        peer_name = target.replace("dm:", "").lstrip("@")
        peer_result = await db.execute(
            select(Member).where(
                Member.server_id == server.id,
                Member.display_name == peer_name,
            )
        )
        peer = peer_result.scalar_one_or_none()
        if not peer:
            raise HTTPException(404, f"Peer {peer_name} not found")

        # Find existing DM channel between these two
        dm_result = await db.execute(
            select(Channel).where(
                Channel.server_id == server.id,
                Channel.kind == "dm",
                Channel.name == f"dm:{min(str(member.id), str(peer.id))}-{max(str(member.id), str(peer.id))}",
            )
        )
        channel = dm_result.scalar_one_or_none()
        if not channel:
            channel = Channel(
                server_id=server.id,
                name=f"dm:{min(str(member.id), str(peer.id))}-{max(str(member.id), str(peer.id))}",
                kind="dm",
                creator_id=member.id,
            )
            db.add(channel)
            await db.flush()
            db.add(ChannelMember(channel_id=channel.id, member_id=member.id))
            db.add(ChannelMember(channel_id=channel.id, member_id=peer.id))
            await db.flush()
    else:
        ch_result = await db.execute(
            select(Channel).where(
                Channel.server_id == server.id,
                Channel.name == channel_name,
            )
        )
        channel = ch_result.scalar_one_or_none()
        if not channel:
            raise HTTPException(404, f"Channel #{channel_name} not found")

    # Get next seq
    seq_result = await db.execute(select(func.coalesce(func.max(Message.seq), 0)).where(Message.channel_id == channel.id))
    last_seq = seq_result.scalar() or 0

    # Generate short_id
    short_id = uuid.uuid4().hex[:8]

    msg = Message(
        short_id=short_id,
        channel_id=channel.id,
        sender_id=member.id,
        content=body.content,
        channel_type=channel.kind,
        seq=last_seq + 1,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    return {
        "state": "sent",
        "messageId": str(msg.id),
        "messageSeq": msg.seq,
        "shortId": msg.short_id,
        "target": target,
    }


# ── Events (poll) ────────────────────────────────────────────

@router.get("/events")
async def get_events(
    since: int = Query(0, alias="since"),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent

    # Get channels this agent is a member of
    ch_result = await db.execute(
        select(ChannelMember.channel_id).where(ChannelMember.member_id == member.id)
    )
    channel_ids = [row[0] for row in ch_result.all()]

    if not channel_ids:
        return {"events": [], "count": 0}

    msgs_result = await db.execute(
        select(Message).where(
            Message.channel_id.in_(channel_ids),
            Message.seq > since,
        ).order_by(Message.seq).limit(100)
    )
    messages = msgs_result.scalars().all()

    events = []
    for msg in messages:
        events.append({
            "type": "message_received",
            "seq": msg.seq,
            "messageId": str(msg.id),
            "shortId": msg.short_id,
            "senderId": str(msg.sender_id),
            "content": msg.content,
            "channelId": str(msg.channel_id),
            "channelType": msg.channel_type,
            "createdAt": msg.created_at.isoformat() if msg.created_at else None,
        })

    return {"events": events, "count": len(events)}


# ── History ──────────────────────────────────────────────────

@router.get("/history")
async def get_history(
    channel: str = Query(...),
    limit: int = Query(50),
    before: int | None = Query(None),
    after: int | None = Query(None),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent

    # Resolve channel
    channel_name = channel.lstrip("#")
    if channel.startswith("dm:"):
        ch_result = await db.execute(
            select(Channel).where(Channel.server_id == server.id, Channel.kind == "dm", Channel.name == channel.replace("dm:", ""))
        )
    else:
        ch_result = await db.execute(
            select(Channel).where(Channel.server_id == server.id, Channel.name == channel_name)
        )
    ch = ch_result.scalar_one_or_none()
    if not ch:
        return {"messages": [], "count": 0}

    q = select(Message).where(Message.channel_id == ch.id)
    if before:
        q = q.where(Message.seq < before)
    if after:
        q = q.where(Message.seq > after)
    q = q.order_by(Message.seq.desc()).limit(limit)

    msgs_result = await db.execute(q)
    messages = list(reversed(msgs_result.scalars().all()))

    # Load sender info
    result_messages = []
    for msg in messages:
        sender_result = await db.execute(select(Member).where(Member.id == msg.sender_id))
        sender = sender_result.scalar_one_or_none()

        result_messages.append({
            "seq": msg.seq,
            "msg": msg.short_id,
            "time": msg.created_at.strftime("%Y-%m-%d %H:%M:%S") if msg.created_at else "",
            "type": sender.kind if sender else "unknown",
            "sender": f"@{sender.display_name}" if sender else "unknown",
            "content": msg.content,
        })

    return {"messages": result_messages, "count": len(result_messages)}


# ── Tasks ────────────────────────────────────────────────────

@router.post("/tasks/claim")
async def claim_task(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent

    body = await request.json()
    task_number = body.get("taskNumber") or body.get("number")
    message_id = body.get("messageId")

    q = select(Task).where(Task.assignee_id.is_(None))
    if task_number:
        q = q.where(Task.task_number == task_number)
    if message_id:
        try:
            q = q.where(Task.message_id == uuid.UUID(message_id))
        except ValueError:
            pass

    q = q.limit(1)
    result = await db.execute(q)
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(404, "No unclaimed task found")

    task.assignee_id = member.id
    task.status = "in_progress"
    await db.commit()
    await db.refresh(task)

    return {
        "claimed": True,
        "taskNumber": task.task_number,
        "title": task.title,
        "status": task.status,
        "assigneeId": str(task.assignee_id),
    }


@router.post("/tasks/update-status")
async def update_task_status(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent

    body = await request.json()
    new_status = body.get("status")
    task_number = body.get("taskNumber") or body.get("number")

    if not new_status:
        raise HTTPException(400, "Missing status")
    if not task_number:
        raise HTTPException(400, "Missing taskNumber")

    result = await db.execute(
        select(Task).where(Task.task_number == task_number)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, f"Task {task_number} not found")

    task.status = new_status
    await db.commit()
    await db.refresh(task)

    return {
        "updated": True,
        "taskNumber": task.task_number,
        "status": task.status,
    }
