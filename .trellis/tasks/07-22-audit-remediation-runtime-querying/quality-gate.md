# Quality Gate Report: Runtime Querying and Resource Contracts

Checked: 2026-07-23
Worktree: `/Users/code/project/smallkhoj-audit-remediation`
Branch: `feat/2026-07-audit-remediation`
Base: `main`
Task: `.trellis/tasks/07-22-audit-remediation-runtime-querying`

## Scope verdict

This child is ready for the commit step. It repairs the confirmed runtime/query
defects from audit findings 005, 015, 016, 017, 018 and the duplicate browser
realtime ownership portion of 022. It also repairs a production-only Next.js
public-environment adapter defect discovered during real browser acceptance.

This verdict does **not** close the parent codebase-audit remediation program.
Delivery/UI, architecture debt, product-direction dispositions, integration,
and the final human/agent audit-report synchronization remain separate children.
The approved implementation commit is `fa1f785`; this child is marked complete
without changing the still-open parent remediation program.

## Independent finding and advisor disposition

| Finding | Independent verdict | Advisor recommendation verdict | Implemented correction |
| --- | --- | --- | --- |
| 005 serializer N+1 / thread qualification | Confirmed by whole-request SQL counts up to 1,220 statements and an under-filled `/threads` RED. | Batch maps were directionally correct; optional/manual query probes and task deferral were insufficient. | Explicit `UNSET`, page contexts, batch loaders, constant request ceilings, exact wire snapshots, and SQL reply-bearing qualification. |
| 015 upload memory/cleanup envelope | Confirmed on all three upload routes. | A chunk list followed by `join` was not a bounded-memory or full cleanup solution; route-level application caps are not ingress proof. | Shared bounded reader, same-directory `.uploading` staging, fsync/atomic promotion, bounded rollback/cleanup/close, and a separate tracked-Caddy 413 proof. |
| 016 per-event NOTIFY connection and recovery | Confirmed; one-shot publisher connects and implicit listener globals lacked a recoverable owner. | A pool was correct, but an unbounded raw-connect fallback and untested reconnect/shutdown were rejected. | One process-owned publisher pool and generation-guarded listener, bounded replacement/reconnect/shutdown, observable health, and worker-multiplied capacity validation. |
| 017 SSE request-session retention | Confirmed through controlled ASGI/HTTP REDs; both setup dependencies finalized only after disconnect. | Increasing pool size and helper/fake-generator tests were rejected as lifecycle fixes/evidence. | Function-scoped setup, frozen primitive claims, short agent poll sessions, no request ORM/session closure capture, and real tiny-pool proof. |
| 018 unstable pagination / frontend first-page truncation | Confirmed for cross-channel task ties, reply filtering after limit, and frontend consumers stopping after page one. | Additive cursors were useful, but incomplete tuples and limit-before-qualification were insufficient. | Versioned scope/filter-bound full tuples, matching seek/order, stable non-disclosing 400s, all-page frontend helpers, repeat-cursor and page bounds. |
| 022 duplicate browser realtime owner | Confirmed by multiple leaf-level consumers and broad refresh behavior. | A shared owner was required; broad client/router decomposition was not safe to smuggle into this child. | `RealtimeTransportOwner` + `RealtimeProvider`, generation/high-water guards, one physical stream, and task-specific invalidation. |
| Production public API key transport | Newly discovered during `/tasks` dogfood: production browser threw despite configured env. | No prior advisor fix covered Next client env static-inlining semantics. | Explicit `process.env.NEXT_PUBLIC_*` public adapter, separate server adapter, fail-closed behavior retained, regression test added. |

## Vision and requirement coverage

| Parent requirement | Evidence | Status |
| --- | --- | --- |
| R3: bounded query work and serializer compatibility | Real PostgreSQL/ASGI 50/100-row counters, canonical object assertions, and a no-fallback-SQL supplied-miss test. | Proven |
| R3: upload ingress/memory/disk ownership | Three-route failure matrix, real migrated PostgreSQL row/file assertions, and separate Caddy/application/parser boundaries. | Proven for supported local-production topology |
| R3: recoverable NOTIFY ownership | Real publisher/listener termination, PID replacement, exactly-once delivery, double-stop cleanup, and capacity preflight. | Proven |
| R3: SSE does not retain request DB sessions | Controlled ASGI finalization and independent `SELECT 1` with `pool_size=1,max_overflow=0` while streams remain open. | Proven |
| R3: stable backend cursors and complete frontend consumption | PostgreSQL traversal matrix plus a real 205-item `/tasks` page showing tail marker 204. | Proven |
| R3: one explicit browser realtime owner | Owner lifecycle tests, one established socket, and one realtime marker application. | Proven within the task-data projection boundary |
| R7: one integrated candidate with DB/backend/frontend/build/runtime/UI gates | Combined PostgreSQL, full suites, production build, compose validation, trace/direct probes and `./twd` evidence all target this sibling candidate. | Proven for this child |

