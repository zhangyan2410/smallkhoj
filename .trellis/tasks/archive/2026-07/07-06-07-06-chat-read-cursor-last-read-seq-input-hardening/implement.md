# Implementation Plan: Chat Read Cursor lastReadSeq Input Hardening

## Phase 0: Preflight

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
rtk sed -n '1,260p' .trellis/spec/backend/event-delivery-contracts.md
rtk sed -n '1,260p' .trellis/spec/backend/threading-contracts.md
rtk sed -n '1,260p' .trellis/spec/backend/database-guidelines.md
rtk sed -n '1,240p' .trellis/spec/guides/cross-layer-thinking-guide.md
```

## Phase 1: Read Anchors

```bash
rtk sed -n '1640,1740p' backend/routers/public_api.py
rtk sed -n '1,140p' backend/services/chat_read_cursors.py
rtk sed -n '240,780p' backend/tests/test_chat_read_cursors_http.py
rtk sed -n '120,320p' backend/tests/test_chat_read_cursors.py
rtk sed -n '80,640p' backend/tests/test_chat_read_cursors_postgres_http.py
```

## Phase 2: RED Tests

Add tests before implementation:

- malformed channel `lastReadSeq` returns 400, not 500;
- negative channel `lastReadSeq` returns 400 and does not move cursor;
- malformed thread `lastReadSeq` returns 400 before writing;
- negative thread `lastReadSeq` returns 400 before writing;
- string integer `"12"` is accepted if not already covered;
- source guard rejects the old raw `int(body.get("lastReadSeq") or ...)`
  expression.

Run:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_http.py -q
```

Expected RED: one or more new tests fail because the current route uses raw
`int(...)`.

## Phase 3: Minimal Implementation

Production file:

```text
backend/routers/public_api.py
```

Implementation:

- add `_parse_read_cursor_last_read_seq(body: dict) -> int`;
- replace inline parsing in `update_chat_read_cursor`;
- raise `HTTPException(400, "Invalid lastReadSeq")` for invalid values;
- keep route scope validation order otherwise unchanged.

## Phase 4: Validation

Focused:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py
```

Frontend compatibility:

```bash
cd ../frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
```

Repository:

```bash
cd ..
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-chat-read-cursor-last-read-seq-input-hardening
```

## Phase 5: Evidence

Write:

```text
.trellis/tasks/07-06-07-06-chat-read-cursor-last-read-seq-input-hardening/evidence/source-contract-validation.md
```

Include RED/GREEN output, compile output, frontend compatibility test, diff
check, task validation, and review outcome.

## Phase 6: Review

Spawn a Trellis check worker with PRD/design/implement and changed files. Fix
findings, then rerun main-session validation.

## Definition Of Done

- RED test exists and fails before implementation.
- Invalid `lastReadSeq` shapes return HTTP 400.
- Valid writes and monotonic behavior remain green.
- Focused backend tests, compile, frontend unread compatibility, diff check,
  and task validation pass.
- Check review complete or self-review recorded.
