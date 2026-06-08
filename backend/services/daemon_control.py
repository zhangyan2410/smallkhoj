"""Daemon control command helpers shared by public and internal APIs."""

from __future__ import annotations

import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AgentWorkspace, Channel, ChannelMember, Computer, EventRecord, Member, Message


PENDING_RUNTIME_START_STATUS = "pending_start"
RUNTIME_ACTIVE_STATUSES = {"running", "active", "idle"}


def runtime_start_command(workspace: AgentWorkspace, agent: Member) -> dict[str, Any]:
    """Build the daemon control envelope for a workspace runtime launch."""
    config: dict[str, Any] = {
        "runtime": workspace.runtime,
        "workspaceId": str(workspace.id),
    }
    if workspace.runtime_command:
        config["runtimeCommand"] = workspace.runtime_command
    if workspace.runtime_model:
        config["runtimeModel"] = workspace.runtime_model
    if workspace.cwd:
        config["workspacePath"] = workspace.cwd
    backend = agent.backend or (agent.config or {}).get("backend")
    if backend:
        config["backend"] = backend

    command = {
        "type": "start_runtime",
        "agentId": str(agent.id),
        "workspaceId": str(workspace.id),
        "config": config,
    }
    return {
        "type": "control",
        "event_type": "control",
        "eventType": "control",
        "controlType": "start_runtime",
        "agentId": str(agent.id),
        "workspaceId": str(workspace.id),
        "command": command,
    }


async def pending_runtime_commands(
    db: AsyncSession,
    *,
    server_id: uuid.UUID,
    computer_id: uuid.UUID,
    agent_id: uuid.UUID | None = None,
) -> list[dict[str, Any]]:
    query = (
        select(AgentWorkspace, Member)
        .join(Member, Member.id == AgentWorkspace.agent_id)
        .where(
            AgentWorkspace.computer_id == computer_id,
            AgentWorkspace.status == PENDING_RUNTIME_START_STATUS,
            Member.server_id == server_id,
            Member.kind == "agent",
        )
        .order_by(AgentWorkspace.created_at, AgentWorkspace.id)
    )
    if agent_id is not None:
        query = query.where(AgentWorkspace.agent_id == agent_id)

    result = await db.execute(query)
    return [runtime_start_command(workspace, agent) for workspace, agent in result.all()]


async def mark_missing_runtimes_pending_start(
    db: AsyncSession,
    *,
    server_id: uuid.UUID,
    computer_id: uuid.UUID,
    reported_workspace_ids: set[uuid.UUID],
) -> list[tuple[AgentWorkspace, Member]]:
    """Re-arm stale runtime rows that are not present in a daemon heartbeat."""
    query = (
        select(AgentWorkspace, Member)
        .join(Member, Member.id == AgentWorkspace.agent_id)
        .where(
            AgentWorkspace.computer_id == computer_id,
            Member.server_id == server_id,
            Member.kind == "agent",
            AgentWorkspace.status.in_(RUNTIME_ACTIVE_STATUSES),
        )
        .order_by(AgentWorkspace.updated_at, AgentWorkspace.id)
    )
    if reported_workspace_ids:
        query = query.where(AgentWorkspace.id.not_in(reported_workspace_ids))

    result = await db.execute(query)
    stale = result.all()
    for workspace, agent in stale:
        workspace.status = PENDING_RUNTIME_START_STATUS
        workspace.pid = None
        workspace.stopped_at = None
        if agent.status in RUNTIME_ACTIVE_STATUSES:
            agent.status = "offline"
    return list(stale)


