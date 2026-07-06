# Review Brief

Please review the task:

`.trellis/tasks/07-06-chat-read-cursor-request-body-scope-hardening`

## Scope

Harden `POST /api/v1/chat/read-cursors` so malformed decoded JSON body shapes
and malformed present `scope` shapes return stable 400 responses before any
route `.get(...)` access or database writes.

## Diff Focus

- `backend/routers/public_api.py`
  - adds `_parse_read_cursor_request_body()`;
  - adds `_parse_read_cursor_scope()`;
  - routes `update_chat_read_cursor()` through those helpers before using
    `.get(...)`.
- `backend/tests/test_chat_read_cursors_http.py`
  - adds malformed non-object body cases;
  - adds present non-object `scope` cases;
  - adds compatibility proof for top-level thread fallback without `scope`.

## Requirements To Check

- Non-object JSON bodies must return `400 Invalid read cursor request body`,
  not 500.
- Present non-object `scope` must return `400 Invalid read cursor scope`.
- Missing `scope` must still allow the existing top-level thread fallback shape.
- Existing `lastReadSeq`, channel, DM, thread, monotonic-write, and scope
  mismatch behavior must not regress.
- Validation should happen before commits/writes.

## Main Validation Already Run

```text
backend/tests/test_chat_read_cursors_http.py: 32 passed
backend cursor suite: 68 passed
backend py_compile: pass
frontend chat unread compatibility: 13 passed
git diff --check: pass
task.py validate: pass
./twd --compact tabs: blocked_no_tab (no connected tab, exit 2)
```

Please report P1/P2 blockers first with exact file/line references. If no
blockers, say `0 open` clearly.
