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

## Scenario: Alembic Schema Authority and Legacy Adoption

### 1. Scope / Trigger
- Trigger: any table/column/index/constraint/extension/identity change, application startup change, or adoption of a database created before Alembic.
- Alembic revision files are the only deployed schema writers. ORM metadata maps the schema; `models/seed.py` performs data-only idempotent seeds/backfills.

### 2. Signatures
- Fresh/known database: `cd backend && uv run alembic upgrade head`.
- Read-only legacy fingerprint: `DATABASE_URL=<explicit-url> uv run python -m scripts.legacy_schema_preflight`.
- Compatible legacy adoption: `uv run alembic stamp 77b8b147f689` followed by `uv run alembic upgrade head`.
- Current chain: `77b8b147f689 -> 0002_messages_seq -> 0003_messages_seq_auto -> 0004_template_tenancy`.
- Runtime guard: `services.schema_readiness.assert_schema_at_head(db)`.
- Isolated migration test env: `SMALLKHOJ_MIGRATION_TEST_ADMIN_URL` and `SMALLKHOJ_MIGRATION_TEST_DATABASE_URL`.

### 3. Contracts
- Docker/local-prod runs `alembic upgrade head` before uvicorn. Direct uvicorn performs a read-only exact-head check and refuses missing/behind/unknown revisions.
- FastAPI lifespan and runtime seed code must not call `Base.metadata.create_all` or execute schema DDL.
- Legacy fingerprint reads required tables, version state and the complete structural
  definitions needed to identify historical 0001: column type/nullability/default /
  identity; index table/key order/uniqueness/access method/predicate; primary, unique,
  check and foreign-key columns/targets/delete actions. Matching object names alone is
  never compatibility evidence. It never stamps automatically and rejects
  post-baseline objects already present in an otherwise unversioned database.
- SQL definition normalization may remove harmless casing, quoting, qualification,
  whitespace, parentheses and text-cast noise only outside quoted semantic tokens.
  String literal contents and case-sensitive quoted identifiers remain byte-for-byte
  significant; for example, `'open'` and `'OPEN'` are different defaults.
- A baseline membership check is compatible only when the complete top-level predicate
  is the expected single-column `IN (...)` or PostgreSQL `= ANY (ARRAY[...])` form.
  Boolean inversion or wrapping such as `(role IN (...)) = FALSE` is incompatible even
  when the column and literal set otherwise match.
- Legacy fingerprint compares with historical `0001`, not terminal `Base.metadata`. Each later revision must register its added columns/indexes/constraints in the preflight post-baseline exclusion sets, while baseline-only objects such as `uq_task_run_templates_slug` remain required before stamping.
- The only valid legacy stamp target is baseline `77b8b147f689`; `stamp head` is forbidden.
- `messages.seq` transitions through `0002_messages_seq` (`BY DEFAULT` plus atomic historical high-water alignment) and `0003_messages_seq_auto` (final alignment plus `ALWAYS`). Production writers omit `seq`.
- `0004_template_tenancy` classifies repository-known builtins as `server_id NULL`, backfills `server/user` rows from a valid creator Member, replaces global slug uniqueness with builtin and `(server_id, slug)` partial unique indexes, and enforces `ck_task_run_templates_tenant_scope`.
- Downgrading `0004` to `0003` first checks for duplicate slugs across tenants. Such
  rows are legal at `0004` but cannot be represented by `0003`'s global unique
  constraint, so the migration raises
  `TEMPLATE_TENANCY_DOWNGRADE_SLUG_COLLISION` before any DDL. It never deletes,
  merges, or silently renames templates.

### 4. Validation & Error Matrix
- Missing `alembic_version` at app startup -> refuse startup and name the migration/preflight command.
- Current revision differs from the checkout's unique head -> refuse startup; do not create missing objects.
- Legacy fingerprint missing a required object, containing a same-name definition
  mismatch, already containing post-baseline/identity/version state, or using an
  unsupported check shape -> incompatible; make zero writes.
- A quoted default or index-predicate literal differs only by case/content ->
  definition mismatch; a membership check has any outer boolean operator -> check
  mismatch. Neither case may create or stamp `alembic_version`.
- Migration lock/DDL/constraint failure -> deployment stops before uvicorn.
- Ambiguous legacy template (unknown builtin or non-builtin without a valid creator Member) -> transactional `0004` failure; revision remains `0003`, `server_id` and partial indexes remain absent, and an operator must explicitly classify the row before retry.
- Cross-Server duplicate template slug during `0004 -> 0003` -> fail before DDL;
  revision remains `0004`, `server_id` and tenant indexes remain present. After an
  operator explicitly renames or merges the collision, retrying the downgrade may
  restore the global `uq_task_run_templates_slug` constraint.
- Migration test URLs absent -> local optional suite may skip; the required release command supplies explicit isolated URLs and permits no skip.

### 5. Good/Base/Bad Cases
- Good: empty disposable PostgreSQL -> actual revisions -> head -> application starts.
- Good: compatible unversioned legacy schema -> read-only preflight -> operator-reviewed baseline stamp -> upgrade head.
- Good: two Server-owned human templates use the same slug; a duplicate inside one Server fails.
- Good: an operator resolves cross-Server duplicate slugs explicitly, then downgrade
  restores the `0003` global slug constraint without losing a template.
- Base: already-versioned database runs ordinary upgrade and exact-head readiness.
- Bad: `Base.metadata.create_all` as startup fallback or migration proof.
- Bad: `alembic stamp head`, automatic stamp on fingerprint failure, or destructive tests against a shared database.
- Bad: silently hide, delete, or guess the Server for an ambiguous legacy template so migration can continue.
- Bad: let downgrade discover duplicate slugs only after dropping tenant indexes, or
  choose an arbitrary tenant row to keep.

### 6. Tests Required
- Execute actual revisions for empty-to-head, baseline-to-head and legacy-preflight/baseline-stamp/head paths.
- Assert missing-object and same-name definition drift are rejected and
  `alembic_version` remains absent. Definition drift coverage includes columns,
  indexes, primary/unique/check constraints and foreign keys.
- Assert harmless PostgreSQL formatting of compatible definitions is accepted while
  case-changed quoted literals and boolean-inverted/wrapped `IN`/`= ANY` checks are
  rejected read-only.
- Seed historical message seq 1/2/3, then assert first implicit value is greater than 3.
- Seed an explicit transition value 100, apply final reconcile and assert the next implicit value is greater than 100.
- Commit concurrent implicit inserts and assert uniqueness; test all production writers omit `seq`.
- Assert startup seed source has no `create_all` or schema DDL.
- Execute `0003 -> 0004` with defensible builtins/human rows, then assert classification, partial indexes, tenant checks and scoped uniqueness. Execute an ambiguous case and assert full DDL/revision rollback.
- Execute `0004 -> 0003` with legal cross-Server duplicate slugs and assert the stable
  failure code, unchanged revision/column/index state, then explicitly resolve the
  duplicate and assert successful downgrade plus restored global uniqueness.

### 7. Wrong vs Correct
#### Wrong
```text
uvicorn startup -> create_all/handwritten ALTER -> stamp head -> schema appears current
```

#### Correct
```text
deployment -> alembic upgrade head -> read-only exact-head guard -> data-only seed -> runtime
legacy -> read-only fingerprint -> explicit baseline stamp -> upgrade head
```

```text
wrong: ambiguous template -> stamp head / guess tenant
correct: ambiguous template -> transactional STOP -> operator classification -> rerun 0004
```

## Scenario: Destructive Writes with Tombstone Audit and Local Blob Compensation

### 1. Scope / Trigger
- Trigger: deleting an entity referenced by ActivityLog/EventRecord, deleting a
  database row that owns a local filesystem blob, or deleting a parent such as an
  Agent/Member/Channel whose cascade or helper removes `FileEntry` rows.

### 2. Signatures
- Task API: `DELETE /api/v1/tasks/{task_id}` -> `{deleted, taskId, taskNumber}`.
- File API: `DELETE /api/v1/files/{file_id}` -> `{deleted, fileId, storageCleanup: "deleted" | "quarantined"}`.
- Parent APIs: `DELETE /api/v1/members/{agent_id}` and
  `DELETE /api/v1/channels/{channel_id}` report deleted file count plus
  `storageCleanup: "deleted" | "quarantined"`.
- Durable UI events: `task.deleted`, `file.deleted`; runtime delivery classification is false.

### 3. Contracts
- Capture primitive UUID/number/name/channel fields before DELETE or rollback can expire ORM state.
- Delete saved/dependent/entity rows first; write deletion ActivityLog/EventRecord with the deleted entity FK set to `NULL`.
- Preserve the old ID only in `details.tombstone` / `payload.tombstone` and top-level JSON routing fields such as `payload.taskId`.
- Commit before browser publication. Rollback leaves entity, dependencies and audit mutually consistent.
- Local file deletion uses quarantine-then-delete: atomically move the blob under `UPLOAD_ROOT/.deleted`, commit DB deletion, then purge. DB failure restores the original path; purge failure returns `storageCleanup="quarantined"` and never claims filesystem atomicity.
- Parent deletion enumerates the complete `FileEntry` set before DML, including
  member-upload cascades, deleted Channel/DM files, and deleted-message attachments.
  It quarantines the batch before DB deletion, restores every already-moved blob if
  quarantine setup or commit fails, and purges every quarantine entry after commit.
  SavedItem references for those files are deleted explicitly; they must not become
  untyped orphans merely because `SavedItem.item_id` has no file foreign key.

### 4. Validation & Error Matrix
- Non-admin deletion -> `403`, no entity/audit/storage mutation.
- Missing or foreign-server ID -> `404`, no existence disclosure.
- Unsafe/missing file path -> fail before DB mutation.
- DB commit failure after quarantine -> rollback and restore original blob; no success response.
- Post-commit quarantine purge failure -> DB remains deleted and response says `quarantined`.
- A later file in a parent-delete batch cannot be quarantined -> restore earlier files
  and make no database mutation.
- Parent-delete commit failure -> rollback all rows/audit and restore every original
  blob path.

### 5. Good/Base/Bad Cases
- Good: Task dependencies cascade, old nullable references become NULL, new tombstone event has `task_id=NULL`, then committed event publishes.
- Good: File blob is quarantined before metadata deletion and disappears after successful purge.
- Good: deleting an Agent or Channel removes every affected FileEntry/SavedItem and
  blob using the same compensation boundary as explicit file deletion.
- Base: purge fails after commit; the blob remains only in non-served quarantine and the response reports it.
- Bad: delete Task then insert ActivityLog/EventRecord with `task_id=<deleted UUID>`.
- Bad: unlink blob after commit and always return success without reporting cleanup failure.
- Bad: rely on `files.uploaded_by ON DELETE CASCADE` or helper-level `DELETE FROM
  files` while leaving `storage_path` on disk.

