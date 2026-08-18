# Runtime query and resource implementation plan

## 0. Preconditions and capsules

- [x] Confirm schema/auth terminal contracts and integrated revisions.
- [x] Drift-check CodeGraph nodes for `list_threads`, upload routes, public/agent SSE,
      `backend/services/public_events.py`, `RealtimeRefresh`, task consumers and chat
      state owners.
- [x] Create capsules under `docs/bug-report/` for serializer N+1, upload envelope,
      NOTIFY recovery, agent SSE leak, unstable pagination and duplicate realtime.
- [x] Capture current query/connection/subscription counts and advisor diffs.

## 1. RED/GREEN — serializer budgets

- [x] Snapshot empty/missing-related/50/100-row endpoint responses.
- [x] Count whole-request SQL for public/agent message, task, member, search/history and
      thread routes; prove reply counts and prefetched-`None` exceed budgets.
- [x] Add `/threads` RED where newest roots lack replies but older roots fill the page.
- [x] Implement explicit sentinel, batch maps and SQL-level thread filter/count.
- [x] GREEN constant ceilings and exact shapes before helper refactor.

Primary ownership: `backend/routers/public_api.py`,
`backend/routers/agent_api.py`, narrow serializer/service helpers and backend tests.

## 2. RED/GREEN — upload envelope

- [x] Test at-limit/over-limit, false content length, chunking, interrupted read,
      invalid metadata, write/DB failure and cancellation on all three routes.
- [x] Assert close/unlink/rollback and zero residual rows/files.
- [x] Add supported reverse-proxy/local-prod 413 probe.
- [x] Implement shared policy/cleanup and atomic staging where supported.
- [x] Configure/document ingress, parser, app and temporary-disk budgets.

## 3. RED/GREEN — NOTIFY

- [x] Test owner transitions, capped backoff and stale-generation rejection.
- [x] Against isolated PostgreSQL, invalidate publisher and listener connections; assert
      recovery without duplicate subscribers.
- [x] Test repeated startup/shutdown and bounded stop during reconnect.
- [x] Implement lifespan ownership, health/trace degradation and worker connection
      budget preflight.

Primary ownership: `backend/services/public_events.py`, lifespan/config/health and
focused integration tests.

## 4. RED/GREEN — SSE lifetime

- [x] With tiny SQL pool and open ASGI stream, prove current agent route retains the
      request session.
- [x] Cover auth failure, heartbeat, disconnect, cancellation, overflow and shutdown
      on both routes.
- [x] Convert auth setup to frozen primitive claims; remove session/ORM captures.
- [x] GREEN finalizer and subscription/task-count assertions; reject source-only tests.

## 5. RED/GREEN — backend pagination

- [x] Freeze compatibility and review terminal order tuples.
- [x] Test invalid version/scope and every tie/direction boundary.
- [x] Use PostgreSQL fixtures with equal cross-channel task numbers, equal timestamps,
      deletion between pages and concurrent insertion.
- [x] Assert full traversal returns each eligible task/thread once.
- [x] Implement matching SQL seek/order and scoped versioned cursors.
- [x] Resolve 005/018 conflict with both query-budget and traversal suites green.

## 6. RED/GREEN — frontend pagination and realtime

- [x] Enumerate task/list consumers with CodeGraph; classify fetch-all vs load-more.
- [x] Test three-page `nextCursor` and repeated-cursor loop; reproduce truncation.
- [x] Count EventSource instances across pages and server/auth switches.
- [x] Implement typed pagination helpers and shell-level realtime provider.
- [x] Prove task events target task data, every event applies once, and other event
      behavior remains explicit.

Primary ownership: `frontend/components/realtime-refresh.tsx`, authenticated shell /
provider, list pages, API helpers and frontend tests.

## 7. Gates and evidence

- [x] Run focused tests, then `cd backend && rtk uv run pytest -q` and configured Ruff.
- [x] Repeat isolated PostgreSQL pagination/NOTIFY/SSE tests with counts recorded.
- [x] Run `cd frontend && rtk bun install --frozen-lockfile`, tests, lint, typecheck and
      production build under the non-secret CI env contract.
- [x] Use `rtk ./smallkhoj-trace` on the worktree runtime for lifecycle evidence.
- [x] Hand real UI scenarios to delivery/UI and verify the runtime-querying slice with
      `rtk ./twd`; broader visible-UI acceptance remains owned by that child.
- [x] Run `rtk proxy git diff --check`, Trellis validation and fill every capsule.

## Final execution evidence

- Disposable PostgreSQL combined focused suite: `53 passed in 12.74s`.
- Backend full suite: `421 passed in 37.52s`; Ruff: `All checks passed!`.
- Frontend: `164 passed`; lint and `bunx tsc --noEmit` passed; production build
  compiled, type-checked and generated 13 static pages.
- Deployment helper tests: `16 passed in 0.02s`; production compose config valid.
- Dependency lock verification: `bun install --frozen-lockfile` checked 789
  installs across 891 packages with no changes.
- Real browser pagination: `/tasks` rendered markers 000, 199 and 204 from the
  205-item initial collection, proving second-page consumption.
- Real browser realtime: one physical established SSE socket; the realtime marker
  appeared exactly once. The task board reached 206 while the server-rendered
  `205 / 205` summary remained stale, an explicit architecture-child boundary.
- Evidence files: `evidence/REAL_runtime_querying_20260723.png` and
  `evidence/REAL_runtime_querying_20260723.snapshot.txt`.
- Implementation commit: `fa1f785` (`fix(runtime): bound querying resources
  pagination and realtime`).

## STOP conditions

- Stop on unversioned cursor/wire breaks or query shape drift.
- Stop unless PostgreSQL and runtime paths are isolated to the remediation worktree.
- Stop if upload cleanup ownership is unprovable across DB/filesystem failure.
- Stop if a stream captures `AsyncSession`/ORM state or green needs a larger pool.
- Stop if realtime consolidation changes chat domain semantics; defer that to the
  architecture child.
