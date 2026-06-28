# Initial release integration gateway foundation

## Goal

Create the backend foundation that lets external systems enter SmallKhoj through durable, idempotent, inspectable records before any Feishu or Jira adapter executes product behavior.

This task is the first implementation slice under `06-28-07-15-initial-release`. It should make the requested 7-15 release loop more true:

`Feishu/Jira event -> connector/route/event/session/mapping -> SmallKhoj channel/task/TaskRun -> daemon/runtime -> evidence/write-back`

The scope is deliberately narrow in feature surface, but not loose in engineering quality. The foundation must be good enough that Feishu long connection and Jira REST can build on it without rewriting temporary webhook code.

## Parent Dependency

- Parent task: `.trellis/tasks/06-28-07-15-initial-release/`.
- This child is a prerequisite for Jira REST MVP and Feishu long-connection MVP.
- Directory hierarchy is not treated as implicit dependency; this PRD is the dependency record.
- The parent release remains the source for product scenario and release acceptance.

## Confirmed Codebase Facts

- Current backend data models live in `backend/models/slock.py`.
- The project does not currently use Alembic migrations. Startup schema creation and incremental upgrades live in `backend/models/seed.py` using `Base.metadata.create_all`, `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and explicit index creation.
- `Task`, `TaskAssignment`, `TaskRun`, `TaskRunTemplate`, `Computer`, `AgentWorkspace`, `Channel`, `Message`, and `EventRecord` already exist.
- `services/task_runs.py` already owns TaskRun creation, lifecycle updates, serialization, runtime/workspace/computer evidence, and failure fields.
- `Computer` already has `machine_id`, daemon lease fields, and a partial unique index for `(server_id, machine_id)` when `machine_id IS NOT NULL`.
- External integration concepts do not yet exist as first-class backend models.

## Reference Evidence

- Agent Platform's `channel-gateway` uses connectors, routes, event logs, and thread/session mapping. SmallKhoj should absorb that lightweight shape inside the existing backend instead of adding a separate gateway service for this slice.
- Multica's Feishu/Lark package uses installation records, long-connection supervision, user/chat bindings, inbound dedup, audit records for drops, and typed dispatcher outcomes. This child should preserve those future needs in the schema and service contracts without implementing the Feishu adapter yet.

## Requirements

- **R1: External connector model.** Add a server-owned model for external systems. It must support at least `provider`, display name, status, non-secret config, secret reference or encrypted secret payload placeholder, timestamps, and server scoping.
- **R2: External route model.** Add route records that map an external source shape to SmallKhoj ownership targets: channel, task template, default assignee/runtime rule, and write-back policy. The first implementation may support a minimal JSON selector, but route state must be durable.
- **R3: External event log.** Add durable event records for received, accepted, dropped, failed, completed, and write-back-failed states. Each event must carry provider/source ids, dedup key, normalized payload metadata, linked route/session/task/run/message ids where available, failure code, and human-readable failure reason.
- **R4: Idempotency contract.** Reprocessing the same external event/message id must not create duplicate channel/task/TaskRun records. Dedup must be enforced by a database uniqueness constraint, not only an in-memory check.
- **R5: External session mapping.** Add a mapping from external chat/thread/topic or issue context to SmallKhoj channel/thread/task context. This is required for Feishu chat/thread binding and future Jira webhook grouping.
- **R6: External object mapping.** Add mapping records between SmallKhoj objects and external provider objects, such as task/run/message to Jira issue/comment and Feishu message/card. Mappings must be provider-scoped and queryable from the local object side.
- **R7: Service boundary.** Add a backend service layer for integration gateway behavior. Adapters should call this service to claim/log events, resolve route/session context, attach task/run/message ids, and update final state. Adapters must not directly scatter these writes across routers.
- **R8: TaskRun boundary preservation.** This foundation must not execute runtime/provider work. It may link to or prepare TaskRun state, but execution remains owned by existing TaskRun and daemon/runtime services.
- **R9: Failure visibility.** Unknown route, duplicate event, unauthorized/unbound user, invalid payload, missing connector config, and downstream write-back failure must have representable status/failure fields with readable reasons.
- **R10: Startup DDL parity.** Any new ORM table/index/check constraint must also be represented in `backend/models/seed.py`, because current deployments rely on startup DDL rather than migrations.
- **R11: Test coverage.** Backend tests must prove metadata declaration, startup DDL, event dedup, route miss/drop/fail behavior, local/external mapping persistence, and the no-direct-runtime-execution boundary.
- **R12: No plaintext secret leak.** This slice must not introduce plaintext external credentials into source-controlled files, test fixtures, logs, or general event payloads. If a credential field is reserved, tests should assert serialized event output redacts it or stores only a reference.

## Scope

- Backend ORM models and startup DDL for the integration gateway foundation.
- Backend service functions/classes for event claim/log/update, route resolution, session mapping, and object mapping.
- Minimal serializers or debug-facing data shapes suitable for later product UI/API work.
- Unit tests around the foundation behavior.
- No Feishu SDK, no Jira SDK, no public webhook endpoint, no frontend settings UI, and no deployment automation in this child.

## Acceptance Criteria

- [ ] New integration gateway tables are declared in `Base.metadata` and created/updated by `backend/models/seed.py`.
- [ ] Startup DDL tests assert the new tables and critical indexes/constraints are emitted.
- [ ] The event log has a database-level uniqueness guard for provider/connector/source event identity or normalized dedup key.
- [ ] A valid external event can be claimed once, recorded as accepted, linked to route/session/local objects, then marked completed.
- [ ] A duplicate external event returns the existing event or a duplicate outcome without creating another accepted event.
- [ ] Unknown route and invalid payload cases produce dropped/failed records with readable failure codes and reasons.
- [ ] External sessions can map a provider chat/thread/topic or issue context to SmallKhoj channel/thread/task ids.
- [ ] External mappings can map local task/run/message ids to provider issue/comment/message/card ids and can be queried by either side.
- [ ] The service API does not call runtime providers, daemon control, or direct execution functions.
- [ ] Tests cover that integration event handling stops at SmallKhoj state/link creation and does not bypass `services/task_runs.py` for runtime execution.
- [ ] Serialized/debug event output does not expose credential-like values from connector config.
- [ ] The implementation leaves a clear extension point for Jira REST MVP and Feishu long connection MVP.

## Non-Goals

- Do not implement Feishu long connection in this child.
- Do not implement Jira REST in this child.
- Do not add a standalone channel-gateway service.
- Do not build a full integration settings UI.
- Do not build generic webhook ingestion as the release's primary entry path.
- Do not create a parallel execution engine outside TaskRun and daemon/runtime services.

## Open Questions

No blocking user decision remains for this child. Product-level decisions remain in the parent task: first complete scenario is Feishu entry with Jira issue analysis/write-back; Jira first write-back should be issue lookup plus append comment.