### 6. Tests Required
- Real PostgreSQL authenticated route tests for owner/admin success, member denial, missing/foreign scope and forced commit rollback.
- Assert Task, assignment/run and saved-item state; old FK `SET NULL`; new Activity/Event tombstone JSON with NULL FK.
- Assert File saved-item removal, memory `file_id SET NULL`, blob purge, quarantine fallback and DB-failure restoration.
- Assert event publication observes committed state from an independent connection.
- Assert daemon runtime allowlist rejects dotted and legacy deletion event names.
- Real PostgreSQL parent-delete tests cover Agent cascade, Channel helper deletion,
  commit rollback/restore, partial batch-quarantine compensation, SavedItem cleanup,
  and truthful post-commit quarantine reporting.

### 7. Wrong vs Correct
#### Wrong
```python
await db.execute(delete(Task).where(Task.id == task.id))
await _record_activity(..., task_id=task.id)  # FK violation / rollback
```

#### Correct
```python
tombstone = {"taskId": str(task.id), "taskNumber": task.task_number, "title": task.title}
await db.execute(delete(Task).where(Task.id == task.id))
await _record_activity(..., details={"taskId": tombstone["taskId"], "tombstone": tombstone}, task_id=None)
await db.commit()
await publish_committed_events()
```

## Scenario: Server Account Membership Foundation

### 1. Scope / Trigger
- Trigger: adding or changing human account, Server/workspace, channel privacy, Computer onboarding, or Agent creation flows.
- Use this whenever a public human API route needs to read or mutate Server-owned data.

### 2. Signatures
- Tables:
  - `server_memberships(server_id, account_id, member_id, role, status)`.
  - `server_invites(server_id, token_hash, role, channel_id, expires_at, revoked_at, accepted_at, accepted_account_id)`.
- Service module: `services.server_membership`.
- Active Server resolver: `resolve_active_server_context(db, account, requested_server_id=None)`.
- Public API wrapper: `routers.public_api._resolve_active_server_context(db, request)`.
- Actor resolver: `routers.public_api._resolve_human_actor(...) -> Member`.
- Bootstrap owner serialization: every default-Server owner-election entrypoint calls
  `services.server_membership.acquire_owner_election_lock(db)`, which acquires the
  same PostgreSQL transaction-scoped advisory lock and holds it through commit or
  rollback.

### 3. Contracts
- `Server` is the product-level team/workspace boundary. Do not introduce another workspace abstraction for the same scope.
- Existing `Account.server_id` and `Account.member_id` remain as compatibility mirrors; new authorization must use `server_memberships`.
- Human public API routes must resolve the active Server from the current account membership, not `select(Server).limit(1)`.
- Actor input is normalized once inside the active Server. Omission, exact display, `@display`, and viewer UUID resolve to the same canonical Member UUID; authorization compares UUIDs and actor lookup never creates a Member.
- Installation bootstrap registration takes the transaction-scoped advisory lock before checking for an active owner. One concurrent winner becomes owner and later successful registrations become members. Explicit creation of a new Server remains a separate per-Server owner rule.
- `X-Server-Id` may select an active Server only when the current account has an active membership for that Server.
- Owner/admin role is required for initial Computer/Agent administration paths.
- Computer identity is currently Server-scoped. Daemon connect resolves or creates `Computer` by `server_id + machine_id`; the same physical `machine_id` under two Servers produces two `computers` rows.
- Do not treat `machine_id` as a global physical-device identifier unless a product/architecture change introduces a global machine identity and per-Server binding layer.
- Private and DM channels require `channel_members` membership for read/write visibility.
- Alembic revisions create membership/invite schema; the data-only runtime seed may idempotently backfill existing accounts from `accounts.server_id` / `accounts.member_id` after the revision guard passes.

### 4. Validation & Error Matrix
- Account selects a Server without active membership -> `403`.
- Missing session for human Server route -> `401`.
- Non-owner/admin creates Agent or Computer connect command -> `403`.
- Private channel read/write by non-member -> `403`.
- Agent creation with a Computer from another Server -> `404`.
- Same daemon `machine_id` connecting with tickets from two different Servers -> two Server-local `Computer` rows, not one global row.
- Existing account without a membership after deployment migration -> startup backfill should create one.
- Foreign actor alias/UUID -> `403`; ambiguous case-insensitive alias -> `400`; unknown/cross-Server reference -> non-disclosing `404`.
- Concurrent first registrations -> both may succeed, but committed bootstrap scope contains exactly one owner. Rollback releases the lock and leaves no Account/Member/Membership orphan.

### 5. Good/Base/Bad Cases
- Good: login creates or reuses an Account and ensures an active `server_memberships` row.
- Good: channel message read/write resolves `context.server` and checks private channel membership before returning content.
- Good: Agent creation verifies both owner/admin role and selected-Server Computer ownership.
- Good: daemon connect reuses a Computer only inside the ConnectTicket's Server scope.
- Good: every legal self alias resolves to the membership Member UUID before authorization.
- Good: two independent first-signup transactions commit one owner and one member; rollback/retry can still produce the first owner.
- Base: compatibility fields continue to point at the primary Server/member until the UI fully supports switching.
- Bad: `server = await _get_server(db)` in an authenticated human route.
- Bad: accepting `X-Server-Id` without checking `server_memberships`.
- Bad: using `machine_id` alone to decide that a Computer belongs to the active Server.
- Bad: authorize `actor`, `sender`, or `creator` by comparing raw text, or auto-create a Member from untrusted actor input.
- Bad: choose owner with application `SELECT` then `INSERT` without a cross-process PostgreSQL serialization primitive.

### 6. Tests Required
- Metadata test for `server_memberships` and `server_invites`.
- Seed DDL/backfill test for existing `accounts.server_id` and `accounts.member_id`.
- Active Server resolver rejects non-member Server selection.
- Private channel access rejects non-members.
- Computer/Agent scoping rejects cross-Server Computer binding.
- Static or route-level test proving migrated human routes call active Server resolution instead of `_get_server()`.
- Actor matrix covers omitted/display/handle/UUID self forms, every foreign form, ambiguity, unknown input and cross-Server UUID without creation side effects.
- Real PostgreSQL tests use independent transactions, repeat the bootstrap race, inspect committed roles, and cover rollback/retry/no-orphan state.

### 7. Wrong vs Correct
#### Wrong
```text
human route -> _get_server() -> first Server -> query channels/messages/computers
```

#### Correct
```text
human route -> current account token -> server_memberships -> active Server context -> scoped query
```

```text
wrong: raw actor string / stale owner read -> authorize or insert
correct: scoped canonical Member UUID / pg advisory xact lock -> authorize or assign role
```

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
- ORM declarations in `backend/models/slock.py` and an ordered Alembic revision must be updated in the same schema change; never add gateway DDL to `backend/models/seed.py`.
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

## Scenario: Feishu Raw Event Loop Handler

### 1. Scope / Trigger
- Trigger: adding the service boundary a Feishu/Lark long-connection worker calls after receiving a raw message event payload.
- Use this before implementing production worker transport code so SDK callbacks stay thin and business flow remains testable.

### 2. Signatures
- Service module: `services.feishu_event_loop`.
- Entry operation: `process_feishu_raw_event(db, raw_event, server_id, feishu_connector_id, jira_connector, creator_id, jira_http_client, jira_credentials, feishu_http_client, feishu_reply_config, bot_open_id=None, bot_name=None)`.
- Structured outcome: `FeishuEventLoopOutcome(status, reason_code, reason, dispatch_outcome, release_result, accepted_reply, failure_code, failure_reason)`.

### 3. Contracts
- Raw Feishu payloads must be normalized through `services.feishu_adapter.normalize_feishu_message` before dispatch or business logic reads message fields.
- Gateway dispatch must go through `services.feishu_adapter.dispatch_feishu_message`; this handler must not duplicate route, dedup, command, or addressing logic.
- Only `FeishuDispatchOutcome(status="accepted")` may start `services.release_loop.start_feishu_jira_analysis`.
- Duplicate, unknown-command, unaddressed-group, no-route, and disabled-route outcomes are passthrough outcomes and must not create local Message/Task/TaskRun work.
- `ReleaseLoopError` after an event is claimed must mark the external event `failed` through `services.integration_gateway.mark_external_event_failed`.
- Accepted Feishu reply failures are reported as `accepted_reply_failed` but must not roll back local release-loop state.
- The production long-connection worker should only resolve runtime dependencies and call this service. It should not own normalize/dispatch/release-loop/accepted-reply semantics.
- The handler must not execute provider/runtime work directly; TaskRun execution remains behind the existing TaskRun/daemon path.

### 4. Validation & Error Matrix
- Dispatch non-accepted -> return dispatch status with `FEISHU_EVENT_LOOP_DISPATCH_PASSTHROUGH`.
- Release-loop startup failure -> mark linked external event failed and return `FEISHU_EVENT_LOOP_RELEASE_FAILED` with the release-loop code/reason.
- Accepted reply send failure -> return `FEISHU_EVENT_LOOP_ACCEPTED_REPLY_FAILED`, preserving `release_result`.
- Accepted dispatch + release-loop + accepted reply success -> return `FEISHU_EVENT_LOOP_ACCEPTED`.

### 5. Good/Base/Bad Cases
- Good: long-connection worker receives a raw event, calls `process_feishu_raw_event`, and records a structured outcome for logs/metrics.
- Good: a duplicate Feishu message returns without Jira lookup, TaskRun creation, or Feishu accepted reply.
- Base: local Message/Task/TaskRun is created but Feishu accepted reply credentials are missing; local state remains the source of truth and the outcome exposes the reply failure.
- Bad: SDK callback calls Jira REST, creates TaskRun state, or sends Feishu replies inline outside the service.
- Bad: retrying accepted-reply failure by starting another release-loop run.

### 6. Tests Required
- Accepted raw event normalizes, dispatches, starts release loop, and sends accepted reply.
- Duplicate/drop passthrough does not start release-loop work.
- Release-loop failure marks the linked external event failed.
- Accepted-reply failure preserves `release_result`.
- Boundary test proving the handler does not import daemon/runtime execution helpers.

### 7. Wrong vs Correct
#### Wrong
```text
lark-oapi worker -> parse raw message -> Jira lookup -> create TaskRun -> Feishu reply
```

#### Correct
```text
lark-oapi worker -> services.feishu_event_loop.process_feishu_raw_event -> adapter/gateway -> release_loop -> reply orchestration
```

## Scenario: Feishu Worker Runtime Boundary

### 1. Scope / Trigger
- Trigger: making the Feishu/Lark long-connection entry deployable from runtime settings, a worker process, or an injected transport.
- Use this after the raw event loop exists and before wiring a real SDK callback or process manager hook.

