# Check Brief

Please review the read-cursor input hardening slice.

Task:

```text
.trellis/tasks/07-06-07-06-chat-read-cursor-last-read-seq-input-hardening
```

Diff scope:

```text
backend/routers/public_api.py
backend/tests/test_chat_read_cursors.py
backend/tests/test_chat_read_cursors_http.py
.trellis/tasks/07-06-07-06-chat-read-cursor-last-read-seq-input-hardening/evidence/source-contract-validation.md
```

Review focus:

- `POST /api/v1/chat/read-cursors` no longer uses raw
  `int(body.get("lastReadSeq") or body.get("last_read_seq") or 0)` parsing.
- Missing `lastReadSeq` remains compatible and defaults to `0`.
- Valid `int` and trimmed decimal string values are accepted.
- Explicit invalid shapes return HTTP 400 `Invalid lastReadSeq`:
  `null`, empty/blank string, negative int/string, float/float-like string,
  boolean, object, array, malformed string.
- `lastReadSeq` wins over `last_read_seq` when both are supplied.
- Channel, DM, and thread cursor paths all use the validated value.
- Valid monotonic cursor behavior is unchanged.
- Invalid channel/thread writes do not commit or mutate cursor state.

Validation already run:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
# 55 passed

rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py
# pass

cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
# 13 passed

cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
# pass

rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-chat-read-cursor-last-read-seq-input-hardening
# pass
```

Known context:

- This is a backend child slice of
  `.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization`.
- The older `.trellis/tasks/07-02-chat-event-unread-indicators` PRD is part of
  the parent acceptance frame; this slice hardens the backend cursor write
  contract that supports those unread indicators.
