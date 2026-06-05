"""Shared member serialization helpers for public and agent APIs."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AgentWorkspace, Member


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


async def serialize_member(db: AsyncSession, member: Member) -> dict:
    config = member.config or {}
    profile = {
        "displayName": member.display_name,
        "description": member.description,
        "avatarUrl": member.avatar_url,
    }
    return {
        "id": str(member.id),
        "name": member.display_name,
        "displayName": member.display_name,
        "handle": f"@{member.display_name}",
        "kind": member.kind,
        "type": member.kind,
        "profile": profile,
        "status": member.status,
        "description": member.description,
        "avatarUrl": member.avatar_url,
        "skills": member.skills or [],
        "config": config,
        "computerId": member_computer_id(member),
        "workspaceId": await member_workspace_id(db, member),
        "backend": member_backend(member),
        "permissions": config.get("permissions") or {},
        "actions": config.get("actions") or {},
    }