### 2. Signatures
- Runtime module: `services.feishu_worker_runtime`.
- Settings: `feishu_worker_enabled`, `feishu_worker_connector_id`, `feishu_worker_jira_connector_id`, `feishu_worker_creator_id`, `feishu_worker_bot_open_id`, `feishu_worker_bot_name`, `feishu_worker_app_id`, `feishu_worker_app_secret`.
- Config resolver: `resolve_feishu_worker_config(configured_settings=settings)`.
- Connector resolver: `load_feishu_worker_connectors(db, config)`.
- Dependency builder: `build_feishu_worker_dependencies(configured_settings=settings)`.
- Event handler: `handle_feishu_worker_raw_event(db, raw_event, config, connectors, dependencies, close_dependencies=False)`.
- Test transport: `FakeFeishuEventTransport` plus `run_feishu_event_transport`.

### 3. Contracts
- Worker settings must have safe empty defaults. Committed examples may include empty placeholders only.
- Feishu app secrets, Jira API tokens, Feishu access tokens, and SDK credentials must come from runtime settings or a future secret manager, never connector config, event normalized payloads, task data, mappings, or `.trellis`.
- The worker runtime validates configured connector ids and app credentials before processing events.
- Feishu connector rows must have `provider="feishu"` and `status="active"`.
- Jira connector rows must have `provider="jira"` and `status="active"`.
- Jira credentials are resolved through runtime dependency injection; missing credentials are a structured worker failure before the raw event loop is called.
- Runtime event handling must delegate to `services.feishu_event_loop.process_feishu_raw_event`; it must not parse Feishu commands, resolve routes, construct Jira REST requests, create TaskRuns, or build reply text.
- SDK/WebSocket transport must stay behind an injected transport boundary. Unit tests must be able to feed raw events without importing a Feishu SDK or opening a network connection.
- Owned HTTP clients must be closed on success and failure when the handler owns dependencies.
- The worker runtime must not execute daemon/runtime/model work directly.

### 4. Validation & Error Matrix
- Missing Feishu connector id -> `FEISHU_WORKER_CONFIG_MISSING_CONNECTOR_ID`.
- Missing Jira connector id -> `FEISHU_WORKER_CONFIG_MISSING_JIRA_CONNECTOR_ID`.
- Missing creator id -> `FEISHU_WORKER_CONFIG_MISSING_CREATOR_ID`.
- Invalid UUID -> `FEISHU_WORKER_CONFIG_INVALID_UUID`.
- Missing app id/secret -> `FEISHU_WORKER_CONFIG_MISSING_APP_CREDENTIALS`.
- Missing connector row -> `FEISHU_WORKER_CONNECTOR_NOT_FOUND`.
- Wrong connector provider -> `FEISHU_WORKER_CONNECTOR_PROVIDER_MISMATCH`.
- Disabled connector -> `FEISHU_WORKER_CONNECTOR_DISABLED`.
- Missing Jira credentials -> `FEISHU_WORKER_JIRA_CREDENTIALS_MISSING`.
- Raw event loop exception -> `FEISHU_WORKER_EVENT_LOOP_FAILED`.
- Successful event handoff -> `FEISHU_WORKER_EVENT_PROCESSED`.

### 5. Good/Base/Bad Cases
- Good: a worker process loads runtime settings, resolves active Feishu/Jira connector rows, receives a raw Feishu event from SDK transport, and calls the raw event loop once.
- Good: local tests use `FakeFeishuEventTransport` to prove event handoff and dependency cleanup without real Feishu credentials.
- Base: worker settings are incomplete; startup/health can report a stable config failure and no local work is created.
- Bad: storing Feishu app secret in `ExternalConnector.config`.
- Bad: SDK callback parses `分析 JIRA-123` itself or calls Jira/TaskRun services directly.
- Bad: leaving per-event HTTP clients open after an event-loop failure.

### 6. Tests Required
- Safe default settings for worker runtime.
- Missing config and invalid connector outcomes.
- Active Feishu/Jira connector resolution.
- Event handler delegates all required dependencies into `process_feishu_raw_event`.
- Missing Jira credentials skips raw event processing.
- Owned client cleanup on success and failure.
- Fake transport feeds raw events without SDK imports.
- Boundary test proving no daemon/runtime execution helpers are imported.

### 7. Wrong vs Correct
#### Wrong
```text
Feishu SDK callback -> parse command -> Jira lookup -> create TaskRun -> send reply
```

#### Correct
```text
Feishu SDK callback -> worker runtime dependency wrapper -> process_feishu_raw_event -> existing service boundaries
```

## Scenario: Feishu Channel SDK Transport Boundary

### 1. Scope / Trigger
- Trigger: wiring the deployable Feishu/Lark Channel SDK long-connection callback into the worker runtime.
- Use this after `services.feishu_worker_runtime` exists and before adding a process manager, FastAPI lifespan hook, or live Feishu smoke test.

### 2. Signatures
- Transport module: `services.feishu_channel_transport`.
- Dependency: `lark-channel-sdk` with import path `lark_channel`.
- Lazy channel factory: `create_feishu_channel(config)`.
- SDK converter: `sdk_message_to_raw_event(message, config)`.
- Transport class: `FeishuChannelSDKTransport(channel, config, connectors, db_factory, dependencies_factory)`.
- Worker entrypoint: `run_feishu_channel_worker(db_factory, configured_settings=settings, channel_factory=create_feishu_channel, dependencies_factory=build_feishu_worker_dependencies)`.

### 3. Contracts
- SDK imports must stay lazy inside the channel factory so non-transport backend imports and tests do not require a live SDK import path.
- The SDK adapter owns Channel construction, message callback registration, connect, and disconnect only.
- SDK callback messages must be converted into the raw Feishu event shape accepted by `services.feishu_adapter.normalize_feishu_message`.
- The converter should preserve event id, message id, chat id/type, sender open id, content text, mentions, thread/root/parent ids, and create time when available.
- Transport callbacks must call `services.feishu_worker_runtime.handle_feishu_worker_raw_event` with close-owned dependencies.
- Transport callbacks must open and close one DB session per incoming message when `db_factory()` returns an async context manager such as `models.async_session()`. Direct fake DB objects may remain supported for unit tests.
- Transport code must not parse Feishu commands, resolve routes, construct Jira REST requests, create TaskRuns, or build Feishu reply text.
- Unit tests must use fake channel objects and must not open real Feishu network connections.
- Worker entrypoint config/connector failures must return structured startup outcomes before channel creation or connection.

### 4. Validation & Error Matrix
- Missing SDK import -> `FEISHU_CHANNEL_TRANSPORT_SDK_MISSING`.
- Runtime config failure -> `FEISHU_CHANNEL_TRANSPORT_CONFIG_FAILED`.
- Connector resolution failure -> `FEISHU_CHANNEL_TRANSPORT_CONNECTOR_FAILED`.
- Channel connect/creation failure -> `FEISHU_CHANNEL_TRANSPORT_START_FAILED`.
- Successful channel start -> `FEISHU_CHANNEL_TRANSPORT_STARTED`.

### 5. Good/Base/Bad Cases
- Good: `lark_channel.FeishuChannel` receives a message and the adapter forwards exactly one raw event into the worker runtime.
- Good: tests inject a fake channel whose `on("message", handler)` callback can be invoked without SDK credentials.
- Base: deployment has missing connector ids; worker startup returns a structured config failure and never creates a channel.
- Bad: importing `lark_channel` at module import time and breaking all backend tests when the optional transport dependency is unavailable.
- Bad: SDK callback parses `分析 JIRA-123` or calls Jira/TaskRun services directly.
- Bad: transport adapter hides connector/config errors behind a generic exception string that cannot be used for health checks.

### 6. Tests Required
- SDK message conversion feeds existing Feishu normalizer.
- Transport registers a message handler and forwards raw events into worker runtime.
- Connect/disconnect calls are delegated to the underlying channel object.
- Channel factory lazy-import behavior is covered.
- Worker entrypoint returns config/connector failures without connecting.
- Message callback enters and exits an async DB context around `handle_feishu_worker_raw_event`.
- Boundary test proving no daemon/runtime or Jira/TaskRun business helpers are imported.

### 7. Wrong vs Correct
#### Wrong
```text
FeishuChannel.on("message") -> parse command -> fetch Jira -> create TaskRun
```

#### Correct
```text
FeishuChannel.on("message") -> sdk_message_to_raw_event -> handle_feishu_worker_raw_event -> existing raw event loop
```

## Scenario: Initial Release Integration Bootstrap CLI

### 1. Scope / Trigger
- Trigger: preparing a real 7-15 Feishu/Jira live-run by creating connector/route rows and worker env guidance.
- Use this when an operator needs stable Feishu/Jira connector IDs and a Feishu `jira_analysis` route without manually editing the database.

### 2. Signatures
- Service module: `services.integration_bootstrap`.
- CLI module: `integration_bootstrap_cli`, run from `backend/` with `python -m integration_bootstrap_cli`.
- Request fields: `server_id`, `channel_id`, `creator_id`, `assignee_id`, `feishu_chat_id`, `feishu_chat_type`, `feishu_app_id`, `feishu_bot_open_id`, `feishu_bot_name`, `jira_site_url`.
- Connector upsert keys:
  - Feishu connector: `(server_id, provider="feishu", name)`.
  - Jira connector: `(server_id, provider="jira", name)`.
- Route upsert key: `(server_id, connector_id, name)`.
- Feishu route selector: `{"chatId": ..., "chatType": ..., "command": "jira_analysis"}`.
- TaskRun DB compatibility: `task_assignments.assignment_mode` must allow `external_feishu` in both `models/slock.py` and the owning Alembic baseline/follow-up revision.

### 3. Contracts
- Bootstrap requires existing `Server`, `Channel`, creator `Member`, and assignee `Member` rows. It must not silently create product identity records.
- Referenced channel and members must belong to the selected server.
- Bootstrap may create/update `ExternalConnector`, `ExternalRoute`, and `ChannelMember` rows only after required references validate.
- Bootstrap is idempotent for the same connector and route names; repeat runs update non-secret config and route targets instead of creating duplicates.
- Persisted connector config may include Feishu app ID, bot open ID, bot name, and Jira site URL.
- Persisted connector config must not include Feishu app secret, Feishu access tokens, Jira API token, Tencent Cloud credentials, or daemon connect tokens.
- CLI output must include env names expected by `services.feishu_worker_runtime.resolve_feishu_worker_config`, with placeholders for secret values.
- The CLI must not expose flags for secret values such as `--feishu-app-secret` or `--jira-api-token`.

### 4. Validation & Error Matrix
- Missing server/channel/creator/assignee -> `BOOTSTRAP_REFERENCE_NOT_FOUND`, no connector or route writes.
- Channel or member from another server -> `BOOTSTRAP_REFERENCE_SCOPE_MISMATCH`, no connector or route writes.
- Existing disabled initial-release connector/route -> reactivate and update it because the operator explicitly requested bootstrap.
- Missing runtime Feishu/Jira credentials after bootstrap -> worker/runtime config errors, not bootstrap errors.
- Existing DB with old `task_assignments` mode constraint -> startup must drop/re-add `ck_task_assignments_mode` so `external_feishu` can persist.

