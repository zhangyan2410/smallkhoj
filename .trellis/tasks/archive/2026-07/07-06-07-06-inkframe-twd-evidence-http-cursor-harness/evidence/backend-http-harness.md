# Backend HTTP Cursor Harness Evidence

Date: 2026-07-06

## Scope

Added ASGI HTTP route-boundary tests for chat read cursors in:

```text
backend/tests/test_chat_read_cursors_http.py
backend/tests/test_chat_read_cursors_postgres_http.py
```

The broad route matrix tests use:

- `main.app`
- `httpx.ASGITransport`
- `httpx.AsyncClient`
- real public API headers:
  - `X-Public-Key`
  - `X-Account-Token`
  - `X-Server-Id`
- FastAPI dependency override for `public_api.get_db`
- statement-aware fake DB session objects

The Postgres integration test uses:

- a random temporary schema inside the local `smallkhoj` Postgres database;
- `Base.metadata.create_all` against that schema via `search_path`;
- real SQLAlchemy async sessions;
- the same ASGI/FastAPI public API route path;
- `DROP SCHEMA ... CASCADE` cleanup in `finally`.

This is stronger than direct handler calls because requests cross:

```text
HTTP request
-> FastAPI route dependency injection
-> public API key check
-> session token lookup
-> active server/member resolution
-> route validation
-> read cursor service
-> response serialization
```

The broad matrix still uses the controlled fake session. The real Postgres
schema path now covers representative channel, DM, thread, scope-mismatch,
missing-session, unjoined active Server, and monotonic channel-write flows
across actual Postgres DDL/DML and persisted SELECT projection.

## Tests Added

- `test_http_channel_cursor_post_and_get_projection_uses_public_auth_and_active_server`
- `test_http_channels_unread_projection_counts_newer_messages_not_global_seq_gap`
- `test_http_read_cursor_requires_account_session`
- `test_http_read_cursor_rejects_unjoined_active_server`
- `test_http_cursor_get_queries_are_scoped_to_active_server_and_member`
- `test_http_dm_cursor_post_and_get_projection_uses_dm_scope`
- `test_http_channel_cursor_write_is_monotonic`
- `test_http_channel_cursor_rejects_dm_scope_mismatch`
- `test_http_dm_cursor_rejects_public_channel_scope_mismatch`
- `test_http_thread_cursor_post_and_get_projection`
- `test_postgres_http_channel_cursor_persists_and_projects_unread_state`
- `test_postgres_http_dm_cursor_persists_with_dm_scope`
- `test_postgres_http_thread_cursor_persists_and_projects`
- `test_postgres_http_channel_and_dm_scope_mismatches_reject_without_writes`
- `test_postgres_http_read_cursor_requires_account_session`
- `test_postgres_http_read_cursor_rejects_unjoined_active_server`
- `test_postgres_http_channel_cursor_write_is_monotonic`

## Coverage Matrix

| Requirement | Evidence |
|---|---|
| Authenticated account/member context | `X-Public-Key`, `X-Account-Token`, and active server headers cross FastAPI dependencies |
| Channel cursor POST + GET | Covered in fake-session matrix and real Postgres schema |
| DM cursor POST + GET | Covered in fake-session matrix and real Postgres schema |
| Thread cursor POST + GET | Covered in fake-session matrix and real Postgres schema |
| Cursor monotonicity | Covered for channel cursor write in fake-session matrix and real Postgres schema |
| Missing account/session rejection | Covered with HTTP 401 in fake-session matrix and real Postgres schema |
| Unjoined active server rejection | Covered with HTTP 403 in fake-session matrix and real Postgres schema |
| Server/member scoping | Covered through active-server membership rejection and a route-boundary GET assertion that the emitted SQL is scoped by account, server, and member filters |
| Channel/DM mismatch rejection | Covered in both directions with HTTP 400 in fake-session matrix and real Postgres schema |
| Unread projection with global sequence gap | Covered through `/api/v1/channels`; unread count is row-count based, not `latestSeq - lastReadSeq` |
| Real database persistence | Covered for channel, DM, thread, mismatch no-write, auth rejection, unjoined-server rejection, and monotonic channel write through a temporary Postgres schema |

## Red-Green Notes

The first simple channel HTTP test passed immediately, proving the existing route
already supported that happy path. Extending the harness to unread projection
created a meaningful red phase:

```text
5 failed, 3 passed
```

The failures were in the new statement-aware fake session, which confused:

- `select(ChannelMember)` membership lookups;
- projection queries selecting `ChannelMember.channel_id, last_read_seq`;
- `Channel.kind`'s mapped DB column name (`channels.type`).

The harness was corrected, then the HTTP tests passed.

A later real Postgres hardening attempt first tried to create a temporary
database and failed with:

```text
asyncpg.exceptions.InsufficientPrivilegeError: permission denied to create database
```

The test was changed to create a random temporary schema inside the existing
local `smallkhoj` database, set `search_path` for the test engine, and drop the
schema with `CASCADE` in `finally`. That made the integration test usable
without touching the existing `public` schema.

Post-review cleanup tightened FastAPI app override isolation: the Postgres HTTP
test now snapshots `app.dependency_overrides`, installs only the test
`public_api.get_db` override, and restores the previous override map in
`finally`. This preserves cleanup on failure without erasing overrides that may
belong to an outer fixture.

A follow-up backend hardening step migrated three more paths from fake-session
coverage to the real temporary Postgres schema fixture:

- DM cursor POST/GET persists and serializes as `scope.kind = "dm"`.
- Thread cursor POST/GET persists `chat_thread_read_cursors` with
  `last_seen_message_id`.
- Channel/DM scope mismatches reject with HTTP 400 and leave existing
  `channel_members.last_read_seq` values unchanged.

A second follow-up backend hardening step migrated the remaining practical
non-SQL-text edges into the real temporary Postgres schema fixture:

- Missing account session rejects with HTTP 401.
- Selecting an active Server without membership rejects with HTTP 403.
- Retrograde channel cursor writes are monotonic and do not lower
  `channel_members.last_read_seq`.

## Verification

Focused HTTP + Postgres HTTP tests:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
```

Result:

```text
17 passed in 1.56s
```

Combined backend route/cursor/membership/Postgres tests:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py tests/test_server_account_membership.py -q
```

Result:

```text
57 passed in 1.48s
```

Backend compile:

```bash
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py
```

Result:

```text
pass
```

Repository whitespace:

```bash
rtk git diff --check
```

Result:

```text
pass
```

## Remaining Backend Gap

The real Postgres schema fixture now covers the main channel, DM, thread,
scope-mismatch, missing-session, unjoined active Server, and monotonic channel
write paths. The cheaper ASGI/fake-session tests still cover one edge that is
intentionally not duplicated in Postgres: emitted SQL text scoping assertions.
