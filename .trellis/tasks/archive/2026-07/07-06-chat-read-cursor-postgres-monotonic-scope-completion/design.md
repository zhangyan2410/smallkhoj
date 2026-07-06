# Design: Chat Read Cursor Postgres Monotonic Scope Completion

## Boundary

This is a backend verification-hardening slice. The production contract already
exists in:

- `backend/services/chat_read_cursors.py`
- `backend/routers/public_api.py`
- `backend/tests/test_chat_read_cursors_postgres_http.py`

The new evidence belongs at the same layer as the existing Postgres HTTP tests:
real FastAPI ASGI requests, real public API headers, a temporary Postgres
schema, and real SQLAlchemy persistence.

## Data Flow

```text
HTTP POST /api/v1/chat/read-cursors
-> public API key + account token auth
-> active Server/member resolution
-> scope validation
-> mark_channel_read(...) or upsert_thread_read_cursor(...)
-> db.commit()
-> serialized cursor response
-> direct SELECT against temporary Postgres schema
```

## Monotonic Contract

Channel and DM cursors share `channel_members.last_read_seq`. DM differs only by
`channels.type = 'dm'` and response scope kind. A retrograde write must never
lower `last_read_seq`.

Thread cursors use `chat_thread_read_cursors.last_read_seq`. A retrograde write
must never lower the sequence and must not replace `last_seen_message_id` with
an older message.

## Implementation Strategy

Prefer adding tests only. The current service code appears to satisfy both
contracts:

- `mark_channel_read(...)` uses `_monotonic_seq(...)`.
- `upsert_thread_read_cursor(...)` only updates `last_seen_message_id` when the
  proposed sequence advances.

If a new Postgres HTTP test fails, fix the backend service/API at the smallest
boundary that owns the bug. Do not paper over failures in the test harness.

## Risk

The test file currently repeats schema/session setup per case. Keep this task
scoped: add focused tests following the existing style rather than refactoring
the whole fixture in the same pass.
