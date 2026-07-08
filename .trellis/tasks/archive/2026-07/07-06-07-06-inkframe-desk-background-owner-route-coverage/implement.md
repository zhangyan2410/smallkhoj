# Implementation Plan: Inkframe Desk Background Owner And Route Coverage

## Phase 0: Preflight

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
rtk python3 ./.trellis/scripts/get_context.py --mode packages
rtk sed -n '1,260p' .trellis/spec/frontend/component-guidelines.md
rtk sed -n '1,260p' .trellis/spec/frontend/product-ui-style.md
rtk sed -n '1,260p' .trellis/spec/frontend/quality-guidelines.md
rtk sed -n '1,240p' .trellis/spec/guides/cross-layer-thinking-guide.md
```

## Phase 1: Read Anchors

```bash
rtk sed -n '1,220p' frontend/components/product-shell.tsx
rtk sed -n '1,220p' frontend/components/inkframe/app-desk-background.tsx
rtk sed -n '1,260p' frontend/components/inkframe/material-surface.tsx
rtk sed -n '1,240p' frontend/components/inkframe/material-resource.ts
rtk sed -n '1,260p' frontend/test/inkframe-object-ui.test.tsx
rtk sed -n '1,260p' frontend/test/material-surface.test.tsx
rtk sed -n '1,240p' frontend/test/material-resource.test.ts
```

## Phase 2: Test First

Add or strengthen failing tests before implementation:

- product shell has one app-background owner and one engine script loader;
- user-facing route coverage includes every route in the PRD;
- user-facing routes do not directly mount `AppDeskBackground`;
- app-background material resource keeps owner/tint and three resource channels.

Run focused tests:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/material-resource.test.ts
```

Expected RED: at least one source contract should fail before implementation,
most likely missing route coverage or missing app-background resource owner
assertions.

## Phase 3: Minimal Implementation

Likely production/test files:

```text
frontend/components/product-shell.tsx
frontend/components/inkframe/app-desk-background.tsx
frontend/components/inkframe/material-resource.ts
frontend/test/inkframe-object-ui.test.tsx
frontend/test/material-surface.test.tsx
frontend/test/material-resource.test.ts
```

Expected edits:

- add stable data slots if the shell/background owner contract needs clearer
  selectors;
- ensure `ProductShell` remains the only direct owner of `AppDeskBackground`;
- ensure any missing user-facing routes compose `ProductShell` or entry-surface
  dry-paper styling;
- strengthen resource helpers/tests without introducing persistence;
- do not add broad styling in page code.

## Phase 4: Validation

Focused:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/material-resource.test.ts
```

Regression:

```bash
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/material-resource.test.ts \
  test/material-surface-restore.test.ts \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
rtk npx tsc --noEmit --pretty false
rtk npx eslint \
  components/product-shell.tsx \
  components/inkframe/app-desk-background.tsx \
  components/inkframe/material-resource.ts \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/material-resource.test.ts
```

Repository:

```bash
cd ..
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-desk-background-owner-route-coverage
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
.trellis/tasks/07-06-07-06-inkframe-desk-background-owner-route-coverage/evidence/source-contract-validation.md
```

Include:

- RED failure;
- GREEN commands/results;
- browser gate status;
- check worker findings.

## Phase 6: Review

Spawn a Trellis check worker with PRD/design/implement plus changed files. Fix
findings, then rerun focused validation.

## Definition Of Done

- Source/component tests were red before implementation.
- Focused and regression frontend tests pass.
- TypeScript, scoped lint, diff check, and task validation pass.
- Check review complete or self-review recorded.
- Browser/mobile proof remains honestly marked pending if no tab is connected.
