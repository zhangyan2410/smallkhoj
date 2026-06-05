"""Reminder firing loop for the local Slock-like backend."""

import asyncio
import contextlib
import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ActivityLog, Channel, EventRecord, Message, Reminder, async_session


def _utcnow() -> datetime:
    return datetime.utcnow()


def _next_fire_at(current: datetime, repeat: dict | None) -> datetime | None:
    if not repeat:
        return None
    cadence = repeat.get("cadence") or repeat.get("interval")
    if isinstance(repeat.get("intervalSeconds"), int):
        return current + timedelta(seconds=max(1, repeat["intervalSeconds"]))
    if cadence == "minutely":
        return current + timedelta(minutes=1)
    if cadence == "hourly":
        return current + timedelta(hours=1)
    if cadence == "daily":
        return current + timedelta(days=1)
    if cadence == "weekly":
        return current + timedelta(weeks=1)
    return None


def _reminder_message_content(reminder: Reminder) -> str:
    if reminder.description:
        return f"Reminder: {reminder.title}\n\n{reminder.description}"
    return f"Reminder: {reminder.title}"


async def _next_message_seq(db: AsyncSession) -> int:
    result = await db.execute(select(func.coalesce(func.max(Message.seq), 0)))
    return int(result.scalar() or 0) + 1


async def fire_due_reminders(db: AsyncSession, limit: int = 50) -> int:
    now = _utcnow()
    result = await db.execute(
        select(Reminder)
        .where(Reminder.status == "pending", Reminder.fire_at <= now)
        .order_by(Reminder.fire_at)
        .limit(limit)
    )
    reminders = result.scalars().all()
    if not reminders:
        return 0

    fired = 0
    for reminder in reminders:
        fired += 1
        reminder.fired_at = now
        next_fire = _next_fire_at(now, reminder.repeat)
        if next_fire:
            reminder.status = "pending"
            reminder.fire_at = next_fire
            reminder.data = {
                **(reminder.data or {}),
                "lastFiredAt": f"{now.isoformat()}Z",
                "lastStatus": "fired",
            }
        else:
            reminder.status = "fired"

        if reminder.channel_id:
            channel_result = await db.execute(
                select(Channel).where(Channel.id == reminder.channel_id)
            )
            channel = channel_result.scalar_one_or_none()
            if channel:
                message = Message(
                    short_id=uuid.uuid4().hex[:8],
                    channel_id=channel.id,
                    sender_id=reminder.agent_id,
                    parent_id=reminder.message_id,
                    content=_reminder_message_content(reminder),
                    channel_type="thread" if reminder.message_id else channel.kind,
                    seq=await _next_message_seq(db),
                )
                db.add(message)
                await db.flush()
                activity = ActivityLog(
                    server_id=reminder.server_id,
                    agent_id=reminder.agent_id,
                    kind="reminder_fired",
                    description=f"Reminder fired: {reminder.title}",
                    details={
                        "reminderId": str(reminder.id),
                        "messageId": str(message.id),
                        "shortId": message.short_id,
                        "seq": message.seq,
                        "messageSeq": message.seq,
                        "senderId": str(reminder.agent_id),
                        "content": message.content,
                        "messageSnippet": message.content[:200],
                        "channelType": message.channel_type,
                        "parentId": str(reminder.message_id) if reminder.message_id else None,
                        "threadId": str(reminder.message_id or message.id),
                    },
                    channel_id=channel.id,
                    task_id=reminder.task_id,
                )
                db.add(activity)
                await db.flush()
                db.add(EventRecord(
                    server_id=reminder.server_id,
                    event_type="message.created",
                    actor_id=reminder.agent_id,
                    channel_id=channel.id,
                    task_id=reminder.task_id,
                    message_id=message.id,
                    payload={
                        "type": "message.created",
                        "legacyType": "message_received",
                        "activityId": str(activity.id),
                        "actorId": str(reminder.agent_id),
                        "agentId": str(reminder.agent_id),
                        "channelId": str(channel.id),
                        "taskId": str(reminder.task_id) if reminder.task_id else None,
                        "messageId": str(message.id),
                        "shortId": message.short_id,
                        "seq": message.seq,
                        "messageSeq": message.seq,
                        "senderId": str(reminder.agent_id),
                        "content": message.content,
                        "channelType": message.channel_type,
                        "parentId": str(reminder.message_id) if reminder.message_id else None,
                        "threadId": str(reminder.message_id or message.id),
                        "createdAt": activity.occurred_at.isoformat() if activity.occurred_at else None,
                        "occurredAt": activity.occurred_at.isoformat() if activity.occurred_at else None,
                    },
                ))
                db.add(EventRecord(
                    server_id=reminder.server_id,
                    event_type="reminder.fired",
                    actor_id=reminder.agent_id,
                    channel_id=channel.id,
                    task_id=reminder.task_id,
                    message_id=message.id,
                    payload={
                        "type": "reminder.fired",
                        "legacyType": "reminder_fired",
                        "activityId": str(activity.id),
                        "actorId": str(reminder.agent_id),
                        "agentId": str(reminder.agent_id),
                        "channelId": str(channel.id),
                        "taskId": str(reminder.task_id) if reminder.task_id else None,
                        "messageId": str(message.id),
                        "reminderId": str(reminder.id),
                        "description": activity.description,
                        "details": activity.details or {},
                        "createdAt": activity.occurred_at.isoformat() if activity.occurred_at else None,
                        "occurredAt": activity.occurred_at.isoformat() if activity.occurred_at else None,
                    },
                ))

    await db.commit()
    return fired


async def reminder_scheduler_loop(interval_seconds: float = 1.0):
    while True:
        try:
            async with async_session() as db:
                await fire_due_reminders(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Keep the lightweight local scheduler alive; detailed DB errors surface in app logs.
            pass
        await asyncio.sleep(interval_seconds)


def start_reminder_scheduler(interval_seconds: float = 1.0) -> asyncio.Task:
    return asyncio.create_task(reminder_scheduler_loop(interval_seconds))


async def stop_reminder_scheduler(task: asyncio.Task | None):
    if not task:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
