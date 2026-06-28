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

## Scenario: Feishu Outbound Reply Boundary

### 1. Scope / Trigger
- Trigger: sending accepted/result/failure replies back to Feishu/Lark for external work that originated from a Feishu message.
- Use this before wiring production long-connection callbacks or TaskRun completion replies to Feishu.

### 2. Signatures
- Service module: `services.feishu_replies`.
- Config type: `FeishuReplyConfig(base_url, access_token)`.
- Send operation: `send_feishu_text_reply(db, http_client, config, server_id, connector_id, chat_id, text, local_type, local_id, source_message_id=None)`.
- Mapping: successful sends create `ExternalMapping(provider="feishu", external_type="message")`.

### 3. Contracts
- Feishu reply access tokens are runtime inputs or future secret-manager outputs. Do not store them in connector config, event normalized payloads, mappings, task data, or task artifacts.
- Text replies use Feishu Open Platform IM v1 with `msg_type="text"` and JSON-string `content={"text": ...}`.
- Chat-level sends use `/open-apis/im/v1/messages?receive_id_type=chat_id` with `receive_id=<chat_id>`.
- Source-message replies use `/open-apis/im/v1/messages/{message_id}/reply`.
- The service records the Feishu reply message id through `external_mappings`; do not add a provider-specific reply table for the first release.
- The service must not execute daemon/runtime work and must not own the long-connection receive loop.

### 4. Validation & Error Matrix
- Missing base URL -> `FEISHU_REPLY_CONFIG_MISSING_BASE_URL`.
- Missing access token -> `FEISHU_REPLY_CREDENTIALS_MISSING`.
- Missing chat id -> `FEISHU_REPLY_CHAT_MISSING`.
- Missing/blank text -> `FEISHU_REPLY_TEXT_MISSING`.
- Non-2xx HTTP or non-zero Feishu `code` -> `FEISHU_REPLY_API_FAILED`.
- Success response without `data.message_id` -> `FEISHU_REPLY_RESPONSE_MISSING_MESSAGE_ID`.

### 5. Good/Base/Bad Cases
- Good: accepted Feishu task request sends a concise text confirmation and maps the Feishu reply message id to the local event/task/run.
- Good: TaskRun result can later use the same service to reply in the source message/thread and map `task_run -> feishu message`.
- Base: outbound credentials are not wired; caller should record a structured write-back failure without rolling back local TaskRun state.
- Bad: storing Feishu tenant access tokens in `ExternalConnector.config`.
- Bad: replying from the inbound adapter before external event dedup/route decisions are durable.
- Bad: blindly retrying an ambiguous thread-reply failure at chat level and risking duplicate/leaked replies.

### 6. Tests Required
- Chat-level text send request shape.
- Source-message reply request shape.
- Missing config/token/chat/text validation.
- Feishu API failure and missing message id failure.
- Successful mapping through `ExternalMapping`.
- Boundary test proving no daemon/runtime execution helpers are imported.

### 7. Wrong vs Correct
#### Wrong
```text
Feishu inbound adapter -> direct HTTP reply -> no mapping / no event status
```

#### Correct
```text
Feishu inbound adapter -> durable gateway/orchestration decision -> services.feishu_replies.send_feishu_text_reply -> external_mapping(feishu message)
```

## Scenario: Feishu Reply Orchestration

### 1. Scope / Trigger
- Trigger: turning durable Feishu accepted outcomes or Feishu-originated TaskRun terminal states into user-visible Feishu replies.
- Use this after gateway dedup/route/linking has succeeded. This is not the long-connection receive loop.

### 2. Signatures
- Service module: `services.feishu_reply_orchestration`.
- Accepted operation: `send_feishu_accepted_reply(db, feishu_outcome, release_result, http_client, config)`.
- Terminal operation: `send_task_run_feishu_terminal_reply(db, task_run, http_client, config, output_text=None)`.
- Runtime dependencies: `services.integration_runtime.build_feishu_reply_dependencies()`.
- Router response field: `feishuReply`.

