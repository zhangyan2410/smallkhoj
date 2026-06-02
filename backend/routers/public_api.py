"""Public API routes — frontend-facing endpoints under /api/v1/."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import get_db, Channel, Member, Message, Server, Task

router = APIRouter(prefix="/api/v1", tags=["public"])


@router.get("/channels")
async def list_channels(db: AsyncSession = Depends(get_db)):
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
        result.append({
            "seq": msg.seq,
            "id": str(msg.id),
            "shortId": msg.short_id,
            "sender": f"@{sender.display_name}" if sender else "unknown",
            "senderType": sender.kind if sender else "unknown",
            "content": msg.content,
            "time": msg.created_at.strftime("%Y-%m-%d %H:%M:%S") if msg.created_at else "",
        })

    return {"messages": result, "channelName": name}


@router.get("/tasks")
async def list_tasks(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Task).order_by(Task.task_number))
    tasks = result.scalars().all()

    task_list = []
    for t in tasks:
        creator_result = await db.execute(select(Member).where(Member.id == t.creator_id))
        creator = creator_result.scalar_one_or_none()

        assignee_name = None
        if t.assignee_id:
            assignee_result = await db.execute(select(Member).where(Member.id == t.assignee_id))
            assignee = assignee_result.scalar_one_or_none()
            assignee_name = assignee.display_name if assignee else None

        task_list.append({
            "number": t.task_number,
            "title": t.title,
            "status": t.status,
            "creator": creator.display_name if creator else "unknown",
            "assignee": assignee_name,
        })

    return {"tasks": task_list}


@router.get("/members")
async def list_members(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"members": []}

    result = await db.execute(select(Member).where(Member.server_id == server.id))
    members = result.scalars().all()

    return {
        "members": [
            {
                "id": str(m.id),
                "name": m.display_name,
                "kind": m.kind,
                "status": m.status,
                "avatarUrl": m.avatar_url,
            }
            for m in members
        ]
    }
