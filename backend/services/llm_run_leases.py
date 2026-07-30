"""Durable, globally serialized capacity leases for built-in Pi turns."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import select, text

from models import LlmRunLease

TERMINAL_LEASE_STATUSES = {"released", "expired", "failed"}
CAPACITY_ADVISORY_LOCK_ID = 0x534B5049  # "SKPI"


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def reconcile_run_leases(
    leases: Iterable[LlmRunLease],
    *,
    capacity: int,
    now: datetime,
    lease_seconds: int,
) -> list[LlmRunLease]:
    """Expire stale owners and promote FIFO waiters without reviving terminals."""
    current = _aware(now)
    items = list(leases)
    for lease in items:
        if lease.status != "active":
            continue
        if _aware(lease.expires_at) <= current:
            lease.status = "expired"
            lease.released_at = current

    active_count = sum(
        1
        for lease in items
        if lease.status == "active" and _aware(lease.expires_at) > current
    )
    available = max(0, max(0, capacity) - active_count)
    waiters = sorted(
        (lease for lease in items if lease.status == "waiting"),
        key=lambda lease: (_aware(lease.created_at), lease.run_id),
    )
    for lease in waiters[:available]:
        lease.status = "active"
        lease.acquired_at = current
        lease.heartbeat_at = current
        lease.expires_at = current + timedelta(seconds=max(1, lease_seconds))
    return items


def serialize_run_lease(lease: LlmRunLease, *, leases: Iterable[LlmRunLease] = ()) -> dict:
    position = None
    if lease.status == "waiting":
        waiters = sorted(
            (item for item in leases if item.status == "waiting"),
            key=lambda item: (_aware(item.created_at), item.run_id),
        )
        position = next((index for index, item in enumerate(waiters, 1) if item.run_id == lease.run_id), None)
    return {
        "runId": lease.run_id,
        "state": lease.status,
        "status": lease.status,
        "position": position,
        "expiresAt": lease.expires_at.isoformat() if lease.expires_at else None,
        "failureCode": lease.failure_code,
    }


def assert_lease_owner(
    lease: LlmRunLease,
    *,
    server_id: uuid.UUID,
    computer_id: uuid.UUID,
    agent_id: uuid.UUID,
) -> None:
    if (
        lease.server_id != server_id
        or lease.computer_id != computer_id
        or lease.agent_id != agent_id
    ):
        raise HTTPException(403, "LLM run lease belongs to another owner")


async def _serialize_capacity(db) -> None:
    bind = db.get_bind() if hasattr(db, "get_bind") else None
    if bind is not None and bind.dialect.name == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(:lock_id)"), {"lock_id": CAPACITY_ADVISORY_LOCK_ID})


async def _load_capacity_leases(db) -> list[LlmRunLease]:
    result = await db.execute(
        select(LlmRunLease)
        .where(LlmRunLease.status.in_(["waiting", "active"]))
        .order_by(LlmRunLease.created_at, LlmRunLease.run_id)
        .with_for_update()
    )
    return list(result.scalars().all())


async def acquire_run_lease(
    db,
    *,
    run_id: str,
    server_id: uuid.UUID,
    computer_id: uuid.UUID,
    agent_id: uuid.UUID,
    capacity: int,
    lease_seconds: int,
) -> tuple[LlmRunLease, list[LlmRunLease]]:
    await _serialize_capacity(db)
    existing_result = await db.execute(select(LlmRunLease).where(LlmRunLease.run_id == run_id).with_for_update())
    lease = existing_result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if lease is None:
        lease = LlmRunLease(
            id=uuid.uuid4(),
            run_id=run_id,
            server_id=server_id,
            computer_id=computer_id,
            agent_id=agent_id,
            status="waiting",
            expires_at=now + timedelta(seconds=max(1, lease_seconds)),
        )
        db.add(lease)
        await db.flush()
    else:
        assert_lease_owner(
            lease,
            server_id=server_id,
            computer_id=computer_id,
            agent_id=agent_id,
        )
    leases = await _load_capacity_leases(db)
    if lease.status in {"waiting", "active"} and all(item.run_id != lease.run_id for item in leases):
        leases.append(lease)
    reconcile_run_leases(leases, capacity=capacity, now=now, lease_seconds=lease_seconds)
    await db.flush()
    return lease, leases


async def get_owned_run_lease(
    db,
    *,
    run_id: str,
    server_id: uuid.UUID,
    computer_id: uuid.UUID,
    agent_id: uuid.UUID,
) -> LlmRunLease:
    result = await db.execute(select(LlmRunLease).where(LlmRunLease.run_id == run_id))
    lease = result.scalar_one_or_none()
    if lease is None:
        raise HTTPException(404, "LLM run lease not found")
    assert_lease_owner(
        lease,
        server_id=server_id,
        computer_id=computer_id,
        agent_id=agent_id,
    )
    return lease


async def heartbeat_run_lease(db, *, lease: LlmRunLease, lease_seconds: int) -> LlmRunLease:
    now = datetime.now(timezone.utc)
    if lease.status != "active" or _aware(lease.expires_at) <= now:
        if lease.status == "active":
            lease.status = "expired"
            lease.released_at = now
        raise HTTPException(409, "LLM run lease is not active")
    lease.heartbeat_at = now
    lease.expires_at = now + timedelta(seconds=max(1, lease_seconds))
    await db.flush()
    return lease


async def release_run_lease(
    db,
    *,
    lease: LlmRunLease,
    capacity: int,
    lease_seconds: int,
    failed: bool = False,
    failure_code: str | None = None,
) -> list[LlmRunLease]:
    await _serialize_capacity(db)
    now = datetime.now(timezone.utc)
    if lease.status not in TERMINAL_LEASE_STATUSES:
        lease.status = "failed" if failed else "released"
        lease.failure_code = failure_code if failed else None
        lease.released_at = now
    leases = await _load_capacity_leases(db)
    reconcile_run_leases(leases, capacity=capacity, now=now, lease_seconds=lease_seconds)
    await db.flush()
    return leases


def require_active_lease(lease: LlmRunLease, *, now: datetime | None = None) -> None:
    current = now or datetime.now(timezone.utc)
    if lease.status != "active" or _aware(lease.expires_at) <= _aware(current):
        raise HTTPException(409, "An active LLM run lease is required")