### 3. Contracts
- Accepted replies only run after a `FeishuDispatchOutcome(status="accepted")` and release-loop local state creation.
- Terminal replies only run for `completed`, `failed`, or `cancelled` TaskRuns.
- Feishu source context comes from the linked `ExternalEvent.normalized` fields `chatId` and `messageId` or equivalent source message id.
- Terminal replies are idempotent through `ExternalMapping(local_type="task_run", provider="feishu", external_type="message")`.
- Completed replies use `TaskRun.output_message_id` content when available.
- Failed/cancelled replies use `TaskRun.failure_reason` when available.
- Feishu reply failures are returned as structured outcomes and must not roll back local TaskRun or Jira state.
- Endpoint-created Feishu HTTP clients must be closed after terminal reply handling.

### 4. Validation & Error Matrix
- Accepted non-accepted outcome -> `FEISHU_REPLY_UNSUPPORTED_OUTCOME`.
- Terminal non-terminal status -> `FEISHU_REPLY_UNSUPPORTED_TASK_RUN_STATUS`.
- Missing linked event or `chatId` -> `FEISHU_REPLY_NO_SOURCE_CONTEXT`.
- Existing task-run Feishu message mapping -> `FEISHU_REPLY_ALREADY_SENT`.
- Feishu send failure -> `FEISHU_REPLY_SEND_FAILED`.
- Successful send -> `FEISHU_REPLY_SENT` and Feishu message mapping.

### 5. Good/Base/Bad Cases
- Good: accepted `jira_analysis` command replies in the source Feishu message with a concise TaskRun-created confirmation.
- Good: completed Feishu-originated TaskRun replies with the agent output and maps `task_run -> feishu message`.
- Good: Jira write-back can fail while Feishu reply still reports its own outcome; neither should erase local TaskRun state.
- Base: Feishu token is not configured; endpoint returns a structured failed/skipped Feishu reply outcome while committing TaskRun status.
- Bad: terminal lifecycle endpoint creates a Feishu reply without checking existing mappings.
- Bad: making Feishu reply success/failure control whether TaskRun lifecycle commits.

### 6. Tests Required
- Accepted reply sends confirmation and maps `external_event -> feishu message`.
- Completed TaskRun reply uses output message content.
- Failed/cancelled TaskRun reply uses failure reason or fallback text.
- Existing Feishu terminal mapping skips duplicate sends.
- Missing source context skips.
- Feishu send failure returns structured failure.
- Agent lifecycle endpoint passes Feishu runtime dependencies, returns `feishuReply`, and closes the owned client.
- Boundary test proving no daemon/runtime execution helpers are imported.

### 7. Wrong vs Correct
#### Wrong
```text
TaskRun completed -> Feishu reply -> exception aborts lifecycle commit
```

#### Correct
```text
TaskRun completed -> local lifecycle update -> Jira writeBack outcome + Feishu feishuReply outcome -> commit local state
```

## Scenario: Initial Release Feishu-Jira-TaskRun Loop

### 1. Scope / Trigger
- Trigger: wiring an accepted Feishu `jira_analysis` command to Jira issue lookup, local task/run creation, or Jira comment write-back.
- Use this for release orchestration. Lower-level adapters remain in `services.feishu_adapter`, `services.jira_rest`, and `services.integration_gateway`.

### 2. Signatures
- Orchestration module: `services.release_loop`.
- Start operation: `start_feishu_jira_analysis(db, feishu_outcome, jira_http_client, jira_connector, jira_credentials, creator_id, task_number_allocator=...)`.
- Write-back operation: `write_back_task_run_to_jira(db, jira_http_client, jira_connector, jira_credentials, issue_key, task_run, task, output_text=None)`.
- Local records:
  - `Message` records the Feishu-originated request.
  - `Task` stores Jira source metadata in `data`.
  - `TaskRun` is created by `create_task_assignment_and_run`.

### 3. Contracts
- Only `FeishuDispatchOutcome(status="accepted", command.kind="jira_analysis")` may start this loop.
- Jira lookup must use `services.jira_rest.fetch_jira_issue`.
- TaskRun creation must use `services.task_runs.create_task_assignment_and_run`.
- External event linking must use `services.integration_gateway.link_external_event`.
- Jira issue/comment mappings must use `services.jira_rest.map_jira_issue` / `map_jira_comment`.
- The orchestration service creates TaskRun state but must not execute daemon/runtime/provider work directly.
- Jira lookup/write-back failures must be wrapped in release-loop failure codes while preserving the original Jira cause code.