### 5. Good/Base/Bad Cases
- Good: bootstrap creates active Feishu/Jira connector rows, creates a route matching `@SmallKhoj 分析 JIRA-123`, ensures creator/assignee are channel members, and prints worker env guidance.
- Good: running bootstrap twice with the same names does not create duplicate connector/route rows.
- Base: bootstrap succeeds without real app secrets; those are set only in runtime env before launching the worker.
- Bad: using SQL console edits to create connector IDs because the live-run path then cannot be reproduced on the server.
- Bad: storing `appSecret` or `apiToken` in `ExternalConnector.config`.
- Bad: changing `release_loop.py` to use a new assignment mode without updating ORM constraints, startup DDL, and regression tests.

### 6. Tests Required
- Bootstrap creates Feishu/Jira connectors and one Feishu route from existing references.
- Bootstrap reuses existing connector/route rows and updates them in place.
- Missing references fail before partial connector/route writes.
- Serialized bootstrap output includes required worker env keys and secret placeholders.
- CLI parser rejects secret flags.
- ORM and startup DDL tests assert `external_feishu` is present in `ck_task_assignments_mode`.

### 7. Wrong vs Correct
#### Wrong
```text
Manual DB rows -> copy connector IDs from psql history -> run worker with secrets stored in connector config
```

#### Correct
```text
python -m integration_bootstrap_cli -> non-secret connector/route rows + env guidance -> secrets only in runtime env -> Feishu worker launch
```

## Scenario: Feishu Worker Process CLI

### 1. Scope / Trigger
- Trigger: making the Feishu Channel SDK worker launchable as a long-running backend process from deployment/runtime env.
- Use this after integration bootstrap has created connector/route rows and before adding process supervision, Docker Compose service definitions, or live Feishu smoke tests.

### 2. Signatures
- CLI module: `feishu_worker_cli`, run from `backend/` with `python -m feishu_worker_cli`.
- CLI flags: `--pretty` only.
- Process runner: `run_worker_process(worker_runner=run_feishu_channel_worker, wait=_wait_forever, emit=print, pretty=False)`.
- Delegated worker: `services.feishu_channel_transport.run_feishu_channel_worker(db_factory=lambda: async_session())`.
- Startup JSON fields: `status`, `reasonCode`, `reason`.

### 3. Contracts
- CLI must be a process wrapper only. It must not parse Feishu messages, resolve routes, call Jira REST, create TaskRuns, or send Feishu replies.
- CLI must use existing settings/env loading through `config.Settings` and existing DB session wiring through `models.async_session`.
- CLI startup success prints one structured JSON line and then keeps the process alive until interrupted.
- CLI startup failure prints structured JSON and exits non-zero.
- CLI shutdown must call `transport.disconnect()` when the worker returned a transport.
- CLI must not expose secret flags such as `--feishu-app-secret`, `--jira-api-token`, or Feishu access token flags.
- Tests must inject worker and wait callables so no real Feishu connection or infinite wait is required.

### 4. Validation & Error Matrix
- Worker outcome `status="started"` -> print JSON, wait, disconnect on shutdown, exit `0`.
- Worker outcome not started -> print JSON, exit `2`.
- Worker runner raises -> `FEISHU_WORKER_CLI_FAILED`, exit `1`.
- Disconnect raises -> `FEISHU_WORKER_CLI_DISCONNECT_FAILED`, exit `1`.
- Operator Ctrl-C after startup -> disconnect and exit `0`.
- Secret-shaped CLI flag -> argparse rejection before any worker startup.

### 5. Good/Base/Bad Cases
- Good: deployment sets bootstrap IDs and secrets in env, then runs `python -m feishu_worker_cli`; the CLI starts the existing Channel SDK transport and waits.
- Good: startup config failure is visible as a JSON line suitable for logs/process supervisors.
- Base: SDK missing or connector disabled; delegated worker returns structured failure and CLI exits non-zero without retry loops.
- Bad: duplicating `resolve_feishu_worker_config` or `load_feishu_worker_connectors` logic in the CLI.
- Bad: adding `--app-secret` convenience flags and leaking secrets through shell history.
- Bad: swallowing Ctrl-C without disconnecting the transport.

### 6. Tests Required
- Success prints JSON, waits, and disconnects.
- Startup failure prints JSON and does not wait.
- KeyboardInterrupt path disconnects and exits cleanly.
- Disconnect failure reports structured JSON.
- Parser rejects secret flags.
- CLI `--help` loads without opening DB or Feishu network connections.

### 7. Wrong vs Correct
#### Wrong
```text
python -m feishu_worker_cli --app-secret xxx -> CLI parses messages and creates TaskRuns
```

#### Correct
```text
env/.env secrets -> python -m feishu_worker_cli -> run_feishu_channel_worker -> existing worker/runtime/event-loop services
```

## Scenario: Initial Release Live-Run Preflight CLI

### 1. Scope / Trigger
- Trigger: validating the release live-run setup before starting the Feishu long-connection worker or using real Feishu/Jira credentials in a live scenario.
- Use this after `integration_bootstrap_cli` and before `feishu_worker_cli`.

### 2. Signatures
- Service module: `services.live_run_preflight`.
- CLI module: `live_run_preflight_cli`, run from `backend/` with `python -m live_run_preflight_cli`.
- Request fields: `feishu_chat_id`, `feishu_chat_type`, `command`.
- CLI flags: `--feishu-chat-id`, `--feishu-chat-type`, `--command`, `--pretty`.
- Report shape: top-level `ready: bool` plus `checks[]` with `name`, `status`, `reasonCode`, `reason`, and optional `details`.

### 3. Contracts
- Preflight is read-only and no-network. It must not call Feishu, Jira, Tencent Cloud, daemon, or runtime providers.
- Worker settings must be validated through `resolve_feishu_worker_config`.
- Connector existence/provider/status must be validated through `load_feishu_worker_connectors`.
- Route readiness must be validated through `resolve_external_route` with `{chatId, chatType, command}`.
- Jira credentials are checked for presence through `resolve_jira_writeback_credentials`; preflight must not test them against Jira.
- Preflight must verify matched routes have `channel_id` and `default_assignee_id`, because the release loop requires both before TaskRun creation.
- CLI must not expose secret flags such as `--jira-api-token`, `--feishu-app-secret`, tenant access tokens, daemon tokens, or cloud credentials.

### 4. Validation & Error Matrix
- Worker config missing/invalid -> `ready=false`, worker config reason code, no DB queries required.
- Connector missing/wrong provider/disabled -> `ready=false`, worker connector reason code.
- Connector non-secret config invalid -> `LIVE_RUN_PREFLIGHT_CONNECTOR_CONFIG_INVALID` or Jira config code.
- Jira credentials absent -> `LIVE_RUN_PREFLIGHT_JIRA_CREDENTIALS_MISSING`.
- Route missing/disabled -> gateway route reason code.
- Route matched but missing channel or default assignee -> `LIVE_RUN_PREFLIGHT_ROUTE_TARGET_MISSING`.
- All checks passed -> top-level `ready=true`, CLI exit `0`.
- Preflight completed but not ready -> CLI exit `2`.
- Unexpected exception -> CLI exit `1`.

### 5. Good/Base/Bad Cases
- Good: after bootstrap and env setup, preflight reports worker config, connectors, connector config, Jira credentials, and Feishu route all passed.
- Base: Jira API token is missing; preflight reports not ready without attempting a Jira API call.
- Base: Feishu route exists but points to no assignee; preflight catches this before a real message creates a failed release loop.
- Bad: launching `feishu_worker_cli` first and discovering route/credential failures only after a live Feishu message.
- Bad: adding `--jira-api-token` convenience flags and leaking secrets through shell history.
- Bad: doing a real Jira issue lookup inside preflight.

### 6. Tests Required
- Ready preflight covers worker config, connectors, route, and credential presence without network calls.
- Missing worker config stops before DB.
- Missing/disabled route returns `ready=false`.
- Route without channel/assignee returns `ready=false`.
- Missing Jira credentials returns `ready=false`.
- CLI help loads without DB/network access and parser rejects secret-shaped flags.

### 7. Wrong vs Correct
#### Wrong
```text
python -m feishu_worker_cli -> live message arrives -> fails because route has no assignee
```

#### Correct
```text
integration_bootstrap_cli -> live_run_preflight_cli -> feishu_worker_cli -> live message
```

## Scenario: Initial Release Lighthouse Host Probe CLI

### 1. Scope / Trigger
- Trigger: validating a first Tencent Cloud Lighthouse, tunnel, or replacement host before installing packages, creating swap, opening ports, or starting the production compose stack.
- Use this before the production deploy preflight when the host itself has not been proven ready.

### 2. Signatures
- CLI module: `scripts/lighthouse_host_probe.py`, run from the repository root with `python3 scripts/lighthouse_host_probe.py`.
- Optional flags:
  - `--json`: emit machine-readable host evidence.
  - `--strict-warnings`: return code `2` when warnings exist.

### 3. Contracts
- Default mode must be read-only and must not install packages, create swap, change firewall rules, start services, or contact Tencent Cloud APIs.
- The command must inspect host package-manager access, sudo availability, CPU, memory, swap, disk, Docker, Docker Compose, local ports 80/443, and firewall tooling.
- The command may emit suggested bootstrap commands, but every suggested command must be marked as not executed.
- Ubuntu/Debian suggestions may include Docker official apt repository setup, a 2 GiB swapfile, and UFW `80/tcp` / `443/tcp` allow rules.
- The command must not require or print `.env.prod` secrets.

### 4. Validation & Error Matrix
- CPU below 2 cores -> warning.
- Memory below 1.5 GiB -> failed; below 2 GiB -> warning.
- Swap below 2 GiB or unknown -> warning.
- Disk free below 8 GiB -> failed; below 12 GiB -> warning.
- Missing Docker command, unavailable Docker daemon, or unavailable Docker Compose -> failed.
- Port 80 or 443 already accepts local TCP connections -> failed.
- Missing package manager, sudo, or firewall tooling -> warning because Tencent Cloud images and security groups vary.

### 5. Good/Base/Bad Cases
- Good: first SSH session runs `python3 scripts/lighthouse_host_probe.py --json` and saves the JSON before host mutation.
- Good: a 2 vCPU / 2 GiB host with no swap emits swapfile suggestions before live-run testing.
- Base: macOS/local development host reports package-manager/sudo/firewall warnings but still emits useful Docker/resource evidence.
- Bad: running install commands before recording host baseline and discovering later that memory, swap, disk, or ports were the real blocker.
- Bad: making the probe require Tencent Cloud credentials or a committed deployment env file.

### 6. Tests Required
- Unit tests cover resource classification, runtime dependency classification, suggested command generation, and warning/failed exit semantics.
- CLI smoke: host probe runs on the current machine and emits JSON.

