# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

<!--
Document your project's database conventions here.

Questions to answer:
- What ORM/query library do you use?
- How are migrations managed?
- What are the naming conventions for tables/columns?
- How do you handle transactions?
-->

(To be filled by the team)

---

## Query Patterns

<!-- How should queries be written? Batch operations? -->

(To be filled by the team)

### Read-Only Marker Observation

Use this pattern for debugging real-test markers across browser/API/database/event state.

**Rules**:
- Use `SELECT` only.
- Do not run `UPDATE`, `DELETE`, `INSERT`, `TRUNCATE`, or DDL during observation.
- Do not assume the active local database port. Check the running backend and test likely local ports such as `5432` and `55432`.
- Copy IDs from results into follow-up queries; do not patch rows to make evidence pass.

**Marker queries**:

```sql
SELECT m.id, m.short_id, c.name AS channel, m.content, m.created_at
FROM messages m
JOIN channels c ON c.id = m.channel_id
WHERE m.content LIKE '%REAL_marker_here%'
ORDER BY m.created_at DESC
LIMIT 5;
```

```sql
SELECT e.seq, e.event_type, e.message_id, e.payload->>'content' AS content
FROM event_records e
WHERE e.payload::text LIKE '%REAL_marker_here%'
ORDER BY e.seq DESC
LIMIT 10;
```

```sql
SELECT t.id, t.task_number, t.title, t.status, t.created_at
FROM tasks t
WHERE t.title LIKE '%REAL_marker_here%' OR t.description LIKE '%REAL_marker_here%'
ORDER BY t.created_at DESC
LIMIT 5;
```

---

## Migrations

<!-- How to create and run migrations -->

## Scenario: External Integration Gateway Foundation

### 1. Scope / Trigger
- Trigger: adding Feishu, Jira, or any external work-system adapter that needs to receive, route, deduplicate, audit, or write back external events.
- Use this before implementing provider-specific adapters. The adapter should enter through the integration gateway foundation instead of writing ad hoc route/event/mapping tables.

### 2. Signatures
- Connector table: `external_connectors(server_id, provider, name, status, config, secret_ref, encrypted_config, last_error_code, last_error_reason)`.
- Route table: `external_routes(connector_id, source_selector, channel_id, task_template_id, default_assignee_id, runtime_rule, writeback_policy, status)`.
- Event table: `external_events(connector_id, provider, dedup_key, event_type, status, normalized, route_id, session_id, channel_id, message_id, task_id, task_run_id, failure_code, failure_reason)`.
- Session table: `external_sessions(connector_id, external_scope_type, external_scope_id, channel_id, thread_root_message_id, task_id, member_id, status)`.
- Mapping table: `external_mappings(connector_id, local_type, local_id, external_type, external_id, external_url)`.
- Service module: `services.integration_gateway`.

### 3. Contracts
- External adapters may normalize input, claim/log events, resolve routes/sessions, link local records, and create mappings.
- External adapters must not execute runtime/provider work directly. Runtime execution stays behind TaskRun and daemon/runtime services.
- Deduplication is database-backed through `uq_external_events_connector_dedup` on `(connector_id, dedup_key)`.
- External sessions are unique by `(connector_id, external_scope_type, external_scope_id)`.
- Startup DDL in `backend/models/seed.py` must be updated in the same change as ORM declarations in `backend/models/slock.py`.
- Connector secrets and credential-shaped payload keys must not leak through event `normalized` payloads or generic serializers.

### 4. Validation & Error Matrix
- Duplicate external event -> return the existing event as duplicate; do not create another task/channel/TaskRun.
- Unknown route -> record `dropped` or `failed` with `EXTERNAL_ROUTE_NOT_FOUND` and a readable reason.
- Disabled route -> return a disabled route outcome; do not create local work.
- Invalid or sensitive payload field -> sanitize credential-shaped keys before storage/serialization.
- Write-back failure -> keep the local TaskRun result and mark the external event `writeback_failed` with provider-readable failure details.

### 5. Good/Base/Bad Cases
- Good: Feishu long-connection message claims `external_events`, resolves an `external_routes` row, links channel/task/TaskRun ids, then later maps the Feishu reply/card id in `external_mappings`.
- Good: Jira REST write-back maps `task_run -> jira comment` and records comment failure without deleting the local run output.
- Base: a connector exists with no active routes; incoming events are auditable but do not create work.
- Bad: a Feishu or Jira router creates tasks directly without an external event row and dedup key.
- Bad: storing raw provider access tokens in `external_events.normalized`.
- Bad: executing model/runtime work inside a provider adapter instead of linking to TaskRun state.

### 6. Tests Required
- Assert all five gateway tables exist in `Base.metadata`.
- Assert startup DDL emits `CREATE TABLE IF NOT EXISTS` for all five tables and critical indexes.
- Assert `claim_external_event` creates one event and duplicate claims return the existing event.
- Assert route miss/disabled outcomes expose failure codes and reasons.
- Assert session and mapping helpers are queryable from local and external sides.
- Assert serializers redact connector secrets and credential-shaped config/payload keys.
- Assert integration gateway service does not import daemon/runtime execution helpers.

### 7. Wrong vs Correct
#### Wrong
```text
Feishu handler -> parse message -> create TaskRun -> call runtime/daemon directly -> reply
```

#### Correct
```text
Feishu handler -> claim external_event -> resolve external_route/session -> create/link SmallKhoj channel/task/TaskRun state -> existing TaskRun/daemon path executes -> external_mapping/write-back records outcome
```

