"""Agent API auth — validate Bearer token + X-Agent-Id."""

import hashlib
import hmac
from uuid import UUID

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import get_db, ApiKey, Computer, Member, Server


async def resolve_agent(
    authorization: str = Header(..., alias="Authorization"),
    x_agent_id: str = Header(..., alias="X-Agent-Id"),
    db: AsyncSession = Depends(get_db),
) -> tuple[Member, Server]:
    """Validate agent token and return (member, server)."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Bearer token")

    token = authorization[7:]
    if not token:
        raise HTTPException(401, "Missing Bearer token")

    try:
        agent_id = UUID(x_agent_id)
    except ValueError:
        raise HTTPException(401, "Invalid agent ID")

    result = await db.execute(
        select(Member).where(Member.id == agent_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(401, f"Agent {x_agent_id} not found")

    result = await db.execute(
        select(Server).where(Server.id == member.server_id)
    )
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(401, "Server not found")

    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    key_result = await db.execute(
        select(ApiKey).where(
            ApiKey.server_id == server.id,
            ApiKey.key_prefix == token[:20],
        )
    )
    api_keys = key_result.scalars().all()
    valid = False
    computer_id = member.computer_id or (member.config or {}).get("computerId")
    for api_key in api_keys:
        if not api_key.token_hash or not hmac.compare_digest(api_key.token_hash, token_hash):
            continue
        if api_key.resource_type == "agent" and api_key.resource_id == member.id:
            valid = True
            break
        if api_key.resource_type == "computer" and computer_id and str(api_key.resource_id) == str(computer_id):
            valid = True
            break

    if not valid:
        raise HTTPException(401, "Invalid agent token")

    return member, server


async def resolve_machine(
    authorization: str = Header(..., alias="Authorization"),
    x_computer_id: str | None = Header(None, alias="X-Computer-Id"),
    db: AsyncSession = Depends(get_db),
) -> tuple[Computer, Server, ApiKey]:
    """Validate a machine token and return (computer, server, api_key)."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Bearer token")

    token = authorization[7:]
    if not token:
        raise HTTPException(401, "Missing Bearer token")

    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    key_result = await db.execute(
        select(ApiKey).where(
            ApiKey.key_prefix == token[:20],
            ApiKey.resource_type == "computer",
        )
    )
    api_keys = key_result.scalars().all()

    api_key = None
    for candidate in api_keys:
        if candidate.token_hash and hmac.compare_digest(candidate.token_hash, token_hash):
            api_key = candidate
            break

    if not api_key:
        raise HTTPException(401, "Invalid machine token")

    if x_computer_id:
        try:
            parsed_computer_id = UUID(x_computer_id)
        except ValueError:
            raise HTTPException(401, "Invalid computer ID")
        if parsed_computer_id != api_key.resource_id:
            raise HTTPException(403, "Machine token does not match X-Computer-Id")

    result = await db.execute(
        select(Server).where(Server.id == api_key.server_id)
    )
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(401, "Server not found")

    result = await db.execute(
        select(Computer).where(
            Computer.id == api_key.resource_id,
            Computer.server_id == server.id,
        )
    )
    computer = result.scalar_one_or_none()
    if not computer:
        computer = Computer(
            id=api_key.resource_id,
            server_id=server.id,
            name="unregistered-computer",
            os="unknown",
            daemon_version="unknown",
            api_key_prefix=api_key.key_prefix,
            status="offline",
            detected_runtimes=[],
        )
        db.add(computer)
        await db.flush()

    return computer, server, api_key
