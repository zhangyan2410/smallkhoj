"""Server/account membership helpers for public human API scoping."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, text

from models import Account, Channel, ChannelMember, Computer, Member, Server, ServerMembership

ADMIN_ROLES = {"owner", "admin"}
OWNER_ELECTION_LOCK_NAMESPACE = 0x534B484A
OWNER_ELECTION_LOCK_SCOPE = 1


@dataclass(frozen=True)
class ActiveServerContext:
    account: Account
    server: Server
    member: Member
    membership: ServerMembership


async def acquire_owner_election_lock(db: Any) -> None:
    """Serialize every global owner-election path for the transaction lifetime."""

    await db.execute(
        text(
            "SELECT pg_advisory_xact_lock("
            ":owner_election_namespace, :owner_election_scope)"
        ),
        {
            "owner_election_namespace": OWNER_ELECTION_LOCK_NAMESPACE,
            "owner_election_scope": OWNER_ELECTION_LOCK_SCOPE,
        },
    )


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


async def list_account_memberships(db: Any, *, account: Account) -> list[dict[str, Any]]:
    result = await db.execute(
        select(ServerMembership, Server, Member)
        .join(Server, Server.id == ServerMembership.server_id)
        .join(Member, Member.id == ServerMembership.member_id)
        .where(
            ServerMembership.account_id == account.id,
            ServerMembership.status == "active",
        )
        .order_by(ServerMembership.created_at.asc())
    )
    memberships = []
    for membership, server, member in result.all():
        memberships.append(
            {
                "server": {
                    "id": str(server.id),
                    "name": server.name,
                },
                "member": {
                    "id": str(member.id),
                    "displayName": member.display_name,
                    "kind": member.kind,
                },
                "role": membership.role,
                "status": membership.status,
                "isDefault": server.id == account.server_id,
            }
        )
    return memberships


async def create_server_for_account(
    db: Any,
    *,
    account: Account,
    name: str,
) -> tuple[Server, Member, ServerMembership]:
    server_name = (name or "").strip()
    if not server_name:
        raise HTTPException(400, "Missing Server name")

    server = Server(id=uuid.uuid4(), name=server_name)
    db.add(server)
    await db.flush()

    member = Member(
        id=uuid.uuid4(),
        server_id=server.id,
        kind="human",
        display_name=account.display_name or account.name,
        status="online",
    )
    db.add(member)
    await db.flush()

    membership = await ensure_account_membership(
        db,
        account=account,
        server=server,
        member=member,
        default_role="owner",
    )
    return server, member, membership


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
    selected_server_id = requested_server_id or account.server_id
    if not selected_server_id:
        raise HTTPException(403, "Account has no active Server membership")

    query = (
        select(ServerMembership, Server, Member)
        .join(Server, Server.id == ServerMembership.server_id)
        .join(Member, Member.id == ServerMembership.member_id)
        .where(
            ServerMembership.account_id == account.id,
            ServerMembership.server_id == selected_server_id,
            ServerMembership.status == "active",
        )
    )

    result = await db.execute(query)
    row = result.one_or_none() if hasattr(result, "one_or_none") else None
    if row:
        membership, server, member = row
        return ActiveServerContext(account=account, server=server, member=member, membership=membership)

    if requested_server_id:
        raise HTTPException(403, "Account is not a member of the selected Server")

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
