# Implementation Plan: Inkframe Task Board Mobile Containment

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
rtk sed -n '760,900p' frontend/app/tasks/page.tsx
rtk sed -n '1,120p' frontend/components/task-dnd-board.tsx
rtk sed -n '120,360p' frontend/components/task-board.tsx
rtk sed -n '760,1180p' frontend/components/task-board.tsx
rtk sed -n '300,620p' frontend/test/material-surface.test.tsx
```

## Phase 2: Test First

Add a failing source contract test to:

```text
frontend/test/material-surface.test.tsx
```

Expected RED reason: at least one of the current task board/filter containment
requirements is missing, such as `task-filters`, `TaskDndBoard` wrapper
containment, or the board grid's one-column mobile base.

Run:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

## Phase 3: Minimal Implementation

Likely production files:

```text
frontend/app/tasks/page.tsx
frontend/components/task-dnd-board.tsx
frontend/components/task-board.tsx
```

Expected edits:

- add `data-inkframe-mobile-role="task-filters"` and containment to the filter
  surface;
- add `min-w-0 overflow-x-hidden` to `TaskDndBoard` wrapper;
- add a contained `TaskBoard` root;
- switch board grid mobile base from `grid-cols-2` to `grid-cols-1`;
- add `min-w-0` / `overflow-x-hidden` to status columns, task stacks,
  sortable cards, list rows, and drag overlay hosts where needed.

## Phase 4: Validation

Focused:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Regression:

```bash
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
rtk npx tsc --noEmit --pretty false
rtk npx eslint app/tasks/page.tsx components/task-dnd-board.tsx components/task-board.tsx test/material-surface.test.tsx
```

Repo:

```bash
cd ..
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-task-board-mobile-containment
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
.trellis/tasks/07-06-07-06-inkframe-task-board-mobile-containment/evidence/source-contract-validation.md
```

Include:

- RED failure;
- GREEN commands/results;
- browser gate status;
- check worker findings.

## Phase 6: Review

Spawn a Trellis check worker with PRD/design/implement plus changed files. Fix
mechanical findings, then rerun focused validation.

## Definition Of Done

- Source contract test was red before implementation.
- Focused and regression frontend tests pass.
- TypeScript, scoped lint, diff check, and task validation pass.
- Check review complete or self-review recorded.
- Browser/mobile proof remains honestly marked pending if no tab is connected.
