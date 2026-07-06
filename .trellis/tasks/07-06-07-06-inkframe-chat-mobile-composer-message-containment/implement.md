# Implementation Plan: Inkframe Chat Mobile Composer Message Containment

## Phase 0: Preflight

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
rtk python3 ./.trellis/scripts/get_context.py --mode packages
rtk sed -n '1,220p' .trellis/spec/frontend/component-guidelines.md
rtk sed -n '1,220p' .trellis/spec/frontend/product-ui-style.md
rtk sed -n '1,220p' .trellis/spec/frontend/quality-guidelines.md
rtk sed -n '1,220p' .trellis/spec/guides/cross-layer-thinking-guide.md
```

## Phase 1: Read Anchors

```bash
rtk sed -n '1040,1475p' 'frontend/app/chat/[channel]/channel-client.tsx'
rtk sed -n '1475,1665p' 'frontend/app/chat/[channel]/channel-client.tsx'
rtk sed -n '1,260p' frontend/components/message-frame.tsx
rtk sed -n '260,620p' frontend/test/material-surface.test.tsx
```

## Phase 2: Test First

Add a failing source contract test to:

```text
frontend/test/material-surface.test.tsx
```

Expected RED reason: at least one chat composer/message/thread containment class
is missing from the current source.

Run:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

## Phase 3: Minimal Implementation

Likely production files:

```text
frontend/app/chat/[channel]/channel-client.tsx
frontend/components/message-frame.tsx
```

Expected changes:

- add `min-w-0 overflow-x-hidden` to `chat-composer`;
- add `flex-wrap items-end` and gap stability to `ChatComposerSurface`;
- change main input to `className="min-w-0 flex-1"`;
- add `min-w-0` to the message list inner stack;
- add message body/content containment in `MessageFrame`;
- add thread scroller/thread reply composer containment and thread input
  `min-w-0 flex-1`.

## Phase 4: Validation

Focused:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
```

Regression set:

```bash
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
rtk npx tsc --noEmit --pretty false
rtk npx eslint 'app/chat/[channel]/channel-client.tsx' components/message-frame.tsx test/material-surface.test.tsx
```

Repo:

```bash
cd ..
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-chat-mobile-composer-message-containment
```

Browser gate:

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

## Phase 5: Evidence

Write:

```text
.trellis/tasks/07-06-07-06-inkframe-chat-mobile-composer-message-containment/evidence/source-contract-validation.md
```

Include:

- RED failure;
- GREEN commands/results;
- previous unread task validation command/result;
- browser gate status.

## Phase 6: Review

Spawn a check worker with PRD/design/implement plus changed files. If a worker
cannot run, record a self-review in evidence.

## Definition Of Done

- Source contract test was red before implementation.
- Focused and regression frontend tests pass.
- Previous chat unread frontend cursor tests pass.
- TypeScript, scoped lint, diff check, and task validation pass.
- Check review attempted and recorded.
- Browser/mobile proof remains honestly marked pending if no tab is connected.
