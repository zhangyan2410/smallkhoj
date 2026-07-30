"""Transaction ownership for Server-scoped runtime and onboarding writes."""

from __future__ import annotations

from contextlib import nullcontext
import hashlib
import uuid

from sqlalchemy import text


_RUNTIME_STATE_LOCK_NAMESPACE = b"smallkhoj:server-runtime-state:v1:"


def server_runtime_state_lock_id(server_id: uuid.UUID) -> int:
    """Return a stable signed bigint accepted by PostgreSQL advisory locks."""
    digest = hashlib.blake2b(
        _RUNTIME_STATE_LOCK_NAMESPACE + server_id.bytes,
        digest_size=8,
    ).digest()
    return int.from_bytes(digest, byteorder="big", signed=True)


async def serialize_server_runtime_state(db, *, server_id: uuid.UUID) -> None:
    """Own runtime-state mutation order for one Server until transaction end.

    Callers must invoke this before changing ORM objects. ``no_autoflush`` is
    retained as a defensive boundary so acquiring the lock never flushes an
    already-dirty object before serialization.
    """
    get_bind = getattr(db, "get_bind", None)
    bind = get_bind() if callable(get_bind) else None
    if bind is None or bind.dialect.name != "postgresql":
        return

    no_autoflush = getattr(db, "no_autoflush", nullcontext())
    with no_autoflush:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(:lock_id)"),
            {"lock_id": server_runtime_state_lock_id(server_id)},
        )
