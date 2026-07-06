# Source Contract Validation

## Scope

This backend slice hardens `POST /api/v1/chat/read-cursors` for thread cursor
writes. `lastSeenMessageId` is now validated as part of the requested thread:
the root message itself or a reply whose `parent_id` is that root.

Changed files for this slice:

- `backend/routers/public_api.py`
- `backend/tests/test_chat_read_cursors.py`
- `backend/tests/test_chat_read_cursors_http.py`

## Red-Green Evidence

RED:

```text
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_http.py -q

FAILED test_http_thread_cursor_rejects_last_seen_message_outside_thread
assert 200 == 400

FAILED test_http_thread_cursor_rejects_malformed_last_seen_message_id
ValueError: badly formed hexadecimal UUID string
```

GREEN:

```text
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_http.py -q
14 passed
```

## Implemented Contract

- Added route-level validation helper:
  `routers.public_api._resolve_thread_last_seen_message_id`.
- Accepted `lastSeenMessageId` only when:
  - it is the root message id; or
  - it belongs to a reply with `parent_id == root.id`.
- Rejected malformed UUIDs with:
  `400 Invalid thread lastSeenMessageId`.
- Rejected missing messages with:
  `400 Thread lastSeenMessageId not found`.
- Rejected out-of-thread messages with:
  `400 Thread lastSeenMessageId must belong to the thread`.
- Kept monotonic `lastReadSeq` behavior unchanged.

## Validation Commands

```text
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
35 passed

rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py
PASS

rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
13 passed

rtk git diff --check
PASS

rtk python3 .trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-chat-read-cursor-thread-last-seen-contract
PASS
```

## Browser Proof

Not applicable for this backend contract slice. This is API behavior covered by
backend HTTP and Postgres-backed tests.

## Check Worker Review

Review channel:

```text
cr-07-06-chat-read-cursor-last-seen-contract
```

Worker result:

- Checked 11 files across router, cursor tests, backend specs, and task docs.
- Found and fixed 5 issues.
- No open issues remained for this slice.

Fixes applied by the check worker:

- Explicit empty-string `lastSeenMessageId` is now treated as malformed instead
  of absent.
- `body.lastSeenMessageId` presence is preserved before falling back to
  `scope.lastSeenMessageId`, so an explicitly supplied empty value cannot be
  hidden by scope fallback.
- The HTTP fake DB now resolves `Message` lookups by the compiled UUID
  parameter, making the test double prove the submitted id is actually queried.
- Added coverage for unrelated root messages as invalid thread
  `lastSeenMessageId` values.
- Added coverage for explicitly empty `lastSeenMessageId` values.

Worker verification:

```text
rtk env UV_CACHE_DIR=/private/tmp/uv-cache PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py
PASS

rtk env UV_CACHE_DIR=/private/tmp/uv-cache PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_http.py -q
16 passed

rtk env UV_CACHE_DIR=/private/tmp/uv-cache PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
30 passed, 7 skipped

rtk git diff --check
PASS

rtk python3 .trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-chat-read-cursor-thread-last-seen-contract
PASS
```

Main-session follow-up verification after the worker fixes:

```text
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
37 passed

rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py
PASS

rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
13 passed

rtk git diff --check
PASS

rtk python3 .trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-chat-read-cursor-thread-last-seen-contract
PASS
```
