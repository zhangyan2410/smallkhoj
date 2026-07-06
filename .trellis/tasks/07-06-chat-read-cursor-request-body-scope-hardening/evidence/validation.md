# Validation

Date: 2026-07-06

## TDD RED

Command:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_http.py -q
```

Expected failures before implementation:

- non-object JSON read-cursor bodies returned HTTP 500 instead of stable 400;
- present non-object `scope` values returned `Missing channel cursor scope`
  instead of the new explicit shape error.

Result:

```text
10 failed, 22 passed
```

## GREEN / Regression

Command:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_http.py -q
```

Result:

```text
32 passed
```

Command:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
```

Result:

```text
68 passed
```

Command:

```bash
cd backend
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py
```

Result:

```text
pass
```

Command:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
```

Result:

```text
13 passed
```

Command:

```bash
rtk git diff --check
```

Result:

```text
pass
```

Command:

```bash
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-chat-read-cursor-request-body-scope-hardening
```

Result:

```text
implement.jsonl: pass
check.jsonl: pass
All validations passed
```

## Browser/TWD Status

Command:

```bash
rtk ./twd --compact tabs
```

Result:

```json
{"ok": true, "tabs": [], "count": 0}
```

Exit code: `2`.

Classification: `blocked_no_tab`. This backend hardening slice is covered by
HTTP and frontend compatibility tests, but no connected browser tab is
available for live UI proof.
