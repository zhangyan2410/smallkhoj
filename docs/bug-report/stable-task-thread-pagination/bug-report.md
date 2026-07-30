# Unstable task and thread pagination

## Bug diagnosis capsule

| Field | Content |
|---|---|
| **1. Symptom** | Public and agent task lists are unbounded. Thread listing over-fetches a heuristic candidate set and filters after limit. Advisor plan 018 proposes a task-number-only cursor even though `task_number` is unique only inside a channel. Expected: every endpoint uses a documented total order, a scoped/versioned cursor containing the full order tuple, SQL seek predicates identical to that order, and duplicate-free traversal under ties/inserts/deletes. |
| **2. Evidence** | Both `/tasks` routes order by `Task.task_number` without a cap. The schema uniqueness is `(channel_id, task_number)`, so equal numbers across channels are legal. `/threads` orders roots by `created_at DESC`, limits `limit * 3`, then counts/skips in Python. Frontend consumers currently assume a single response and can silently truncate once server caps are added. |
| **3. Confirmed root cause** | The endpoints lack an explicit pagination contract. Sort order is not total, cursor scope/version is absent, and qualification occurs after limiting. Server and frontend therefore cannot agree on stable continuation semantics. |
| **4. Diagnostic strategy** | Freeze the current product-visible sort, extend it with deterministic tie-breakers, and write codec/order/seek tests first. Use isolated PostgreSQL fixtures with equal timestamps, equal task numbers in different channels, page boundaries, concurrent insert, deletion between pages, invalid/version/endpoint/server cursors, and full traversal. Enumerate every frontend consumer and classify fetch-all-bounded versus honest load-more UI. |
| **5. Timeout strategy** | Stop before shipping an unversioned wire break. If an existing client cannot consume a new envelope, add a compatibility parameter/versioned path and document removal timing rather than silently changing array/object shape. |
| **6. Warning strategy** | Reject `task_number` alone, timestamp alone, cursor fields that differ from SQL `ORDER BY`, missing final unique ID tie-breaker, cross-server/cross-endpoint cursor reuse, Python reply filtering after limit, first-50 frontend truncation, or repeated-cursor loops. |
| **7. User-visible correction** | Task and thread lists remain bounded but can traverse every eligible record exactly once; users do not lose tasks that share a number across channels or threads hidden behind newer empty roots. |
| **8. Acceptance** | PostgreSQL tests cover all ties/boundaries/mutations and prove duplicate-free complete traversal. Bad/foreign cursors produce a stable non-disclosing 4xx. Every frontend consumer follows `nextCursor` to its declared bound or renders an explicit load-more contract. |

## Report

- **Reporter:** Independent re-audit of finding 018 and its conflict with 005 on 2026-07-23.
- **Reproduction:** Create two channels with the same task numbers and equal timestamps, page through lists, insert/delete between page requests, and create newer thread roots without replies ahead of eligible roots.
- **Root cause:** There is no end-to-end total-order/cursor contract; current list limits and eligibility are ad hoc.
- **Repair direction:** Define scoped versioned cursor codecs and matching SQL seek/order tuples, qualify threads in SQL, and update all frontend consumers intentionally.
- **Verification:** Real PostgreSQL traversal tests plus frontend multi-page/repeated-cursor tests.

## Advisor disposition

- Plan 018 correctly identifies unbounded task lists and thread over-fetching.
- Its proposed task-number cursor is invalid for a server-wide list because the number is channel-scoped.
- Its instruction to change thread over-fetch to `limit + 1` while retaining post-limit filtering is rejected.
- Its frontend omission is a release blocker: backend caps cannot ship while consumers silently render only the first page.

## TDD evidence

### RED

Before implementation, the focused PostgreSQL/HTTP contract demonstrated that
task responses were unbounded, cross-channel equal task numbers had no complete
position tuple, and thread qualification occurred after a heuristic candidate
limit. Frontend source inventory also showed five full-collection consumers
performing one request and having no continuation policy. The intended RED
assertions required `limit <= 200`, additive `nextCursor`, full position tuples,
SQL-qualified reply roots, scoped cursor rejection, and all-page consumption;
the existing implementation could not satisfy those assertions.

### GREEN

Public and agent task endpoints now order by
`(task_number ASC, channel_id ASC, id ASC)` and bind a version-1 cursor to the
endpoint, Server, filters, and all three position values. Agent threads qualify
reply-bearing roots in SQL and order/seek by `(created_at DESC, id DESC)`.
Malformed, wrong-version, wrong-endpoint, foreign-Server, and filter-mismatched
cursors return the same non-disclosing 400 detail.

The real PostgreSQL/HTTP regression covers cross-channel ties, complete
duplicate-free traversal, deletion of boundary rows, insertion before a task
cursor, root/reply deletion, thread insertion/update, status-filter mismatch,
version mismatch, foreign Server, and channel mismatch:

```text
6 passed in 4.84s
```

Frontend `fetchAllCursorPages`/`fetchAllTaskPages` follows `nextCursor`, encodes
it, rejects repeats, and caps traversal at 100 pages. All five task consumers
use the shared `limit=200` all-pages contract. Production-like runtime evidence
created 205 marked tasks through the real HTTP API and PostgreSQL; `/tasks`
rendered `205 / 205 可见` and contained markers 000, 199, and second-page tail
204.

```text
frontend cursor tests: 5 passed
combined PostgreSQL backend focus: 53 passed
```
