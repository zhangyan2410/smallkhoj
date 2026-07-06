# Inkframe Chat Mobile Composer Message Containment

## Goal

Harden the Chat page's mobile message and composer path so the Inkframe chat
surface remains usable on phone-sized layouts: message papers do not push the
workspace wider, the composer wraps instead of overflowing, and thread reply
controls follow the same containment contract.

This is a child of:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

It also carries forward the earlier chat unread/event task:

```text
.trellis/tasks/07-02-chat-event-unread-indicators
.trellis/tasks/07-06-chat-unread-frontend-cursor-contract-hardening
```

Unread/event behavior is already contract-hardened in a separate slice. This
task does not redesign those badges; it makes the surrounding chat surface
mobile-safe so unread markers, message tools, and material message cards have a
stable place to live.

## Current Facts

- `channel-client.tsx` already exposes stable chat mobile roles:
  `chat-workspace`, `chat-message-list`, `chat-composer`, `chat-thread-panel`,
  and `chat-members-panel`.
- `chat-tab-strip` is already source-tested for horizontal containment.
- `chat-message-list` has `min-h-0 min-w-0 flex-1 overflow-x-hidden
  overflow-y-auto`, but the source contract does not yet pin the inner stack or
  message frame body.
- `chat-composer` owns the bottom input surface, but its region lacks explicit
  `min-w-0 overflow-x-hidden`, and its inner composer row currently uses
  `items-center` without a source-tested mobile wrap contract.
- The main input and thread reply input use `className="flex-1"`, which can be
  unsafe in a constrained flex row without `min-w-0`.
- Real browser/mobile proof remains blocked until `./twd` has a connected tab.

## In Scope

- Add source-tested mobile containment to:
  - `chat-message-list`;
  - the message list inner stack;
  - `MessageFrame` root/body/message body;
  - `chat-composer`;
  - the main `ChatComposerSurface` row and content input;
  - the thread panel message scroller and thread reply composer.
- Keep the work to layout/contract hardening. Do not introduce a new visual
  design or new WebGL behavior in this slice.
- Re-run the earlier chat unread/event contract validation so the previous
  Trellis task remains included in this round.
- Record browser proof status honestly.

## Out Of Scope

- Full chat visual redesign.
- Changing unread cursor backend APIs or realtime semantics.
- Creating new notification center behavior.
- Persisting Inkframe material blobs.
- Launching Chrome or using Playwright.
- Replacing `ProductShell`.

## Requirements

### R1. Message List Scroll Owner

The `chat-message-list` element must remain the mobile scroll owner:

```text
min-h-0
min-w-0
flex-1
overflow-x-hidden
overflow-y-auto
```

The inner message stack must also be `min-w-0` so long markdown/code/message
content stays inside the scroll owner.

### R2. MessageFrame Containment

`MessageFrame` must preserve the avatar plus paper layout without letting
message content widen the viewport:

```text
data-slot="message-frame" -> min-w-0
message body wrapper -> min-w-0 flex-1
message body/content -> min-w-0 overflow-x-hidden
```

This is especially important for long agent output and markdown content.

### R3. Composer Region Containment

`chat-composer` must be a contained bottom region:

```text
shrink-0
min-w-0
overflow-x-hidden
border-t-2
```

The inner `ChatComposerSurface` must support phone-width wrapping instead of
forcing one wide row.

### R4. Composer Controls

The message input must be `min-w-0 flex-1` and the composer surface must allow
controls to wrap while keeping icon buttons and the task toggle reachable.

### R5. Thread Panel Reply Composer

The thread panel's reply row must use the same containment grammar:

```text
min-w-0
overflow-x-hidden where needed
input -> min-w-0 flex-1
```

### R6. Previous Chat Unread Task Included

This round must explicitly re-run or reference validation for
`07-06-chat-unread-frontend-cursor-contract-hardening`, because it is part of
the user's earlier Trellis request.

### R7. Evidence Honesty

Run `./twd` proof if a tab is available. If the tool reports no connected tab,
record that status and do not claim browser-visible acceptance.

## Acceptance Criteria

- [ ] Source tests fail before implementation for at least one missing chat
      mobile containment contract.
- [ ] `chat-message-list` and its inner message stack are source-tested.
- [ ] `MessageFrame` root/body/content containment is source-tested.
- [ ] `chat-composer` region and inner composer surface are source-tested.
- [ ] Main chat input is source-tested as `min-w-0 flex-1`.
- [ ] Thread reply composer/input containment is source-tested.
- [ ] Focused frontend tests pass.
- [ ] Relevant TypeScript and scoped lint pass.
- [ ] Previous unread/frontend cursor tests pass in this same round.
- [ ] `git diff --check` and task validation pass.
- [ ] Check worker review is attempted and findings are fixed or recorded.
- [ ] Browser/mobile acceptance is not claimed while `./twd` remains
      `blocked_no_tab`.
