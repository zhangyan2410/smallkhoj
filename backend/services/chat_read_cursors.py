"""Backend-owned chat read cursor helpers."""

import uuid
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ChannelMember
from models.slock import ChatThreadReadCursor

ChannelCursorKind = Literal["channel", "dm"]


def _monotonic_seq(current: int | None, proposed: int | None) -> int:
    return max(int(current or 0), int(proposed or 0))


def read_state_from_message_seq(*, latest_seq: int | None, last_read_seq: int | None) -> dict[str, int | bool]:
    latest = max(0, int(latest_seq or 0))
    read = max(0, int(last_read_seq or 0))
    unread_count = max(0, latest - read)
    return {
        "latestSeq": latest,
        "unreadCount": unread_count,
        "hasUnread": unread_count > 0,
    }


async def mark_channel_read(
    db: AsyncSession,
    *,
    channel_id: uuid.UUID,
    member_id: uuid.UUID,
    last_read_seq: int,
) -> ChannelMember:
    result = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel_id,
            ChannelMember.member_id == member_id,
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        membership = ChannelMember(channel_id=channel_id, member_id=member_id, last_read_seq=0)
        db.add(membership)

    membership.last_read_seq = _monotonic_seq(membership.last_read_seq, last_read_seq)
    await db.flush()
    return membership


async def upsert_thread_read_cursor(
    db: AsyncSession,
    *,
    server_id: uuid.UUID,
    member_id: uuid.UUID,
    root_message_id: uuid.UUID,
    last_read_seq: int,
    last_seen_message_id: uuid.UUID | None = None,
) -> ChatThreadReadCursor:
    result = await db.execute(
        select(ChatThreadReadCursor).where(
            ChatThreadReadCursor.server_id == server_id,
            ChatThreadReadCursor.member_id == member_id,
            ChatThreadReadCursor.root_message_id == root_message_id,
        )
    )
    cursor = result.scalar_one_or_none()
    if cursor is None:
        cursor = ChatThreadReadCursor(
            server_id=server_id,
            member_id=member_id,
            root_message_id=root_message_id,
            last_read_seq=max(int(last_read_seq or 0), 0),
            last_seen_message_id=last_seen_message_id,
        )
        db.add(cursor)
        await db.flush()
        return cursor

    next_seq = _monotonic_seq(cursor.last_read_seq, last_read_seq)
    if next_seq > int(cursor.last_read_seq or 0):
        cursor.last_read_seq = next_seq
        cursor.last_seen_message_id = last_seen_message_id
    await db.flush()
    return cursor


def serialize_channel_read_cursor(
    membership: ChannelMember,
    *,
    scope_kind: ChannelCursorKind = "channel",
) -> dict[str, Any]:
    return {
        "scope": {"kind": scope_kind, "channelId": str(membership.channel_id)},
        "memberId": str(membership.member_id),
        "lastReadSeq": int(membership.last_read_seq or 0),
    }


def serialize_thread_read_cursor(cursor: ChatThreadReadCursor) -> dict[str, Any]:
    return {
        "scope": {"kind": "thread", "rootMessageId": str(cursor.root_message_id)},
        "memberId": str(cursor.member_id),
        "lastReadSeq": int(cursor.last_read_seq or 0),
        "lastSeenMessageId": str(cursor.last_seen_message_id) if cursor.last_seen_message_id else None,
    }
