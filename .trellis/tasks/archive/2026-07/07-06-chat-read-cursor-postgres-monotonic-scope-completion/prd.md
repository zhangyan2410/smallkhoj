# Chat Read Cursor Postgres Monotonic Scope Completion

## Goal

Complete the backend evidence matrix for chat read cursor monotonicity by moving
the remaining DM and thread retrograde-write checks across the real ASGI route
boundary and a real temporary Postgres schema.

This is a narrow follow-up under
`07-05-inkframe-product-ui-refactor` and
`07-06-07-06-inkframe-twd-evidence-http-cursor-harness`. The previous harness
already proves channel monotonicity through real Postgres. This task closes the
same evidence gap for DM and thread cursor scopes without changing the product
UI direction.

## Confirmed Facts

- Current worktree: `/Users/code/project/smallkhoj-inkframe-object-ui`
- Current branch: `codex/inkframe-object-ui`
- Parent product task:
  `.trellis/tasks/07-05-inkframe-product-ui-refactor`
- Related harness task:
  `.trellis/tasks/07-06-07-06-inkframe-twd-evidence-http-cursor-harness`
- Existing backend service behavior:
  - `mark_channel_read(...)` is monotonic for both public channel and DM
    channel-member cursors.
  - `upsert_thread_read_cursor(...)` is monotonic for thread/root-message
    cursors and preserves `last_seen_message_id` on retrograde writes.
- Existing real Postgres HTTP coverage already includes:
  - channel cursor POST/GET;
  - DM cursor POST/GET;
  - thread cursor POST/GET;
  - channel cursor monotonicity;
  - mismatch rejection;
  - missing-session and unjoined-server rejection.

## Requirements

### R1. DM Cursor Retrograde Writes Are Proven Through Real HTTP + Postgres

Add a Postgres-backed ASGI HTTP test that starts with a DM channel membership at
a higher `last_read_seq`, posts an older DM read cursor through
`POST /api/v1/chat/read-cursors`, and proves:

- HTTP status is `200`;
- returned cursor stays at the higher existing sequence;
- persisted `channel_members.last_read_seq` remains unchanged;
- scope serialization stays `{ kind: "dm", channelId }`.

### R2. Thread Cursor Retrograde Writes Are Proven Through Real HTTP + Postgres

Add a Postgres-backed ASGI HTTP test that starts with an existing
`chat_thread_read_cursors` row at a higher sequence, posts an older thread read
cursor through `POST /api/v1/chat/read-cursors`, and proves:

- HTTP status is `200`;
- returned cursor stays at the higher existing sequence;
- persisted `chat_thread_read_cursors.last_read_seq` remains unchanged;
- `last_seen_message_id` is not replaced by the older write's message id;
- scope serialization stays `{ kind: "thread", rootMessageId }`.

### R3. No Product-Scope Drift

This task may only touch backend tests, backend cursor code if a test exposes a
real bug, and task evidence. It must not alter Inkframe UI styling, WebGL
material behavior, or browser-evidence claims.

## Acceptance Criteria

- [ ] A real Postgres ASGI test covers retrograde DM cursor writes.
- [ ] A real Postgres ASGI test covers retrograde thread cursor writes.
- [ ] If existing code fails either test, the minimal backend service/API fix is
      implemented.
- [ ] Focused Postgres HTTP tests pass.
- [ ] Combined backend cursor/account/Postgres tests pass.
- [ ] Backend compile passes for touched modules/tests.
- [ ] `git diff --check` passes.
- [ ] Evidence records whether this was a code fix or coverage-hardening pass.
- [ ] Browser/mobile proof remains explicitly out of scope for this slice unless
      `./twd` becomes connected during the turn.

## Out Of Scope

- New read cursor API shapes.
- Frontend unread UI changes.
- Browser/mobile `./twd` proof.
- Backend persistence for large material/image blobs.
- Changing cursor monotonic semantics.