### 7. Wrong vs Correct
#### Wrong
```text
ssh lighthouse
curl install docker ...
# no baseline, no swap/disk/port evidence
```

#### Correct
```text
python3 scripts/lighthouse_host_probe.py --json
# review warnings and suggested commands before any host mutation
```

## Scenario: Initial Release Tencent Cloud CLI Discovery

### 1. Scope / Trigger
- Trigger: discovering Tencent Cloud Lighthouse instance metadata, region, public IP, OS, status, login key IDs, or firewall-adjacent information before SSH host probe and deployment.
- Use this when console UI is blocked by login state or when repeatable evidence is preferred over manual console screenshots.

### 2. Signatures
- CLI binary: `tccli`.
- Recommended local install path for this machine: `/Volumes/ORICO/smallkhoj-tools/tccli-venv/bin/tccli`.
- Configuration command:
  - `tccli configure --profile smallkhoj-release`
- Read-only discovery commands:
  - `tccli lighthouse DescribeRegions --profile smallkhoj-release`
  - `tccli lighthouse DescribeInstances --profile smallkhoj-release --region <region> --Limit 20`
- Optional network proxy:
  - `--https-proxy http://127.0.0.1:7897`

### 3. Contracts
- Install `tccli` outside the repository; do not vendor it into project files.
- Store Tencent Cloud `SecretId` and `SecretKey` only in the local `tccli` profile, environment variables, or CI secrets. Never commit credentials or inline them in tracked commands.
- Use named profiles such as `smallkhoj-release` instead of relying on an ambiguous default profile during release work.
- `DescribeInstances` is read-only and may be used before any SSH/server mutation.
- `DescribeInstances` output is allowed release evidence after reviewing it for secrets. It includes fields such as `InstanceId`, `Zone`, `CPU`, `Memory`, `OsName`, `Platform`, `PrivateAddresses`, `PublicAddresses`, `InternetAccessible`, `LoginSettings.KeyIds`, `InstanceState`, `CreatedTime`, and `ExpiredTime`.
- If network access requires VPN, use `--https-proxy http://127.0.0.1:7897` for `tccli` host calls. Docker build containers still use `host.docker.internal:7897`.

### 4. Validation & Error Matrix
- Missing `tccli` -> install it into an external tools directory such as `/Volumes/ORICO/smallkhoj-tools/tccli-venv`.
- Missing credentials -> `tccli` cannot call Lighthouse APIs; configure a local profile or use explicit environment/CI secrets outside the repo.
- Wrong region -> `DescribeInstances` returns no target instance; run `DescribeRegions` and try likely regions such as `ap-guangzhou`, `ap-shanghai`, `ap-beijing`, or `ap-hongkong`.
- Browser console still at login page -> use CLI discovery once credentials exist, or have the operator complete login in the browser.
- SSL/proxy certificate errors while installing `tccli` through the local proxy -> use pip `--trusted-host pypi.org --trusted-host files.pythonhosted.org` only for installing into the external venv.

### 5. Good/Base/Bad Cases
- Good: operator configures `tccli --profile smallkhoj-release`, runs `DescribeInstances`, captures public IP/OS/status, then starts SSH dry-run/host probe.
- Good: `tccli lighthouse DescribeInstances --https-proxy http://127.0.0.1:7897` is used when direct network access is unreliable.
- Base: no credentials are available; keep browser login tab open and wait for operator login or credential setup.
- Bad: committing `SecretId`, `SecretKey`, or generated credential files.
- Bad: treating browser login state as the only source of instance metadata when CLI evidence can be produced.

### 6. Tests Required
- No unit tests are required for external `tccli` installation itself.
- Deployment docs must show no real credentials and must keep `SecretId`/`SecretKey` as local profile inputs only.
- Manual evidence should include `tccli lighthouse DescribeInstances ...` output with sensitive values reviewed before sharing.

### 7. Wrong vs Correct
#### Wrong
```text
tccli lighthouse DescribeInstances --secretId AKID... --secretKey ... > docs/server.json
```

#### Correct
```text
tccli configure --profile smallkhoj-release
tccli lighthouse DescribeInstances --profile smallkhoj-release --region ap-guangzhou --Limit 20
```

## Scenario: Initial Release Deployment Bundle CLI

### 1. Scope / Trigger
- Trigger: preparing the minimal no-secret file set to upload to Tencent Cloud Lighthouse or another release host.
- Use this when the full repository should not be copied to the server just to run host probe, deploy preflight, compose, Caddy, and post-deploy smoke.

### 2. Signatures
- CLI module: `scripts/make_deployment_bundle.py`, run from the repository root with `python3 scripts/make_deployment_bundle.py --output <bundle.tar.gz>`.
- Optional flags:
  - `--root <repo-root>`
  - `--prefix <tar-top-level-dir>`

### 3. Contracts
- The bundle must include:
  - `docker-compose.prod.yml`
  - `deploy/caddy/Dockerfile`
  - `deploy/caddy/Caddyfile`
  - `docs/initial-release-production-deployment.md`
  - `scripts/create_prod_env_template.py`
  - `scripts/initial_release_deploy_preflight.py`
  - `scripts/lighthouse_host_probe.py`
  - `scripts/post_deploy_smoke.py`
  - `scripts/remote_deploy_evidence.py`
  - `scripts/validate_release_worker_env.py`
  - `scripts/update_prod_env_from_stdin.py`
  - generated `README.deploy-bundle.md`
  - generated `manifest.json`
- The bundle must not include `.env*`, `.git`, `.trellis`, `node_modules`, `.next`, `__pycache__`, local databases, logs, screenshots, task evidence, or secrets.
- Manifest entries must include relative path, size, and SHA-256 hash. The top-level manifest must include generation time and current git commit when available.
- Tar members must live under one relative top-level prefix. No absolute paths or `..` path components are allowed.
- The generated README must show the server-side order: host probe -> env/preflight -> compose up -> post-deploy smoke.
- When Feishu/Jira runtime values are patched from a repo-external `release-worker.env`, the README must show `validate_release_worker_env.py` before `update_prod_env_from_stdin.py`. The validator/updater may print key names and readiness labels only, never configured values.

### 4. Validation & Error Matrix
- Missing required included file -> fail bundle generation.
- Included path is absolute, contains `..`, or uses an excluded path segment -> fail.
- Basename starts with `.env` -> fail.
- Required file is a symlink -> fail.

### 5. Good/Base/Bad Cases
- Good: local machine runs `python3 scripts/make_deployment_bundle.py --output /tmp/smallkhoj-deploy-bundle.tar.gz`, uploads the tarball, then runs scripts from `smallkhoj-deploy/`.
- Good: manifest hash lets the operator prove which deployment scripts were uploaded.
- Bad: uploading the full repo including `.env.prod`, task archives, logs, browser evidence, or build artifacts.
- Bad: hand-copying only one script and then discovering compose, Caddyfile, or docs are missing on the server.

### 6. Tests Required
- Unit tests inspect tarball contents without unsafe extraction.
- Unit tests verify manifest hashes match tar member bytes.
- Unit tests verify README command order and env/secret exclusion.
- CLI smoke generates a bundle under `/tmp` and lists members.

### 7. Wrong vs Correct
#### Wrong
```text
scp -r smallkhoj lighthouse:/opt/smallkhoj
# includes unrelated worktrees, caches, evidence, and maybe env files
```

#### Correct
```text
python3 scripts/make_deployment_bundle.py --output /tmp/smallkhoj-deploy-bundle.tar.gz
scp /tmp/smallkhoj-deploy-bundle.tar.gz lighthouse:/opt/
```

## Scenario: Initial Release Remote Deployment Evidence CLI

### 1. Scope / Trigger
- Trigger: collecting no-secret SSH evidence from a running initial-release deployment host.
- Use this after a remote compose deployment or when recording Lighthouse suitability/capacity evidence.

### 2. Signatures
- CLI module: `scripts/remote_deploy_evidence.py`.
- Required flags:
  - `--host <server-ip-or-hostname>`
- Common flags:
  - `--user ubuntu`
  - `--identity-file <ssh-key>`
  - `--remote-dir <deploy-parent-dir>`
  - `--bundle-prefix <unpacked-bundle-dir>`
  - `--remote-env-file .env.prod`
  - `--public-base-url http://<server-ip>`
  - `--allow-http`
  - `--output <evidence.json>`

### 3. Contracts
- The collector must not read or print `.env.prod`; it may pass `--env-file .env.prod` to deploy preflight and Docker Compose commands.
- When `--remote-env-file` is provided, Docker Compose evidence commands must include `--env-file <file>` so production interpolation succeeds without exposing values.
- Evidence should include host probe, deploy preflight, compose services/ps/log tails, `docker stats --no-stream`, `docker ps`, `docker system df`, memory snapshot, disk snapshot, top memory processes, and optional public smoke.
- Existing running deployments may cause host/runtime preflight to return non-zero because ports 80/443 are already bound by Caddy. Treat that as expected for post-deploy evidence when public smoke is green.

### 4. Validation & Error Matrix
- Missing SSH access -> command result captures SSH failure.
- Missing remote bundle -> remote command returns a `cd` or missing-file failure.
- Missing `--env-file` on compose commands -> compose interpolation fails for required secrets such as `POSTGRES_PASSWORD`; this is a collector bug, not a deployment resource finding.
- Public smoke failure -> inspect Caddy/backend/frontend logs in the same evidence payload before restarting services.

### 5. Good/Base/Bad Cases
- Good: evidence JSON records all command outputs and public smoke is green while preflight port checks flag 80/443 as occupied by the running proxy.
- Base: no public URL is ready; collect SSH-only host/compose/docker evidence.
- Bad: using `cat .env.prod`, `printenv`, or inline secret arguments to collect evidence.

### 6. Tests Required
- Unit tests verify the command plan never includes `cat .env.prod` or `printenv`.
- Unit tests verify compose commands include `--env-file <file>` whenever `remote_env_file` is configured.
- Unit tests verify `docker stats --no-stream` and top memory process commands are included in the no-secret plan.

### 7. Wrong vs Correct
#### Wrong
```text
ssh lighthouse 'cd smallkhoj-deploy && cat .env.prod && docker compose ps'
```

#### Correct
```text
python3 scripts/remote_deploy_evidence.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --bundle-prefix smallkhoj-deploy \
  --remote-env-file .env.prod \
  --public-base-url http://<server-ip> \
  --allow-http \
  --output /tmp/smallkhoj-remote-deploy-evidence.json
```

## Scenario: Initial Release Worker Rollout CLI

### 1. Scope / Trigger
- Trigger: applying a filled repo-external `release-worker.env` to the deployed initial-release host and validating Feishu/Jira worker readiness.
- Use this after integration bootstrap has produced connector IDs and the operator has filled Feishu/Jira secrets outside the repository.

### 2. Signatures
- CLI module: `scripts/release_worker_rollout.py`.
- Safe dry-run:
  - `python3 scripts/release_worker_rollout.py --dry-run --json --host <server-ip> --identity-file <key> --env-file <release-worker.env> --feishu-chat-id <chat-id>`
