# Plan 016: Pool Postgres NOTIFY connections (PERF-03)

> Unblocks the second half of the concurrency fixes. Currently every committed
> event opens a fresh asyncpg TCP connection, authenticates, sends NOTIFY, and
> closes — bypassing SQLAlchemy's pool. Under concurrent message sends (every
> message/reaction/task generates an event) this caps event throughput well
> below the pool's capacity and adds per-event latency to every mutating
> request (the NOTIFY is awaited synchronously inside the request path).

## Status
- **Priority**: P1 (concurrency)
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: plans 001 + 002 (security/test baseline)
- **Category**: performance
- **Planned at**: commit `47848e8`, 2026-07-20

## Why this matters
High-concurrency message sends trigger one NOTIFY per event. Each NOTIFY
currently does `asyncpg.connect()` + `conn.close()` — a full TCP + auth
handshake per event. The SQLAlchemy engine's own pool is bypassed entirely.
This adds per-event latency to every mutating request (the NOTIFY call sits
inside `push_latest_events_for_server`, which is awaited synchronously inside
the request handler) and caps event throughput.

## Current state
**`backend/services/public_events.py:393-412`** — `_notify_postgres`:
```python
async def _notify_postgres(db: AsyncSession, event: dict[str, Any]) -> None:
    ...
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        await conn.execute(...)
    finally:
        await conn.close()
```
Called from `push_latest_events_for_server` (line 388), which is awaited inside
mutating request handlers via `_push_committed_events`.

**`backend/services/public_events.py:449`** — separate `asyncpg.connect()` for
the LISTENER startup. This is a long-lived connection by design (LISTEN must
stay open) — do NOT pool this one; only pool the NOTIFY sender.

**`backend/main.py:lifespan`** already has `start_postgres_public_event_listener`
/ `stop_postgres_public_event_listener` — add `start_notify_pool` /
`stop_notify_pool` alongside them.

**`_asyncpg_dsn()` at line 415** parses `settings.database_url` into the
`postgresql://` (non-+asyncpg) form asyncpg expects.

## Scope
**In scope**:
- `backend/services/public_events.py` — module-level pool, `_notify_postgres`
  borrows from pool instead of `connect()`, add `start_notify_pool` /
  `stop_notify_pool`.
- `backend/main.py:lifespan` — call `start_notify_pool()` at startup,
  `stop_notify_pool()` at shutdown (alongside the existing listener lifecycle).
- New test: `backend/tests/test_notify_pool.py`.

**Out of scope**:
- The LISTENER connection (line 449) — it's long-lived by design, leave alone.
- SQLAlchemy engine pool tuning — that's PERF-02 (separate plan).
- Any router changes.

## Repo conventions
- Lifespan pattern: existing `start_postgres_public_event_listener()` /
  `stop_postgres_public_event_listener()` show the shape — start in the
  `lifespan` body before `yield`, stop in the `finally` block.
- Logger pattern: `logger = logging.getLogger(__name__)` at module top.
- Tests use `pytest-asyncio` and the fake-session pattern (see
  `backend/tests/test_member_patch_admin.py`).

## Steps

### Step 1: Add module-level pool primitives
At the top of `backend/services/public_events.py`, after the existing imports:

```python
import asyncpg

_notify_pool: asyncpg.Pool | None = None

logger = logging.getLogger(__name__)


async def start_notify_pool(*, min_size: int = 2, max_size: int = 10) -> None:
    """Initialize the shared asyncpg pool used by _notify_postgres.

    Call from main.py lifespan at startup. Idempotent: a second call is a no-op
    if the pool is already open.
    """
    global _notify_pool
    if _notify_pool is not None:
        return
    _notify_pool = await asyncpg.create_pool(
        dsn=_asyncpg_dsn(),
        min_size=min_size,
        max_size=max_size,
    )


async def stop_notify_pool() -> None:
    """Close the shared NOTIFY pool. Call from main.py lifespan at shutdown."""
    global _notify_pool
    if _notify_pool is None:
        return
    await _notify_pool.close()
    _notify_pool = None
```

### Step 2: Rewrite `_notify_postgres` to borrow from the pool
Replace the body of `_notify_postgres` (line 393) so it acquires from the pool:

```python
async def _notify_postgres(db: AsyncSession, event: dict[str, Any]) -> None:
    """Notify Postgres channels of a committed event.

    Borrows from a module-level asyncpg pool (start_notify_pool) instead of
    opening a fresh connection per event. If the pool isn't initialized (e.g.
    during tests that bypass lifespan), falls back to a one-shot connect so
    the code path remains testable in isolation.
    """
    payload = json.dumps({...})  # preserve existing payload construction
    if _notify_pool is not None:
        async with _notify_pool.acquire() as conn:
            await conn.execute("SELECT pg_notify($1, $2)", channel, payload)
        return
    # Fallback for tests / pre-lifespan invocation.
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        await conn.execute("SELECT pg_notify($1, $2)", channel, payload)
    finally:
        await conn.close()
```

