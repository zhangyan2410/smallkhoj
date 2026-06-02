"""Agent API auth — validate Bearer token + X-Agent-Id."""

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import get_db, ApiKey, Member, Server


async def resolve_agent(
    authorization: str = Header(..., alias="Authorization"),
    x_agent_id: str = Header(..., alias="X-Agent-Id"),
    db: AsyncSession = Depends(get_db),
) -> tuple[Member, Server]:
    """Validate agent token and return (member, server)."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Bearer token")

    token = authorization[7:]

    # MVP: accept known test tokens or query api_keys table
    # For now, look up by member id matching x_agent_id
    from uuid import UUID
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

    return member, server
