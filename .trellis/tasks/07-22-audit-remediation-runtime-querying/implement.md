# Runtime query and resource implementation plan

## 0. Preconditions and capsules

- [ ] Confirm schema/auth terminal contracts and integrated revisions.
- [ ] Drift-check CodeGraph nodes for `list_threads`, upload routes, public/agent SSE,
      `backend/services/public_events.py`, `RealtimeRefresh`, task consumers and chat
      state owners.
- [ ] Create capsules under `docs/bug-report/` for serializer N+1, upload envelope,
      NOTIFY recovery, agent SSE leak, unstable pagination and duplicate realtime.
- [ ] Capture current query/connection/subscription counts and advisor diffs.

## 1. RED/GREEN — serializer budgets

- [ ] Snapshot empty/missing-related/50/100-row endpoint responses.
- [ ] Count whole-request SQL for public/agent message, task, member, search/history and
      thread routes; prove reply counts and prefetched-`None` exceed budgets.
- [ ] Add `/threads` RED where newest roots lack replies but older roots fill the page.
- [ ] Implement explicit sentinel, batch maps and SQL-level thread filter/count.
- [ ] GREEN constant ceilings and exact shapes before helper refactor.

Primary ownership: `backend/routers/public_api.py`,
`backend/routers/agent_api.py`, narrow serializer/service helpers and backend tests.

## 2. RED/GREEN — upload envelope

- [ ] Test at-limit/over-limit, false content length, chunking, interrupted read,
      invalid metadata, write/DB failure and cancellation on all three routes.
- [ ] Assert close/unlink/rollback and zero residual rows/files.
- [ ] Add supported reverse-proxy/local-prod 413 probe.
- [ ] Implement shared policy/cleanup and atomic staging where supported.
- [ ] Configure/document ingress, parser, app and temporary-disk budgets.

## 3. RED/GREEN — NOTIFY

- [ ] Test owner transitions, capped backoff and stale-generation rejection.
- [ ] Against isolated PostgreSQL, invalidate publisher and listener connections; assert
      recovery without duplicate subscribers.
- [ ] Test repeated startup/shutdown and bounded stop during reconnect.
- [ ] Implement lifespan ownership, health/trace degradation and worker connection
      budget preflight.

Primary ownership: `backend/services/public_events.py`, lifespan/config/health and
focused integration tests.

## 4. RED/GREEN — SSE lifetime

- [ ] With tiny SQL pool and open ASGI stream, prove current agent route retains the
      request session.
- [ ] Cover auth failure, heartbeat, disconnect, cancellation, overflow and shutdown
      on both routes.
- [ ] Convert auth setup to frozen primitive claims; remove session/ORM captures.
- [ ] GREEN finalizer and subscription/task-count assertions; reject source-only tests.

## 5. RED/GREEN — backend pagination

- [ ] Freeze compatibility and review terminal order tuples.
- [ ] Test invalid version/scope and every tie/direction boundary.
- [ ] Use PostgreSQL fixtures with equal cross-channel task numbers, equal timestamps,
      deletion between pages and concurrent insertion.
- [ ] Assert full traversal returns each eligible task/thread once.
- [ ] Implement matching SQL seek/order and scoped versioned cursors.
- [ ] Resolve 005/018 conflict with both query-budget and traversal suites green.

## 6. RED/GREEN — frontend pagination and realtime

- [ ] Enumerate task/list consumers with CodeGraph; classify fetch-all vs load-more.
- [ ] Test three-page `nextCursor` and repeated-cursor loop; reproduce truncation.
- [ ] Count EventSource instances across pages and server/auth switches.
- [ ] Implement typed pagination helpers and shell-level realtime provider.
- [ ] Prove task events target task data, every event applies once, and other event
      behavior remains explicit.

Primary ownership: `frontend/components/realtime-refresh.tsx`, authenticated shell /
provider, list pages, API helpers and frontend tests.

## 7. Gates and evidence

- [ ] Run focused tests, then `cd backend && rtk uv run pytest -q` and configured Ruff.
- [ ] Repeat isolated PostgreSQL pagination/NOTIFY/SSE tests with counts recorded.
- [ ] Run `cd frontend && rtk bun install --frozen-lockfile`, tests, lint, typecheck and
      production build under the non-secret CI env contract.
- [ ] Use `rtk ./smallkhoj-trace` on the worktree runtime for lifecycle evidence.
- [ ] Hand real UI scenarios to delivery/UI and verify with `rtk ./twd` there.
- [ ] Run `rtk proxy git diff --check`, Trellis validation and fill every capsule.

## STOP conditions

- Stop on unversioned cursor/wire breaks or query shape drift.
- Stop unless PostgreSQL and runtime paths are isolated to the remediation worktree.
- Stop if upload cleanup ownership is unprovable across DB/filesystem failure.
- Stop if a stream captures `AsyncSession`/ORM state or green needs a larger pool.
- Stop if realtime consolidation changes chat domain semantics; defer that to the
  architecture child.
