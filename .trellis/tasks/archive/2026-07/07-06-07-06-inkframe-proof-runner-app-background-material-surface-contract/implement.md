# Implementation Plan: Proof Runner App Background Material Surface Contract

## Phase 0: Preflight

Read:

```text
.trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract/prd.md
.trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract/design.md
.trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract/implement.md
.trellis/spec/frontend/quality-guidelines.md
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/evidence/integrated-execution-plan.md
```

Inspect:

```text
tools/twd-guard/twd-inkframe-proof.mjs
tools/twd-guard/twd-inkframe-proof.test.mjs
frontend/components/inkframe/app-desk-background.tsx
frontend/components/inkframe/material-surface.tsx
```

## Phase 1: Red Test

Extend `tools/twd-guard/twd-inkframe-proof.test.mjs` so it expects each
`PRODUCT_SHELL_PROOF_ROUTES` route to contain required inner app-background
material surface checks with `minCount === 1`.

Run:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
```

Expected pre-implementation failure: missing inner material surface selector.

## Phase 2: Implementation

Modify `buildProductShellChecks()` in:

```text
tools/twd-guard/twd-inkframe-proof.mjs
```

Add generated checks for:

- app background inner material owner;
- app background inner material tint;
- app background inner material static mode;
- app background inner material pointer false.

Use stable `data-inkframe-*` selectors only.

## Phase 3: Validation

Run:

```bash
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
rtk node --test tools/twd-guard/*.test.mjs
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract \
  --account zy-ean \
  --json
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract
```

If `./twd` reports no tabs, record `blocked_no_tab` and do not claim browser
acceptance.

## Phase 4: Evidence And Review

Write:

```text
.trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract/evidence/validation.md
.trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract/evidence/check-review.md
```

Request a check worker if available.
