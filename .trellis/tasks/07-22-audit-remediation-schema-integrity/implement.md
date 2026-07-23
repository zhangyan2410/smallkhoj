# Schema and destructive-write implementation plan

## Task 0 — Diagnostic capsules and drift check

- [ ] Create `docs/bug-report/messages-seq-migration/bug-report.md` with the 8-field diagnosis capsule and existing PostgreSQL RED evidence.
- [ ] Create `docs/bug-report/task-delete-audit-fk/bug-report.md` with the route order, FK evidence and target tombstone contract.
- [ ] Compare synchronized remediation base with advisor heads `8962df8`, `050a624`, `33945d1`; map every reusable hunk and reject stale fake tests.
- [ ] Confirm exact current writers, startup DDL, event maps, storage helpers and dependent Task relationships using CodeGraph.

## Task 1 — Required real-PostgreSQL test harness

**Files:**

- Create/modify: `backend/tests/postgres_test_support.py`
- Create: `backend/tests/test_alembic_migrations_postgres.py`
- Modify: CI backend job created by the delivery child, or add a temporary required local command until that child lands.

- [ ] RED: add a disposable schema/database fixture that executes actual Alembic revisions and always cleans up.
- [ ] RED: baseline → insert seq 1/2/3 → upgrade identity → implicit insert; assert next seq > 3. Confirm it fails with duplicate seq=1 on the broken migration.
- [ ] RED: upgrade identity → explicit seq 100 during transition → final reconcile → implicit insert; assert >100.
- [ ] RED: concurrent implicit inserts commit unique values.
- [ ] Verify failures are contract failures, not unavailable database/fixture errors.

Run:

```bash
cd backend
rtk env SMALLKHOJ_TEST_DATABASE_URL=<isolated-test-url> SMALLKHOJ_TEST_ADMIN_DATABASE_URL=<isolated-admin-url> uv run pytest tests/test_alembic_migrations_postgres.py -q
```

Expected before fix: historical/transition tests fail with `messages_seq_key` or a generated value not above the high-water mark.

## Task 2 — Establish Alembic schema authority

**Files:**

- Modify: `backend/pyproject.toml`, `backend/uv.lock`, `backend/Dockerfile`, `backend/main.py`, local startup script(s), `docker-compose.yml`, `docker-compose.prod.yml`
- Create: `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/script.py.mako`, `backend/alembic/versions/<baseline>.py`
- Replace/retire schema mutation in: `backend/models/seed.py`
- Create/modify tests for startup revision guard and baseline metadata coverage.

- [ ] RED: test fresh database cannot be considered ready without running Alembic and that application startup no longer creates tables.
- [ ] Inventory every table/index/constraint/data migration currently owned by ORM + `create_tables`; make baseline/follow-up revisions complete.
- [ ] Implement migration-before-app entrypoints and a non-mutating revision readiness guard.
- [ ] Add legacy adoption preflight that refuses missing/incompatible required objects and prints the baseline-only stamp/upgrade sequence without executing against shared DB.
- [ ] Remove unsafe `stamp head` documentation and implicit lifecycle DDL.
- [ ] GREEN: fresh, legacy-compatible and schema-drift cases produce the specified outcomes.

## Task 3 — Fix identity high-water and switch writers

**Files:**

- Create: ordered identity/reconciliation Alembic revisions.
- Modify: `backend/models/slock.py`
- Modify writers: `backend/routers/public_api.py`, `backend/routers/agent_api.py`, `backend/services/reminder_scheduler.py`
- Modify/add focused message tests.

- [ ] Implement `BY DEFAULT` identity plus atomic high-water alignment for historical rows.
- [ ] Preserve explicit-write compatibility until the final reconciliation revision.
- [ ] RED: repository/route tests prove each writer currently sends explicit seq or performs `MAX(seq)`.
- [ ] Remove manual allocation from all writers after the safe migration exists.
- [ ] GREEN: migration matrix and concurrent route/service inserts pass.
- [ ] Add a guard test/search assertion preventing new production `MAX(Message.seq)+1` allocation.

## Task 4 — Real PostgreSQL Task/File DELETE contracts

**Files:**

- Create: `backend/tests/test_task_delete_postgres_http.py`
- Create/modify: `backend/tests/test_file_delete_postgres_http.py`
- Modify: `backend/routers/public_api.py`
- Prefer a shared deletion/audit helper in `backend/services/` only if both endpoints have a stable common contract.
- Modify: `backend/services/public_events.py` and event mapping tests.

- [ ] RED: authenticated owner Task DELETE on real PostgreSQL fails at the current activity FK path.
- [ ] Add RED cases for non-admin, missing/cross-server Task, dependencies, commit rollback, and event semantics.
- [ ] Add File DELETE RED cases including persistence/storage cleanup behavior.
- [ ] Capture primitive tombstone before deletion; write dedicated activity/event with deleted FK fields null.
- [ ] Ensure commit precedes event publication and failure leaves consistent state.
- [ ] Add scope/alias/daemon-gate tests for new deletion event types.
- [ ] GREEN: focused real PostgreSQL routes and event tests pass.

## Task 5 — Full verification and docs

- [ ] Run actual empty→head and legacy→baseline stamp→head migration matrices.
- [ ] Run focused PostgreSQL tests with no skip in the required environment.
- [ ] Run full backend pytest and Ruff.
- [ ] Run `git diff --check` and Trellis validation.
- [ ] Update `docs/migration-workflow.md`, deployment docs and backend DB spec with the executable contracts learned.
- [ ] Fill capsule acceptance fields with exact RED/GREEN commands and outputs.

## STOP conditions

- Stop if baseline generation would omit current `models/seed.py` DDL/data responsibilities.
- Stop if a test URL resolves to the shared development/cloud database rather than a disposable schema/database.
- Stop if legacy compatibility cannot distinguish a valid baseline from drift; do not automate `stamp` blindly.
- Stop if File storage cleanup requires a product durability choice not represented in current storage architecture; present the choice before inventing atomicity.
- Stop if a new deletion event would become runtime actionable under existing daemon classification.
