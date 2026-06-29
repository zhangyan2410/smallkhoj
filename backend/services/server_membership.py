"""Server/account membership helpers for public human API scoping."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select

from models import Account, Channel, ChannelMember, Computer, Member, Server, ServerMembership

ADMIN_ROLES = {"owner", "admin"}


@dataclass(frozen=True)
class ActiveServerContext:
    account: Account
    server: Server
    member: Member
    membership: ServerMembership


async def ensure_account_membership(
    db: Any,
    *,
    account: Account,
    server: Server,
    member: Member,
    default_role: str = "member",
) -> ServerMembership:
    result = await db.execute(
        select(ServerMembership).where(
            ServerMembership.server_id == server.id,
            ServerMembership.account_id == account.id,
        )
    )
    membership = result.scalar_one_or_none()
    if membership:
        if membership.status != "active":
            membership.status = "active"
        if membership.member_id != member.id:
            membership.member_id = member.id
        return membership

    membership = ServerMembership(
        server_id=server.id,
        account_id=account.id,
        member_id=member.id,
        role=default_role,
        status="active",
    )
    db.add(membership)
    await db.flush()
    return membership


def parse_server_id(raw: str | uuid.UUID | None) -> uuid.UUID | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, uuid.UUID):
        return raw
    try:
        return uuid.UUID(str(raw))
    except ValueError:
        raise HTTPException(400, "Invalid server id")


async def resolve_active_server_context(
    db: Any,
    *,
    account: Account,
    requested_server_id: uuid.UUID | None = None,
) -> ActiveServerContext:
    query = (
        select(ServerMembership, Server, Member)
        .join(Server, Server.id == ServerMembership.server_id)
        .join(Member, Member.id == ServerMembership.member_id)
        .where(
            ServerMembership.account_id == account.id,
            ServerMembership.status == "active",
        )
    )
    if requested_server_id:
        query = query.where(ServerMembership.server_id == requested_server_id)

    result = await db.execute(query)
    row = result.one_or_none() if hasattr(result, "one_or_none") else None
    if row:
        membership, server, member = row
        return ActiveServerContext(account=account, server=server, member=member, membership=membership)

    if requested_server_id:
        raise HTTPException(403, "Account is not a member of the selected Server")

    fallback_result = await db.execute(
        select(ServerMembership, Server, Member)
        .join(Server, Server.id == ServerMembership.server_id)
        .join(Member, Member.id == ServerMembership.member_id)
        .where(
            ServerMembership.account_id == account.id,
            ServerMembership.server_id == account.server_id,
            ServerMembership.status == "active",
        )
    )
    fallback = fallback_result.one_or_none() if hasattr(fallback_result, "one_or_none") else None
    if fallback:
        membership, server, member = fallback
        return ActiveServerContext(account=account, server=server, member=member, membership=membership)

    raise HTTPException(403, "Account has no active Server membership")


def require_admin_role(membership: ServerMembership) -> None:
    if membership.role not in ADMIN_ROLES:
        raise HTTPException(403, "Server owner/admin role required")


def ensure_channel_access(channel: Channel, member_id: uuid.UUID, *, is_channel_member: bool) -> None:
    if channel.kind in {"private", "dm"} and not is_channel_member:
        raise HTTPException(403, "Channel is private to channel members")


async def is_channel_member(db: Any, *, channel_id: uuid.UUID, member_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel_id,
            ChannelMember.member_id == member_id,
        )
    )
    return result.scalar_one_or_none() is not None


def ensure_server_scoped_computer(computer: Computer | None, *, server_id: uuid.UUID) -> Computer:
    if not computer or computer.server_id != server_id:
        raise HTTPException(404, "Computer not found")
    return computer