## Functional and cross-layer gate

| Area | Implementation evidence | Verification evidence | Status |
| --- | --- | --- | --- |
| Serialization/query budget | `backend/routers/serialization_prefetch.py`, route serializers and batch loaders | `test_serializer_query_budget_postgres_http.py`; whole-request N=50/100 counts | Pass |
| Stable task/thread pagination | `backend/services/pagination.py`, public/agent task and thread routes | `test_task_thread_pagination_postgres_http.py`; invalid/scope/filter/tie/delete/insert/full-traversal matrix | Pass |
| Upload ownership | `backend/services/upload_storage.py`, three upload routes, Caddy/deployment config | `test_upload_resource_envelope.py`; real PostgreSQL and Docker Caddy probe | Pass |
| PostgreSQL fanout | `backend/services/public_events.py`, settings and lifespan | `test_public_events.py`, `test_postgres_notify_lifecycle.py`; real connection termination/recovery | Pass |
| SSE lifetime | public/agent route setup and frozen claims | `test_sse_session_lifetime.py`; controlled ASGI plus tiny real pool | Pass |
| Frontend cursor consumption | `frontend/lib/cursor-pagination.ts` and five task consumers | `cursor-pagination.test.ts`; real 205-item browser traversal | Pass |
| Browser realtime | owner/provider, shell mount and task projection | `realtime-owner.test.ts`; single-socket and exactly-once marker evidence | Pass |
| Production public env | `frontend/lib/control-plane.ts` and public call sites | `runtime-url.test.ts`; production build and real production-like browser runtime | Pass |

Cross-layer trace:

```text
PostgreSQL total order / cursor -> public API nextCursor
  -> bounded frontend traversal -> TaskBoard complete collection
PostgreSQL EventRecord -> process-owned NOTIFY runtime -> one public SSE stream
  -> RealtimeProvider projection -> task-page refetch + filter reapplication
```

The cursor codec, SQL ordering, response envelope and frontend continuation use
the same fields and direction. Realtime scope changes abort older generations;
stale callbacks cannot apply to the new Server/auth scope.

## TDD and real PostgreSQL evidence

Each defect has a diagnostic capsule under `docs/bug-report/` with symptom,
evidence, root cause, diagnostic/timeout/warning strategies, user-visible
correction, acceptance, advisor disposition and RED/GREEN outputs.

Representative intended REDs:

- agent search: 620 statements at 50 rows and 1,220 at 100;
- public tasks: 1,220 statements at 100 rows;
- `/threads?limit=2`: returned zero despite two older eligible roots;
- five upload tests failed on unbounded read, missing cap, missing close and
  missing rollback/unlink;
- NOTIFY owner/recovery tests observed no publisher pool, extra raw connections,
  stale callbacks and unbounded cleanup;
- controlled public and agent SSE requests retained `get_db` until disconnect;
- frontend cursor and realtime-owner focused tests reproduced first-page and
  duplicate-owner failures;
- runtime URL test rejected dynamic `resolve*(process.env)` client calls.

Final real-PostgreSQL combined runtime suite:

```text
53 passed in 12.74s
```

Final backend suite using the disposable migrated PostgreSQL URLs:

```text
421 passed in 37.52s
Ruff: All checks passed!
```

No fake session or `Base.metadata.create_all` path is counted as migration,
foreign-key, concurrency, NOTIFY, pagination or SSE lifecycle evidence.

## Dogfood-Your-Slice and browser evidence

Scope verdict: required and completed because pagination, production runtime
configuration and realtime invalidation are user-visible.

Runtime identity:

- candidate worktree: `/Users/code/project/smallkhoj-audit-remediation`;
- frontend: `http://127.0.0.1:3000/tasks`;
- candidate backend: `http://127.0.0.1:8100`;
- backend `/docs` direct probe: HTTP 200;
- browser tab id: `1617512415`.

The authenticated `./twd` DOM assertion returned:

```json
{
  "globalError": false,
  "marker000": true,
  "marker199": true,
  "marker204": true,
  "realtimeMarkerCount": 1,
  "serverSummary205": true,
  "url": "http://127.0.0.1:3000/tasks"
}
```

`REAL_PAGINATION_20260723_204` proves the frontend consumed the second cursor
page rather than stopping at the first 200 records. Creating
`REAL_REALTIME_OWNER_20260723` made it appear once without adding a second
physical SSE socket.

