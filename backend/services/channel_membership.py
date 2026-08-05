"""The single production mutation boundary for Channel membership."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select

from models import Channel, ChannelMember, EventRecord, Member, ServerMembership
from services.channel_member_references import (
    ChannelRosterMember,
    load_agent_channel_roster,
    reference_updates,
)


@dataclass(frozen=True)
class ChannelMembershipMutation:
    channel: Channel
    member: Member
    changed: bool
    roster_revision: int
    event: EventRecord | None
    payload: dict[str, Any] | None


async def _locked_channel(db: Any, channel_id: uuid.UUID) -> Channel:
    result = await db.execute(
        select(Channel).where(Channel.id == channel_id).with_for_update()
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(404, "Channel not found")
    return channel


async def _member(db: Any, member_id: uuid.UUID) -> Member:
    result = await db.execute(select(Member).where(Member.id == member_id))
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(404, "Member not found")
    return member


async def _validate_member_scope(db: Any, *, channel: Channel, member: Member) -> None:
    if member.deleted_at is not None:
        raise HTTPException(404, "Member not found")
    if member.kind == "agent":
        if member.origin_server_id != channel.server_id:
            raise HTTPException(400, "Agent cannot join a Channel outside its origin Server")
        return
    if member.kind != "human" or member.account_id is None:
        raise HTTPException(400, "Invalid Channel member identity")
    result = await db.execute(
        select(ServerMembership.id).where(
            ServerMembership.server_id == channel.server_id,
            ServerMembership.account_id == member.account_id,
            ServerMembership.member_id == member.id,
            ServerMembership.status == "active",
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(403, "Human is not a member of this Server")


def _entry_by_id(
    roster: list[ChannelRosterMember],
    member_id: uuid.UUID,
) -> ChannelRosterMember | None:
    return next((entry for entry in roster if entry.member_id == member_id), None)


async def _write_event(
    db: Any,
    *,
    channel: Channel,
    actor_id: uuid.UUID | None,
    event_type: str,
    changed_member: ChannelRosterMember,
    before: list[ChannelRosterMember],
    after: list[ChannelRosterMember],
    removed_agent_id: uuid.UUID | None = None,
) -> tuple[EventRecord, dict[str, Any]]:
    updates = reference_updates(before, after)
    if event_type == "channel.member_joined":
        updates = [update for update in updates if update["memberId"] != str(changed_member.member_id)]
    payload: dict[str, Any] = {
        "type": event_type,
        "legacyType": event_type.replace(".", "_"),
        "channelId": str(channel.id),
        "rosterRevision": int(channel.membership_revision),
        "member": changed_member.compact_payload(),
        "referenceUpdates": updates,
    }
    if removed_agent_id is not None:
        payload["removedAgentId"] = str(removed_agent_id)
    event = EventRecord(
        id=uuid.uuid4(),
        server_id=channel.server_id,
        event_type=event_type,
        actor_id=actor_id,
        channel_id=channel.id,
        payload=payload,
    )
    db.add(event)
    await db.flush()
    return event, payload


async def add_channel_member(
    db: Any,
    *,
    channel_id: uuid.UUID,
    member_id: uuid.UUID,
    actor_id: uuid.UUID | None,
) -> ChannelMembershipMutation:
    channel = await _locked_channel(db, channel_id)
    member = await _member(db, member_id)
    await _validate_member_scope(db, channel=channel, member=member)
    existing_result = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel.id,
            ChannelMember.member_id == member.id,
        )
    )
    if existing_result.scalar_one_or_none() is not None:
        return ChannelMembershipMutation(
            channel=channel,
            member=member,
            changed=False,
            roster_revision=int(channel.membership_revision or 0),
            event=None,
            payload=None,
        )

    before = await load_agent_channel_roster(db, channel_id=channel.id)
    db.add(ChannelMember(channel_id=channel.id, member_id=member.id))
    channel.membership_revision = int(channel.membership_revision or 0) + 1
    await db.flush()
    after = await load_agent_channel_roster(db, channel_id=channel.id)
    changed_member = _entry_by_id(after, member.id)
    if changed_member is None:
        raise RuntimeError("Channel member projection missing after insert")
    event, payload = await _write_event(
        db,
        channel=channel,
        actor_id=actor_id,
        event_type="channel.member_joined",
        changed_member=changed_member,
        before=before,
        after=after,
    )
    return ChannelMembershipMutation(
        channel=channel,
        member=member,
        changed=True,
        roster_revision=int(channel.membership_revision),
        event=event,
        payload=payload,
    )


async def remove_channel_member(
    db: Any,
    *,
    channel_id: uuid.UUID,
    member_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    strict: bool = True,
) -> ChannelMembershipMutation:
    channel = await _locked_channel(db, channel_id)
    member = await _member(db, member_id)
    before = await load_agent_channel_roster(db, channel_id=channel.id)
    changed_member = _entry_by_id(before, member.id)
    membership_result = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel.id,
            ChannelMember.member_id == member.id,
        )
    )
    membership = membership_result.scalar_one_or_none()
    if membership is None or changed_member is None:
        if strict:
            raise HTTPException(404, "Channel membership not found")
        return ChannelMembershipMutation(
            channel=channel,
            member=member,
            changed=False,
            roster_revision=int(channel.membership_revision or 0),
            event=None,
            payload=None,
        )

    await db.delete(membership)
    channel.membership_revision = int(channel.membership_revision or 0) + 1
    await db.flush()
    after = await load_agent_channel_roster(db, channel_id=channel.id)
    event, payload = await _write_event(
        db,
        channel=channel,
        actor_id=actor_id,
        event_type="channel.member_left",
        changed_member=changed_member,
        before=before,
        after=after,
        removed_agent_id=member.id if member.kind == "agent" else None,
    )
    return ChannelMembershipMutation(
        channel=channel,
        member=member,
        changed=True,
        roster_revision=int(channel.membership_revision),
        event=event,
        payload=payload,
    )


async def remove_agent_from_all_channels(
    db: Any,
    *,
    agent: Member,
    actor_id: uuid.UUID | None,
) -> list[ChannelMembershipMutation]:
    result = await db.execute(
        select(ChannelMember.channel_id)
        .join(Channel, Channel.id == ChannelMember.channel_id)
        .where(
            ChannelMember.member_id == agent.id,
            Channel.server_id == agent.origin_server_id,
        )
        .order_by(ChannelMember.channel_id)
    )
    mutations = []
    for (channel_id,) in result.all():
        mutations.append(
            await remove_channel_member(
                db,
                channel_id=channel_id,
                member_id=agent.id,
                actor_id=actor_id,
            )
        )
    return mutations

