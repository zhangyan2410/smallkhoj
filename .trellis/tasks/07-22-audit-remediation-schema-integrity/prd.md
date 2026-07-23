# Repair schema and destructive-write integrity

## Goal

建立可部署、可升级、可并发验证的 PostgreSQL schema 真相源，修复消息序号迁移撞号和 Task 删除审计外键失败，同时完成 plan 009 的 backend Task/File 删除契约。

## Source Findings

- Parent remediation requirements R1 and R7.
- Independent verdicts: 003b/004/009 are `REVISE`.
- Confirmed RED evidence:
  - 0001 historical `messages.seq=1,2,3` → 0002 identity → first implicit insert selects 1 and violates `messages_seq_key`.
  - `DELETE tasks` → new `activity_logs(task_id=deleted_id)` violates `activity_logs_task_id_fkey`; EventRecord has the same latent failure.

## Requirements

### Schema authority

- Add Alembic as the deployment schema authority with a baseline that represents the synchronized remediation base.
- Fresh databases reach head through `alembic upgrade head` only.
- Existing pre-Alembic databases use an explicit compatibility preflight, stamp the baseline revision only, then upgrade to head; documentation must never recommend `stamp head`.
- FastAPI lifespan must not call `Base.metadata.create_all` or run compatibility DDL. Startup may verify revision/schema readiness but cannot mutate schema implicitly.
- Local-dev, test, Docker and production entrypoints must run/require migrations coherently.
- ORM metadata may remain for query mapping and isolated unit fixtures, but passing `Base.metadata.create_all` tests is not migration evidence.

### Message sequence invariant

- `messages.seq` is database-generated and globally unique under the current schema contract.
- When the identity migration is applied to existing rows, the next generated value is greater than every existing seq.
- During the compatibility window, an explicit seq insert above the current generator must advance/reconcile the generator before automatic-only writers are deployed.
- Application message writers stop using `SELECT MAX(seq)+1` only after the safe migration exists.
- Public API, agent API and reminder scheduler use the same terminal allocation contract.

### Task/File deletion and audit

- Owner/admin can delete an existing Task or File; non-admin is rejected and cross-server references are not observable.
- Task delete removes saved-item references and dependent assignments/runs according to declared FK/service contracts.
- A deletion audit/event uses a dedicated semantic kind/type (`supervisor_task_deleted` / `task.deleted` or the final reviewed equivalent), not `task.updated` or `message.sent`.
- Deletion records preserve old IDs/numbers/names in JSON payload tombstones, but do not insert a new FK to a deleted Task/File.
- `task.deleted` is browser/UI work only. It must be scoped and replayable through committed EventRecord state while remaining non-actionable to agent runtimes.
- File blob/storage deletion and database deletion have a defined order and failure policy; a DB rollback must not leave a successful response for an undeleted row.

## Invariants

- **INV-S1:** Every deployed schema has an Alembic revision, and current application startup refuses an unrecognized/missing revision rather than inventing head schema.
- **INV-S2:** After any supported migration/transition sequence, the next implicit `messages.seq` is `> MAX(committed seq before insertion)`.
- **INV-S3:** Two concurrent implicit message inserts commit distinct seq values without application retry based on `MAX(seq)`.
- **INV-S4:** A successful Task DELETE commits with no FK referencing the deleted task; tombstone payload contains its old identity.
- **INV-S5:** A failed deletion transaction leaves Task/File and audit/event state mutually consistent.
- **INV-S6:** A deletion UI event is published only after commit and cannot be delivered as runtime/model work.

## Acceptance Criteria

- [ ] Fresh PostgreSQL database upgrades from empty to head and backend starts without application-created DDL.
- [ ] Representative legacy database passes compatibility preflight, stamps baseline only, upgrades all later migrations exactly once, and rejects unsafe drift.
- [ ] Historical seq migration test with rows 1/2/3 passes; first implicit row receives 4 or greater.
- [ ] Transition test performs explicit post-migration high seq insertion and proves the later implicit value advances beyond it.
- [ ] Concurrent implicit insertion test commits distinct seq values with no unique violation.
- [ ] All production message writers omit manual `seq=max+1`; a repository check/test prevents reintroduction.
- [ ] Real PostgreSQL authenticated route test deletes a Task, commits, returns success, and proves Task absent, tombstone audit/event present, both FK columns null.
- [ ] Non-admin, missing, cross-server and dependent-record Task delete cases have direct route coverage.
- [ ] File delete has equivalent permission/scope/commit/storage-failure coverage appropriate to its persistence model.
- [ ] Event scope/alias/runtime-gate tests prove `task.deleted` refreshes product UI but never reaches a runtime prompt.
- [ ] Migration docs, Docker/local startup and rollback notes match actual commands and revision IDs.
- [ ] Focused and full backend tests, Ruff, migration matrix and `git diff --check` pass.

## Out of Scope

- Tenant template schema migration belongs to the auth/tenancy child and must depend on this Alembic foundation.
- Frontend delete affordances and `./twd` interaction evidence belong to delivery/UI, though this child owns their backend contracts.
- No migration or destructive test may target the shared development or cloud database.
