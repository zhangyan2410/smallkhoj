"""Daemon control command helpers shared by public and internal APIs."""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AgentWorkspace, Channel, ChannelMember, Computer, EventRecord, Member, Message, Task
from services.public_events import publish_latest_public_events

logger = logging.getLogger(__name__)

PENDING_RUNTIME_START_STATUS = "pending_start"
RUNTIME_CONFIGURATION_FAILED_STATUS = "failed"
RUNTIME_ACTIVE_STATUSES = {"running", "active", "idle"}
RUNTIME_REARMABLE_STATUSES = RUNTIME_ACTIVE_STATUSES | {"starting", "restarting"}
RUNTIME_TERMINAL_STATUSES = {"stopped", "offline", "exited"}
MISSING_RUNTIME_REARM_GRACE_SECONDS = 90


def _falsey_config(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"0", "false", "no", "off", "stopped", "disabled"}
    return value is False


def runtime_provider_for_agent(agent: Member) -> str | None:
    config = agent.config or {}
    provider = config.get("runtimeProvider")
    if provider:
        value = str(provider).strip()
        if value:
            return value
    return None


def runtime_should_autostart(agent: Member) -> bool:
    config = agent.config or {}
    desired_status = config.get("runtimeDesiredStatus")
    if desired_status and str(desired_status).strip().lower() in {"stopped", "disabled"}:
        return False
    if _falsey_config(config.get("runtimeAutostart", True)):
        return False
    return True


def runtime_start_command(workspace: AgentWorkspace, agent: Member) -> dict[str, Any]:
    """Build the daemon control envelope for a workspace runtime launch."""
    agent_config = agent.config or {}
    config: dict[str, Any] = {
        "runtime": workspace.runtime,
        "workspaceId": str(workspace.id),
        "allowWrites": True,
    }
    if workspace.runtime_command and workspace.runtime != "codex":
        config["runtimeCommand"] = workspace.runtime_command
    if workspace.runtime_model:
        config["runtimeModel"] = workspace.runtime_model
    if workspace.cwd:
        config["workspacePath"] = workspace.cwd
    runtime_provider = runtime_provider_for_agent(agent)
    if runtime_provider:
        config["runtimeProvider"] = runtime_provider
    backend = agent.backend or agent_config.get("backend")
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


def runtime_provider_available(workspace: AgentWorkspace, agent: Member, computer: Computer) -> bool:
    return runtime_provider_available_for(
        workspace.runtime,
        runtime_provider_for_agent(agent),
        computer,
    )


def runtime_provider_available_for(runtime: str, provider: str | None, computer: Computer) -> bool:
    if not provider:
        return True
    for item in computer.detected_runtimes or []:
        if not isinstance(item, dict):
            continue
        if item.get("runtimeProvider") != provider:
            continue
        if item.get("type") != runtime:
            continue
        return item.get("status") != "error"
    return False


def runtime_provider_unavailable_message_for(runtime: str, provider: str | None) -> str:
    return (
        f"Runtime provider {provider or '<none>'} is not available for "
        f"{runtime} on this computer"
    )


def runtime_provider_unavailable_message(workspace: AgentWorkspace, agent: Member) -> str:
    return runtime_provider_unavailable_message_for(workspace.runtime, runtime_provider_for_agent(agent))


def mark_runtime_provider_unavailable(workspace: AgentWorkspace, agent: Member) -> None:
    workspace.status = RUNTIME_CONFIGURATION_FAILED_STATUS
    workspace.pid = None
    workspace.stopped_at = datetime.now(timezone.utc)
    if agent.status in {"online", "active", "running", "idle"}:
        agent.status = "offline"
    config = dict(agent.config or {})
    config["runtimeLastError"] = runtime_provider_unavailable_message(workspace, agent)
    config["runtimeAutostart"] = False
    config["runtimeDesiredStatus"] = "stopped"
    agent.config = config