class DaemonControlHub:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._event_cursors: dict[WebSocket, int] = {}

    def add(self, computer_id: uuid.UUID, websocket: WebSocket, event_cursor: int = 0) -> None:
        self._connections[str(computer_id)].add(websocket)
        self._event_cursors[websocket] = event_cursor

    def remove(self, computer_id: uuid.UUID, websocket: WebSocket) -> None:
        key = str(computer_id)
        peers = self._connections.get(key)
        self._event_cursors.pop(websocket, None)
        if not peers:
            return
        peers.discard(websocket)
        if not peers:
            self._connections.pop(key, None)

    def connected_computers(self, server_id: uuid.UUID | None = None) -> list[uuid.UUID]:
        # server_id is accepted to keep call sites explicit; the hub is keyed by computer id.
        del server_id
        return [uuid.UUID(key) for key, peers in self._connections.items() if peers]

    async def push(self, computer_id: uuid.UUID, event: dict[str, Any]) -> int:
        peers = list(self._connections.get(str(computer_id), set()))
        delivered = 0
        for websocket in peers:
            try:
                await websocket.send_json(event)
                delivered += 1
            except Exception:
                self.remove(computer_id, websocket)
        return delivered

    async def push_events(
        self,
        db: AsyncSession,
        *,
        server_id: uuid.UUID,
        computer_id: uuid.UUID,
    ) -> int:
        peers = list(self._connections.get(str(computer_id), set()))
        if not peers:
            return 0

        delivered = 0
        for websocket in peers:
            cursor = self._event_cursors.get(websocket, 0)
            events, scanned_cursor = await pending_visible_events_for_computer(
                db,
                server_id=server_id,
                computer_id=computer_id,
                event_cursor=cursor,
            )
            if not events:
                if scanned_cursor > cursor:
                    self._event_cursors[websocket] = scanned_cursor
                continue
            max_cursor = scanned_cursor
            try:
                for event in events:
                    await websocket.send_json(event)
                    delivered += 1
                self._event_cursors[websocket] = max_cursor
            except Exception:
                self.remove(computer_id, websocket)
        return delivered


daemon_control_hub = DaemonControlHub()


async def pending_visible_events_for_computer(
    db: AsyncSession,
    *,
    server_id: uuid.UUID,
    computer_id: uuid.UUID,
    event_cursor: int = 0,
    limit: int = 100,
) -> tuple[list[dict[str, Any]], int]:
    """Return daemon WS events expanded per target agent on a computer."""
    agent_result = await db.execute(
        select(Member).where(
            Member.server_id == server_id,
            Member.kind == "agent",
            Member.computer_id == computer_id,
        )
    )
    agents = agent_result.scalars().all()
    if not agents:
        return [], event_cursor

    channel_rows = await db.execute(
        select(ChannelMember.member_id, ChannelMember.channel_id).where(
            ChannelMember.member_id.in_([agent.id for agent in agents])
        )
    )
    visible_channels: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for member_id, channel_id in channel_rows.all():
        visible_channels[member_id].add(channel_id)

    records_result = await db.execute(
        select(EventRecord)
        .where(
            EventRecord.server_id == server_id,
            EventRecord.seq > event_cursor,
        )
        .order_by(EventRecord.seq)
        .limit(limit)
    )
    records = records_result.scalars().all()
    events: list[dict[str, Any]] = []
    scanned_cursor = event_cursor
    for record in records:
        scanned_cursor = max(scanned_cursor, int(record.seq or 0))
        for agent in agents:
            if not _event_visible_to_agent(record, agent, visible_channels.get(agent.id, set())):
                continue
            event = await _daemon_event_record_event(db, record, agent)
            event["agentId"] = str(agent.id)
            event["targetAgentId"] = str(agent.id)
            events.append(event)
    return events, scanned_cursor


async def push_latest_events_for_server(db: AsyncSession, *, server_id: uuid.UUID) -> int:
    delivered = 0
    computer_result = await db.execute(
        select(Computer.id).where(Computer.server_id == server_id)
    )
    connected = set(daemon_control_hub.connected_computers(server_id))
    for (computer_id,) in computer_result.all():
        if computer_id not in connected:
            continue
        delivered += await daemon_control_hub.push_events(
            db,
            server_id=server_id,
            computer_id=computer_id,
        )
    return delivered


