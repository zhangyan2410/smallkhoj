"""Shared member serialization helpers for public and agent APIs."""

import uuid
from datetime import datetime
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AgentWorkspace, Computer, Member
from routers.serialization_prefetch import UNSET


def _now_for(value: datetime | None) -> datetime:
    if not value:
        return datetime.utcnow()
    return datetime.now(value.tzinfo) if value.tzinfo else datetime.utcnow()


def _lease_expired(computer: Computer | None) -> bool:
    if not computer or not computer.daemon_lease_expires_at:
        return True
    now = _now_for(computer.daemon_lease_expires_at)
    return computer.daemon_lease_expires_at <= now


def member_computer_id(member: Member) -> str | None:
    if member.computer_id:
        return str(member.computer_id)
    config = member.config or {}
    return config.get("computerId")


def member_backend(member: Member) -> str | None:
    if member.backend:
        return member.backend
    config = member.config or {}
    return config.get("backend")


def member_runtime_provider(member: Member) -> str | None:
    config = member.config or {}
    provider = config.get("runtimeProvider")
    if provider:
        value = str(provider).strip()
        if value:
            return value
    return None


async def member_workspace_id(db: AsyncSession, member: Member) -> str | None:
    config = member.config or {}
    if member.kind != "agent":
        return config.get("workspaceId")

    result = await db.execute(
        select(AgentWorkspace.id)
        .where(AgentWorkspace.agent_id == member.id)
        .order_by(AgentWorkspace.updated_at.desc())
        .limit(1)
    )
    workspace_id = result.scalar_one_or_none()
    return str(workspace_id) if workspace_id else config.get("workspaceId")


async def _member_workspace_status(db: AsyncSession, workspace_id: str | None) -> str | None:
    """Look up an agent workspace's runtime status (pending_start/running/stopped/...).

    Used by serialize_member to surface runtimeStatus so the frontend can show an
    "agent starting" state — member.status alone is only online/offline.
    """
    if not workspace_id:
        return None
    try:
        parsed = uuid.UUID(str(workspace_id))
    except (ValueError, TypeError):
        return None
    result = await db.execute(
        select(AgentWorkspace.status)
        .where(AgentWorkspace.id == parsed)
        .limit(1)
    )
    status = result.scalar_one_or_none()
    return status or None


async def serialize_member(
    db: AsyncSession,
    member: Member,
    *,
    _computer: Computer | None | object = UNSET,
    _workspace_id: str | None | object = UNSET,
    _workspace_status: str | None | object = UNSET,
    _reference: str | None = None,
) -> dict:
    config = member.config or {}
    profile = {
        "avatarUrl": member.avatar_url,
    }
    if member.kind == "agent":
        profile["description"] = member.description

    status = member.status
    if member.kind == "agent" and member.computer_id and status in {"online", "active", "running", "idle"}:
        if _computer is UNSET:
            result = await db.execute(
                select(Computer).where(Computer.id == member.computer_id)
            )
            computer = result.scalar_one_or_none()
        else:
            computer = cast(Computer | None, _computer)
        if _lease_expired(computer):
            status = "offline"

    if _workspace_id is UNSET:
        workspace_id = await member_workspace_id(db, member)
    else:
        workspace_id = cast(str | None, _workspace_id)

    runtime_status: str | None = None
    if member.kind == "agent":
        if _workspace_status is UNSET:
            runtime_status = await _member_workspace_status(db, workspace_id)
        else:
            runtime_status = cast(str | None, _workspace_status)

    payload = {
        "id": str(member.id),
        "name": member.handle,
        "handle": member.handle,
        "reference": _reference or f"@{member.handle}",
        "kind": member.kind,
        "type": member.kind,
        "profile": profile,
        "status": status,
        "avatarUrl": member.avatar_url,
        "skills": member.skills or [],
        "config": config,
        "computerId": member_computer_id(member),
        "workspaceId": workspace_id,
        "backend": member_backend(member),
        "runtimeProvider": member_runtime_provider(member),
        "permissions": config.get("permissions") or {},
        "actions": config.get("actions") or {},
    }
    if member.kind == "agent":
        payload["description"] = member.description
        if runtime_status:
            payload["runtimeStatus"] = runtime_status
    return payload
