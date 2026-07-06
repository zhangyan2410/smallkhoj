# Implementation Plan: Inkframe Mobile Shell Drawer Reachability

## Phase 0: Preflight

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py current
rtk git status --short --branch
rtk sed -n '1,260p' .trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability/prd.md
rtk sed -n '1,260p' .trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability/design.md
rtk sed -n '1,260p' .trellis/spec/frontend/quality-guidelines.md
rtk sed -n '1,260p' .trellis/spec/frontend/product-ui-style.md
```

## Phase 1: Test First

Add a failing source contract test before changing `ProductShellBody`.

Target:

```text
frontend/test/material-surface.test.tsx
```

Assertions:

- `ProductShellBody` source contains
  `data-inkframe-mobile-role="sidebar-drawer-toggle"`;
- toggle has `aria-controls` and `aria-expanded`;
- drawer has stable id and `data-inkframe-state` open/collapsed logic;
- close control exists;
- drawer content scroll owner has `min-h-0`, `min-w-0`, and
  `overflow-y-auto`;
- desktop classes such as `sm:flex` and resize handle remain present.

Run:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Confirm red for the missing drawer-toggle contract.

## Phase 2: Minimal Implementation

Change:

```text
frontend/components/product-shell-body.tsx
```

Implementation guidance:

- add `useState(false)` for mobile drawer open state;
- render a mobile-only toggle when `isThreeColumn` is true;
- give the drawer a stable id such as `inkframe-mobile-sidebar-drawer`;
- switch drawer `data-inkframe-state` between `open` and `collapsed`;
- include a mobile close control inside the drawer;
- keep desktop `sm:flex` and resizable width behavior;
- do not introduce a new visual language; use existing `Button`/ink-border
  language if already imported or simple button classes if avoiding cycles.

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
rtk npx eslint components/product-shell-body.tsx test/material-surface.test.tsx
```

Repo checks:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability
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
.trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability/evidence/source-contract-validation.md
```

Include red/green notes, commands, results, reviewer status, and browser gate
status.

## Phase 5: Review

Spawn a check worker through Trellis channel with:

```text
Active task: .trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability
```

Review focus:

- mobile drawer reachability is real in source, not just a marker;
- test couples marker/classes to the same element;
- desktop three-column layout remains intact;
- no browser acceptance is claimed while `./twd` is no-tab.

## Definition Of Done

- Red/green test loop completed.
- Focused and broader source tests pass.
- Type/lint checks pass.
- Browser gate result recorded truthfully.
- Check worker review completed or provider failure recorded with self-review.