def _event_visible_to_agent(record: EventRecord, agent: Member, channel_ids: set[uuid.UUID]) -> bool:
    target_agent_id = (record.payload or {}).get("targetAgentId")
    if target_agent_id and str(target_agent_id) != str(agent.id):
        return False
    return (
        record.channel_id is None
        or record.actor_id == agent.id
        or record.channel_id in channel_ids
    )


async def _daemon_event_record_event(db: AsyncSession, record: EventRecord, recipient: Member) -> dict[str, Any]:
    payload = dict(record.payload or {})
    event_type = _dotted_event_type(record.event_type)
    payload["type"] = event_type
    payload["legacyType"] = payload.get("legacyType") or _legacy_event_type(event_type)
    payload["eventId"] = str(record.id)
    payload["eventSeq"] = record.seq
    payload["eventCursor"] = str(record.seq)
    payload["eventLogCursor"] = str(record.seq)
    payload["actorId"] = str(record.actor_id) if record.actor_id else payload.get("actorId")
    payload["channelId"] = str(record.channel_id) if record.channel_id else payload.get("channelId")
    payload["taskId"] = str(record.task_id) if record.task_id else payload.get("taskId")
    payload["messageId"] = str(record.message_id) if record.message_id else payload.get("messageId")
    payload["createdAt"] = record.created_at.isoformat() if record.created_at else payload.get("createdAt")
    payload["activityCursor"] = str(record.seq)
    if event_type == "message.created":
        await _backfill_daemon_message_event_target(db, payload, record, recipient)
    return payload


async def _backfill_daemon_message_event_target(
    db: AsyncSession,
    payload: dict[str, Any],
    record: EventRecord,
    recipient: Member,
) -> None:
    """Recover reply-safe runtime targets when older event payloads lack them."""
    raw_target = str(payload.get("target") or payload.get("channel") or "")
    if record.message_id is None:
        return

    result = await db.execute(
        select(Message, Channel).join(Channel, Channel.id == Message.channel_id).where(
            Message.id == record.message_id,
        )
    )
    row = result.one_or_none()
    if not row:
        return

    msg, channel = row
    root = msg
    if msg.parent_id:
        root_result = await db.execute(select(Message).where(Message.id == msg.parent_id))
        root = root_result.scalar_one_or_none() or msg

    thread_ref = root.short_id if msg.parent_id else None
    event_target = await _message_target_for_recipient(db, channel, recipient, thread_ref=thread_ref)
    if not raw_target or (thread_ref and not raw_target.endswith(f":{thread_ref}")):
        payload["target"] = event_target
        payload["channel"] = event_target


async def _message_target_for_recipient(
    db: AsyncSession,
    channel: Channel,
    recipient: Member,
    *,
    thread_ref: str | None = None,
) -> str:
    if channel.kind in {"public", "private"}:
        base = f"#{channel.name}"
    elif channel.kind == "dm":
        peer_result = await db.execute(
            select(Member)
            .join(ChannelMember, ChannelMember.member_id == Member.id)
            .where(
                ChannelMember.channel_id == channel.id,
                Member.id != recipient.id,
            )
            .order_by(Member.kind.desc(), Member.display_name)
            .limit(1)
        )
        peer = peer_result.scalar_one_or_none()
        base = f"dm:@{peer.display_name}" if peer else channel.name
    else:
        base = f"#{channel.name}"
    return f"{base}:{thread_ref}" if thread_ref else base


def _dotted_event_type(event_type: str) -> str:
    aliases = {
        "message_received": "message.created",
        "task_created": "task.created",
        "task_claimed": "task.claimed",
        "task_updated": "task.updated",
        "message_reaction_added": "message.reaction_added",
        "message_reaction_removed": "message.reaction_removed",
    }
    return aliases.get(event_type, event_type)


def _legacy_event_type(event_type: str) -> str:
    aliases = {
        "message.created": "message_received",
        "task.created": "task_created",
        "task.claimed": "task_claimed",
        "task.updated": "task_updated",
        "task.unclaimed": "task_updated",
        "message.reaction_added": "message_reaction_added",
        "message.reaction_removed": "message_reaction_removed",
    }
    return aliases.get(event_type, event_type.replace(".", "_"))
