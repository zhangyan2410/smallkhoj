# Check Brief

Please review the completed chat mobile containment slice.

## Scope

Task:

```text
.trellis/tasks/07-06-07-06-inkframe-chat-mobile-composer-message-containment
```

Changed files to inspect:

```text
frontend/app/chat/[channel]/channel-client.tsx
frontend/components/message-frame.tsx
frontend/test/material-surface.test.tsx
.trellis/tasks/07-06-07-06-inkframe-chat-mobile-composer-message-containment/evidence/source-contract-validation.md
```

## What Changed

- Added a source contract test for chat mobile message/composer/thread
  containment.
- Hardened the chat message inner stack with `min-w-0`.
- Hardened `MessageFrame` message body/content containment.
- Hardened chat composer region with `min-w-0 overflow-x-hidden`.
- Made `ChatComposerSurface` wrap on narrow widths with `flex-wrap items-end`.
- Hardened main input and thread reply input as `min-w-0 flex-1`.
- Hardened thread scroller/reply composer containment.
- Re-ran previous chat unread/event frontend cursor tests so the earlier
  Trellis task remains included in this round.

## Validation Already Run

```text
material-surface.test.tsx: 20 pass
chat-unread-state.test.ts: 13 pass
inkframe regression set: 40 pass
tsc --noEmit --pretty false: pass
eslint scoped changed files: pass
git diff --check: pass
task.py validate: pass
twd-inkframe-proof: blocked_no_tab
```

## Review Questions

- Does the test assert the actual containment owners rather than nearby
  wrappers?
- Did this accidentally introduce visual redesign or motion beyond containment?
- Is the thread reply path covered enough for a source-contract slice?
- Is the evidence honest about `./twd` being blocked?