def clear_workspace_reference(agent: Member, workspace_id: uuid.UUID) -> None:
    config = dict(agent.config or {})
    if config.get("workspaceId") == str(workspace_id):
        config.pop("workspaceId", None)
    config["runtimeAutostart"] = False
    config["runtimeDesiredStatus"] = "stopped"
    agent.config = config


def runtime_control_command(workspace: AgentWorkspace, agent: Member, command_type: str) -> dict[str, Any]:
    """Build a daemon control envelope for a supported workspace lifecycle action."""
    if command_type == "start_runtime":
        return runtime_start_command(workspace, agent)
    if command_type not in {"stop_runtime", "restart_runtime"}:
        raise ValueError(f"Unsupported runtime control command: {command_type}")

    config = runtime_start_command(workspace, agent)["command"]["config"]
    command = {
        "type": command_type,
        "agentId": str(agent.id),
        "workspaceId": str(workspace.id),
        "config": config,
    }
    return {
        "type": "control",
        "event_type": "control",
        "eventType": "control",
        "controlType": command_type,
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
        select(AgentWorkspace, Member, Computer)
        .join(Member, Member.id == AgentWorkspace.agent_id)
        .join(Computer, Computer.id == AgentWorkspace.computer_id)
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
    commands = []
    for workspace, agent, computer in result.all():
        if not runtime_provider_available(workspace, agent, computer):
            mark_runtime_provider_unavailable(workspace, agent)
            continue
        commands.append(runtime_start_command(workspace, agent))
    return commands


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
            AgentWorkspace.status.in_(RUNTIME_REARMABLE_STATUSES | RUNTIME_TERMINAL_STATUSES),
        )
        .order_by(AgentWorkspace.updated_at, AgentWorkspace.id)
    )
    if reported_workspace_ids:
        query = query.where(AgentWorkspace.id.not_in(reported_workspace_ids))

    result = await db.execute(query)
    stale = result.all()
    now = datetime.now(timezone.utc)
    for workspace, agent in stale:
        if workspace.status in RUNTIME_TERMINAL_STATUSES:
            workspace.pid = None
            continue
        if workspace.status not in RUNTIME_REARMABLE_STATUSES:
            continue
        if _workspace_recently_confirmed_running(workspace, now=now):
            continue
        if not runtime_should_autostart(agent):
            continue
        workspace.status = PENDING_RUNTIME_START_STATUS
        workspace.pid = None
        workspace.stopped_at = None
        if agent.status in {"online", "active", "running", "idle"}:
            agent.status = "offline"
    return list(stale)


def _workspace_recently_confirmed_running(workspace: AgentWorkspace, *, now: datetime) -> bool:
    """Avoid rearming a just-confirmed session from an older empty heartbeat."""
    if workspace.status not in RUNTIME_ACTIVE_STATUSES:
        return False
    if not workspace.session_id or not workspace.started_at:
        return False
    started_at = workspace.started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    return (now - started_at).total_seconds() < MISSING_RUNTIME_REARM_GRACE_SECONDS


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
                logger.exception(
                    "daemon control push failed for computer_id=%s",
                    computer_id,
                )
                self.remove(computer_id, websocket)
        return delivered

    async def push_events(
        self,
        db: AsyncSession,
        *,
        server_id: uuid.UUID,
        computer_id: uuid.UUID,
        max_batches: int = 10,
    ) -> int:
        peers = list(self._connections.get(str(computer_id), set()))
        if not peers:
            return 0

        delivered = 0
        for websocket in peers:
            cursor = self._event_cursors.get(websocket, 0)
            for _ in range(max_batches):
                events, scanned_cursor = await pending_visible_events_for_computer(
                    db,
                    server_id=server_id,
                    computer_id=computer_id,
                    event_cursor=cursor,
                )
                if not events:
                    if scanned_cursor <= cursor:
                        break
                    cursor = scanned_cursor
                    self._event_cursors[websocket] = cursor
                    continue
                try:
                    for event in events:
                        await websocket.send_json(event)
                        delivered += 1
                    cursor = scanned_cursor
                    self._event_cursors[websocket] = cursor
                except Exception:
                    logger.exception(
                        "daemon control event push failed for computer_id=%s",
                        computer_id,
                    )
                    self.remove(computer_id, websocket)
                    break
                break
        return delivered


