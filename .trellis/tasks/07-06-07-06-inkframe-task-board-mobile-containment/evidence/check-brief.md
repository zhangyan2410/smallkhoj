# Check Brief

Please review the completed Tasks page mobile board containment slice.

## Scope

Task:

```text
.trellis/tasks/07-06-07-06-inkframe-task-board-mobile-containment
```

Changed files to inspect:

```text
frontend/app/tasks/page.tsx
frontend/components/task-dnd-board.tsx
frontend/components/task-board.tsx
frontend/test/material-surface.test.tsx
.trellis/tasks/07-06-07-06-inkframe-task-board-mobile-containment/evidence/source-contract-validation.md
```

## What Changed

- Added `data-inkframe-mobile-role="task-filters"` to the filter object surface.
- Added `min-w-0 overflow-x-hidden` containment to filter, task board wrapper,
  TaskBoard root, status columns, task stacks, sortable task card wrappers,
  list rows, source chips, and drag overlay.
- Changed the board grid mobile base from two columns to one column, preserving
  `sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5` for larger widths.
- Strengthened source tests so `task-board-root` must belong to the real
  TaskBoard root, not a nearby detail component.

## Validation Already Run

```text
material-surface.test.tsx: 21 pass
inkframe regression set: 41 pass
tsc --noEmit --pretty false: pass
eslint scoped changed files: pass
git diff --check: pass
task.py validate: pass
twd-inkframe-proof: blocked_no_tab
```

## Review Questions

- Does the source test assert the actual containment owners?
- Did the hook naming correctly distinguish `task-board-root` from
  `task-detail-inline`?
- Is the one-column mobile board base the right product-safe default?
- Is browser evidence honestly marked blocked?
