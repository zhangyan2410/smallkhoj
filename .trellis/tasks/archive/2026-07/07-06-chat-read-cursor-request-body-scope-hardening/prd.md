# Chat read cursor request body and scope hardening

## Goal

Harden POST /api/v1/chat/read-cursors so non-object JSON bodies and invalid scope shapes return stable 400 errors instead of leaking AttributeError/500 behavior.

## Requirements

- `POST /api/v1/chat/read-cursors` must validate the decoded JSON body before
  any `.get(...)` access.
- Non-object JSON bodies (`null`, array, string, number, boolean) must return
  HTTP 400 with a stable product error instead of leaking `AttributeError` or a
  framework 500.
- When `scope` is present it must be a JSON object. Explicit `scope: null`,
  arrays, strings, booleans, and numbers must return HTTP 400 with a stable
  scope-shape error.
- Missing `scope` remains acceptable for the existing top-level thread fallback
  shape (`{"kind":"thread","threadId":...}`); existing valid channel, DM, and
  thread request shapes must keep their current responses.
- Body and scope validation must happen before database writes/commits.
- The `lastReadSeq` hardening from the previous child task remains binding and
  must not regress.
- This task is part of the parent `07-06` delivery and carries the earlier
  `07-02` chat unread/event cursor contract forward. It is backend/API
  hardening for that product surface, not a separate visual task.

## Acceptance Criteria

- [ ] Route-level HTTP tests prove non-object JSON bodies return 400, not 500.
- [ ] Route-level HTTP tests prove present non-object `scope` values return 400
      without committing.
- [ ] Route-level HTTP tests prove a valid object body with a missing `scope`
      but top-level thread fallback still works.
- [ ] Existing channel, DM, thread, monotonic-write, and `lastReadSeq`
      validation tests remain green.
- [ ] `backend/routers/public_api.py` compiles.
- [ ] Frontend chat unread-state compatibility tests remain green.
- [ ] Trellis task validation passes.

## Notes

- No persistence model changes are included here. This is input-boundary
  hardening for the backend read cursor endpoint.
