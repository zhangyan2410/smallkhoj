"""Bounded page-level loaders used by public and agent wire serializers."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from models import AgentWorkspace, Channel, Computer, Member, Message, MessageReaction, Task, TaskRun


UNSET = object()


@dataclass(frozen=True)
class MemberSerializationContext:
    workspace_ids: dict[uuid.UUID, str | None]
    computers: dict[uuid.UUID, Computer]


@dataclass(frozen=True)
class MessageSerializationContext:
    channels: dict[uuid.UUID, Channel]
    members: dict[uuid.UUID, Member]
    reply_counts: dict[uuid.UUID, int]
    reactions: dict[uuid.UUID, list[MessageReaction]]
    member_details: MemberSerializationContext


@dataclass(frozen=True)
class TaskSerializationContext:
    channels: dict[uuid.UUID, Channel]
    members: dict[uuid.UUID, Member]
    runs: dict[uuid.UUID, list[TaskRun]]
    member_details: MemberSerializationContext


async def load_member_serialization_context(
    db: AsyncSession,
    members: list[Member],
) -> MemberSerializationContext:
    workspace_ids: dict[uuid.UUID, str | None] = {
        member.id: (member.config or {}).get("workspaceId")
        for member in members
    }
    agent_ids = [member.id for member in members if member.kind == "agent"]
    if agent_ids:
        rows = (
            await db.execute(
                select(AgentWorkspace.agent_id, AgentWorkspace.id)
                .where(AgentWorkspace.agent_id.in_(agent_ids))
                .order_by(
                    AgentWorkspace.agent_id,
                    AgentWorkspace.updated_at.desc(),
                    AgentWorkspace.id.desc(),
                )
            )
        ).all()
        seen: set[uuid.UUID] = set()
        for agent_id, workspace_id in rows:
            if agent_id in seen:
                continue
            workspace_ids[agent_id] = str(workspace_id)
            seen.add(agent_id)

    computer_ids = {
        member.computer_id
        for member in members
        if member.computer_id is not None
    }
    computers: dict[uuid.UUID, Computer] = {}
    if computer_ids:
        result = await db.execute(
            select(Computer)
            .options(noload("*"))
            .where(Computer.id.in_(computer_ids))
        )
        computers = {computer.id: computer for computer in result.scalars().all()}

    return MemberSerializationContext(
        workspace_ids=workspace_ids,
        computers=computers,
    )


async def load_message_serialization_context(
    db: AsyncSession,
    messages: list[Message],
) -> MessageSerializationContext:
    if not messages:
        return MessageSerializationContext(
            {}, {}, {}, {}, MemberSerializationContext({}, {})
        )

    message_ids = [message.id for message in messages]
    channel_ids = {message.channel_id for message in messages}
    member_ids = {message.sender_id for message in messages}

    channel_result = await db.execute(
        select(Channel).options(noload("*")).where(Channel.id.in_(channel_ids))
    )
    channels = {channel.id: channel for channel in channel_result.scalars().all()}

    reaction_result = await db.execute(
        select(MessageReaction)
        .options(noload("*"))
        .where(MessageReaction.message_id.in_(message_ids))
        .order_by(MessageReaction.created_at, MessageReaction.id)
    )
    reactions: dict[uuid.UUID, list[MessageReaction]] = {
        message_id: [] for message_id in message_ids
    }
    for reaction in reaction_result.scalars().all():
        reactions.setdefault(reaction.message_id, []).append(reaction)
        member_ids.add(reaction.member_id)

    member_result = await db.execute(
        select(Member).options(noload("*")).where(Member.id.in_(member_ids))
    )
    member_rows = list(member_result.scalars().all())
    members = {member.id: member for member in member_rows}

    reply_count_result = await db.execute(
        select(Message.parent_id, func.count())
        .where(Message.parent_id.in_(message_ids))
        .group_by(Message.parent_id)
    )
    reply_counts = {
        message_id: 0 for message_id in message_ids
    }
    reply_counts.update({
        parent_id: int(count or 0)
        for parent_id, count in reply_count_result.all()
        if parent_id is not None
    })

    return MessageSerializationContext(
        channels=channels,
        members=members,
        reply_counts=reply_counts,
        reactions=reactions,
        member_details=await load_member_serialization_context(db, member_rows),
    )


async def load_task_serialization_context(
    db: AsyncSession,
    tasks: list[Task],
) -> TaskSerializationContext:
    if not tasks:
        return TaskSerializationContext(
            channels={},
            members={},
            runs={},
            member_details=MemberSerializationContext({}, {}),
        )

    task_ids = [task.id for task in tasks]
    channel_ids = {task.channel_id for task in tasks}
    member_ids = {
        member_id
        for task in tasks
        for member_id in (task.creator_id, task.assignee_id)
        if member_id is not None
    }

    channel_result = await db.execute(
        select(Channel).options(noload("*")).where(Channel.id.in_(channel_ids))
    )
    channels = {channel.id: channel for channel in channel_result.scalars().all()}

    member_result = await db.execute(
        select(Member).options(noload("*")).where(Member.id.in_(member_ids))
    )
    member_rows = list(member_result.scalars().all())
    members = {member.id: member for member in member_rows}

    run_result = await db.execute(
        select(TaskRun)
        .options(noload("*"))
        .where(TaskRun.task_id.in_(task_ids))
        .order_by(TaskRun.task_id, TaskRun.created_at.desc(), TaskRun.id.desc())
    )
    runs: dict[uuid.UUID, list[TaskRun]] = {task_id: [] for task_id in task_ids}
    for run in run_result.scalars().all():
        runs.setdefault(run.task_id, []).append(run)

    return TaskSerializationContext(
        channels=channels,
        members=members,
        runs=runs,
        member_details=await load_member_serialization_context(db, member_rows),
    )