### 4. Validation & Error Matrix
- Non-accepted Feishu outcome -> `RELEASE_LOOP_FEISHU_OUTCOME_NOT_ACCEPTED`.
- Unsupported command -> `RELEASE_LOOP_UNSUPPORTED_COMMAND`.
- Accepted route without channel -> `RELEASE_LOOP_ROUTE_CHANNEL_MISSING`.
- Accepted route without assignee -> `RELEASE_LOOP_ASSIGNEE_MISSING`.
- Jira lookup failure -> `RELEASE_LOOP_JIRA_LOOKUP_FAILED` with `cause_code`.
- Jira comment failure -> `RELEASE_LOOP_JIRA_WRITEBACK_FAILED` with `cause_code`.

### 5. Good/Base/Bad Cases
- Good: accepted `@SmallKhoj 分析 JIRA-123` creates a channel message, task, TaskRun, Jira issue mapping, and links the external event to local ids.
- Good: completed TaskRun output appends a Jira comment and maps `task_run -> jira comment`.
- Base: Jira write-back fails; local TaskRun output remains available and the caller receives a structured failure.
- Bad: release orchestration calling daemon control or runtime providers directly.
- Bad: storing Jira/Feishu state only in `Task.data` without external mappings.
- Bad: treating this service as the production Feishu long-connection worker; it is the business orchestration boundary.

### 6. Tests Required
- Reject invalid Feishu outcomes.
- Accepted command creates message/task/run and links external event ids.
- Jira issue/comment mappings are created.
- Jira lookup/write-back failures expose release-loop and cause codes.
- Boundary test proving no daemon/runtime execution helpers are imported directly.

### 7. Wrong vs Correct
#### Wrong
```text
Feishu accepted command -> Jira lookup -> daemon command -> Jira comment
```

#### Correct
```text
Feishu accepted command -> Jira lookup -> Message/Task/TaskRun state -> daemon runtime later executes TaskRun -> release_loop write-back maps Jira comment
```

## Scenario: TaskRun Terminal External Write-Back Hook

### 1. Scope / Trigger
- Trigger: wiring TaskRun terminal lifecycle updates to Feishu/Jira/external write-back.
- Use this when a runtime reports `completed`, `failed`, or `cancelled` through the daemon-facing TaskRun lifecycle API.

### 2. Signatures
- Service module: `services.task_run_writeback`.
- Hook operation: `handle_terminal_task_run_writeback(db, task_run, output_text=None, dependencies=None)`.
- Router integration: `routers.agent_api.update_task_run_lifecycle_endpoint`.
- Dependency object: `TaskRunWritebackDependencies(jira_http_client, jira_credentials_resolver)`.

### 3. Contracts
- Only terminal TaskRun statuses may trigger external write-back.
- Local TaskRun lifecycle update remains authoritative. Provider write-back failures must not roll back or erase local TaskRun status/output evidence.
- Use `external_mappings` for idempotency. A `task_run -> jira comment` mapping means the run has already been written back.
- Discover Jira issue context through the linked `external_events` row and the task's `task -> jira issue` mapping.
- Jira credentials must come from runtime injection or a secret resolver. Do not read or store API tokens in committed connector config.
- Router code may call the hook, but provider-specific request construction belongs in service modules.
- If `TaskRun.output_message_id` is present and no explicit output text is passed, load the output message content for the Jira comment.
- The hook must not import daemon/runtime execution helpers or start provider work.

### 4. Validation & Error Matrix
- Non-terminal status -> `TASK_RUN_WRITEBACK_NON_TERMINAL`, no write-back query chain.
- Existing Jira comment mapping -> `TASK_RUN_WRITEBACK_ALREADY_WRITTEN`.
- Missing linked event/task/Jira issue mapping -> `TASK_RUN_WRITEBACK_NO_JIRA_ISSUE`.
- Missing Jira connector -> `TASK_RUN_WRITEBACK_NO_JIRA_CONNECTOR`.
- Missing Jira HTTP client -> `TASK_RUN_WRITEBACK_NO_JIRA_HTTP_CLIENT`.
- Missing Jira credentials resolver or resolver result -> `TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS`.
- Jira append failure -> `TASK_RUN_WRITEBACK_JIRA_FAILED` and linked external event becomes `writeback_failed`.
- Successful append -> `TASK_RUN_WRITEBACK_WRITTEN`, `task_run -> jira comment` mapping, and linked external event becomes `completed`.

