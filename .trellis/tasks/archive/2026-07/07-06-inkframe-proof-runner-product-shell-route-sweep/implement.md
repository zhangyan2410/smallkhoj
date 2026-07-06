# Implementation Plan: Inkframe Proof Runner Product Shell Route Sweep

## Phase 0: Preflight

1. Read current proof runner task artifacts.
2. Inspect `tools/twd-guard/twd-inkframe-proof.mjs` and its tests.
3. Confirm `./twd --compact tabs` still has no connected tab before claiming
   browser status.

## Phase 1: Red Test

1. Add tests in `tools/twd-guard/twd-inkframe-proof.test.mjs` that expect:
   - an exported `PRODUCT_SHELL_PROOF_ROUTES`;
   - the route list includes `/chat`, `/tasks`, `/members`, `/computers`,
     `/settings`;
   - each route has product-shell selector checks for background surface,
     owner, desk tint, and pointer-capture false.
2. Run:

```bash
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
```

Expected: fail before implementation if the route list/checks are missing.

## Phase 2: Implementation

1. Add `PRODUCT_SHELL_PROOF_ROUTES`.
2. Add a helper to generate the product-shell selector checks for each route.
3. Replace the hand-written chat/tasks shell checks with generated checks.
4. Keep all selectors in the stable `data-inkframe-*` vocabulary.

## Phase 3: Validation

Run:

```bash
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
rtk node --test tools/twd-guard/*.test.mjs
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep \
  --account zy-ean \
  --json
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep
```

The `twd-inkframe-proof` command is expected to remain `blocked_no_tab` if no
browser tab is connected.

## Phase 4: Evidence And Review

Write:

```text
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/evidence/route-sweep-validation.md
```

Then request a check worker review. If the worker cannot run, perform and record
self-review.
