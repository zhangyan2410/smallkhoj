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

## Scenario: Jira REST Outbound Write-Back

### 1. Scope / Trigger
- Trigger: adding or changing Jira Cloud outbound REST operations for issue lookup, comment write-back, or Jira object mappings.
- Use this for the 7-15 release path where Jira is a durable external work-record target. Jira webhook ingestion is a separate future scenario.

### 2. Signatures
- Service module: `services.jira_rest`.
- Config resolver: `resolve_jira_config(connector, credentials={email, apiToken})`.
- Issue lookup: `GET {siteUrl}/rest/api/3/issue/{issueIdOrKey}`.
- Comment write-back: `POST {siteUrl}/rest/api/3/issue/{issueIdOrKey}/comment`.
- Comment body: Jira Atlassian Document Format document under JSON key `body`.
- Mapping helpers:
  - `map_jira_issue(... local_type, local_id, issue_key, issue_url)`.
  - `map_jira_comment(... local_type, local_id, comment_id, comment_url)`.

### 3. Contracts
- Jira credentials are runtime inputs or secret-manager outputs. Do not commit real Jira email/API token values.
- `ExternalConnector.config` may store non-secret `siteUrl`; tokens must not be stored in `ExternalEvent.normalized` or mappings.
- Jira Cloud REST uses Basic auth with `email:apiToken` encoded in the `Authorization` header.
- Plain text TaskRun output must be converted to minimal ADF before comment write-back.
- Successful issue/comment associations must use `external_mappings`; do not add a Jira-specific mapping table.
- Jira service must not import daemon/runtime execution helpers. It only reads/writes Jira and records external mappings.

### 4. Validation & Error Matrix
- Missing `siteUrl` -> `JIRA_CONFIG_MISSING_SITE_URL`.
- Non-HTTPS or malformed `siteUrl` -> `JIRA_CONFIG_INVALID_SITE_URL`.
- Missing email/API token -> `JIRA_CREDENTIALS_MISSING`.
- Jira 401/403 -> `JIRA_AUTH_FAILED`.
- Jira 404 -> `JIRA_ISSUE_NOT_FOUND`.
- Jira issue lookup 5xx/other -> `JIRA_API_FAILED`.
- Jira comment 5xx/other -> `JIRA_COMMENT_FAILED`.
- Jira comment response without id -> `JIRA_COMMENT_FAILED`.

### 5. Good/Base/Bad Cases
- Good: `fetch_jira_issue` normalizes key, id, summary, status, description text, and browser URL for TaskRun context.
- Good: `append_jira_comment` posts ADF and maps `task_run -> jira comment` through integration gateway.
- Base: issue lookup succeeds but later comment write-back fails; local TaskRun output remains the source of truth.
- Bad: storing Jira API token in connector config snapshots, event normalized payloads, or test fixtures.
- Bad: writing Jira comments by constructing ad hoc JSON outside the service, bypassing ADF conversion tests.
- Bad: updating Jira workflow status in the REST MVP before comment/evidence write-back is reliable.

### 6. Tests Required
- Config validation for missing/invalid site URL and missing credentials.
- Fake HTTP test for issue lookup URL, method, auth header, and normalized issue shape.
- Fake HTTP test for comment POST URL, ADF body, and returned comment URL.
- Failure-code tests for auth, not found, and provider errors.
- Mapping tests proving issue/comment mappings are `ExternalMapping` rows.
- Boundary test proving `services.jira_rest` does not import runtime/daemon execution helpers.

### 7. Wrong vs Correct
#### Wrong
```text
TaskRun completion -> Jira adapter writes comment -> stores jira_comment_id in task.data
```

#### Correct
```text
TaskRun completion -> services.jira_rest.append_jira_comment -> services.integration_gateway.create_external_mapping(local task_run -> jira comment)
```

## Scenario: Feishu Long-Connection Message Boundary

### 1. Scope / Trigger
- Trigger: adding Feishu/Lark message events, long-connection workers, or bot command handlers.
- Use this before connecting a production `lark-oapi` worker or adding more Feishu command shapes.

### 2. Signatures
- Service module: `services.feishu_adapter`.
- Normalized event type: `FeishuInboundMessage`.
- First supported command: optional bot mention plus `分析 <JIRA-KEY>`.
- Gateway event claim:
  - `provider="feishu"`.
  - `dedup_key="feishu:{event_id or message_id}"`.
- Route source shape:
  - `chatId`
  - `chatType`
  - `command`
- Session scope:
  - `thread` when Feishu `thread_id` exists.
  - `chat` otherwise.

### 3. Contracts
- Raw SDK events must be normalized before business logic reads them.
- Group messages are non-work by default. They enter SmallKhoj only when explicitly addressed to the bot by mention/name or when the chat is direct/p2p.
- Feishu adapter must claim an `external_events` row before accepted work is created.
- Duplicate, unknown command, unaddressed group, no route, and disabled route outcomes must not create channel/task content.
- Accepted outcomes may expose parsed command data for later orchestration, but must not execute runtime/model work directly.
- The production long-connection worker should be a transport wrapper that calls this adapter; it should not own route, dedup, or TaskRun semantics.

### 4. Validation & Error Matrix
- Unaddressed group message -> `FEISHU_UNADDRESSED_GROUP`.
- Unsupported text -> `FEISHU_COMMAND_UNKNOWN`.
- Duplicate event/message id -> duplicate outcome from integration gateway claim.
- No matching route -> `FEISHU_ROUTE_NOT_FOUND`.
- Disabled route -> `FEISHU_ROUTE_DISABLED`.
- Matching route -> external session is created/reused and event is linked to route/session/channel context.

### 5. Good/Base/Bad Cases
- Good: `@SmallKhoj 分析 JIRA-123` in a group where the bot is mentioned claims the event, resolves route, creates/reuses session, and returns a `jira_analysis` command for the next orchestration slice.
- Good: `分析 JIRA-123` in p2p chat does not require a bot mention.
- Base: unknown command is audited as dropped and can be inspected through external event status.
- Bad: ingesting every group message into SmallKhoj channels.
- Bad: making the Feishu SDK callback create TaskRun records and send daemon commands directly.
- Bad: storing unaddressed group message bodies as local channel/task content.

### 6. Tests Required
- Raw event normalization from Feishu-like payload to `FeishuInboundMessage`.
- Group addressing filter for p2p, mentioned group, and unaddressed group.
- Command parser for `分析 JIRA-123`.
- Duplicate/unknown/no-route/drop outcomes.
- Matched route creates session and links event context.
- Boundary test proving Feishu adapter does not import runtime/daemon execution helpers.

### 7. Wrong vs Correct
#### Wrong
```text
lark-oapi callback -> parse text -> create TaskRun -> send daemon command
```

#### Correct
```text
lark-oapi callback -> normalize -> services.feishu_adapter.dispatch_feishu_message -> integration gateway event/session/route -> later orchestration creates TaskRun
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
