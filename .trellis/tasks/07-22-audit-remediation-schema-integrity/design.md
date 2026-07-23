# Schema and destructive-write remediation design

## Current state

- `backend/main.py:lifespan` calls `models.seed.create_tables()`.
- `create_tables()` runs `Base.metadata.create_all` plus a long sequence of handwritten DDL/data backfills.
- `Message.seq` declares `autoincrement=True` on a non-primary-key column, which does not create the intended generator.
- Public/agent/reminder writers compensate with application `MAX(seq)+1`.
- Advisor 004 adds Alembic but leaves the identity sequence at 1 for historical rows and documents an unsafe `stamp head` legacy path.
- Advisor 009 deletes a Task, then records ActivityLog/EventRecord with the deleted Task FK.

## Terminal schema lifecycle

```text
fresh DB
  -> alembic upgrade head
  -> application starts after revision verification

legacy pre-Alembic DB
  -> read-only compatibility preflight
  -> operator explicitly stamps BASELINE only
  -> alembic upgrade head
  -> application starts after revision verification
```

The container/local entrypoint runs migrations before uvicorn. FastAPI lifespan initializes runtime cursors/listeners/schedulers only; it does not create or alter tables. If direct `uvicorn` remains supported, a revision guard gives an actionable error naming the migration command.

Baseline ownership must be reconciled with every DDL/data operation currently in `models/seed.py`. Builtin template rows become an Alembic data migration or idempotent application data bootstrap with a documented non-schema owner; schema constraints and columns remain migration-owned.

## Message identity state machine

Lifecycle owner: PostgreSQL identity sequence associated with `messages.seq`.

| State | Event | Required transition |
|---|---|---|
| Plain historical BIGINT | Apply identity migration | Add identity and set next generator value above current `MAX(seq)` atomically |
| Compatibility identity | Old writer inserts explicit seq | Reconcile generator high-water before automatic-only rollout |
| Automatic-only identity | New writer inserts without seq | PostgreSQL allocates unique next value |
| Automatic-only identity | Concurrent writers | Each transaction receives a distinct generated value |
| Any | Downgrade requested | Preserve concrete seq data; document loss of automatic generation and rollout ordering |

The migration should use PostgreSQL-supported sequence/identity operations inside the migration transaction. It must handle an empty table and non-empty table without returning 0/duplicate values. A follow-up transition migration may perform the final high-water reconciliation immediately before application writers stop supplying seq.

## Deletion transaction design

```text
authorize + resolve scoped entity
  -> capture primitive tombstone fields
  -> remove dependent/saved references
  -> delete entity
  -> create ActivityLog(task_id=NULL, details.tombstone=...)
  -> create EventRecord(task_id=NULL, payload.taskId=...)
  -> commit
  -> publish committed public event
```

The old UUID remains data, not a relational reference. `channel_id` may remain populated while the channel exists. A dedicated delete activity/event prevents semantic reuse of `task.updated` or `message.sent`.

For files, database row deletion and external/local blob deletion require an explicit policy. Prefer a service boundary that can distinguish `not_found`, `forbidden`, `deleted`, and `storage_cleanup_pending/failed`; do not claim atomicity across PostgreSQL and a filesystem/object store when none exists.

## Cross-layer event contract

- Backend mapping: deletion activity → dotted public event.
- Scope: channel/task-product scope sufficient for frontend refetch; tombstoned task id remains payload data.
- Durable source: committed EventRecord.
- Browser: targeted task/file list refetch.
- Daemon runtime: default drop; no `deliverRuntimeMessage` classification.
- Aliases: dotted/legacy symmetry only where clients need it.

## Test environment

- Reuse the repository's `SMALLKHOJ_TEST_DATABASE_URL` / `SMALLKHOJ_TEST_ADMIN_DATABASE_URL` convention.
- Create a unique disposable PostgreSQL schema or database for every migration/route test; skip only when PostgreSQL is genuinely unavailable outside CI.
- CI starts PostgreSQL and treats skips in the migration/FK suite as failure or runs a required non-skipping marker job.
- Alembic tests execute actual revision code. `Base.metadata.create_all` is permitted only for unrelated unit/fixture setup.
- Always drop the disposable schema/database in `finally`.

## Rollout

1. Land Alembic baseline/adoption guard and safe identity migration while old explicit writers remain compatible.
2. Run/verify migration in local-prod and a snapshot-derived disposable legacy database.
3. Land automatic-only message writers plus final sequence high-water reconciliation.
4. Land delete endpoints and event semantics after their schema/runtime contracts are present.
5. Auth/tenancy child adds later revisions on the same migration chain.

Rollback must never deploy old manual writers against an `ALWAYS` identity. `BY DEFAULT` remains the compatibility mode unless a later coordinated migration intentionally changes it.
