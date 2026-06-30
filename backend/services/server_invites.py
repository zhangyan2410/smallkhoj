"""Server invite link helpers."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select

from models import Account, Member, Server, ServerInvite, ServerMembership
from services.server_membership import ensure_account_membership

INVITE_TOKEN_PREFIX = "sk_invite_"
DEFAULT_INVITE_EXPIRES_IN_DAYS = 14
MAX_INVITE_EXPIRES_IN_DAYS = 30
VALID_INVITE_ROLES = {"admin", "member"}


@dataclass(frozen=True)
class CreatedServerInvite:
    invite: ServerInvite
    token: str
    join_url: str


@dataclass(frozen=True)
class ServerInvitePreview:
    invite: ServerInvite
    server: Server
    already_member: bool


@dataclass(frozen=True)
class AcceptedServerInvite:
    invite: ServerInvite
    server: Server
    member: Member
    membership: ServerMembership


def generate_invite_token() -> str:
    return f"{INVITE_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _normalize_role(role: str | None) -> str:
    normalized = (role or "member").strip().lower()
    if normalized not in VALID_INVITE_ROLES:
        raise HTTPException(400, "Invite role must be admin or member")
    return normalized


def _normalize_expiry_days(expires_in_days: int | str | None) -> int:
    if expires_in_days in (None, ""):
        return DEFAULT_INVITE_EXPIRES_IN_DAYS
    try:
        days = int(expires_in_days)
    except (TypeError, ValueError):
        raise HTTPException(400, "Invite expiry must be a number of days")
    if days < 1 or days > MAX_INVITE_EXPIRES_IN_DAYS:
        raise HTTPException(400, f"Invite expiry must be between 1 and {MAX_INVITE_EXPIRES_IN_DAYS} days")
    return days


def _normalize_token(token: str) -> str:
    value = (token or "").strip()
    if not value.startswith(INVITE_TOKEN_PREFIX) or len(value) <= len(INVITE_TOKEN_PREFIX):
        raise HTTPException(404, "Invite link not found")
    return value


def _is_past(value: datetime | None) -> bool:
    if not value:
        return False
    now = datetime.now(value.tzinfo or timezone.utc)
    comparable = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return comparable <= now


async def create_server_invite(
    db: Any,
    *,
    server: Server,
    creator: Member,
    role: str | None = "member",
    invited_name: str | None = None,
    expires_in_days: int | str | None = DEFAULT_INVITE_EXPIRES_IN_DAYS,
    public_base_url: str,
) -> CreatedServerInvite:
    token = generate_invite_token()
    days = _normalize_expiry_days(expires_in_days)
    invite = ServerInvite(
        id=uuid.uuid4(),
        server_id=server.id,
        token_hash=hash_invite_token(token),
        role=_normalize_role(role),
        invited_name=(invited_name or "").strip()[:255] or None,
        expires_at=datetime.now(timezone.utc) + timedelta(days=days),
        created_by=creator.id,
    )
    db.add(invite)
    await db.flush()
    base = public_base_url.rstrip("/")
    return CreatedServerInvite(invite=invite, token=token, join_url=f"{base}/join/{token}")


async def _load_invite(db: Any, *, token: str) -> ServerInvite:
    normalized = _normalize_token(token)
    result = await db.execute(select(ServerInvite).where(ServerInvite.token_hash == hash_invite_token(normalized)))
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(404, "Invite link not found")
    return invite


def _validate_invite_for_accept(invite: ServerInvite, *, account: Account | None = None) -> None:
    if invite.revoked_at is not None:
        raise HTTPException(410, "Invite link was revoked")
    if _is_past(invite.expires_at):
        raise HTTPException(410, "Invite link has expired")
    if invite.accepted_at is not None and (not account or invite.accepted_account_id != account.id):
        raise HTTPException(410, "Invite link has already been used")


async def _load_server(db: Any, *, server_id: uuid.UUID) -> Server:
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(404, "Invite Server not found")
    return server


async def _load_active_membership(
    db: Any,
    *,
    server_id: uuid.UUID,
    account_id: uuid.UUID,
) -> tuple[ServerMembership, Member] | None:
    result = await db.execute(
        select(ServerMembership, Member)
        .join(Member, Member.id == ServerMembership.member_id)
        .where(
            ServerMembership.server_id == server_id,
            ServerMembership.account_id == account_id,
            ServerMembership.status == "active",
        )
    )
    return result.one_or_none()


def _account_member_name(account: Account) -> str:
    return (account.display_name or account.name or f"member-{str(account.id)[:8]}").strip()[:80]


async def _create_human_member_for_account(db: Any, *, server: Server, account: Account) -> Member:
    base_name = _account_member_name(account)
    candidates = [base_name, f"{base_name}-{str(account.id)[:6]}"]
    for name in candidates:
        result = await db.execute(
            select(Member).where(
                Member.server_id == server.id,
                Member.display_name == name,
            )
        )
        if result.scalar_one_or_none() is None:
            member = Member(
                id=uuid.uuid4(),
                server_id=server.id,
                kind="human",
                display_name=name,
                status="online",
            )
            db.add(member)
            await db.flush()
            return member
    raise HTTPException(409, "A member with this display name already exists")


async def inspect_server_invite(db: Any, *, token: str, account: Account | None = None) -> ServerInvitePreview:
    invite = await _load_invite(db, token=token)
    _validate_invite_for_accept(invite, account=account)
    server = await _load_server(db, server_id=invite.server_id)
    already_member = False
    if account:
        existing = await _load_active_membership(db, server_id=server.id, account_id=account.id)
        already_member = existing is not None
    return ServerInvitePreview(invite=invite, server=server, already_member=already_member)


async def accept_server_invite(db: Any, *, token: str, account: Account) -> AcceptedServerInvite:
    invite = await _load_invite(db, token=token)
    _validate_invite_for_accept(invite, account=account)
    server = await _load_server(db, server_id=invite.server_id)

    existing = await _load_active_membership(db, server_id=server.id, account_id=account.id)
    if existing:
        membership, member = existing
    else:
        member = await _create_human_member_for_account(db, server=server, account=account)
        membership = await ensure_account_membership(
            db,
            account=account,
            server=server,
            member=member,
            default_role=invite.role,
        )

    if invite.accepted_at is None:
        invite.accepted_at = datetime.now(timezone.utc)
        invite.accepted_account_id = account.id
    return AcceptedServerInvite(invite=invite, server=server, member=member, membership=membership)
