# Design

## Current Failure Shape

`update_chat_read_cursor()` currently does:

```python
body = await request.json()
scope = body.get("scope") if isinstance(body.get("scope"), dict) else {}
kind = scope.get("kind") or body.get("kind")
```

That assumes `request.json()` produced a dict. JSON arrays, strings, and `null`
can therefore raise `AttributeError` before the route reaches the existing
HTTPException-based error contract.

The current `scope` handling also silently treats present non-object values as
missing. For a public write endpoint, explicit malformed scope should be a
client error, not a fallback.

## Boundary Helpers

Add small route-local parser helpers near `_parse_read_cursor_last_read_seq()`:

- `_parse_read_cursor_request_body(raw: object) -> dict`
  - accepts only dict;
  - rejects every other decoded JSON value with
    `HTTPException(400, "Invalid read cursor request body")`.
- `_parse_read_cursor_scope(body: dict) -> dict`
  - returns `{}` when `scope` is absent;
  - returns `scope` when it is a dict;
  - rejects present non-dict scope values with
    `HTTPException(400, "Invalid read cursor scope")`.

The route then becomes:

```python
body = _parse_read_cursor_request_body(await request.json())
scope = _parse_read_cursor_scope(body)
kind = scope.get("kind") or body.get("kind")
```

This keeps validation at the public API boundary, before authorization context
resolution and before writes/commits.

## Compatibility

Keep existing accepted shapes:

- channel/DM with object `scope`;
- thread with object `scope`;
- thread with top-level `kind` and `threadId` fallback.

Do not add new channel/DM top-level fallback semantics in this task; that would
expand the API surface rather than harden it.

## Error Contract

- Non-object body: `400 Invalid read cursor request body`.
- Present non-object scope: `400 Invalid read cursor scope`.
- Unsupported or incomplete scope after shape validation keeps existing errors
  such as `Unsupported read cursor scope`, `Missing channel cursor scope`, and
  `Missing thread cursor scope`.