- Apply path:
  - add `--apply`
- Worker startup:
  - add `--start-worker` only after live-run preflight succeeds.

### 3. Contracts
- The CLI must validate the local release-worker env file before remote mutation.
- Env values must be piped to the remote updater over stdin, never embedded in SSH command arguments.
- The CLI must restart only `backend` after env changes, then run `live_run_preflight_cli` inside the backend container.
- `--start-worker` must require `--apply`; dry-run mode must never start the worker.
- The worker start step must appear only behind the live-run preflight step in the command plan.
- JSON/dry-run output may include file paths, labels, and commands, but not env file contents or `KEY=value` secret pairs.

### 4. Validation & Error Matrix
- Missing or placeholder release-worker env value -> validator fails and no remote mutation is executed.
- SSH/env updater failure -> stop before backend restart.
- Backend restart failure -> stop before live-run preflight.
- Live-run preflight failure -> stop before worker startup.
- `--start-worker` without `--apply` -> exit code `2`.

### 5. Good/Base/Bad Cases
- Good: run dry-run JSON, inspect labels/commands, then run `--apply`, then add `--start-worker` only after preflight is known ready.
- Base: no external secrets yet; dry-run plan can still be inspected with the expected env-file path.
- Bad: running `docker compose --profile feishu-worker up -d feishu-worker` before live-run preflight is ready.
- Bad: passing Feishu/Jira secrets in command arguments or committing `release-worker.env`.

### 6. Tests Required
- Unit tests verify the command plan order and default omission of worker startup.
- Unit tests verify `--start-worker` is explicit and incompatible with dry-run-only execution.
- Unit tests verify dry-run JSON contains no env values or `KEY=value` secret pairs.

### 7. Wrong vs Correct
#### Wrong
```text
ssh lighthouse 'cd deploy && FEISHU_WORKER_APP_SECRET=... docker compose --profile feishu-worker up -d feishu-worker'
```

#### Correct
```text
python3 scripts/release_worker_rollout.py \
  --dry-run \
  --json \
  --host <server-ip> \
  --identity-file ~/.ssh/<key> \
  --env-file /Volumes/ORICO/smallkhoj-secrets/release-worker.env \
  --feishu-chat-id <chat-id>
```

## Scenario: Initial Release Production Env Template CLI

### 1. Scope / Trigger
- Trigger: creating or changing the server-side `.env.prod` setup path for the initial release deployment.
- Use this before editing deployment env requirements, required placeholders, or bundle contents.

### 2. Signatures
- CLI module: `scripts/create_prod_env_template.py`.
- Optional flags:
  - `--output <path>`: write the template to a file instead of stdout.
  - `--force`: overwrite an existing output file.

### 3. Contracts
- The template must contain no real secret values.
- The template must include all required operational env keys checked by deploy preflight.
- Required values must be placeholder-shaped so `initial_release_deploy_preflight.py --env-file .env.prod` fails until the operator replaces them.
- The command must refuse to overwrite an existing output file unless `--force` is provided.
- The deployment bundle may include the generator script but must not include generated `.env.prod`.

### 4. Validation & Error Matrix
- Existing output file without `--force` -> exit code `2`.
- Generated required placeholders passed to env preflight -> failed `env.required`.
- Real filled required values passed to env preflight -> `env.required` passed.

### 5. Good/Base/Bad Cases
- Good: server operator runs `python3 scripts/create_prod_env_template.py --output .env.prod`, edits values, then runs deploy preflight.
- Base: operator prints template to stdout to inspect required keys without writing a file.
- Bad: committing `.env.prod` or adding real Jira/Feishu/LLM tokens to the template.
- Bad: setting placeholders to non-placeholder text that accidentally passes preflight.

### 6. Tests Required
- Unit tests cover required template keys, no obvious live secret marker, overwrite refusal, and forced overwrite.
- Deploy preflight tests cover placeholder required values failing without leaking values.

### 7. Wrong vs Correct
#### Wrong
```text
POSTGRES_PASSWORD=secret123
```

#### Correct
```text
POSTGRES_PASSWORD=<set-outside-repo>
```

## Scenario: Initial Release Production Image Transfer CLI

### 1. Scope / Trigger
- Trigger: preparing the first Tencent Cloud Lighthouse deployment when backend/frontend/Caddy images should be built off-host and loaded directly on the server without a container registry.
- Use this before `lighthouse_ssh_deploy_probe.py --compose-up --use-loaded-images` when the target host is too small to build the app images or a registry is not ready.

### 2. Signatures
- CLI module: `scripts/production_image_transfer.py`.
- Required flag:
  - `--host <ssh-host-or-ip>`
- Optional flags:
  - `--user <ssh-user>`
  - `--port <ssh-port>`
  - `--identity-file <path>`
  - `--remote-dir <path>`
  - `--output-archive <path>`
  - `--backend-image <tag>`
  - `--frontend-image <tag>`
  - `--caddy-image <tag>`
  - `--skip-build`
  - `--platform <docker-platform>`
  - `--use-vpn-proxy`
  - `--proxy-url <url>`
  - `--next-public-api-base-url <url>`
  - `--next-public-ws-base-url <url>`
  - `--dry-run`
  - `--json`

### 3. Contracts
- Default image tags are `smallkhoj-backend:local-release`, `smallkhoj-frontend:local-release`, and `smallkhoj-caddy:local-release`.
- Default mode must build backend, frontend, and Caddy images locally; `--skip-build` must omit build steps while preserving `docker save`, `scp`, and remote `docker load`.
- `--platform` must pass the same Docker build target platform to backend, frontend, and Caddy builds. Omit it only when the local Docker default architecture is known to match the target host.
- The CLI must save all three app images into one Docker archive, upload the archive to the remote directory, and run `docker load -i <remote-archive>`.
- `--output-archive` is a local path and may point to `/Volumes/ORICO/...`; `--remote-dir` is a server path and should remain a normal host directory such as `/opt/smallkhoj`.
- `--use-vpn-proxy` must add Docker build args for `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, and `https_proxy`, using `http://host.docker.internal:7897` by default because the proxy is reached from inside build containers.
- Frontend builds pass `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_WS_BASE_URL` as build args; same-origin release mode keeps both empty by default. Production public-key material is never a build arg.
- The caller must export `PUBLIC_API_KEY` in the process environment. The CLI passes only `--secret id=public_api_key,env=PUBLIC_API_KEY`; its command plan and JSON never contain the value or a `NEXT_PUBLIC_API_KEY=...` assignment.
- The CLI must not read, upload, or print `.env.prod` or credential-shaped environment values. Missing `PUBLIC_API_KEY` is allowed in `--dry-run` planning but the real frontend Docker build fails closed because the BuildKit secret is absent.
- After using this CLI, `.env.prod` must point `SMALLKHOJ_BACKEND_IMAGE`, `SMALLKHOJ_FRONTEND_IMAGE`, and `SMALLKHOJ_CADDY_IMAGE` at the loaded tags, and compose startup must avoid pulling those local tags.

### 4. Validation & Error Matrix
- Missing `--host` -> CLI parser failure.
- Local Docker build/save failure -> stop and return that command's exit code.
- Apple Silicon `linux/arm64` images loaded onto a `linux/amd64` host -> container startup fails with architecture mismatch; choose `--platform` before build.
- SCP failure -> stop before remote `docker load` and return the SCP exit code.
- Remote `docker load` failure -> return the SSH command exit code.
- Using loaded local tags with `lighthouse_ssh_deploy_probe.py --compose-up` but without `--use-loaded-images` -> risk pulling nonexistent registry tags; treat this as operator error.

### 5. Good/Base/Bad Cases
- Good: after confirming the Lighthouse host is x86_64, local machine runs `production_image_transfer.py --platform linux/amd64 --use-vpn-proxy --dry-run`, then runs it for real, edits `.env.prod` image tags to the loaded local-release tags, and starts compose with `--use-loaded-images`.
- Good: images were already built locally, so the operator runs with `--skip-build` to avoid rebuilding and only transfers the current archive.
- Good: local archive is written to `/Volumes/ORICO/...` with `--output-archive`, while SSH upload still targets `/opt/smallkhoj` with `--remote-dir`.
- Base: a registry is already ready; skip this CLI and use registry image tags plus the normal pull/build startup path.
- Bad: building Next.js on the nominal 4 vCPU / 4 GB Lighthouse host (3.32 GiB guest-visible RAM) instead of transferring a prebuilt `linux/amd64` image.
- Bad: reusing Apple Silicon `linux/arm64` local-smoke images on an `amd64` Lighthouse host.
- Bad: setting `--remote-dir /Volumes/ORICO/...`; that path is local-only and normally does not exist on the server.
- Bad: running `docker compose pull backend frontend` against `smallkhoj-*:local-release` tags after loading them locally.

### 6. Tests Required
- Unit tests cover default command planning, SSH identity/port flags, `--skip-build`, target platform build args, VPN proxy build args, no-secret command payloads, and loaded-image compose compatibility.

### 7. Wrong vs Correct
#### Wrong
```text
ssh host
docker build -t smallkhoj-frontend:latest ./frontend
# server swaps or runs out of disk/memory during Next build
```

#### Correct
```text
python3 scripts/production_image_transfer.py --host <ip> --user ubuntu --platform linux/amd64 --use-vpn-proxy
python3 scripts/lighthouse_ssh_deploy_probe.py --host <ip> --user ubuntu --remote-env-file .env.prod --compose-up --use-loaded-images
```

## Scenario: Initial Release SSH Deployment Probe Runner

### 1. Scope / Trigger
- Trigger: validating a first Tencent Cloud Lighthouse or replacement SSH host from the local machine without hand-copying each deployment command.
- Use this after local production compose smoke passes and before mutating a real deployment host beyond upload/unpack/probe.

### 2. Signatures
- CLI module: `scripts/lighthouse_ssh_deploy_probe.py`.
- Required flag:
  - `--host <ssh-host-or-ip>`
- Optional flags:
  - `--user <ssh-user>`
  - `--port <ssh-port>`
  - `--identity-file <path>`
  - `--remote-dir <path>`
  - `--local-bundle <path>`
  - `--bundle-prefix <name>`
  - `--remote-env-file <path>`
  - `--runtime-preflight`
  - `--compose-up`
  - `--use-loaded-images`
  - `--public-base-url <url>`
  - `--allow-http`
  - `--dry-run`
  - `--json`

### 3. Contracts
- Default mode must create a no-secret bundle locally, upload it with `scp`, unpack it remotely, run `lighthouse_host_probe.py --json`, and run repo/config deploy preflight.
- The runner must not create, upload, or print `.env.prod` or any secret value.
- `--runtime-preflight` requires `--remote-env-file`.
- `--compose-up` requires `--remote-env-file` and must be explicit; default probe must not start containers.
- `--use-loaded-images` may only affect explicit compose startup: it pulls `db` but must not pull backend/frontend or build Caddy, because those images should already exist from `production_image_transfer.py`.
- `--public-base-url` runs local `post_deploy_smoke.py` after remote steps.
- `--dry-run` and `--json` must expose the command plan without executing SSH/SCP/local commands.