**Preserve the existing payload construction and channel name** — only the
connection-handling shape changes. Read the current `_notify_postgres` body
before rewriting to copy the exact payload logic.

### Step 3: Wire lifespan to start/stop the pool
In `backend/main.py:lifespan`:
- Import `start_notify_pool, stop_notify_pool` from `services.public_events`
  (alongside the existing imports).
- After `await start_postgres_public_event_listener()` (around line 32), add:
  ```python
  await start_notify_pool()
  ```
- In the `finally` block, before `await stop_postgres_public_event_listener()`
  (around line 44), add:
  ```python
  await stop_notify_pool()
  ```

Order matters: start the pool AFTER the listener is up (listener may receive
notifications triggered by the pool's first sends); stop the pool BEFORE the
listener (so we don't try to notify while shutting down the listener).

### Step 4: New test
Write `backend/tests/test_notify_pool.py`:

```python
import asyncio
import pytest
from services import public_events


@pytest.mark.asyncio
async def test_notify_pool_lifecycle_idempotent(monkeypatch):
    """start_notify_pool twice doesn't double-create; stop closes cleanly."""
    created = {"n": 0}
    closed = {"n": 0}

    class _FakePool:
        async def close(self):
            closed["n"] += 1

    async def fake_create_pool(*args, **kwargs):
        created["n"] += 1
        return _FakePool()

    monkeypatch.setattr(public_events.asyncpg, "create_pool", fake_create_pool)

    await public_events.start_notify_pool()
    await public_events.start_notify_pool()  # idempotent
    assert created["n"] == 1

    await public_events.stop_notify_pool()
    await public_events.stop_notify_pool()  # idempotent
    assert closed["n"] == 1
    assert public_events._notify_pool is None


@pytest.mark.asyncio
async def test_notify_postgres_uses_pool_when_available(monkeypatch):
    """When the pool is up, _notify_postgres acquires from it (no raw connect)."""
    connects = {"n": 0}
    acquired = {"n": 0}

    class _FakeConn:
        async def execute(self, *args, **kwargs):
            return "OK"

    class _FakePoolAcquire:
        async def __aenter__(self):
            acquired["n"] += 1
            return _FakeConn()

        async def __aexit__(self, *args):
            return False

    class _FakePool:
        def acquire(self):
            return _FakePoolAcquire()

        async def close(self):
            pass

    async def fake_create_pool(*args, **kwargs):
        return _FakePool()

    async def fake_connect(*args, **kwargs):
        connects["n"] += 1
        return _FakeConn()

    monkeypatch.setattr(public_events.asyncpg, "create_pool", fake_create_pool)
    monkeypatch.setattr(public_events.asyncpg, "connect", fake_connect)

    await public_events.start_notify_pool()
    # Call _notify_postgres — need to construct the event arg shape it expects.
    # Read the function signature before writing this test.
    await public_events._notify_postgres(db=None, event={...})
    assert acquired["n"] == 1
    assert connects["n"] == 0  # did NOT fall back to raw connect

    await public_events.stop_notify_pool()
```

(Adjust the event arg shape to match the real `_notify_postgres` signature. If
constructing the event payload is non-trivial, refactor `_notify_postgres` to
accept the channel + payload directly, then have the caller build them —
cleaner for testing.)

**Verify**: `cd backend && uv run pytest tests/test_notify_pool.py -q` → pass.

## Done criteria (ALL must hold)
- [ ] `grep -n "asyncpg.connect" backend/services/public_events.py` shows matches
      ONLY in the LISTENER path (~line 449) and the `_notify_postgres` fallback
      branch — NOT in the main NOTIFY path.
- [ ] `grep -n "_notify_pool\|start_notify_pool\|stop_notify_pool" backend/services/public_events.py`
      returns matches.
- [ ] `grep -n "start_notify_pool\|stop_notify_pool" backend/main.py` shows both
      wired into lifespan.
- [ ] `cd backend && uv run pytest -q` exits 0.
- [ ] New `test_notify_pool.py` covers: idempotent start/stop, pool is used when
      available, fallback to raw connect when pool is None.
- [ ] `git status` shows only in-scope files modified.

## STOP conditions
- The existing `_notify_postgres` payload construction is more complex than the
  plan assumes (e.g. it does DB reads inside the function, not just JSON dumps)
  — report; the test event arg shape will need to match.
- `asyncpg.create_pool` API differs in the installed version (older asyncpg may
  not accept `min_size`/`max_size` kwargs) — adapt to the actual API.
- The LISTENER connection (line 449) and the NOTIFY path share state in a way
  that makes pooling the NOTIFY side unsafe — report; do NOT pool if there's
  shared mutable state between them.

## Maintenance notes
- The fallback `asyncpg.connect` branch exists for tests that bypass lifespan —
  production always goes through the pool. Don't remove the fallback.
- If NOTIFY volume grows further, consider batching (multiple events per
  `pg_notify` call) — but only after measuring.
- Reviewer scrutiny: confirm the pool is started AFTER the listener and stopped
  BEFORE the listener (Step 3 ordering).
