# Chat Read Cursor Thread Last-Seen Contract

## Goal

Start the backend phase of the multi-round optimization loop by hardening the
backend-owned chat read cursor implementation. The current branch already adds
channel, DM, and thread cursor persistence; this slice closes a correctness gap:
`lastSeenMessageId` for a thread cursor must refer to the thread root itself or
one of that root's replies. It must not accept an arbitrary message id from a
different channel, server, or thread.

This is a child of:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization
```

and satisfies part of R5:

```text
Backend-owned Chat Read/Event Cursors
```

## Current Facts

- `POST /api/v1/chat/read-cursors` supports `kind: "thread"`.
- The route resolves the root message and checks channel access.
- The route currently converts `lastSeenMessageId` to UUID and passes it to
  `upsert_thread_read_cursor`.
- There is no visible validation that `lastSeenMessageId` belongs to the same
  thread root.
- `ChatThreadReadCursor.last_seen_message_id` has a database foreign key to
  `messages.id`, but a plain FK only proves the message exists, not that it is
  the correct thread.

## In Scope

- Validate optional `lastSeenMessageId` for thread cursor writes.
- Accept:
  - the root message id itself;
  - a reply whose `parent_id` is the root message id.
- Reject:
  - malformed UUIDs;
  - missing messages;
  - messages in another thread;
  - root messages from another channel/thread;
  - replies whose `parent_id` is not this root.
- Keep channel/DM cursor behavior unchanged.
- Add HTTP-level fake DB tests and source/route tests as needed.
- Run focused backend tests and check worker review.

## Out Of Scope

- Frontend cursor projection changes.
- Database migration tooling beyond existing model/table contracts.
- Changing unread count semantics.
- Browser evidence; this is backend API behavior.

## Requirements

### R1. Thread Last-Seen Ownership

For `scope.kind === "thread"`, if the request includes `lastSeenMessageId`,
the backend must verify the message is either:

```text
message.id == root.id
```

or:

```text
message.parent_id == root.id
```

before persisting it.

### R2. Error Semantics

Invalid or out-of-thread `lastSeenMessageId` must produce HTTP 400 and must not
commit the database session.

### R3. Existing Cursor Semantics

The monotonic `lastReadSeq` contract stays unchanged. Older writes must not move
the cursor backward.

### R4. Evidence

Add a failing test first, then implement the minimal route/helper change.

## Acceptance Criteria

- [ ] A test fails before implementation because out-of-thread
      `lastSeenMessageId` is accepted.
- [ ] Out-of-thread `lastSeenMessageId` returns HTTP 400.
- [ ] Missing/malformed `lastSeenMessageId` returns HTTP 400 when supplied.
- [ ] Valid root/reply `lastSeenMessageId` still persists.
- [ ] Existing channel, DM, thread, and Postgres cursor tests remain green or
      are explicitly skipped only when local Postgres is unavailable.
- [ ] Type/lint or equivalent syntax gates pass.
- [ ] Check worker reviews the slice.
