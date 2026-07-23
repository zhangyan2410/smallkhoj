# Plan 017: SSE /events must not pin request-scoped DB session (PERF-02)

> This is the biggest remaining concurrency bottleneck. Each connected agent
> on `/events?stream=true` holds a request-scoped DB session for the lifetime
> of the SSE connection; the asyncpg pool defaults to 5 connections. More
> than ~5 concurrent streaming agents block the entire backend's DB access
> for non-stream requests.

## Status
- **Priority**: P1 (concurrency — biggest bottleneck)
- **Effort**: M
- **Risk**: MED (touches SSE cursor/visibility semantics)
- **Depends on**: plans 001 + 002 (DONE, cherry-picked)
- **Category**: performance
- **Planned at**: commit `47848e8`, 2026-07-20

## Why this matters
With default pool size 5, more than ~5 concurrent streaming agents block the entire backend's DB access for non-stream requests. Each connected agent also burns one backend task + one DB connection indefinitely while doing 1-2 polls/sec with sub-queries per record. This is a hard scaling ceiling, not a gradual slowdown.

## Current state

**`backend/routers/agent_api.py:1916-2044`** — `/events?stream=true`:
```python
async def get_events(..., db: AsyncSession = Depends(get_db)):
    ...
    async def event_stream():
        # polls _visible_event_records every `interval` (default 1.0s)
        # using the SAME `db` session captured from the request scope
        ...
        await asyncio.sleep(interval)
    return StreamingResponse(event_stream())
```

**`backend/routers/public_api.py:1782-1819`** — `/events/stream`:
similar shape; takes `db: AsyncSession = Depends(get_db)`; the public path
uses a queue and does not query inside the loop, but the session is still
pinned for the connection lifetime.

**`backend/models/base.py:7`**:
```python
engine = create_async_engine(settings.database_url, echo=settings.debug)
```
No `pool_size`, `pool_recycle`, `pool_pre_ping` configured → asyncpg default `pool_size=5`.

**`backend/routers/agent_api.py:846-898`** — `_event_record_event` →
`_backfill_message_event_target` fires 1-2 more queries PER polled record.

## Scope
**In scope**:
- `backend/routers/agent_api.py` — `event_stream` opens a fresh session per poll iteration via `async_session()`.
- `backend/routers/public_api.py` — same for `stream_public_events`.
- `backend/models/base.py` — tune `create_async_engine` with `pool_size`, `max_overflow`, `pool_recycle`, `pool_pre_ping`.
- `backend/config.py` — optional new settings for pool tuning (with sane defaults).
- New test: `backend/tests/test_sse_session_lifetime.py`.

**Out of scope**:
- The `_event_record_event`/`_backfill_message_event_target` sub-queries (separate optimization; touch only if trivial).
- Switching SSE to a LISTEN-based push model (architectural — defer).
- `backend/pyproject.toml`.

## Repo conventions
- `from models import async_session` — the session factory. Use `async with async_session() as poll_db:` for short-lived sessions.
- Settings pattern: snake_case env names in `backend/config.py:Settings`.
- Logger pattern: `logger = logging.getLogger(__name__)`.

## Steps

### Step 1: Tune the SQLAlchemy engine pool
In `backend/models/base.py`:
```python
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_recycle=settings.database_pool_recycle,
    pool_pre_ping=True,
    pool_timeout=30,
)
```
Add to `backend/config.py:Settings`:
```python
database_pool_size: int = 10
database_max_overflow: int = 20
database_pool_recycle: int = 1800  # seconds; recycle before idle-in-transaction reaper kills
```
Defaults raise the ceiling from 5 to 10+20=30 connections. Operators can tune via env vars.

**Verify**: `cd backend && uv run python -c "from models import engine; print(engine.pool.size(), engine.pool._max_overflow)"` → `10 20`.

### Step 2: Agent SSE — open fresh session per poll iteration
In `backend/routers/agent_api.py:get_events`, the `event_stream()` generator currently closes over the request-scoped `db`. Change it so each poll iteration opens its own short-lived session:

