# Chat Unread Frontend Cursor Contract Hardening

## Goal

Harden the frontend chat unread/event contract while real browser proof remains
blocked by no connected `./twd` tab.

The backend read cursor route boundary is now covered by fake-session ASGI tests
and real temporary Postgres schema tests. The next useful frontend step is to
make sure the real chat sidebar/thread code consumes that backend contract
correctly and does not regress into decorative-only unread badges.

This task is a child of:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

It complements, but does not replace:

```text
.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof
```

Browser/mobile acceptance still requires a connected `./twd` tab. This task
only strengthens unit/static contract evidence that can run without a browser.

## In Scope

- Audit and harden `frontend/lib/chat-unread-state.ts`.
- Audit and harden `frontend/hooks/use-chat-unread-store.ts`.
- Audit real usage in:
  - `frontend/app/chat/layout.tsx`
  - `frontend/app/chat/[channel]/chat-sidebar.tsx`
  - `frontend/app/chat/[channel]/channel-client.tsx`
- Add or refine unit/static tests in `frontend/test/chat-unread-state.test.ts`.
- Ensure channel, DM, and thread cursor request shapes match backend API:
  - `scope.kind = "channel" | "dm" | "thread"`
  - channel/DM use `channelId`
  - thread uses `rootMessageId`
  - `lastReadSeq` is monotonic from visible latest sequence
  - thread write includes `lastSeenMessageId` when available
- Ensure local pending unread overlay does not override backend-projected counts
  incorrectly.
- Ensure opening/active entity clears local decoration and writes backend cursor.
- Ensure tests do not rely on screenshots or browser-only state.

## Out Of Scope

- Real chat/task/mobile browser proof. That remains blocked until `./twd` has a
  connected tab.
- New backend cursor endpoints.
- New notification center design.
- IndexedDB/localStorage persistence for ink/material blobs.
- Full visual redesign of sidebar rows.
- Launching Chrome.

## Current Anchors

- `frontend/lib/chat-unread-state.ts`
- `frontend/hooks/use-chat-unread-store.ts`
- `frontend/test/chat-unread-state.test.ts`
- `frontend/app/chat/layout.tsx`
- `frontend/app/chat/[channel]/chat-sidebar.tsx`
- `frontend/app/chat/[channel]/channel-client.tsx`
- `backend/tests/test_chat_read_cursors_http.py`
- `backend/tests/test_chat_read_cursors_postgres_http.py`

## Requirements

### R1. Cursor Key Contract

Frontend cursor keys must match backend cursor payloads:

- channel cursor -> `channel:id:<channelId>`
- DM cursor -> `dm:id:<channelId>`
- thread cursor -> `thread:id:<rootMessageId>`

Name-based keys are allowed only as local realtime/event fallbacks, not as the
backend cursor identity.

### R2. Sidebar Entity Merge

`mergeChatReadCursorsIntoEntities(...)` must:

- preserve backend-projected `unreadCount`/`hasUnread` when present;
- derive unread from `latestSeq - lastReadSeq` only when backend projection is
  absent;
- clamp negative or missing sequence values to safe zero behavior;
- distinguish channel and DM scopes.

### R3. Active Entity Clear

When a channel or DM becomes active:

- local unread overlay for that entity is cleared;
- a backend cursor write request is created if the entity has an id and
  non-zero latest sequence;
- the sidebar suppresses stale server-projected unread after a successful write.

### R4. Thread Cursor Write

Opening a thread must build a backend cursor request from visible thread
messages:

- choose the highest `seq` message;
- write `lastReadSeq` equal to that highest visible sequence;
- include `lastSeenMessageId` for the highest visible message when it has an id;
- return `null` if there is no root message id or no readable sequence.

### R5. Realtime Overlay

Realtime events for non-active channels/DMs should increment a local pending
overlay, but duplicate/replayed event sequences must not inflate counts.

Thread unread markers can derive from backend projection or local realtime
overlay.

### R6. Evidence Honesty

This task may claim unit/static contract coverage only. It must not claim real
browser-visible acceptance.

## Acceptance Criteria

- [ ] `frontend/test/chat-unread-state.test.ts` covers channel, DM, and thread
      cursor keys/request shapes.
- [ ] Tests cover backend-projected unread counts as source of truth.
- [ ] Tests cover fallback derivation from backend cursors when projection is
      absent.
- [ ] Tests cover local realtime duplicate/replay suppression.
- [ ] Tests cover active entity backend cursor write source in the real sidebar
      code.
- [ ] Tests cover thread backend cursor write source in the real channel client
      code.
- [ ] Frontend unread tests pass with the repo's Node test runner.
- [ ] Relevant TypeScript compile or targeted test command passes.
- [ ] Evidence records that browser proof remains pending and is not claimed.
- [ ] A check agent reviews the contract hardening, or main session records
      self-review if worker providers fail.

## Guardrails

- Do not add decorative unread badges without backed state.
- Do not make localStorage the source of truth for read state; it is only a
  pending overlay.
- Do not remove backend cursor writes just because browser proof is unavailable.
- Do not touch large Inkframe material persistence.
- Do not use Playwright as a substitute for `./twd`.
