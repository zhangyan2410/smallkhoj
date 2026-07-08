# Design: Chat Read Cursor lastReadSeq Input Hardening

## Contract Shape

`POST /api/v1/chat/read-cursors` receives a JSON body with a cursor scope and an
optional sequence:

```json
{
  "scope": { "kind": "channel", "channelId": "..." },
  "lastReadSeq": 12
}
```

The public API router is the right boundary for input validation. Service
helpers such as `mark_channel_read` and `upsert_thread_read_cursor` should
continue receiving an already-valid non-negative integer.

## Parser

Add a small helper in `backend/routers/public_api.py` near the other
read-cursor helpers:

```python
def _parse_read_cursor_last_read_seq(body: dict) -> int:
    ...
```

Recommended behavior:

1. If `"lastReadSeq" in body`, use that value.
2. Else if `"last_read_seq" in body`, use that value.
3. Else return `0`.
4. Reject `None`, booleans, lists, dicts, empty strings, floats, and negatives.
5. For strings, trim whitespace and allow only decimal digits.

Python gotcha: `bool` is a subclass of `int`, so reject booleans before accepting
integers.

## Error Semantics

Use `HTTPException(400, "Invalid lastReadSeq")` for all invalid sequence shapes.
Do not expose Python conversion details.

## Tests

Primary test file:

```text
backend/tests/test_chat_read_cursors_http.py
```

Add HTTP tests against the route so the parser is exercised through the same
path as production:

- channel cursor rejects `"bad"`;
- channel cursor rejects `-1`;
- thread cursor rejects `""` or `"1.5"`;
- thread cursor rejects `-1`;
- valid string integer `"12"` still writes.

Optional source/unit test:

```text
backend/tests/test_chat_read_cursors.py
```

Add a source guard proving the route calls `_parse_read_cursor_last_read_seq`
and no longer contains the old raw `int(body.get(...))` expression.

## Compatibility

Absent sequence remains `0` for compatibility. Existing frontend cursor writes
send real message seq values, so this should not change normal UI behavior.

## Review Focus

Reviewers should check:

- no valid clients are broken by rejecting only malformed/negative values;
- booleans do not pass as integers;
- thread path validates `lastReadSeq` before writing `ChatThreadReadCursor`;
- monotonic service behavior remains unchanged;
- tests prove HTTP 400 rather than accidental 500.
