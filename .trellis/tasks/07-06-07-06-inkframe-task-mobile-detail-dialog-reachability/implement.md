# Implementation Plan: Task Mobile Detail Dialog Reachability

## Phase 0: Preflight

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py current
rtk git status --short --branch
rtk sed -n '1,240p' .trellis/spec/frontend/quality-guidelines.md
rtk sed -n '1,260p' .trellis/spec/frontend/product-ui-style.md
rtk sed -n '1,260p' .trellis/spec/frontend/component-guidelines.md
```

## Phase 1: Test First

Add a failing source contract test to:

```text
frontend/test/material-surface.test.tsx
```

Assertions:

- `TaskDetailDialog` `DialogContent` has
  `data-inkframe-mobile-role="task-detail-dialog"`;
- the same `DialogContent` class has viewport width, `100svh` max height,
  `overflow-x-hidden`, and `overflow-y-auto`;
- `TaskRouteDetailMaterialFrame` passes `min-w-0` and `overflow-x-hidden`;
- evidence form row/input classes are contained with `min-w-0`;
- review note input includes `min-w-0`.

Run the focused test and confirm RED:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

## Phase 2: Minimal Implementation

Change:

```text
frontend/components/task-detail-dialog.tsx
frontend/components/task-material-state.tsx
frontend/app/tasks/page.tsx
```

Expected changes:

- add `data-inkframe-mobile-role="task-detail-dialog"` to `DialogContent`;
- replace dialog class with explicit mobile viewport containment;
- add `min-w-0 overflow-x-hidden` to `TaskRouteDetailMaterialFrame` default
  class;
- add `min-w-0` to evidence form row and flexible inputs;
- add `min-w-0` to review note input.

## Phase 3: Validation

Focused:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Broader source/mobile:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
```

Type/lint:

```bash
cd frontend
rtk npx tsc --noEmit --pretty false
rtk npx eslint components/task-detail-dialog.tsx components/task-material-state.tsx \
  app/tasks/page.tsx test/material-surface.test.tsx
```

Repo/task:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-07-06-inkframe-task-mobile-detail-dialog-reachability
```

Browser gate:

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

## Phase 4: Evidence

Write:

```text
.trellis/tasks/07-06-07-06-inkframe-task-mobile-detail-dialog-reachability/evidence/source-contract-validation.md
```

Include red/green notes, commands, results, and browser gate status.

## Phase 5: Review

Spawn a Trellis check worker with:

```text
Active task: .trellis/tasks/07-06-07-06-inkframe-task-mobile-detail-dialog-reachability
```

Review focus:

- dialog mobile containment is on the actual `DialogContent`;
- evidence/review containment is bound to actual row/input elements;
- no browser acceptance is claimed while `./twd` has no tab;
- no unrelated visual redesign.