### 5. Good/Base/Bad Cases
- Good: completed Feishu-originated Jira analysis run loads the output message content, appends one Jira comment, maps the comment, and marks the external event completed.
- Good: repeated lifecycle reports for the same completed run see the existing comment mapping and skip without creating duplicate Jira comments.
- Base: production secret wiring is not ready; hook returns a structured missing-credentials outcome while the TaskRun update still commits.
- Bad: calling Jira directly from the lifecycle router.
- Bad: using `Task.data` as the only Jira write-back marker.
- Bad: making TaskRun completion fail because Jira is temporarily unavailable.

### 6. Tests Required
- Non-terminal skip.
- Terminal success with fake Jira HTTP client.
- Output message content is used when explicit output text is not passed.
- Existing comment mapping skips duplicate write-back.
- Missing credentials returns a structured skip.
- Jira failure marks linked external event `writeback_failed`.
- Lifecycle endpoint invokes the hook for terminal states and still commits when the hook reports failure.
- Boundary test proving the hook service does not import daemon/runtime execution helpers.

### 7. Wrong vs Correct
#### Wrong
```text
TaskRun lifecycle endpoint -> append Jira comment inline -> fail request on Jira outage
```

#### Correct
```text
TaskRun lifecycle endpoint -> update local TaskRun -> services.task_run_writeback handles provider side effect -> commit local state with writeBack outcome
```

## Scenario: Jira Write-Back Runtime Dependency Bridge

### 1. Scope / Trigger
- Trigger: making the TaskRun terminal write-back hook usable in a single-instance release deployment before a full secret manager exists.
- Use this for backend settings, env-based Jira credentials, and HTTP client wiring into `services.task_run_writeback`.

### 2. Signatures
- Settings: `config.Settings.jira_email`, `config.Settings.jira_api_token`.
- Runtime module: `services.integration_runtime`.
- Dependency builder: `build_task_run_writeback_dependencies(configured_settings=settings)`.
- Credential resolver: `resolve_jira_writeback_credentials(connector, configured_settings=settings)`.
- Cleanup helper: `close_task_run_writeback_dependencies(dependencies)`.

### 3. Contracts
- Jira `siteUrl` remains non-secret `ExternalConnector.config` data.
- Jira email/API token come from runtime settings or a future secret resolver, not from connector config, external events, task data, or mappings.
- Missing or incomplete Jira credentials return `None` from the resolver so the write-back hook can emit `TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS`.
- The production dependency builder uses `httpx.AsyncClient(trust_env=False)` to avoid accidental proxy/environment coupling.
- Endpoint code that creates a per-request write-back HTTP client must close it after the hook returns or raises.
- This bridge is a release-stage single-instance mechanism, not the final tenant-aware secret manager.

### 4. Validation & Error Matrix
- Both `JIRA_EMAIL` and `JIRA_API_TOKEN` empty -> resolver returns `None`.
- Only one Jira credential present -> resolver returns `None`.
- Both credentials present -> resolver returns `{email, apiToken}` with whitespace stripped.
- Dependency builder returns a `TaskRunWritebackDependencies` object with Jira HTTP client and credentials resolver.
- Endpoint terminal lifecycle path passes dependencies into the write-back hook and closes the owned HTTP client.

### 5. Good/Base/Bad Cases
- Good: deployment sets `JIRA_EMAIL` and `JIRA_API_TOKEN`; TaskRun completion can append a Jira comment through the existing mapping-driven hook.
- Base: deployment does not set Jira credentials; TaskRun completion still commits locally and returns a structured missing-credentials writeBack outcome.
- Bad: storing Jira API tokens in `external_connectors.config` or `.trellis` task artifacts.
- Bad: relying on system proxy env vars for Jira write-back behavior in the release path.

### 6. Tests Required
- Settings expose safe empty defaults.
- Resolver returns `None` for incomplete credentials and normalized credentials for complete settings.
- Dependency builder exposes client + resolver and can be closed.
- Lifecycle endpoint passes dependencies into `handle_terminal_task_run_writeback` and closes the owned client.

### 7. Wrong vs Correct
#### Wrong
```text
ExternalConnector.config = {"siteUrl": "...", "apiToken": "..."}
```

#### Correct
```text
ExternalConnector.config = {"siteUrl": "..."}
JIRA_EMAIL / JIRA_API_TOKEN -> services.integration_runtime -> TaskRunWritebackDependencies
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
