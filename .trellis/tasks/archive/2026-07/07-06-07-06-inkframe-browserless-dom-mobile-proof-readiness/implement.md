# Implementation Plan: Browserless DOM Contract And Mobile Proof Readiness

## Phase 0: Preflight

1. Confirm worktree and branch.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git branch --show-current
rtk git status --short
```

Expected:

```text
codex/inkframe-object-ui
dirty tree is expected
```

2. Read scope docs:

```bash
rtk sed -n '1,260p' .trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness/prd.md
rtk sed -n '1,260p' .trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness/design.md
rtk sed -n '1,320p' .trellis/tasks/07-05-inkframe-product-ui-refactor/prd.md
rtk sed -n '1,260p' .trellis/tasks/07-05-inkframe-product-ui-refactor/evidence/merged-scope-lock.md
```

3. Read relevant frontend specs:

```bash
rtk sed -n '1,220p' .trellis/spec/frontend/component-guidelines.md
rtk sed -n '1,220p' .trellis/spec/frontend/product-ui-style.md
rtk sed -n '1,220p' .trellis/spec/frontend/quality-guidelines.md
```

## Phase 1: Inventory Current DOM Contracts

1. Inspect current attributes and material markers.

```bash
rtk rg -n "data-inkframe|MaterialSurface|AppDeskBackground|MessageFrame|TaskMaterialSurface|mobile-role|pointer-capture" frontend/app frontend/components frontend/test
```

2. Write:

```text
.trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness/evidence/dom-contract-inventory.md
```

Required sections:

- current product shell background markers;
- current chat message/material markers;
- current task/evidence/review markers;
- current mobile markers;
- gaps to fix in this task.

## Phase 2: Product Shell And Material Surface DOM Contract

Files likely modified:

- `frontend/components/inkframe/material-surface.tsx`
- `frontend/components/inkframe/app-desk-background.tsx`
- `frontend/components/product-shell.tsx`
- `frontend/test/material-surface.test.tsx`
- `frontend/test/inkframe-object-ui.test.tsx`

Steps:

1. Add failing tests for shell background DOM attributes:
   owner kind, owner id, region, mode, tint, pointer capture.

2. Add or adjust attributes on real components, not wrapper-only test shims.

3. Add tests that static mode renders no active material canvas and active mode
   renders exactly one active canvas for that surface.

4. Run focused tests:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx test/inkframe-object-ui.test.tsx
```

Expected: pass.

## Phase 3: Chat DOM Contract

Files likely modified:

- `frontend/components/message-frame.tsx`
- `frontend/app/chat/[channel]/channel-client.tsx`
- `frontend/app/chat/[channel]/chat-sidebar.tsx`
- `frontend/test/inkframe-object-ui.test.tsx`
- `frontend/test/chat-unread-state.test.ts`
- optionally a new focused test file if existing tests become too broad.

Steps:

1. Add tests for chat message markers:
   `data-inkframe-object="message"`, owner kind/id, density, toolbar state.

2. Add tests/source assertions for one-active foreground surface marker in chat.

3. Add tests/source assertions that unread/event markers remain tied to cursor
   state helpers and not decorative-only route styling.

4. Add mobile role markers for chat:
   message list, composer, sidebar drawer/switcher.

5. Run:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/chat-unread-state.test.ts
```

## Phase 4: Task DOM Contract

Files likely modified:

- `frontend/components/task-board.tsx`
- `frontend/components/task-dnd-board.tsx`
- `frontend/components/task-list-panel.tsx`
- `frontend/components/task-material-state.tsx`
- `frontend/test/task-board-hydration.test.tsx`
- `frontend/test/inkframe-object-ui.test.tsx`

Steps:

1. Add tests for distinct task/evidence/review object markers.

2. Add markers for mobile task access:
   active ticket/detail/evidence/review/task controls.

3. Add tests that ordinary task lists default to static material surfaces and
   do not render unbounded active canvases.

4. Run:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/task-board-hydration.test.tsx test/inkframe-object-ui.test.tsx test/material-surface.test.tsx
```

## Phase 5: Browser Proof Checklist

Create:

```text
.trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness/evidence/twd-proof-checklist.md
```

Include:

- `rtk ./twd --compact tabs` gate;
- exact selectors for product shell background;
- chat desktop selector checks;
- chat mobile selector checks;
- task desktop selector checks;
- task mobile selector checks;
- material pointer-capture/canvas-count checks;
- instruction to stop and record "no browser proof claimed" if no tab is
  connected.

Do not use Playwright.

## Phase 6: Validation

Run target matrix:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/chat-unread-state.test.ts \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false
```

Repository:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
rtk ./twd --compact tabs
```

If tabs are connected, run the checklist. If tabs are not connected, record that
browser/mobile proof remains pending.

## Phase 7: Review

Dispatch a check worker:

```text
Active task: .trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness

Review the DOM contract/mobile proof readiness work. Prioritize false-positive
tests, fake markers, missing mobile affordance markers, unbounded active canvas
risks, and any place browser proof is claimed without a connected `./twd` tab.
```

Fix findings and rerun focused checks.

## Definition Of Done

- DOM contract inventory written.
- Product shell/material/chat/task/mobile markers are present on real
  components.
- Focused frontend tests prove marker and canvas-count contracts.
- `twd-proof-checklist.md` exists with exact selector plan.
- Lint/typecheck/diff-check pass.
- Check worker or main-session review is recorded.
- Browser evidence is either captured with `./twd` or explicitly recorded as
  blocked by no connected tab.