daemon_control_hub = DaemonControlHub()


def parse_positive_event_cursor(raw_cursor: str | int | None) -> int | None:
    """Return a resumable daemon event cursor, or None for live-subscribe starts."""
    if raw_cursor is None:
        return None
    try:
        parsed_cursor = int(raw_cursor)
    except (TypeError, ValueError):
        return None
    return parsed_cursor if parsed_cursor > 0 else None


async def initial_daemon_event_cursor(
    db: AsyncSession,
    *,
    server_id: uuid.UUID,
    raw_cursor: str | int | None,
) -> int:
    """Resolve the per-connection daemon WS cursor.

    Missing, zero, negative, or invalid cursors represent a fresh live subscription:
    start at the latest event row instead of replaying historical runtime input.
    """
    parsed_cursor = parse_positive_event_cursor(raw_cursor)
    if parsed_cursor is not None:
        return parsed_cursor

    cursor_result = await db.execute(
        select(func.coalesce(func.max(EventRecord.seq), 0)).where(EventRecord.server_id == server_id)
    )
    return int(cursor_result.scalar_one() or 0)


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
            EventRecord.event_type.not_like("workspace.%"),
        )
        .order_by(EventRecord.seq)
        .limit(limit)
    )
    records = records_result.scalars().all()
    events: list[dict[str, Any]] = []
    scanned_cursor = event_cursor
    for record in records:
        scanned_cursor = max(scanned_cursor, int(record.seq or 0))
        await _backfill_task_event_target(db, record)
        for agent in agents:
            if not _event_visible_to_agent(record, agent, visible_channels.get(agent.id, set())):
                continue
            event = await _daemon_event_record_event(db, record, agent)
            event["agentId"] = str(agent.id)
            event["targetAgentId"] = str(agent.id)
            events.append(event)
    return events, scanned_cursor


async def _backfill_task_event_target(db: AsyncSession, record: EventRecord) -> None:
    event_type = _dotted_event_type(record.event_type)
    if event_type not in {"task.created", "task.claimed", "task.updated"}:
        return
    payload = dict(record.payload or {})
    if payload.get("targetAgentId") or payload.get("assigneeId") or record.task_id is None:
        return

    result = await db.execute(select(Task.assignee_id).where(Task.id == record.task_id))
    assignee_id = result.scalar_one_or_none()
    if not assignee_id:
        return

    payload["assigneeId"] = str(assignee_id)
    payload["targetAgentId"] = str(assignee_id)
    record.payload = payload


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
    await publish_latest_public_events(db, server_id=server_id)
    return delivered


def _event_visible_to_agent(record: EventRecord, agent: Member, channel_ids: set[uuid.UUID]) -> bool:
    target_agent_id = (record.payload or {}).get("targetAgentId")
    if target_agent_id and str(target_agent_id) != str(agent.id):
        return False
    if target_agent_id and str(target_agent_id) == str(agent.id):
        return True
    event_type = _dotted_event_type(record.event_type)
    if event_type == "thread.summary_updated":
        return False
    if event_type.startswith("workspace."):
        return False
    if event_type == "message.created" and record.actor_id == agent.id:
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
        "task_memory_requested": "task.memory_requested",
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
        "task.memory_requested": "task_memory_requested",
        "task.unclaimed": "task_updated",
        "message.reaction_added": "message_reaction_added",
        "message.reaction_removed": "message_reaction_removed",
    }
    return aliases.get(event_type, event_type.replace(".", "_"))
