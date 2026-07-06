# Source Contract Validation

## Scope

Task: `07-06-07-06-chat-read-cursor-last-read-seq-input-hardening`

Changed contract:

- `POST /api/v1/chat/read-cursors` now parses `lastReadSeq` / `last_read_seq`
  through `_parse_read_cursor_last_read_seq`.
- Missing value defaults to `0`.
- Integer and trimmed decimal-string values are accepted.
- Explicit `null`, empty strings, whitespace-only strings, negatives, floats,
  booleans, objects, arrays, and malformed strings return HTTP 400 with
  `Invalid lastReadSeq`.
- Channel, DM, and thread cursor paths share the same parsed value.

This slice is part of the larger unread/event cursor work from:

- `.trellis/tasks/07-02-chat-event-unread-indicators`
- `.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization`

## RED

Command:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors.py -q
```

Observed expected failures before implementation:

```text
test_http_channel_cursor_rejects_malformed_last_read_seq_without_commit
  expected 400, got 500

test_http_channel_cursor_rejects_negative_last_read_seq_without_commit
  expected 400, got 200

test_http_thread_cursor_rejects_malformed_last_read_seq_without_commit
  ValueError: invalid literal for int() with base 10: '1.5'

test_http_thread_cursor_rejects_negative_last_read_seq_without_commit
  expected 400, got 200

test_public_api_uses_named_last_read_seq_parser_for_read_cursor_route
  missing def _parse_read_cursor_last_read_seq
```

This proved the route still used raw `int(body.get(...))` parsing and accepted
negative values through the service layer.

## GREEN

Focused backend tests after implementation:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
```

Result:

```text
57 passed in 2.02s
```

Compile check:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py
```

Result:

```text
pass
```

Frontend unread compatibility:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
```

Result:

```text
13 passed
```

Repository whitespace:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result:

```text
pass
```

Task validation:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-chat-read-cursor-last-read-seq-input-hardening
```

Result:

```text
All validations passed
```

## Notes

- Browser proof is intentionally not claimed for this slice; it is an API input
  contract task.
- The frontend unread-state test was run only as compatibility evidence that
  the cursor request contract still lines up with the UI adapter.

## Review

Trellis channel:

```text
cr-07-06-chat-read-cursor-last-read-seq-input
```

Attempted check worker:

```bash
rtk trellis channel spawn cr-07-06-chat-read-cursor-last-read-seq-input --agent check --provider codex --as check-codex ...
```

Outcome:

```text
check-codex was killed by the supervisor timeout after 20 minutes before it
produced a final review.
```

Self-review performed in the main session:

- Inspected parser implementation at `backend/routers/public_api.py`.
- Inspected route-level HTTP coverage for channel and thread invalid writes.
- Inspected parser source/unit coverage for accepted values, rejected values,
  and `lastReadSeq` precedence over `last_read_seq`.
- Found no additional required fixes.

Post-review validation was rerun:

```text
backend cursor tests: 57 passed
backend py_compile: pass
frontend unread compatibility: 13 passed
git diff --check: pass
task.py validate: pass
```

## 2026-07-06 Continuation

The task context manifests were updated from seed-only `_example` rows to real
backend spec entries:

- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/event-delivery-contracts.md`
- `.trellis/spec/backend/threading-contracts.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`

Main session reran validation:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
```

Result:

```text
57 passed in 2.02s
```

```bash
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py
```

Result:

```text
pass
```

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
```

Result:

```text
13 passed
```

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-chat-read-cursor-last-read-seq-input-hardening
rtk git diff --check
```

Result:

```text
pass
```
