# Chat Read Cursor lastReadSeq Input Hardening

## Goal

Continue the multi-round optimization loop on the backend read-cursor contract by
hardening `POST /api/v1/chat/read-cursors` input parsing for `lastReadSeq`.

The previous cursor slices added backend-owned channel/DM/thread read cursors
and validated thread `lastSeenMessageId`. This slice closes the next boundary:
cursor writes must reject malformed or negative `lastReadSeq` inputs with a
clear HTTP 400 instead of silently treating them as 0 or allowing a raw
`ValueError` to escape as a 500.

This is a child of:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization
```

## Current Facts

- `backend/routers/public_api.py:update_chat_read_cursor` currently computes:

```python
last_read_seq = int(body.get("lastReadSeq") or body.get("last_read_seq") or 0)
```

- That expression conflates absent, explicit empty, `0`, negative, float-like,
  and malformed values.
- Backend service helpers are intentionally monotonic and clamp read-state
  derivation, but route input validation should happen before service writes.
- Existing tests cover monotonic writes, DM/channel kind rejection, thread
  `lastSeenMessageId` validation, and several HTTP/Postgres route flows.

## In Scope

- Add route-level validation helper for `lastReadSeq` / `last_read_seq`.
- Accept absent `lastReadSeq` as 0 for compatibility.
- Accept integer `0` and positive integers.
- Accept string integer forms like `"12"` if existing clients send JSON strings.
- Reject explicit empty strings, whitespace-only strings, non-integers, floats,
  booleans, objects, arrays, and negative values with HTTP 400.
- Ensure channel, DM, and thread cursor route paths all use the validated value.
- Add focused HTTP tests for malformed and negative values.
- Add or update source/service tests so future agents do not reintroduce raw
  `int(body.get(...))` parsing.
- Record review and validation evidence.

## Out Of Scope

- Changing read cursor storage schema.
- Changing monotonic update behavior.
- Changing read-state projection math.
- Frontend unread UI changes.
- Backend storage of ink/material resources.
- Browser proof; this is an API contract slice.

## Requirements

### R1. Explicit Parser

`update_chat_read_cursor` must call a named helper rather than parsing inline
with `int(body.get(...) or ...)`.

The helper must preserve explicit body-key presence:

- if `lastReadSeq` exists, it wins;
- else if `last_read_seq` exists, it wins;
- else default to 0.

### R2. Accepted Values

Accepted:

- missing field -> `0`;
- integer `0`;
- positive integer;
- string containing base-10 integer digits, after trimming whitespace.

### R3. Rejected Values

Rejected with HTTP 400:

- empty string;
- whitespace-only string;
- negative integer;
- negative string;
- float or float-like string;
- boolean;
- object;
- array;
- null when explicitly supplied.

The response detail should be stable enough for tests, for example:

```text
Invalid lastReadSeq
```

### R4. Route Coverage

The same validated sequence value must be used by:

- channel cursor writes;
- DM cursor writes;
- thread cursor writes.

### R5. Monotonic Behavior Preserved

Valid lower values should still not move a cursor backwards. This slice changes
input validity, not monotonic semantics.

## Acceptance Criteria

- [ ] RED test proves malformed `lastReadSeq` currently fails incorrectly.
- [ ] Channel cursor HTTP tests reject malformed and negative `lastReadSeq`
      with HTTP 400.
- [ ] Thread cursor HTTP tests reject malformed and negative `lastReadSeq` with
      HTTP 400 before writing a cursor.
- [ ] Existing channel/DM/thread valid cursor tests remain green.
- [ ] Source test proves route code no longer uses raw
      `int(body.get("lastReadSeq") or ...)` parsing.
- [ ] Backend cursor HTTP and Postgres cursor tests pass.
- [ ] Backend compile passes for changed router/service/test files.
- [ ] Frontend unread-state tests still pass if touched or relevant.
- [ ] `git diff --check` and task validation pass.
- [ ] Trellis check worker reviews the slice, or self-review is recorded if
      worker startup fails.