### 4. Validation & Error Matrix
- Missing `--host` -> CLI parser failure.
- `--runtime-preflight` without `--remote-env-file` -> exit code `2`.
- `--compose-up` without `--remote-env-file` -> exit code `2`.
- Any local, `scp`, or `ssh` step returns non-zero -> stop and return that code.
- Public smoke failure -> return the post-deploy smoke exit code.

### 5. Good/Base/Bad Cases
- Good: `--dry-run` first prints create-bundle, SSH mkdir, SCP upload, remote unpack, host probe, and repo preflight in order.
- Good: runtime preflight is only added after `.env.prod` exists on the server and `--remote-env-file` is provided.
- Good: local image transfer is followed by `--compose-up --use-loaded-images`, so the server pulls only `db` and uses already-loaded app images.
- Base: no public URL is ready; the runner still performs bundle upload, host probe, and repo preflight.
- Bad: uploading `.env.prod` from the local repo or printing secret values in the command plan.
- Bad: starting compose on a fresh host before `lighthouse_host_probe.py` has recorded CPU/memory/swap/disk/Docker/port evidence.
- Bad: pulling backend/frontend local-release tags after they were loaded with `docker load`.

### 6. Tests Required
- Unit tests cover default command planning, SSH identity/port flags, runtime preflight, explicit compose startup, loaded-image startup, missing env validation, and optional public smoke.
- CLI dry-run should be manually inspected before first real host use.

### 7. Wrong vs Correct
#### Wrong
```text
scp -r . ubuntu@host:/opt/smallkhoj
ssh ubuntu@host 'docker compose up -d'
```

#### Correct
```text
python3 scripts/lighthouse_ssh_deploy_probe.py --host <ip> --user ubuntu --dry-run
python3 scripts/lighthouse_ssh_deploy_probe.py --host <ip> --user ubuntu
```

## Scenario: Initial Release Remote Deploy Evidence Collector

### 1. Scope / Trigger
- Trigger: a remote Lighthouse probe, preflight, compose startup, or public smoke fails and the operator needs a no-secret evidence bundle from the local machine.
- Use this after `lighthouse_ssh_deploy_probe.py` has uploaded/unpacked the deployment bundle on the remote host.

### 2. Signatures
- CLI module: `scripts/remote_deploy_evidence.py`.
- Required flag:
  - `--host <ssh-host-or-ip>`
- Optional flags:
  - `--user <ssh-user>`
  - `--port <ssh-port>`
  - `--identity-file <path>`
  - `--remote-dir <path>`
  - `--bundle-prefix <name>`
  - `--remote-env-file <path>`
  - `--public-base-url <url>`
  - `--allow-http`
  - `--output <json-path>`
  - `--dry-run`
  - `--json`

### 3. Contracts
- The collector must run remote commands from the unpacked deployment bundle directory.
- Default evidence must include host probe, repo preflight, compose services, compose ps, recent core service logs, Docker ps, Docker system disk usage, memory snapshot, and disk snapshot.
- `--remote-env-file` may add runtime preflight, but the collector must not print, cat, upload, or copy `.env.prod`.
- `--public-base-url` may add local post-deploy smoke output.
- The local evidence output must be JSON with command labels, command strings, return codes, stdout, and stderr.
- `--dry-run` and `--json` must expose the command plan without executing SSH/local commands.

### 4. Validation & Error Matrix
- Missing `--host` -> CLI parser failure.
- SSH command failure -> captured result with non-zero return code; final exit code non-zero.
- Public smoke failure -> captured non-zero result; final exit code non-zero.
- Output path unwritable -> command exits non-zero from file write error.

### 5. Good/Base/Bad Cases
- Good: failed remote compose startup is followed by one evidence collection command and a JSON artifact with labeled command output.
- Base: no env file exists yet; collector still gathers host probe, repo preflight, compose service/ps/logs, and host snapshots.
- Bad: running `cat .env.prod`, `printenv`, or uploading env files as part of evidence collection.
- Bad: relying only on `docker compose logs` and missing host memory/disk/Docker daemon evidence.

### 6. Tests Required
- Unit tests cover default command planning, SSH identity/port flags, optional runtime preflight, optional public smoke, and JSON result shape.
- Manual dry-run should be inspected before first real host use.

### 7. Wrong vs Correct
#### Wrong
```text
ssh host 'cat .env.prod && docker compose logs'
```

#### Correct
```text
python3 scripts/remote_deploy_evidence.py --host <ip> --user ubuntu --remote-dir /opt/smallkhoj --output /tmp/evidence.json
```

## Scenario: Initial Release Production Deploy Preflight CLI

### 1. Scope / Trigger
- Trigger: changing production compose, Caddy routing, frontend standalone image output, deployment env requirements, or release host readiness checks.
- Use this before starting the production stack on Tencent Cloud Lighthouse, a tunnel host, or any release candidate machine.

### 2. Signatures
- CLI module: `scripts/initial_release_deploy_preflight.py`, run from the repository root with `python3 scripts/initial_release_deploy_preflight.py`.
- Optional flags:
  - `--env-file <path>`: inspect deployment env without printing secret values.
  - `--runtime`: inspect current host Docker, memory, disk, and ports.
  - `--json`: emit machine-readable release evidence.
  - `--strict-warnings`: return code `2` when warnings exist.

### 3. Contracts
- Default mode must be offline and no-secret: inspect tracked repo files only.
- Env-file mode must check required operational keys without printing values for secrets or image names.
- Env-file mode must fail required keys that still use placeholder-shaped values such as `<set-outside-repo>`, `<registry>/...:<tag>`, `TODO...`, `CHANGE_ME...`, or `REPLACE_ME...`.
- Runtime mode must not start production containers or contact Tencent Cloud, Feishu, Jira, or LLM providers.
- Repository checks must cover `docker-compose.prod.yml`, `deploy/caddy/Dockerfile`, `deploy/caddy/Caddyfile`, `frontend/next.config.mjs`, and `frontend/Dockerfile`.
- Production compose must build the Caddy image from `./deploy/caddy` so Caddy config is baked into the image instead of relying on a file-level bind mount to `/etc/caddy/Caddyfile`.
- Production compose may make Caddy host ports overridable for local smoke, but defaults must remain host `80` and `443` mapped to container `80` and `443`.
- Production frontend image readiness requires `output: "standalone"` and a Dockerfile that copies `/app/.next/standalone` and starts `server.js`.
- Caddy readiness requires `/api/*`, `/internal/*`, `/docs`, and `/openapi.json` to route to `backend:8000`, with `frontend:3000` as the default route.
- Runtime readiness requires Docker command availability, Docker daemon response, Docker Compose response, memory/disk thresholds, and ports 80/443 not already accepting local TCP connections.

### 4. Validation & Error Matrix
- Missing production compose/Caddy/frontend config file -> failed check.
- Missing compose service or route contract -> failed check.
- Missing `output: "standalone"` -> failed `repo.frontend.standalone`.
- Missing required env key -> failed `env.required`.
- Placeholder value for a required env key -> failed `env.required` with key names only, no values.
- Local/IP-only site address, CORS mismatch, or frontend public URL override -> warning unless strict warnings are enabled.
- Docker command/daemon/compose unavailable -> failed runtime check.
- Host memory below 1.5 GiB or disk below 8 GiB -> failed runtime check.
- Host memory below 2 GiB or disk below 12 GiB -> warning.
- Port 80 or 443 already accepts local TCP connections -> failed runtime check.

### 5. Good/Base/Bad Cases
- Good: local CI runs `python3 scripts/initial_release_deploy_preflight.py --json` and stores the JSON report with release evidence.
- Good: deployment host runs `python3 scripts/initial_release_deploy_preflight.py --env-file .env.prod --runtime --json` before `docker compose up`.
- Good: local production smoke sets `SMALLKHOJ_HTTP_PORT=18080` and `SMALLKHOJ_HTTPS_PORT=18443`, while Compose defaults still use public ports on real hosts.
- Base: IP-only smoke uses `SMALLKHOJ_SITE_ADDRESS=:80`; env preflight warns but does not fail unless `--strict-warnings` is used.
- Bad: starting Caddy before checking that ports 80/443 are already occupied by another service.
- Bad: changing production defaults to high local ports instead of using env overrides for local smoke.
- Bad: relying on `next build` alone when the production Dockerfile depends on `.next/standalone`.
- Bad: printing `POSTGRES_PASSWORD`, Jira API tokens, Feishu app secrets, or LLM keys in preflight output.
- Bad: treating `<set-outside-repo>` or `<registry>/smallkhoj-backend:<tag>` as valid production env values.

### 6. Tests Required
- Unit tests cover passing repo config, missing standalone output, missing env values, and warning exit semantics.
- Unit tests cover placeholder env values failing without leaking their values.
- CLI smoke: default preflight passes against the current repository.
- Runtime smoke: runtime preflight runs on the current machine and reports Docker/resource/port status.

### 7. Wrong vs Correct
#### Wrong
```text
docker compose --env-file .env.prod up -d
# then discover Caddy routes, frontend image output, or ports are wrong
```

#### Correct
```text
python3 scripts/initial_release_deploy_preflight.py --env-file .env.prod --runtime --json
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d db backend frontend caddy
```

## Scenario: Initial Release Post-Deploy Smoke CLI

### 1. Scope / Trigger
- Trigger: validating a started production stack through its public base URL after Caddy/frontend/backend containers are running.
- Use this after host probe and production deploy preflight pass, and after `docker compose up -d db backend frontend caddy`.

### 2. Signatures
- CLI module: `scripts/post_deploy_smoke.py`, run from the repository root with `python3 scripts/post_deploy_smoke.py --base-url <url>`.
- Optional flags:
  - `--json`: emit machine-readable public URL evidence.
  - `--allow-http`: allow HTTP without warning for IP-only or tunnel smoke tests.
  - `--timeout <seconds>`: per-network-operation timeout.
  - `--strict-warnings`: return code `2` when warnings exist.

### 3. Contracts
- The command must be read-only and must not require authentication, app secrets, Jira/Feishu credentials, machine tokens, or deployment env files.
- Required checks: URL scheme, DNS resolution, TCP connect, frontend root, `/api/health`, `/docs`, `/openapi.json`, and an unauthenticated daemon WebSocket upgrade probe for `/internal/agent-api/ws`.
- The daemon WebSocket probe must not send a real machine token. `401` or `403` is a passed check because it proves the route reaches the backend and preserves auth. `101 Switching Protocols` is a failed check without credentials.
- HTTPS is expected by default. HTTP must warn unless `--allow-http` is used.
- If DNS, TCP, or TLS prerequisites fail, endpoint checks should fail fast without waiting for repeated HTTP timeouts.
- Output must not include raw response bodies.

