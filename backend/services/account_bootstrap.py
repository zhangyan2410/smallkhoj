"""One-Account/one-home-Server signup transaction."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from config import settings
from models import Account, Member, Server, ServerMembership
from services.member_identity import (
    SERVER_HANDLE_RETRY_LIMIT,
    MemberIdentityError,
    generate_server_handle,
    integrity_constraint_name,
    normalize_handle,
)
from services.server_membership import ensure_account_membership


@dataclass(frozen=True)
class AccountBootstrapResult:
    account: Account
    server: Server
    member: Member
    membership: ServerMembership
    session_token: str
    created: bool


def _identity_http_error(error: MemberIdentityError) -> HTTPException:
    return HTTPException(
        400,
        detail={"reasonCode": error.code, "message": str(error)},
    )


def _normalize_auth_subject(raw: object) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise HTTPException(400, "Missing authentication subject")
    subject = raw.strip()
    if len(subject) > 255:
        raise HTTPException(400, "Authentication subject is too long")
    return subject


async def _lock_subject(db: Any, auth_subject: str) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:auth_subject, 0))"),
        {"auth_subject": auth_subject},
    )


async def _create_home_server(db: Any, *, name: str) -> Server:
    for _attempt in range(SERVER_HANDLE_RETRY_LIMIT):
        server = Server(id=uuid.uuid4(), name=name, server_handle=generate_server_handle())
        try:
            if hasattr(db, "begin_nested"):
                async with db.begin_nested():
                    db.add(server)
                    await db.flush()
            else:
                db.add(server)
                await db.flush()
            return server
        except IntegrityError as error:
            if integrity_constraint_name(error) != "uq_servers_server_handle":
                raise
    raise HTTPException(503, "Could not allocate a unique Server handle")


async def _load_configured_official_server(db: Any) -> Server | None:
    """Resolve the optional official Server from ``OFFICIAL_SERVER_HANDLE``.

    An empty setting disables the auto-join; an unknown handle (official
    Account not registered yet) skips it without failing the signup.
    """

    handle = (settings.official_server_handle or "").strip().lower()
    if not handle:
        return None
    result = await db.execute(select(Server).where(Server.server_handle == handle))
    return result.scalar_one_or_none()


async def bootstrap_account(
    db: Any,
    *,
    auth_subject: object,
    name: object,
    display_name: str | None = None,
) -> AccountBootstrapResult:
    """Create or safely resume one complete application identity transaction."""

    subject = _normalize_auth_subject(auth_subject)
    try:
        normalized_name = normalize_handle(name)
    except MemberIdentityError as error:
        raise _identity_http_error(error) from error

    await _lock_subject(db, subject)
    result = await db.execute(select(Account).where(Account.auth_subject == subject))
    account = result.scalar_one_or_none()
    created = account is None

    if account is None:
        server = await _create_home_server(db, name=normalized_name.handle)
        account = Account(
            id=uuid.uuid4(),
            auth_subject=subject,
            display_name=(display_name or "").strip() or None,
            home_server_id=server.id,
        )
        db.add(account)
        await db.flush()
        member = Member(
            id=uuid.uuid4(),
            origin_server_id=server.id,
            account_id=account.id,
            kind="human",
            handle=normalized_name.handle,
            handle_key=normalized_name.handle_key,
            status="online",
        )
        db.add(member)
        await db.flush()
        membership = ServerMembership(
            id=uuid.uuid4(),
            server_id=server.id,
            account_id=account.id,
            member_id=member.id,
            role="owner",
            status="active",
        )
        db.add(membership)
        await db.flush()
        official_server = await _load_configured_official_server(db)
        if official_server is not None and official_server.id != server.id:
            await ensure_account_membership(
                db,
                account=account,
                server=official_server,
                member=member,
                default_role="member",
            )
    else:
        server_result = await db.execute(select(Server).where(Server.id == account.home_server_id))
        server = server_result.scalar_one_or_none()
        member_result = await db.execute(select(Member).where(Member.account_id == account.id))
        member = member_result.scalar_one_or_none()
        membership_result = await db.execute(
            select(ServerMembership).where(
                ServerMembership.server_id == account.home_server_id,
                ServerMembership.account_id == account.id,
                ServerMembership.member_id == (member.id if member else None),
            )
        )
        membership = membership_result.scalar_one_or_none()
        if not server or not member or not membership:
            raise HTTPException(409, "Account bootstrap is incomplete; clean reset is required")
        if member.handle_key != normalized_name.handle_key:
            raise HTTPException(
                409,
                detail={
                    "reasonCode": "NAME_IMMUTABLE",
                    "message": "This account already has a different immutable Name",
                },
            )
        member.status = "online"
        membership.status = "active"
        membership.role = "owner"
        if display_name is not None:
            account.display_name = display_name.strip() or None

    session_token = f"sk_session_{secrets.token_urlsafe(32)}"
    account.session_token_hash = hashlib.sha256(session_token.encode("utf-8")).hexdigest()
    account.last_login_at = datetime.now(timezone.utc)
    await db.flush()
    return AccountBootstrapResult(
        account=account,
        server=server,
        member=member,
        membership=membership,
        session_token=session_token,
        created=created,
    )
