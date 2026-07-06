# Implementation Plan: Inkframe App Background Material Action Contract

## Phase 0: Preflight

Read:

```text
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/prd.md
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/design.md
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/implement.md
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/evidence/integrated-execution-plan.md
.trellis/spec/frontend/quality-guidelines.md
.trellis/spec/guides/index.md
```

Inspect:

```text
frontend/components/inkframe/app-desk-background.tsx
frontend/components/inkframe/material-surface-lifecycle.ts
frontend/test/material-surface.test.tsx
frontend/test/inkframe-object-ui.test.tsx
```

## Phase 1: Red Test

Extend `frontend/test/material-surface.test.tsx` with tests that require:

- an importable `resolveAppDeskMaterialAction`;
- every app desk action maps to the expected material/pointer mode;
- pointer capture is true only for `draw` and `water`;
- source scan confirms no `localStorage`, `indexedDB`, or backend persistence is
  introduced in `app-desk-background.tsx`.

Run focused test and confirm it fails before the resolver export if possible:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

## Phase 2: Implementation

Modify:

```text
frontend/components/inkframe/app-desk-background.tsx
frontend/test/material-surface.test.tsx
```

Steps:

1. Rename or wrap the private `stateForAction` helper as
   `resolveAppDeskMaterialAction`.
2. Export it.
3. Use it inside the event listener.
4. Keep existing component attributes stable.
5. Add focused tests.

## Phase 3: Validation

Run:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx test/inkframe-object-ui.test.tsx
rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false
```

From repo root:

```bash
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract
```

Optional no-tab proof runner check:

```bash
rtk ./twd --compact tabs
```

If no tab is connected, record no browser proof claimed.

## Phase 4: Evidence And Review

Write:

```text
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/evidence/validation.md
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/evidence/check-review.md
```

Request a check agent if available. If not available, perform self-review and
record it honestly.
