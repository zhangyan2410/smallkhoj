# Plan 018: Add pagination caps to unbounded list endpoints (PERF-04)

## Status
- **Priority**: P2, Effort: S–M, Risk: LOW
- **Depends on**: plans 001 + 002 (DONE, cherry-picked)
- **Category**: performance

## Why this matters
`/tasks` has no `limit` parameter at all — response size and DB time grow linearly with total tasks forever. `/threads` over-fetches `limit * 3` roots then loops with per-root work. As the dataset grows, these endpoints degrade without bound. (Plan 005 already killed the serializer N+1; this plan caps response size.)

## Current state
- `backend/routers/public_api.py:2389-2402` — public `/tasks` has NO `limit`.
- `backend/routers/agent_api.py:~2331-2352` — agent `/tasks` similarly no `limit`.
- `backend/routers/agent_api.py:~2976-3020` — `/threads` over-fetches `limit*3`.
- `backend/routers/public_api.py:3182-3206` — `/activity?compact=true` queries up to 500 rows.
- `/history` already uses `before`/`after` cursors (`agent_api.py:~2114`) — use as the exemplar.

## Scope
**In scope**:
- `backend/routers/public_api.py` — `/tasks` add `limit`+`before` cursor; `/activity?compact` reduce default cap.
- `backend/routers/agent_api.py` — `/tasks` add `limit`+`before`; `/threads` reduce over-fetch factor to `limit+1` and use a single `group_by(parent_id)` count query.
- New tests under `backend/tests/test_tasks_pagination.py`.

**Out of scope**: other endpoints; the serializer N+1 (already done in plan 005); `pyproject.toml`.

## Steps

### Step 1: `/tasks` cursor pagination (both routers)
Mirror the `/history` cursor pattern. Add `limit: int = Query(50, ge=1, le=200)` and `before: str | None = Query(None)` (an ISO timestamp or task_number cursor). Apply `.where(Task.task_number < cursor).limit(limit+1)` (return one extra so the client knows there's a next page). Cap default at 50, hard cap at 200.

Return shape: `{"tasks": [...], "nextCursor": "<task_number>|null"}` — `null` means no more pages.

### Step 2: `/threads` reduce over-fetch
Change the over-fetch factor from `limit * 3` to `limit + 1`. Replace the per-root `count(*)` loop with one `select(Message.parent_id, func.count()).where(parent_id.in_(roots)).group_by(parent_id)`. Preserve the "skip roots with 0 replies" filter and `limit` cap.

### Step 3: `/activity?compact` cap
Reduce the 500-row cap to 100 by default (configurable via existing params if any). Document that compact mode is a summary view, not a full dump.

### Step 4: Tests
Write `backend/tests/test_tasks_pagination.py`:
- `/tasks` with `limit=10` returns at most 10 + cursor logic
- `/tasks` with `before=<cursor>` returns only earlier tasks
- `/tasks` with `limit=201` (over hard cap) returns 422 validation error
- `/threads` does not over-fetch beyond `limit + 1`

## Done criteria
- [ ] `grep -n "limit.*Query.*ge=.*le=" backend/routers/public_api.py backend/routers/agent_api.py` shows new caps on /tasks.
- [ ] `/threads` no longer uses `limit * 3`.
- [ ] `cd backend && uv run pytest -q` exits 0.
- [ ] New test file covers cursor + cap behavior.

## STOP conditions
- Frontend depends on `/tasks` returning ALL tasks (no pagination) — report; need coordinated frontend change.
- The `/history` cursor pattern doesn't apply cleanly to `/tasks` (different sort key) — adapt; pick the natural sort (probably `task_number desc`).
- A test for cursor logic needs real DB and can't be unit-tested — write a service-layer test using the fake-session pattern.

## Maintenance notes
- New endpoints should follow this pattern by default — never expose unbounded lists.
- Reviewer scrutiny: confirm the `limit+1` "next page indicator" pattern is consistent with `/history`.
