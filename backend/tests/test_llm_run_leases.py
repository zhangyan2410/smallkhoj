from datetime import datetime, timedelta, timezone
import uuid

import pytest
from fastapi import HTTPException

from models import Base, LlmRunLease
from services.llm_run_leases import (
    assert_lease_owner,
    reconcile_run_leases,
    serialize_run_lease,
)


def _lease(*, status="waiting", created_offset=0, expires_offset=120):
    now = datetime.now(timezone.utc)
    return LlmRunLease(
        id=uuid.uuid4(),
        run_id=f"run-{uuid.uuid4()}",
        server_id=uuid.uuid4(),
        computer_id=uuid.uuid4(),
        agent_id=uuid.uuid4(),
        status=status,
        created_at=now + timedelta(seconds=created_offset),
        expires_at=now + timedelta(seconds=expires_offset),
    )


def test_llm_run_lease_schema_has_owner_status_and_expiry_indexes():
    table = Base.metadata.tables["llm_run_leases"]

    assert {"run_id", "server_id", "computer_id", "agent_id", "status", "heartbeat_at", "expires_at"} <= set(table.c.keys())
    assert table.c.run_id.unique is True
    assert any(index.name == "idx_llm_run_leases_status_expiry" for index in table.indexes)


def test_capacity_one_activates_oldest_waiter_and_exposes_queue_position():
    first = _lease(created_offset=-2)
    second = _lease(created_offset=-1)
    now = datetime.now(timezone.utc)

    reconcile_run_leases([second, first], capacity=1, now=now, lease_seconds=60)

    assert first.status == "active"
    assert second.status == "waiting"
    serialized = serialize_run_lease(second, leases=[second, first])
    assert serialized["state"] == "waiting"
    assert serialized["status"] == "waiting"
    assert serialized["position"] == 1


def test_expired_active_lease_is_terminal_and_promotes_waiter():
    active = _lease(status="active", created_offset=-3, expires_offset=-1)
    waiter = _lease(status="waiting", created_offset=-2)
    now = datetime.now(timezone.utc)

    reconcile_run_leases([active, waiter], capacity=1, now=now, lease_seconds=60)

    assert active.status == "expired"
    assert active.released_at == now
    assert waiter.status == "active"
    assert waiter.acquired_at == now


def test_released_lease_never_reactivates():
    released = _lease(status="released", created_offset=-3)

    reconcile_run_leases([released], capacity=1, now=datetime.now(timezone.utc), lease_seconds=60)

    assert released.status == "released"


def test_lease_owner_tuple_is_immutable_and_non_owner_is_rejected():
    lease = _lease(status="active")

    assert_lease_owner(
        lease,
        server_id=lease.server_id,
        computer_id=lease.computer_id,
        agent_id=lease.agent_id,
    )
    with pytest.raises(HTTPException) as exc:
        assert_lease_owner(
            lease,
            server_id=lease.server_id,
            computer_id=uuid.uuid4(),
            agent_id=lease.agent_id,
        )

    assert exc.value.status_code == 403
