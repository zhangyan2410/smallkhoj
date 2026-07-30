# Serializer shape and query-budget violations

## Bug diagnosis capsule

| Field | Content |
|---|---|
| **1. Symptom** | Message, task, member, history, search, and thread list work grows with the number of returned rows. A 50/100-row response performs repeated relationship, workspace, reaction, run, or reply-count queries. `/threads` also limits candidate roots before deciding whether a root has replies, so a page can be under-filled even when older eligible threads exist. Expected: fixed query ceilings per response shape, exact wire-shape preservation, and SQL qualification before pagination. |
| **2. Evidence** | `agent_api._serialize_message` queries Channel, sender Member, reply count, reactions, and reaction Members per message. Both task serializers query Channel/creator/assignee/TaskRun per task. `member_serialization.serialize_member` calls `member_workspace_id`, which queries `AgentWorkspace` per agent when no explicit prefetch exists. Agent history queries each sender in a loop; public global search queries each message sender in a loop. `list_threads` fetches `limit * 3`, counts replies per root, then skips empty roots. Advisor plan 005 correctly identifies message/member N+1 but explicitly defers task serialization and makes the whole-request query probe optional. |
| **3. Confirmed root cause** | Async serializers mix wire projection with database loading, so list callers cannot prove bounded access. Optional prefetch state uses `None`/absence ambiguously, which risks re-querying a known-missing relation. Thread eligibility is implemented in Python after the SQL limit instead of in the query predicate. |
| **4. Diagnostic strategy** | Freeze canonical JSON for empty, missing-related-row, reaction-bearing, 50-row, and 100-row cases. Count SQL around complete ASGI requests, not just helper calls. Compare N=1/50/100 and name a constant ceiling per endpoint. Add a root fixture where the newest roots have no replies but older roots should fill the page. Trace every list call site and separate batch loading from pure serialization. |
| **5. Timeout strategy** | If one endpoint cannot meet a constant ceiling without changing its public shape, stop that endpoint, preserve the snapshot, and document the exact remaining query source. Do not weaken the ceiling or silently alter the response contract. |
| **6. Warning strategy** | Reject helper-only query tests, fake-session query counts, `None` as both “not prefetched” and “prefetched miss,” per-row TaskRun/workspace/reaction queries, Python filtering after limit, or a query reduction that changes key names/null/default/order semantics. |
| **7. User-visible correction** | List/search/history/thread pages return the same JSON but remain responsive as a page grows; reply-bearing thread pages fill deterministically instead of appearing sparse. |
| **8. Acceptance** | Automated whole-request SQL counters prove documented constant ceilings at 50 and 100 rows. Canonical snapshots remain exact. A supplied missing relation does not trigger fallback SQL. `/threads` qualifies reply-bearing roots in SQL and fills the requested page when enough eligible roots exist. |

## Report

- **Reporter:** Independent re-audit of findings 005 and 018 on 2026-07-23.
- **Reproduction:** Populate list endpoints with increasing row counts and count database statements for the complete authenticated request; create newer root messages without replies followed by older roots with replies.
- **Root cause:** Persistence lookups are embedded in per-entity serializers, and thread qualification occurs after SQL limiting.
- **Repair direction:** Add explicit prefetch sentinels, page-level batch loaders/maps, pure projections, grouped reply/run data, and SQL-level thread eligibility.
- **Verification:** Canonical response snapshots plus isolated PostgreSQL/ASGI whole-request query ceilings at N=0/1/50/100.

## Advisor disposition

- Plan 005's batch-map direction is valid.
- Its optional manual probe and “no new behavioral tests” conclusion are rejected; query budgets are the repaired contract and must be automated.
- Its deferral of task serializer N+1 is rejected for this remediation child because task list pagination and frontend consumers depend on a bounded full-page query cost.
- Plan 018's thread `limit + 1` change without SQL eligibility is rejected; reducing over-fetch before qualifying roots can make under-filled pages worse.

## TDD evidence

### RED

The isolated PostgreSQL/ASGI RED failed for the intended reasons:

```text
agent search 50:    620 statements (ceiling 20)
agent search 100: 1,220 statements (ceiling 20)
agent history 100:  226 statements (ceiling 12)
public search 50:    127 statements (ceiling 16)
public tasks 100:  1,220 statements (ceiling 20)
public members 100:  119 statements (ceiling 16)
```

The same run preserved the current canonical message/task/member JSON
assertions. The `/threads?limit=2` fixture had six newer roots without replies
and two older reply-bearing roots; the current endpoint returned `count=0`
instead of both eligible roots because it limited candidates before
qualification.

```bash
cd backend
SMALLKHOJ_MIGRATION_TEST_ADMIN_URL=postgresql://.../postgres \
SMALLKHOJ_MIGRATION_TEST_DATABASE_URL=postgresql+asyncpg://.../audit_remediation_test \
  uv run pytest -q tests/test_serializer_query_budget_postgres_http.py
# 2 failed in 7.75s (intended RED)
```

### GREEN

The serializers now receive explicit page contexts whose absence is represented
by `UNSET`; a map miss/explicit `None` is never treated as permission to run a
fallback query. Page loaders batch channels, members, reactions, reply counts,
TaskRuns, workspaces, and Computers. Agent history and public search batch sender
lookups. Reply-bearing root qualification is an SQL join before order/limit.

The same isolated PostgreSQL/ASGI request matrix now records fixed costs:

```text
agent search 50:      25 statements
agent search 100:     25 statements
agent history 100:    27 statements
agent tasks 100:      23 statements
public messages 100:  34 statements
public search 50:      28 statements
public tasks 100:      22 statements
public members 100:    19 statements
```

All counts include authentication and active-Server resolution. The 50/100
agent-search equality proves the list serializer is no longer row-linear. Exact
canonical agent/public message, agent/public task, and member objects remain
unchanged, including reactions and nested member projections. The explicit
missing-prefetch test uses a session that raises on any SQL call and proves
missing Channel/Member/workspace values serialize without fallback queries.

```bash
cd backend
SMALLKHOJ_MIGRATION_TEST_ADMIN_URL=postgresql://.../postgres \
SMALLKHOJ_MIGRATION_TEST_DATABASE_URL=postgresql+asyncpg://.../audit_remediation_test \
  uv run pytest -q tests/test_serializer_query_budget_postgres_http.py
# 3 passed in 2.10s

SMALLKHOJ_MIGRATION_TEST_ADMIN_URL=postgresql://.../postgres \
SMALLKHOJ_MIGRATION_TEST_DATABASE_URL=postgresql+asyncpg://.../audit_remediation_test \
  uv run pytest -q
# 387 passed in 24.73s

uv run --with ruff ruff check .
# All checks passed!
```

## Final integrated gate

The final full-scope backend gate was rerun against the disposable migrated
PostgreSQL database after pagination, upload, NOTIFY, SSE, and frontend-runtime
integration had all landed:

```text
421 passed in 37.52s
Ruff: All checks passed!
```

This supersedes the earlier intermediate `387 passed` count above; the named
50/100-row SQL ceilings and canonical response-shape assertions remain part of
the final 421-test run.
