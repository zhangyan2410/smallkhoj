# Backend Route-Flow Evidence

Date: 2026-07-06

## Scope

This pass strengthened read-cursor backend tests from mostly source-text checks
to route-handler-level flow checks.

The tests now call:

- `public_api.update_chat_read_cursor(...)`
- `public_api.get_chat_read_cursors(...)`

with a fake active server/member context and fake async DB session.

This proves the route handler boundary through:

```text
active server context -> route handler -> channel/thread access check ->
chat_read_cursors service -> DB session add/flush/commit -> serializer payload
```

It is stronger than a source-text assertion, but it is not yet a full ASGI
`TestClient` / HTTP authentication test. The current backend public API tests in
this area mostly call handler functions directly, so a full authenticated HTTP
harness remains a future hardening step.

## Tests Added

File:

```text
backend/tests/test_chat_read_cursors.py
```

Added route-flow tests:

- `test_update_chat_read_cursor_route_writes_channel_cursor_with_active_context`
- `test_update_chat_read_cursor_route_writes_dm_cursor_with_dm_scope`
- `test_update_chat_read_cursor_route_writes_thread_cursor_with_active_context`
- `test_get_chat_read_cursors_route_lists_channel_dm_and_thread_cursors`

Support added to existing fake test utilities:

- `_ExecuteResult.all()`
- `_ExecuteResult.scalars()`
- `_FakeSession.commit()`
- `_JsonRequest`

## Verification

Command:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py -q
```

Result:

```text
14 passed in 0.26s
```

## Coverage Matrix

| Requirement | Current evidence |
|---|---|
| Channel cursor route write | Covered by handler-level route-flow test |
| DM cursor route write | Covered by handler-level route-flow test |
| Thread cursor route write | Covered by handler-level route-flow test |
| GET cursor list projection | Covered by handler-level route-flow test |
| Monotonic writes | Covered by service tests for channel/thread helpers |
| Server/member scoping | Covered by route-flow tests asserting active context ids are used and by server membership regression list |
| Channel/DM kind mismatch rejection | Covered by source-level route regression strings; still not full handler-flow |
| Actual unread count with global sequence gaps | Covered by source/service projection tests from previous loop; still not full handler-flow |

## Remaining Backend Hardening

The next backend test improvement should add either:

- a reusable authenticated public API route harness; or
- handler-level tests for mismatch rejection and unread count projection that
  use fake DB rows instead of source-text checks.

