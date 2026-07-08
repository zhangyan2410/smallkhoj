# Check Brief: Chat Read Cursor Thread Last-Seen Contract

Active task:

```text
.trellis/tasks/07-06-07-06-chat-read-cursor-thread-last-seen-contract
```

Please review the uncommitted diff for this backend slice against:

- `.trellis/tasks/07-06-07-06-chat-read-cursor-thread-last-seen-contract/prd.md`
- `.trellis/tasks/07-06-07-06-chat-read-cursor-thread-last-seen-contract/design.md`
- `.trellis/tasks/07-06-07-06-chat-read-cursor-thread-last-seen-contract/implement.md`
- `.trellis/spec/backend/event-delivery-contracts.md`
- `.trellis/spec/backend/threading-contracts.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`

Intended slice-specific files:

- `backend/routers/public_api.py`
- `backend/tests/test_chat_read_cursors.py`
- `backend/tests/test_chat_read_cursors_http.py`

Important context:

- This worktree already contains many unrelated uncommitted changes from the
  broader Inkframe branch. Do not revert unrelated files.
- This slice only validates thread cursor `lastSeenMessageId` ownership.
- Browser proof is not expected; this is backend HTTP/API behavior.

Main-session validation already run:

```text
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_http.py -q
PASS 14

rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
PASS 35

rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py
PASS

rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
PASS 13

rtk git diff --check
PASS

rtk python3 .trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-chat-read-cursor-thread-last-seen-contract
PASS
```

Review focus:

1. Does `_resolve_thread_last_seen_message_id` correctly reject malformed,
   missing, and out-of-thread messages?
2. Does it accept both root and reply messages for the target thread?
3. Does it preserve the existing channel/DM/read-seq behavior?
4. Are the fake HTTP tests strong enough, and do the Postgres tests still cover
   persistence?
