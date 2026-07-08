# Integration gateway foundation design

## Boundary

This child creates the backend foundation for external integration state. It is not the Feishu adapter, Jira adapter, deployment task, or UI task.

The intended boundary is:

`external adapter -> integration gateway service -> SmallKhoj channel/task/TaskRun state`

The service may create or link local records, but it must not run an agent, call a model provider, or push daemon execution directly.

## Data Model

Recommended model names:

- `ExternalConnector`
- `ExternalRoute`
- `ExternalEvent`
- `ExternalSession`
- `ExternalMapping`

Recommended table names:

- `external_connectors`
- `external_routes`
- `external_events`
- `external_sessions`
- `external_mappings`

### ExternalConnector

Purpose: one configured external system connection.

Minimum fields:

- `id`
- `server_id`
- `provider`: initially supports values such as `feishu`, `jira`, `generic`
- `name`
- `status`: `active`, `disabled`, `error`
- `config`: JSONB for non-secret connection metadata
- `secret_ref` or `encrypted_config`: placeholder for credential handling
- `last_error_code`
- `last_error_reason`
- timestamps

Credential rule:

- Do not store raw API tokens in `external_events`.
- Do not serialize `secret_ref` or encrypted payload values to generic frontend/debug output unless explicitly redacted.

### ExternalRoute

Purpose: map an external source to SmallKhoj ownership and execution policy.

Minimum fields:

- `id`
- `server_id`
- `connector_id`
- `name`
- `status`: `active`, `disabled`
- `source_selector`: JSONB; provider-specific but stable enough for Feishu chat/thread or Jira project/issue shape
- `channel_id`
- `task_template_id`
- `default_assignee_id`
- `runtime_rule`: JSONB; future target computer/runtime selection
- `writeback_policy`: JSONB
- timestamps

MVP route resolution can use exact matches, but the service contract should return typed outcomes:

- matched route
- disabled route
- no route
- invalid selector

### ExternalEvent

Purpose: durable event log and idempotency anchor.

Minimum fields:

- `id`
- `server_id`
- `connector_id`
- `route_id`
- `session_id`
- `provider`
- `source_event_id`
- `source_message_id`
- `source_thread_id`
- `dedup_key`
- `status`: `received`, `accepted`, `dropped`, `failed`, `completed`, `writeback_failed`
- `event_type`
- `actor_external_id`
- `normalized`: JSONB metadata safe for local inspection
- `raw_ref`: optional pointer, not full sensitive raw body
- `channel_id`
- `message_id`
- `task_id`
- `task_run_id`
- `failure_code`
- `failure_reason`
- timestamps such as `received_at`, `processed_at`, `completed_at`

Idempotency:

- Create a unique database index on `(server_id, provider, dedup_key)` or `(connector_id, dedup_key)`.
- The service should claim events through one transaction that either inserts the first event or returns the existing event as duplicate.

### ExternalSession

Purpose: bind external conversation/work context to local context.

Minimum fields:

- `id`
- `server_id`
- `connector_id`
- `provider`
- `external_scope_type`: `chat`, `thread`, `topic`, `issue`, `project`
- `external_scope_id`
- `channel_id`
- `thread_root_message_id`
- `task_id`
- `member_id`
- `status`: `active`, `archived`, `disabled`
- `metadata`
- timestamps

Unique key:

- At minimum, unique on `(connector_id, external_scope_type, external_scope_id)`.

### ExternalMapping

Purpose: map local SmallKhoj objects to provider objects.

Minimum fields:

- `id`
- `server_id`
- `connector_id`
- `provider`
- `local_type`: `channel`, `message`, `task`, `task_run`
- `local_id`
- `external_type`: `message`, `card`, `issue`, `comment`, `thread`
- `external_id`
- `external_url`
- `metadata`
- timestamps

Indexes:

- `(server_id, local_type, local_id)`
- `(connector_id, external_type, external_id)`
- Optional unique key on `(connector_id, local_type, local_id, external_type, external_id)`.

## Service API Shape

Create `backend/services/integration_gateway.py` or an equivalent module.

Expected service operations:

- `claim_external_event(...)`
- `mark_external_event_accepted(...)`
- `mark_external_event_dropped(...)`
- `mark_external_event_failed(...)`
- `mark_external_event_completed(...)`
- `resolve_external_route(...)`
- `get_or_create_external_session(...)`
- `create_external_mapping(...)`
- `list_external_mappings_for_local(...)`
- `serialize_external_event(...)`

The service should return structured outcomes, not raw booleans. Later Feishu and Jira adapters should be able to distinguish duplicate, no route, disabled route, unauthorized user, accepted, and infra failure.

## Relationship To Existing Models

- `ExternalEvent.channel_id/message_id/task_id/task_run_id` link external event evidence to owned SmallKhoj work.
- `ExternalRoute.channel_id` selects where accepted external work lands.
- `ExternalRoute.task_template_id` should point at `TaskRunTemplate` when a route chooses a template.
- `ExternalRoute.default_assignee_id` should point at an agent `Member` when a route has a default executor.
- `ExternalSession.channel_id/thread_root_message_id/task_id` keeps Feishu or Jira context from creating repeated disconnected channels/tasks.
- `ExternalMapping.task_run` entries let Jira/Feishu write-back find the originating run.

## Runtime Boundary

The gateway service must not call:

- daemon WebSocket delivery directly;
- runtime provider functions;
- shell/runtime launchers;
- model provider APIs.

When later adapters need execution, they should create or link channel/task state and call the existing TaskRun creation path. The TaskRun/daemon system remains the execution source of truth.

## Startup DDL

Because current SmallKhoj startup schema management lives in `backend/models/seed.py`, implementation must update both:

- ORM declarations in `backend/models/slock.py`;
- startup DDL in `backend/models/seed.py`.

Tests should follow the existing `test_startup_seed_emits_*_ddl` style by replacing `seed.engine` with a fake engine and asserting emitted SQL contains the new tables/indexes/constraints.

## Security And Privacy

- Store normalized event metadata, not full raw external payloads, by default.
- Never write credential fields into `ExternalEvent.normalized`.
- Redact connector secret placeholders from serializers.
- Dropped unbound/unauthorized Feishu-like messages should be audit-only when adapters are implemented later; this foundation must have enough status/failure fields to represent that.

## Rollout

This is additive schema and service work. Existing SmallKhoj flows should continue to work if no external connectors exist.

Rollback is straightforward before adapters depend on the tables: remove service usage and ignore the unused tables. After Feishu/Jira adapters are built, these tables become required release infrastructure.
