# Design

## Route Helper

Add a small backend helper in `routers/public_api.py`:

```text
_resolve_thread_last_seen_message(db, root, last_seen_message_id)
```

Behavior:

- `None` input returns `None`.
- malformed UUID raises `HTTPException(400, "Invalid thread lastSeenMessageId")`.
- no matching message raises `HTTPException(400, "Thread lastSeenMessageId not found")`.
- message is accepted only when `message.id == root.id` or
  `message.parent_id == root.id`.
- otherwise raise
  `HTTPException(400, "Thread lastSeenMessageId must belong to the thread")`.

Return the validated UUID or message object. The route only needs the UUID for
`upsert_thread_read_cursor`, so returning `message.id` is enough.

## Why Route-Level Validation

The service helper `upsert_thread_read_cursor` is intentionally low-level and
does not receive `db` access to inspect message ownership. The HTTP route owns
request validation because it already resolves root and channel access.

## Test Shape

Use `backend/tests/test_chat_read_cursors_http.py` fake ASGI route tests for
fast RED/GREEN behavior:

- valid root/reply still persists;
- invalid out-of-thread message returns 400 and `db.commits == 0`;
- malformed UUID returns 400 and `db.commits == 0`.

The fake session should recognize the validation query for `Message.id ==
last_seen_id`.
