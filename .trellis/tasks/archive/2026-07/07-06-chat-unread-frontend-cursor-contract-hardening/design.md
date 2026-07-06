# Design: Chat Unread Frontend Cursor Contract Hardening

## Contract Shape

The frontend has three layers of unread state:

```text
Backend projection
  -> channel/DM objects from /api/v1/channels and /api/v1/dms
  -> unreadCount / hasUnread

Backend cursor fallback
  -> /api/v1/chat/read-cursors
  -> lastReadSeq per channel/DM/thread
  -> derive latestSeq - lastReadSeq when projection is absent

Local pending overlay
  -> localStorage small count map
  -> realtime events that arrive before server projection refreshes
```

Priority:

```text
backend projection > backend cursor fallback > local pending overlay
```

The local overlay may increase what the user sees until backend state catches
up, but it must not become the long-term source of truth.

## Key Model

Use explicit stable keys:

```text
channel:id:<channelId>
channel:name:<routeName>   // fallback only
dm:id:<channelId>
dm:name:<routeName>        // fallback only
thread:id:<rootMessageId>
```

Backend read cursors use id keys only. Realtime browser events may use id and/or
name because payloads can differ by source.

## Write Model

Sidebar active entity:

```text
active channel/DM entity
-> clear local overlay
-> chatReadCursorRequestForEntity(entity)
-> POST /api/v1/chat/read-cursors
-> suppress stale server projection for keys at readSeq
```

Thread active entity:

```text
visible thread messages
-> chatReadCursorRequestForThread(rootMessageId, messages)
-> POST /api/v1/chat/read-cursors
-> clear local thread marker and zero root message thread projection
```

## Test Strategy

Because real browser proof is blocked, this task relies on:

- pure unit tests for helper behavior;
- static source assertions that real chat routes still call backend cursor write
  APIs;
- existing backend HTTP/Postgres tests for server semantics.

Static source assertions are not a substitute for browser proof, but they catch
the most likely regression while no tab is connected: a future refactor removes
the cursor write and leaves only local badge clearing.

## Known Limit

The test file can prove helper contracts and route source anchors. It cannot
prove actual click/hover/mobile behavior. That must remain in
`07-06-inkframe-browser-connection-mobile-proof`.

## Review Focus

Reviewers should check:

- whether tests assert real contracts rather than implementation trivia;
- whether source assertions are narrow enough to catch accidental cursor-write
  removal but not so brittle that formatting breaks them;
- whether browser claims remain absent;
- whether helper behavior matches backend route tests.
