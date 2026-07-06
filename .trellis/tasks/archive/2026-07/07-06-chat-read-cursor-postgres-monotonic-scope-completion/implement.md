# Implementation Plan: Chat Read Cursor Postgres Monotonic Scope Completion

## Phase 0: Preflight

1. Read the active PRD/design and relevant backend specs.
2. Confirm the current branch/worktree.
3. Inspect existing Postgres HTTP test patterns.

## Phase 1: DM Monotonic Test

1. Add a failing/coverage test to
   `backend/tests/test_chat_read_cursors_postgres_http.py`:
   `test_postgres_http_dm_cursor_write_is_monotonic`.
2. Seed:
   - Server, member, account, active membership;
   - DM channel;
   - `ChannelMember(last_read_seq=20)`.
3. POST an older DM cursor with `lastReadSeq=7`.
4. Assert:
   - response status `200`;
   - response cursor `lastReadSeq == 20`;
   - direct DB row remains `20`;
   - response scope kind is `dm`.
5. Run the single test and inspect whether it fails for a real product reason.

## Phase 2: Thread Monotonic Test

1. Add a failing/coverage test to
   `backend/tests/test_chat_read_cursors_postgres_http.py`:
   `test_postgres_http_thread_cursor_write_is_monotonic_and_preserves_last_seen`.
2. Seed:
   - Server, member, account, active membership;
   - public channel and membership;
   - root message, current seen reply, older reply;
   - `ChatThreadReadCursor(last_read_seq=31, last_seen_message_id=current_reply.id)`.
3. POST an older thread cursor with `lastReadSeq=10` and
   `lastSeenMessageId=older_reply.id`.
4. Assert:
   - response status `200`;
   - response cursor `lastReadSeq == 31`;
   - response `lastSeenMessageId == current_reply.id`;
   - direct DB row remains sequence `31` and current seen id.
5. Run the single test and inspect whether it fails for a real product reason.

## Phase 3: Minimal Fix If Needed

If either test fails:

1. Identify whether the bug is in route validation, service monotonicity, or
   serialization.
2. Fix only the owning code path.
3. Re-run the red test until it passes.

If both tests pass immediately, record this as coverage hardening of existing
correct behavior, not a production code change.

## Phase 4: Validation And Evidence

Run:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_postgres_http.py -q
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py tests/test_server_account_membership.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors_postgres_http.py
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Write evidence to:

```text
.trellis/tasks/07-06-chat-read-cursor-postgres-monotonic-scope-completion/evidence/postgres-monotonic-scope-completion.md
```

Then request or perform review.
