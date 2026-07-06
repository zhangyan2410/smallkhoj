# Implementation Plan: Inkframe Background Image Resource And Readability Contract

## Phase 0: Preflight

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
rtk cat .trellis/spec/frontend/component-guidelines.md
rtk cat .trellis/spec/frontend/product-ui-style.md
rtk cat .trellis/spec/frontend/quality-guidelines.md
rtk cat .trellis/spec/frontend/state-management.md
rtk cat .trellis/spec/guides/index.md
```

## Phase 1: Read Anchors

```bash
rtk sed -n '1,260p' frontend/components/product-shell.tsx
rtk sed -n '1,260p' frontend/components/inkframe/app-desk-background.tsx
rtk sed -n '1,320p' frontend/components/inkframe/material-surface.tsx
rtk sed -n '1,260p' frontend/components/inkframe/material-resource.ts
rtk sed -n '1,360p' frontend/test/inkframe-object-ui.test.tsx
rtk sed -n '1,360p' frontend/test/material-surface.test.tsx
rtk sed -n '1,260p' frontend/test/material-resource.test.ts
```

## Phase 2: RED Tests

Before production changes, add focused tests that fail if missing:

- app background default resource reports `app-background` / `desk`;
- image-seeded app background resource keeps `app-background` / `desk` /
  `image` metadata;
- discard fallback for app background returns to desk owner/tint;
- inactive background exposes non-interactive pointer contract;
- route coverage includes the exact PRD route set and rejects duplicate
  page-local backgrounds.

Run:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts
```

Expected RED only if the contract is not already covered.

## Phase 3: Minimal Implementation

Likely files:

```text
frontend/components/product-shell.tsx
frontend/components/inkframe/app-desk-background.tsx
frontend/components/inkframe/material-surface.tsx
frontend/components/inkframe/material-resource.ts
frontend/test/inkframe-object-ui.test.tsx
frontend/test/material-surface.test.tsx
frontend/test/material-resource.test.ts
```

Rules:

- preserve existing component APIs where possible;
- add explicit metadata hooks instead of brittle class assertions;
- keep styling in components/primitives, not route pages;
- do not introduce blob persistence;
- do not create route-local background owners.

## Phase 4: Validation

Focused:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts test/material-surface-restore.test.ts
rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false
```

Repo:

```bash
cd ..
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability
```

Browser gate:

```bash
./twd --compact tabs
```

If no connected tab, record `blocked_no_tab` and do not claim visible
acceptance.

## Phase 5: Evidence

Write:

```text
.trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability/evidence/contract-validation.md
```

Include:

- RED/GREEN behavior;
- commands and results;
- whether production code changed;
- route coverage summary;
- browser proof status.

## Phase 6: Review

Because broad check workers can time out on this dirty branch, prefer one of:

1. Spawn a tightly scoped check worker with only task files and the exact changed
   files.
2. If worker startup or completion fails again, record main-session self-review
   in evidence with file/line anchors.

## Definition Of Done

- Task PRD/design/implement exist.
- Focused tests pass.
- TypeScript passes if production code changes.
- `git diff --check` passes.
- `task.py validate` passes.
- Browser acceptance is honest.
- Review or self-review is recorded.
