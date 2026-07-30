"""Thread summary helpers and scheduler."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    Channel,
    ChannelMember,
    Computer,
    EventRecord,
    Member,
    Message,
    ThreadSummary,
    async_session,
)
from services.daemon_control import push_latest_events_for_server

logger = logging.getLogger(__name__)

SUMMARY_MAX_CHARS = 300
SUMMARY_REQUEST_INTERVAL_SECONDS = 600
SUMMARY_SCHEDULER_INTERVAL_SECONDS = 60
SUMMARY_REQUEST_BATCH_LIMIT = 5


def _utcnow() -> datetime:
    return datetime.utcnow()


def _now_for(value: datetime | None) -> datetime:
    if value and value.tzinfo:
        return datetime.now(value.tzinfo)
    return _utcnow()


def _datetime_sort_key(value: datetime) -> float:
    if value.tzinfo:
        return value.timestamp()
    return value.replace(tzinfo=timezone.utc).timestamp()


def _latest_datetime(*values: datetime | None) -> datetime | None:
    present = [value for value in values if value is not None]
    if not present:
        return None
    return max(present, key=_datetime_sort_key)


def _older_than(value: datetime, seconds: int) -> bool:
    now = _now_for(value)
    return value <= now - timedelta(seconds=seconds)


def serialize_thread_summary(summary: ThreadSummary | None) -> dict[str, Any] | None:
    if not summary:
        return None
    return {
        "id": str(summary.id),
        "threadId": str(summary.root_message_id),
        "rootMessageId": str(summary.root_message_id),
        "summary": summary.summary,
        "status": summary.status,
        "requestedAgentId": str(summary.requested_agent_id) if summary.requested_agent_id else None,
        "updatedBy": str(summary.updated_by) if summary.updated_by else None,
        "replyCountAtRequest": summary.reply_count_at_request,
        "replyCountAtSummary": summary.reply_count_at_summary,
        "lastRequestedAt": summary.last_requested_at.isoformat() if summary.last_requested_at else None,
        "summarizedAt": summary.summarized_at.isoformat() if summary.summarized_at else None,
        "updatedAt": summary.updated_at.isoformat() if summary.updated_at else None,
    }


async def thread_reply_count(db: AsyncSession, root_message_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count()).select_from(Message).where(Message.parent_id == root_message_id)
    )
    return int(result.scalar() or 0)


async def load_thread_metadata(
    db: AsyncSession,
    root_message_ids: list[uuid.UUID],
) -> dict[uuid.UUID, dict[str, Any]]:
    if not root_message_ids:
        return {}

    metadata: dict[uuid.UUID, dict[str, Any]] = {
        root_id: {"replyCount": 0, "latestReplySeq": 0, "threadSummary": None}
        for root_id in root_message_ids
    }

    counts_result = await db.execute(
        select(Message.parent_id, func.count(), func.max(Message.seq))
        .where(Message.parent_id.in_(root_message_ids))
        .group_by(Message.parent_id)
    )
    for root_id, count, latest_reply_seq in counts_result.all():
        if root_id in metadata:
            metadata[root_id]["replyCount"] = int(count or 0)
            metadata[root_id]["latestReplySeq"] = int(latest_reply_seq or 0)

    summaries_result = await db.execute(
        select(ThreadSummary).where(ThreadSummary.root_message_id.in_(root_message_ids))
    )
    for summary in summaries_result.scalars().all():
        if summary.root_message_id in metadata:
            metadata[summary.root_message_id]["threadSummary"] = serialize_thread_summary(summary)

    return metadata


async def resolve_thread_root(db: AsyncSession, server_id: uuid.UUID, thread_ref: str) -> Message | None:
    try:
        parsed_id = uuid.UUID(thread_ref)
    except ValueError:
        parsed_id = None

    query = select(Message).join(Channel).where(Channel.server_id == server_id)
    if parsed_id:
        query = query.where(Message.id == parsed_id)
    else:
        query = query.where(Message.short_id == thread_ref)

    result = await db.execute(query)
    message = result.scalar_one_or_none()
    if not message:
        return None
    if message.parent_id:
        root_result = await db.execute(select(Message).where(Message.id == message.parent_id))
        return root_result.scalar_one_or_none()
    return message


async def thread_participant_ids(db: AsyncSession, root_message_id: uuid.UUID) -> set[uuid.UUID]:
    result = await db.execute(
        select(Message.sender_id).where(
            (Message.id == root_message_id) | (Message.parent_id == root_message_id)
        )
    )
    return {row[0] for row in result.all()}


async def choose_summary_agent(db: AsyncSession, root_message_id: uuid.UUID) -> Member | None:
    result = await db.execute(
        select(Member)
        .join(Message, Message.sender_id == Member.id)
        .where(
            Message.parent_id == root_message_id,
            Member.kind == "agent",
        )
        .order_by(Message.created_at.desc(), Message.seq.desc())
    )
    agents = result.scalars().all()
    if not agents:
        root_result = await db.execute(
            select(Member)
            .join(Message, Message.sender_id == Member.id)
            .where(Message.id == root_message_id, Member.kind == "agent")
        )
        agents = root_result.scalars().all()

    if not agents:
        return None

    for agent in agents:
        if agent.status not in {"online", "active", "idle", "busy"}:
            continue
        if not agent.computer_id:
            return agent
        computer_result = await db.execute(select(Computer).where(Computer.id == agent.computer_id))
        computer = computer_result.scalar_one_or_none()
        if computer and computer.status in {"online", "active"}:
            return agent
    return agents[0]


async def display_target_for_agent(
    db: AsyncSession,
    channel: Channel,
    agent: Member,
    root: Message,
) -> str:
    if channel.kind == "dm":
        peer_result = await db.execute(
            select(Member)
            .join(ChannelMember, ChannelMember.member_id == Member.id)
            .where(
                ChannelMember.channel_id == channel.id,
                Member.id != agent.id,
            )
            .order_by(Member.kind.desc(), Member.display_name)
            .limit(1)
        )
        peer = peer_result.scalar_one_or_none()
        if peer:
            return f"dm:@{peer.display_name}:{root.short_id}"
        return f"{channel.name}:{root.short_id}"
    prefix = f"#{channel.name}" if channel.kind == "public" else channel.name
    return f"{prefix}:{root.short_id}"


async def request_thread_summary(
    db: AsyncSession,
    *,
    root: Message,
    channel: Channel,
    reply_count: int,
    now: datetime,
) -> bool:
    agent = await choose_summary_agent(db, root.id)
    if not agent:
        return False

    summary_result = await db.execute(
        select(ThreadSummary).where(ThreadSummary.root_message_id == root.id)
    )
    summary = summary_result.scalar_one_or_none()
    if summary is None:
        summary = ThreadSummary(
            server_id=channel.server_id,
            channel_id=channel.id,
            root_message_id=root.id,
        )
        db.add(summary)

    summary.status = "requested"
    summary.requested_agent_id = agent.id
    summary.reply_count_at_request = reply_count
    summary.last_requested_at = now

    target = await display_target_for_agent(db, channel, agent, root)
    instruction = (
        "Summarize this thread in 1-2 short, precise sentences. "
        f"Keep it under {SUMMARY_MAX_CHARS} characters. "
        f"Read the thread, then write the result with `slock thread summary --thread-id {root.short_id} --summary \"...\"`. "
        "Do not send the summary as a normal chat message."
    )
    db.add(EventRecord(
        server_id=channel.server_id,
        event_type="thread.summary_requested",
        actor_id=None,
        channel_id=channel.id,
        message_id=root.id,
        payload={
            "type": "thread.summary_requested",
            "legacyType": "thread_summary_requested",
            "targetAgentId": str(agent.id),
            "threadId": str(root.id),
            "threadShortId": root.short_id,
            "rootMessageId": str(root.id),
            "messageId": str(root.id),
            "shortId": root.short_id,
            "target": target,
            "content": instruction,
            "replyCount": reply_count,
            "summaryMaxChars": SUMMARY_MAX_CHARS,
        },
    ))
    return True


async def request_due_thread_summaries(db: AsyncSession, limit: int = SUMMARY_REQUEST_BATCH_LIMIT) -> int:
    reply_stats = (
        select(
            Message.parent_id.label("root_message_id"),
            func.count().label("reply_count"),
            func.max(Message.created_at).label("last_reply_at"),
        )
        .where(Message.parent_id.is_not(None))
        .group_by(Message.parent_id)
        .subquery()
    )
    result = await db.execute(
        select(Message, Channel, reply_stats.c.reply_count, ThreadSummary)
        .join(Channel, Channel.id == Message.channel_id)
        .join(reply_stats, reply_stats.c.root_message_id == Message.id)
        .outerjoin(ThreadSummary, ThreadSummary.root_message_id == Message.id)
        .order_by(reply_stats.c.last_reply_at.desc())
        .limit(limit)
    )

    requested = 0
    touched_servers: set[uuid.UUID] = set()
    for root, channel, raw_reply_count, summary in result.all():
        reply_count = int(raw_reply_count or 0)
        if reply_count <= 0:
            continue
        if summary and summary.summary and reply_count <= summary.reply_count_at_summary:
            continue
        if summary:
            last_touch_at = _latest_datetime(
                summary.last_requested_at,
                summary.summarized_at if summary.summary else None,
            )
            if last_touch_at and not _older_than(last_touch_at, SUMMARY_REQUEST_INTERVAL_SECONDS):
                continue
            if reply_count <= summary.reply_count_at_request and not summary.summary:
                # Do not keep re-prompting a runtime for the same unanswered thread state.
                # A later reply_count increase is the next automatic trigger.
                continue
        did_request = await request_thread_summary(
            db,
            root=root,
            channel=channel,
            reply_count=reply_count,
            now=_now_for(summary.last_requested_at if summary else None),
        )
        if did_request:
            requested += 1
            touched_servers.add(channel.server_id)

    if requested:
        await db.commit()
        for server_id in touched_servers:
            await push_latest_events_for_server(db, server_id=server_id)
    return requested


async def thread_summary_scheduler_loop(interval_seconds: float = SUMMARY_SCHEDULER_INTERVAL_SECONDS):
    backoff_seconds = interval_seconds
    while True:
        try:
            async with async_session() as db:
                await request_due_thread_summaries(db)
            backoff_seconds = interval_seconds
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("thread summary scheduler iteration failed")
            backoff_seconds = min(backoff_seconds * 2, 60.0)
        await asyncio.sleep(backoff_seconds)


def start_thread_summary_scheduler(interval_seconds: float = SUMMARY_SCHEDULER_INTERVAL_SECONDS) -> asyncio.Task:
    return asyncio.create_task(thread_summary_scheduler_loop(interval_seconds))


async def stop_thread_summary_scheduler(task: asyncio.Task | None):
    if not task:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