### 4. Validation & Error Matrix
- Invalid base URL -> failed URL parse check.
- HTTP base URL without `--allow-http` -> warning.
- DNS failure -> failed `dns.resolve` and skipped endpoint checks marked failed.
- TCP failure -> failed `tcp.connect` and skipped endpoint checks marked failed.
- TLS handshake failure on HTTPS -> failed `tls.handshake` and skipped endpoint checks marked failed.
- Frontend root not 2xx/3xx HTML -> failed `http.frontend`.
- `/api/health` not 2xx JSON with `status: "ok"` -> failed `http.health`.
- `/docs` not 2xx/3xx -> failed `http.docs`.
- `/openapi.json` not 2xx JSON with OpenAPI-like keys -> failed `http.openapi`.
- `/internal/agent-api/ws` no-token upgrade returns `401` or `403` -> passed `ws.daemonAuth`.
- `/internal/agent-api/ws` no-token upgrade returns `101` -> failed `POST_DEPLOY_SMOKE_DAEMON_WS_ACCEPTED_WITHOUT_AUTH`.
- `/internal/agent-api/ws` no-token upgrade returns `404`, `502`, malformed status, or no response -> failed daemon WebSocket route check.

### 5. Good/Base/Bad Cases
- Good: `python3 scripts/post_deploy_smoke.py --base-url https://smallkhoj.example.com --json` returns ready after DNS, TLS, frontend, backend health, docs, and OpenAPI routes all pass.
- Base: `python3 scripts/post_deploy_smoke.py --base-url http://<server-ip> --allow-http --json` proves IP-only HTTP smoke while ICP/domain/HTTPS are pending.
- Good: daemon WebSocket smoke receives `403` for an unauthenticated upgrade, proving Caddy `/internal/*` reaches the backend while auth remains enforced.
- Bad: relying only on `curl /` and missing a broken `/api/*` or `/openapi.json` Caddy route.
- Bad: opening daemon WebSocket in smoke with a real machine token; daemon validation belongs to the daemon reconnect/live-run gate.
- Bad: accepting `101 Switching Protocols` for a no-token daemon WebSocket smoke as healthy.

### 6. Tests Required
- Unit tests cover successful local fake deployment smoke.
- Unit tests cover HTTP warning behavior, health failure, daemon WebSocket no-auth rejection, daemon WebSocket no-auth acceptance failure, and JSON/exit semantics.
- CLI smoke against a refused local port should fail quickly without repeated endpoint timeouts.

### 7. Wrong vs Correct
#### Wrong
```text
curl -I https://domain/
# frontend works, but /api/health is silently broken
```

#### Correct
```text
python3 scripts/post_deploy_smoke.py --base-url https://domain --json
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

## Scenario: Bounded Serialization and Stable Task/Thread Cursors

### 1. Scope / Trigger
- Trigger: changing list/search/history serializers, task/thread ordering, cursor fields, endpoint filters, or a frontend consumer that assumes a complete collection.

### 2. Signatures
- Prefetch sentinel: `routers.serialization_prefetch.UNSET`.
- Page contexts: `MessageSerializationContext`, `TaskSerializationContext`, `MemberSerializationContext`.
- Task order: `(task_number ASC, channel_id ASC, id ASC)`.
- Thread order: `(created_at DESC, id DESC)` after SQL qualification that the root has replies.
- Cursor codec: base64url JSON, `v=1`, bound to `endpoint`, `serverId`, normalized filters, and the complete position tuple.
- Task limits: `limit` defaults to 50 and is constrained to `1..200`; responses add `nextCursor`.

### 3. Contracts
- List work may grow by page count, not returned row count. Relationship/workspace/reaction/reply-count/TaskRun data is loaded once per page and serializers project from immutable maps.
- `UNSET` means no context was supplied. A supplied map miss or explicit `None` is authoritative and must not trigger fallback SQL.
- Public and agent response keys/null/defaults remain unchanged except for the additive pagination envelope field.
- SQL `ORDER BY`, cursor position fields, and seek predicates use the same tuple/directions. `id` is the final unique tie-breaker.
- `task_number` is channel-scoped and must never be the only server-wide cursor field.
- Thread roots are joined/qualified against replies before seek/order/limit; Python filtering after limit is forbidden.
- Cursor endpoint, Server, filter, version, type, timezone, UUID, and length mismatches all return the same non-disclosing `400 {"detail":"Invalid pagination cursor"}`.
- Seek cursors are row-position tokens: deleting the boundary row does not invalidate continuation. Inserts before the boundary do not flow into later pages.

### 4. Validation & Error Matrix
- Missing/invalid cursor JSON/base64/type/version -> `400 Invalid pagination cursor`.
- Cursor from another endpoint or Server -> the same 400; disclose no foreign scope details.
- Cursor reused with a different status/channel filter -> the same 400.
- Task tie across channels -> order by channel UUID then task UUID; return each task once.
- Equal thread timestamp -> order/seek by message UUID descending.
- No eligible reply-bearing roots -> empty page with `nextCursor: null`.

### 5. Good/Base/Bad Cases
- Good: 50-row and 100-row request statement counts remain equal or under their named constant ceiling while canonical JSON snapshots match.
- Good: delete the boundary task/thread between pages and traverse every remaining eligible row once.
- Base: serializer is called outside a list with `_context=UNSET`; its documented single-row fallback may query relations.
- Bad: using `None` for both “not prefetched” and “known missing,” or `limit * 3` followed by Python reply filtering.
- Bad: cursor contains only `task_number` or `created_at`, or frontend stops after the first 50/200 rows.

### 6. Tests Required
- Real PostgreSQL/ASGI whole-request counters at representative 50/100 rows for public and agent messages/search/history/tasks/members.
- Exact canonical snapshots for empty, missing relation, reactions, TaskRuns, and nested Member shapes.
- A no-SQL session assertion for a supplied missing prefetch value.
- PostgreSQL task/thread traversal with ties, deletion, insertion before boundary, full duplicate-free traversal, filter mismatch, version mismatch, foreign Server, and cross-channel cursor reuse.
- Frontend tests must prove every required consumer follows `nextCursor` with repeated-cursor and page-bound guards.

### 7. Wrong vs Correct
#### Wrong
```python
for task in tasks:
    await db.execute(select(Channel).where(Channel.id == task.channel_id))
cursor = {"taskNumber": task.task_number}
```

#### Correct
```python
context = await load_task_serialization_context(db, tasks)
items = [await serialize(db, task, _context=context) for task in tasks]
cursor = encode_task_cursor(task_number=last.task_number,
                            position_channel_id=last.channel_id,
                            task_id=last.id, ...)
```

## Scenario: Upload Resource Envelope and Compensation

### 1. Scope / Trigger
- Trigger: public file, agent attachment, or avatar multipart ingestion; upload limits; Caddy body limits; local durable storage; or FileEntry transaction changes.

### 2. Signatures
- Entrypoints: `POST /api/v1/files`, `POST /internal/agent-api/upload`, `POST /internal/agent-api/profile/avatar`.
- Shared service: `services.upload_storage.stage_upload`, `StagedUpload.promote/cleanup`, `rollback_and_cleanup_upload`, `close_upload`.
- Env: `UPLOAD_MAX_BYTES`, `UPLOAD_READ_CHUNK_BYTES`, `UPLOAD_CLEANUP_TIMEOUT_SECONDS`, and Caddy `SMALLKHOJ_UPLOAD_REQUEST_BODY_MAX`.
- Default application cap/read chunk: 50 MiB / 64 KiB.

### 3. Contracts
- Caddy request-body rejection, Starlette multipart spooling, application reads/staging, and final durable storage are separate resource boundaries and must be reported separately.
- Every route uses the same application cap unless a reviewed product-specific lower cap is explicit.
- The application reads at most one configured chunk at a time into a same-directory hidden `.uploading` staging file. It does not accumulate the complete body in a byte array.
- Exact-limit input is accepted; one byte over returns stable 413. Content-Length is not trusted as the sole guard.
- The durable blob is exposed with atomic same-filesystem `os.replace` only after validation and database flush. Commit success is the only committed terminal state.
- Read/write/fsync/flush/promote/commit failure and cancellation roll back within a bounded wait and remove staging/final residue. Every path closes the parser-owned `UploadFile`.
- Do not claim that application chunking rejects network ingress before Starlette has parsed/spooled multipart data.

### 4. Validation & Error Matrix
- Empty public file/avatar/attachment -> stable 400 detail for that route; no row/blob.
- Body exceeds application cap -> 413; close handle; no row/staging/final file.
- Invalid channel/message/mime metadata -> 4xx before durable commit; upload handle still closes.
- Interrupted read or cancellation -> re-raise the original exception after cleanup.
- Local write/fsync/promote failure -> rollback/cleanup; no committed row.
- Database flush/commit failure after promotion -> rollback and unlink promoted blob.
- Caddy body cap exceeded -> proxy 413 before backend; distinguish this evidence from application 413.

### 5. Good/Base/Bad Cases
- Good: migrated PostgreSQL accepts one exact-limit multipart file and rejects the next, leaving one FileEntry, one durable blob, and zero `.uploading` files.
- Good: forced commit failure for all three routes leaves zero rows and zero blobs.
- Base: Starlette spools a large multipart part to temporary disk before route code applies the 50 MiB application cap; docs state both boundaries.
- Bad: `content = await file.read()`, `chunks.append` plus `b''.join(chunks)`, or direct writes to the final served path.
- Bad: commit a FileEntry then attempt best-effort storage without compensating missing/partial files.

### 6. Tests Required
- Each route: exact limit, one byte over, multi-chunk input, misleading/missing content length, empty input, invalid metadata, interrupted read, cancellation, write/fsync failure, DB flush/commit failure, and handle close.
- Filesystem assertions: no hidden staging or promoted residue on every non-commit terminal path.
- Real migrated PostgreSQL/ASGI success and 413 cases with row/blob counts.
- Exact tracked Caddy image/config probe: below ingress cap reaches backend; above cap returns 413 at Caddy.

### 7. Wrong vs Correct
#### Wrong
```python
content = await upload.read()
path.write_bytes(content)
db.add(FileEntry(storage_path=str(path)))
await db.commit()
```

#### Correct
```python
staged = await stage_upload(upload, final_path=path, max_bytes=limit, ...)
try:
    db.add(FileEntry(size=staged.size, storage_path=str(path), ...))
    await db.flush()
    staged.promote()
    await db.commit()
except BaseException:
    await rollback_and_cleanup_upload(db, staged)
    raise
finally:
    await close_upload(upload)
```

---

## Naming Conventions

<!-- Table names, column names, index names -->

(To be filled by the team)

---

## Common Mistakes

<!-- Database-related mistakes your team has made -->

(To be filled by the team)
