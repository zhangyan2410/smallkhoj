# Postgres Monotonic Scope Completion Evidence

Date: 2026-07-06

## Scope

This slice completed the remaining practical Postgres HTTP monotonicity matrix
for chat read cursors.

Previous evidence already covered real temporary-Postgres route-flow
monotonicity for public channel cursors. This pass added the same route-boundary
and real-database coverage for:

- DM channel-member read cursors;
- thread/root-message read cursors.

No production backend code was changed. The new tests passed immediately,
confirming that the existing service behavior was already correct and the gap
was evidence coverage rather than implementation.

## Files Changed

```text
backend/tests/test_chat_read_cursors_postgres_http.py
```

Task artifacts:

```text
.trellis/tasks/07-06-chat-read-cursor-postgres-monotonic-scope-completion/prd.md
.trellis/tasks/07-06-chat-read-cursor-postgres-monotonic-scope-completion/design.md
.trellis/tasks/07-06-chat-read-cursor-postgres-monotonic-scope-completion/implement.md
.trellis/tasks/07-06-chat-read-cursor-postgres-monotonic-scope-completion/implement.jsonl
.trellis/tasks/07-06-chat-read-cursor-postgres-monotonic-scope-completion/check.jsonl
```

## Tests Added

### `test_postgres_http_dm_cursor_write_is_monotonic`

This test creates a temporary Postgres schema, seeds an authenticated account,
active Server membership, DM channel, and `ChannelMember(last_read_seq=20)`,
then posts a retrograde DM cursor with `lastReadSeq=7` through the real ASGI
route:

```text
POST /api/v1/chat/read-cursors
```

It proves:

- response status is `200`;
- response cursor remains `lastReadSeq = 20`;
- response scope remains `{ kind: "dm", channelId }`;
- persisted `channel_members.last_read_seq` remains `20`.

### `test_postgres_http_thread_cursor_write_is_monotonic_and_preserves_last_seen`

This test creates a temporary Postgres schema, seeds an authenticated account,
active Server membership, channel, root message, older reply, current reply, and
an existing `ChatThreadReadCursor(last_read_seq=31,
last_seen_message_id=current_reply.id)`. It then posts a retrograde thread
cursor with `lastReadSeq=10` and `lastSeenMessageId=older_reply.id` through the
real ASGI route.

It proves:

- response status is `200`;
- response cursor remains `lastReadSeq = 31`;
- response `lastSeenMessageId` remains the current reply id;
- persisted `chat_thread_read_cursors.last_read_seq` remains `31`;
- persisted `last_seen_message_id` is not replaced by the older reply id.

## Red-Green Note

Both new tests passed on first run:

```text
2 passed in 0.90s
```

Interpretation: this was a coverage-hardening slice for already-correct
production behavior. There was no production bug to fix.

## Validation

Focused new tests:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest \
  tests/test_chat_read_cursors_postgres_http.py::test_postgres_http_dm_cursor_write_is_monotonic \
  tests/test_chat_read_cursors_postgres_http.py::test_postgres_http_thread_cursor_write_is_monotonic_and_preserves_last_seen -q
```

Result:

```text
2 passed in 0.90s
```

Focused Postgres HTTP file:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_postgres_http.py -q
```

Result:

```text
9 passed in 1.76s
```

Combined backend cursor/account/Postgres suite:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py tests/test_server_account_membership.py -q
```

Result:

```text
83 passed in 1.80s
```

Backend compile:

```bash
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors_postgres_http.py
```

Result: pass.

Repository whitespace:

```bash
rtk git diff --check
```

Result: pass.

## Remaining Browser Status

Browser/mobile proof is out of scope for this backend slice. The parent task's
`./twd` blocker still applies until a connected browser tab is available.
