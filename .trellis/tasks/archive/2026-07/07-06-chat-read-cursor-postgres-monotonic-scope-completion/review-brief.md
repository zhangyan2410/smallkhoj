# Review Brief: Chat Read Cursor Postgres Monotonic Scope Completion

Active task:

```text
.trellis/tasks/07-06-chat-read-cursor-postgres-monotonic-scope-completion
```

Please review this narrow backend hardening slice.

## What Changed

Added a new detailed Trellis task under the Inkframe product refactor:

- `prd.md`
- `design.md`
- `implement.md`
- `implement.jsonl`
- `check.jsonl`
- `evidence/postgres-monotonic-scope-completion.md`

Added two real temporary-Postgres ASGI route-flow tests to:

```text
backend/tests/test_chat_read_cursors_postgres_http.py
```

New tests:

- `test_postgres_http_dm_cursor_write_is_monotonic`
- `test_postgres_http_thread_cursor_write_is_monotonic_and_preserves_last_seen`

## Review Focus

Please prioritize bugs and missing tests. In particular:

- Do the new tests cross the real ASGI route boundary rather than calling route
  handlers directly?
- Do they use the real temporary Postgres schema fixture safely?
- Does the DM test prove a retrograde DM cursor write keeps the existing
  `channel_members.last_read_seq`?
- Does the thread test prove a retrograde thread cursor write keeps the
  existing `chat_thread_read_cursors.last_read_seq` and preserves
  `last_seen_message_id`?
- Is the evidence honest that this was coverage hardening, not a production code
  fix?
- Any cleanup needed around fixture repetition should be treated as optional
  unless it hides a correctness bug.

## Validation Already Run

```text
new focused tests: 2 passed
Postgres HTTP file: 9 passed
combined backend cursor/account/Postgres suite: 83 passed
backend compile: pass
git diff --check: pass
```

Do not commit, push, pull, reset, or merge.
