"""Shared member serialization helpers for public and agent APIs."""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AgentWorkspace, Computer, Member


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


async def serialize_member(db: AsyncSession, member: Member, *, _computer: Computer | None = None) -> dict:
    config = member.config or {}
    profile = {
        "displayName": member.display_name,
        "description": member.description,
        "avatarUrl": member.avatar_url,
    }

    status = member.status
    if member.kind == "agent" and member.computer_id and status in {"online", "active", "running", "idle"}:
        computer = _computer
        if computer is None:
            result = await db.execute(
                select(Computer).where(Computer.id == member.computer_id)
            )
            computer = result.scalar_one_or_none()
        if _lease_expired(computer):
            status = "offline"

    return {
        "id": str(member.id),
        "name": member.display_name,
        "displayName": member.display_name,
        "handle": f"@{member.display_name}",
        "kind": member.kind,
        "type": member.kind,
        "profile": profile,
        "status": status,
        "description": member.description,
        "avatarUrl": member.avatar_url,
        "skills": member.skills or [],
        "config": config,
        "computerId": member_computer_id(member),
        "workspaceId": await member_workspace_id(db, member),
        "backend": member_backend(member),
        "runtimeProvider": member_runtime_provider(member),
        "permissions": config.get("permissions") or {},
        "actions": config.get("actions") or {},
    }