```python
async def event_stream():
    last_seq = ...  # preserve existing cursor init
    while True:
        try:
            async with async_session() as poll_db:
                records = await _visible_event_records(poll_db, ...)
                # serialize records using poll_db (for any lazy loads)
                ...
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("agent event_stream poll failed")
        await asyncio.sleep(interval)
```

The request-scoped `db` is no longer captured by the generator. The handler can still use `db` for the initial cursor setup (before returning the StreamingResponse), but the generator itself uses fresh sessions.

**Preserve the existing cursor semantics**: the cursor (`last_seq` or equivalent) is local to the generator and tracks across iterations — only the DB session is per-iteration.

**Verify**: `cd backend && uv run pytest -q` → no regressions. Then manually (if a running backend is available) connect multiple SSE clients and confirm non-stream requests still respond (you may not be able to do this in the worktree; rely on the test in Step 4).

### Step 3: Public SSE — same change
Apply the same pattern to `backend/routers/public_api.py:stream_public_events` (line 1782). The public path uses a queue and may not query inside the loop — if so, the change is simpler: just don't capture `db` in the generator. Read the function first.

**Verify**: `cd backend && uv run pytest -q` → no regressions.

### Step 4: New test
Write `backend/tests/test_sse_session_lifetime.py`:

```python
import pytest
from routers import agent_api


@pytest.mark.asyncio
async def test_event_stream_does_not_capture_request_session(monkeypatch):
    """The event_stream generator must open its own session per iteration,
    not reuse the request-scoped one (which pins a pool connection for the
    lifetime of the SSE connection)."""
    # Strategy: monkeypatch async_session to return a counter-tracking fake.
    # Run the generator for a few iterations (mock asyncio.sleep to raise
    # CancelledError after N calls). Assert that async_session was invoked
    # at least once per iteration — proving a fresh session per poll.
    ...
```

Also (if practical): a test asserting `engine.pool.size() == settings.database_pool_size` and `pool_pre_ping=True`.

**Verify**: `cd backend && uv run pytest tests/test_sse_session_lifetime.py -q` → pass.

## Done criteria (ALL must hold)
- [ ] `grep -nE "pool_size|pool_pre_ping" backend/models/base.py` shows pool tuning.
- [ ] `grep -nE "database_pool_size|database_max_overflow" backend/config.py` shows new settings.
- [ ] The `event_stream` generator in `agent_api.py` does NOT close over a request-scoped `db` — it opens `async_session()` per iteration.
- [ ] Same for `public_api.py:stream_public_events`.
- [ ] `cd backend && uv run pytest -q` exits 0.
- [ ] New `test_sse_session_lifetime.py` proves per-iteration session opening.
- [ ] `git status` shows only in-scope files modified.
- [ ] Commit created on `advisor/017-sse-session`.

## STOP conditions
- The `event_stream` generator's cursor/visibility semantics depend on the same session being reused across iterations (e.g. session-level state, uncommitted changes) — report; the per-iteration approach may need adjustment.
- `_visible_event_records` or `_event_record_event` relies on lazy-loaded relationships that detach outside the session — report; you may need `selectinload` or eager loading inside each iteration.
- The public `/events/stream` path is structurally different from agent `/events` (e.g. push-based via the listener, not poll-based) — adapt; the change may be "don't capture db at all" rather than "open per iteration."
- A test for the generator is impractical because `StreamingResponse` swallows exceptions — report; write a test that calls the inner generator function directly (not via StreamingResponse).

## Maintenance notes
- `pool_pre_ping=True` adds a cheap `SELECT 1` before each checkout; prevents "stale connection" errors when the DB or network recycles idle connections.
- `pool_recycle=1800s` should be lower than the DB's `idle_in_transaction_session_timeout` (if set) — otherwise connections die mid-use.
- Reviewer scrutiny: the highest-risk change is the cursor continuity. Confirm the cursor variable persists across iterations (it's a local in the generator, not session-scoped).
- After this lands, the SSE connection-count ceiling moves from 5 to 30 (default). Still finite — for a true fix, switch SSE to a LISTEN-based push (defer; separate architectural change).
