# Implementation Plan: Inkframe Material Source Image Fidelity And Foreground Contrast Proof

## Phase 0: Preflight

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
rtk python3 ./.trellis/scripts/task.py start .trellis/tasks/07-06-inkframe-material-source-image-fidelity-contrast
```

Read:

```text
.trellis/tasks/07-06-inkframe-material-source-image-fidelity-contrast/prd.md
.trellis/tasks/07-06-inkframe-material-source-image-fidelity-contrast/design.md
.trellis/spec/frontend/component-guidelines.md
.trellis/spec/frontend/product-ui-style.md
.trellis/spec/frontend/quality-guidelines.md
.trellis/spec/frontend/state-management.md
.trellis/spec/guides/cross-layer-thinking-guide.md
```

## Phase 1: RED Tests

Add failing tests first. Candidate tests:

- `material-resource.test.ts`
  - app-background image resources must have distinct visual/restore/source
    object URLs;
  - foreground image resources, such as `message` or `task`, must preserve the
    same channel separation;
  - storage APIs are absent from material/resource/background code.
- `material-surface-restore.test.ts`
  - restore image loads and bakes before source image load/composition;
  - source color is skipped only when the resource has no source URL.
- `inkframe-object-ui.test.tsx`
  - foreground shell regions expose readable paper/contrast ownership hooks;
  - foreground regions are above the background layer and do not rely on the
    app background as direct text backdrop.
- `twd-inkframe-proof.test.mjs`
  - future connected-browser checks include background source-mode and
    foreground contrast selectors.

Run the focused test expected to fail:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-resource.test.ts test/material-surface-restore.test.ts test/inkframe-object-ui.test.tsx
```

## Phase 2: Minimal Implementation

Only after RED:

- add minimal metadata hooks on `AppDeskBackground`, `MaterialSurface`, or
  `ProductShellBody` if tests need stable selectors;
- strengthen resource helper tests without changing runtime behavior if the
  implementation already satisfies the contract;
- add proof-runner selector definitions only if they can be checked later with a
  connected tab and do not broaden browser claims now.

Do not add visible upload controls.
Do not add persistence.
Do not change chat/task styling beyond contrast hooks.

## Phase 3: Validation

Focused frontend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-resource.test.ts test/material-surface-restore.test.ts test/material-surface.test.tsx test/inkframe-object-ui.test.tsx
rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false
```

Proof runner if touched:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
```

Repo:

```bash
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-inkframe-material-source-image-fidelity-contrast
rtk ./twd --compact tabs
```

If tabs are empty, record `blocked_no_tab`.

## Phase 4: Review

Spawn a narrow check worker with:

```text
prd.md
design.md
implement.md
check.jsonl
changed source/test files
```

Ask the reviewer to focus on:

- whether channel separation is actually proven;
- whether contrast hooks are meaningful rather than decorative;
- whether any storage/persistence path slipped in;
- whether browser proof is honestly classified.

## Definition Of Done

- RED/GREEN evidence recorded.
- Focused tests pass.
- Typecheck passes if production code changes.
- `git diff --check` passes.
- `task.py validate` passes.
- Check review has no open P1/P2, or fixes are recorded.
- Browser evidence is captured or honestly `blocked_no_tab`.
