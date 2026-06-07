"""Daemon control command helpers shared by public and internal APIs."""

from __future__ import annotations

import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AgentWorkspace, Member


PENDING_RUNTIME_START_STATUS = "pending_start"


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


class DaemonControlHub:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    def add(self, computer_id: uuid.UUID, websocket: WebSocket) -> None:
        self._connections[str(computer_id)].add(websocket)

    def remove(self, computer_id: uuid.UUID, websocket: WebSocket) -> None:
        key = str(computer_id)
        peers = self._connections.get(key)
        if not peers:
            return
        peers.discard(websocket)
        if not peers:
            self._connections.pop(key, None)

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


daemon_control_hub = DaemonControlHub()