## Scenario: Computer Binding Columns On Members

### 1. Scope / Trigger
- Trigger: P1 unified Member model stores agent computer/runtime bindings in explicit DB columns while keeping older config payloads readable.

### 2. Signatures
- `members.computer_id UUID REFERENCES computers(id) ON DELETE SET NULL`
- `members.backend VARCHAR(40)`
- Compatibility config keys: `config.computerId`, `config.workspaceId`, `config.backend`
- Binding table: `agent_workspaces(agent_id, computer_id, runtime, updated_at)`

### 3. Contracts
- Explicit columns are the source of truth for query/auth paths.
- Serializers still emit `computerId`, `workspaceId`, and `backend` for agents.
- Startup table creation must use `ADD COLUMN IF NOT EXISTS` for local existing DBs.
- Startup migration must not create demo servers, members, computers, channels, messages, tasks, API keys, or activity logs.
- Startup migration may only backfill existing rows from compatibility config keys into explicit columns.

### 4. Validation & Error Matrix
- Missing `members.computer_id` on an old DB -> startup adds it.
- Missing `members.backend` on an old DB -> startup adds it.
- Existing row only has `config.computerId` -> startup backfills `members.computer_id` when the UUID references a real computer.
- Existing row only has `config.backend` -> startup backfills `members.backend`.

### 5. Good/Base/Bad Cases
- Good: agent API auth validates a machine token through `members.computer_id` and serializers return `computerId`, `workspaceId`, and `backend`.
- Base: old rows with config-only bindings continue to serialize and authenticate through fallback paths.
- Bad: writing only `config.workspaceId` without an `agent_workspaces` row, because query/auth paths cannot join or filter reliably.

### 6. Tests Required
- Assert DB startup exposes `members.computer_id` and `members.backend`.
- Assert startup does not insert demo agents such as `aaa` or `deepseek`.
- Assert `/api/v1/members`, `/api/v1/computers`, `/internal/agent-api/profile`, and `/internal/agent-api/channel-members` return agent binding fields.
- Assert machine-token auth works for an agent bound through `members.computer_id`.

### 7. Wrong vs Correct
#### Wrong
Only read or write agent computer binding through `member.config`.

#### Correct
Write `members.computer_id` and `members.backend` first, keep `config.computerId`, `config.workspaceId`, and `config.backend` synchronized for old clients.

---

## Scenario: Per-Channel Task Number Allocation

### 1. Scope / Trigger
- Trigger: Public and agent task creation assign `tasks.task_number` from `max(task_number) + 1` under the unique key `tasks_channel_id_task_number_key`.
- Use this whenever code creates tasks or other channel-scoped sequence-like records without a database sequence.

### 2. Signatures
- DB unique key: `UNIQUE (channel_id, task_number)`.
- Public API: `POST /api/v1/tasks`.
- Internal API: any agent task creation path that writes `Task(task_number=...)`.

### 3. Contracts
- Treat `max(task_number) + 1` as optimistic allocation only.
- On `IntegrityError` for `tasks_channel_id_task_number_key`, rollback the failed transaction, recompute the next number, and retry a bounded number of times.
- After `AsyncSession.rollback()`, do not read attributes from previously loaded ORM instances such as `server.id`, `channel.name`, or `creator.display_name`. Rollback expires ORM state; direct attribute access can trigger async lazy I/O outside `greenlet_spawn`.
- Cache primitive IDs/display values before the retry loop, or reload ORM instances after rollback before passing them to helpers that read attributes.

### 4. Validation & Error Matrix
- Missing `title` -> `400 Missing title`.
- Malformed JSON body -> `400 Invalid JSON body`.
- Invalid `messageId` -> `400 Invalid messageId`.
- Source message outside the task channel -> `404 Source message not found in task channel`.
- Duplicate `(channel_id, task_number)` during concurrent create -> retry, then return a normal `200` response when a later number succeeds.
- Duplicate key after retry limit -> re-raise the database error so the caller sees the real operational failure.

### 5. Good/Base/Bad Cases
- Good: five concurrent `POST /api/v1/tasks` calls for one channel return unique contiguous task numbers and no 500 responses.
- Base: a single task create still inserts once, records activity, commits, refreshes the task, and publishes latest events.
- Bad: create task #N with `max + 1`, catch no `IntegrityError`, and let one worker receive `500 Internal Server Error` when another worker created #N first.
- Bad: call `await db.rollback()` and then use a previously loaded ORM object's expired attributes inside `_record_activity`.

### 6. Tests Required
- API concurrency smoke: run 4-5 parallel `POST /api/v1/tasks` calls against the same channel and assert all status codes are 200 with distinct task numbers.
- API malformed JSON smoke: send invalid JSON to `POST /api/v1/tasks` and assert `400 Invalid JSON body`.
- Activity/event assertion: after a retried create, assert the task exists and a `task.created` event/activity row references the final task id and task number.

### 7. Wrong vs Correct
#### Wrong
Allocate `task_number = await _next_task_number(...)`, flush once, and rely on the unique constraint to never collide.

#### Correct
Allocate optimistically, catch only the task-number unique constraint, rollback, reload or use cached primitive values, recompute, and retry with a small bounded limit.

---

## Naming Conventions

<!-- Table names, column names, index names -->

(To be filled by the team)

---

## Common Mistakes

<!-- Database-related mistakes your team has made -->

(To be filled by the team)