The screenshot also exposes an important honest boundary: the client TaskBoard
column reached 206 after realtime invalidation, while the server-rendered top
summary remained `205 / 205`. This child promises targeted task-data refresh,
not that every server-rendered derivative becomes client-live; broad server/client
decomposition belongs to the architecture child.

| Requirement | Evidence file |
| --- | --- |
| 205-item task page, no global production-key error, realtime-refreshed board | `evidence/REAL_runtime_querying_20260723.png` |
| Text/DOM snapshot for review and marker lookup | `evidence/REAL_runtime_querying_20260723.snapshot.txt` |

Only one screenshot is retained because this is a state/lifecycle correction,
not a visual redesign. The project `./twd` wrapper has no video-recording
command; deterministic DOM markers, the socket count and the saved snapshot are
the behavioral evidence instead. Playwright was not used.

`./smallkhoj-trace summary` currently auto-discovers another local backend on
port 8000 and a daemon JSON-RPC GET that returns 405. Those signals are not
attributed to this candidate. Candidate runtime acceptance uses the explicit
worktree, port 8100 direct probe, port 3000 authenticated tab and saved `./twd`
evidence.

## Design and architecture ownership

- `.pen` glob: no `designs/` directory and therefore no matching design file.
- UI status: behavior/ownership correction with no visual redesign; the current
  product task surface is preserved.
- Architecture cells: backend database/query contracts, backend deployment/upload
  contracts, backend event delivery, and frontend state management.
- Top-level map delta: none. Existing cells remain owners; executable boundaries
  were strengthened in four `.trellis/spec/` documents.
- Router/client decomposition is intentionally owned by the architecture-debt
  child. It is not required to rewrite or undo this child; it will extend these
  now-tested contracts.

## Spec sync

Phase 3.3 is complete:

- `.trellis/spec/backend/database-guidelines.md` adds seven-section executable
  scenarios for bounded serialization/stable cursors and upload compensation;
- `.trellis/spec/backend/event-delivery-contracts.md` adds the PostgreSQL fanout
  and SSE ownership scenario and corrects public SSE auth to header-only;
- `.trellis/spec/backend/deployment-environment-contracts.md` records explicit
  static `NEXT_PUBLIC_*` client reads and the server/public adapter boundary;
- `.trellis/spec/frontend/state-management.md` adds bounded cursor traversal,
  one realtime owner, scope generations and targeted task projection.

The additions include signatures, contracts, error matrices, good/base/bad
cases, required tests and wrong/correct examples. No duplicate scenario or
wrong-layer placement was found in the final diff review.

## Delivery completeness and follow-up-tail review

The terms “out of scope”, “architecture child” and “delivery/UI” in task
artifacts are explicit parent-program partitioning, not hidden unfinished ACs.
All nine child acceptance criteria and all implement-plan items are checked with
evidence. The remaining children own independently verifiable work; this child
will be extended by them rather than rewritten.

SmallKhoj does not provide the external project-specific
`check-hotfix-pattern.mjs`, `check-fallback-layers.mjs`, architecture-ownership
or capability-tip scripts. The equivalent applicable checks here are the Trellis
task validator, package/layer spec review, real runtime/browser gate, linters,
type checker, tests, production build and manual cross-layer diff review.

## Verification commands and results

```text
Disposable PostgreSQL combined focused tests -> 53 passed in 12.74s
Backend full pytest                         -> 421 passed in 37.52s
Ruff                                         -> All checks passed!
Frontend tests                              -> 164 passed
Frontend lint                               -> passed
bunx tsc --noEmit                           -> passed
Production Next.js build                    -> compiled; TypeScript passed; 13 static pages
Deployment helper tests                     -> 16 passed in 0.02s
bun install --frozen-lockfile               -> 789 installs / 891 packages checked; no changes
docker compose config --no-interpolate      -> passed
git diff --check                            -> passed
Trellis task.py validate                    -> implement.jsonl/check.jsonl valid
./twd DOM assertion/snapshot/screenshot     -> passed on tab 1617512415
```

## Artifact hygiene

- Worktree root-level media/design pathspec check: no matches.
- `origin/main...HEAD` root-level media/design pathspec check: no matches.
- The single screenshot and snapshot are stored under the active task's
  `evidence/` directory.

## Gate result

Child implementation gate: **pass**.
Spec gate: **pass**.
Real PostgreSQL/runtime/browser gate: **pass within the explicitly documented
child boundary**.
Implementation commit gate: **pass — `fa1f785` created after operator approval**.
Parent audit-remediation program: **still open**.
