# Review Brief: Inkframe Proof Runner Product Shell Route Sweep

Active task:

```text
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep
```

Please review this narrow frontend/tooling proof-runner slice.

## What Changed

Files changed:

```text
tools/twd-guard/twd-inkframe-proof.mjs
tools/twd-guard/twd-inkframe-proof.test.mjs
```

Task/evidence:

```text
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/prd.md
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/design.md
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/implement.md
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/evidence/route-sweep-validation.md
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/evidence/twd-inkframe-proof.json
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/evidence/twd-inkframe-proof.md
```

The proof runner now exports:

```js
PRODUCT_SHELL_PROOF_ROUTES = ["/chat", "/tasks", "/members", "/computers", "/settings"]
```

and generates product-shell background checks for each route:

- app background surface;
- app background owner kind/id;
- app background region + desk tint;
- pointer capture false by default.

## Review Focus

Please prioritize bugs and missing tests:

- Does the runner still start with the `./twd --compact tabs` no-tab gate?
- Does it still avoid launching Chrome or using Playwright?
- Are product shell route checks generated for all required routes?
- Do tests fail if `/members`, `/computers`, or `/settings` are dropped from
  the route sweep?
- Does the evidence honestly report `blocked_no_tab` and avoid claiming browser
  acceptance?
- Any issue with using generated checks rather than hand-written route entries?

## Validation Already Run

```text
node --test tools/twd-guard/twd-inkframe-proof.test.mjs: 11 passed
node --test tools/twd-guard/*.test.mjs: 20 passed
twd-inkframe-proof: blocked_no_tab, evidence written
git diff --check: pass
task.py validate: pass
```

Do not commit, push, pull, reset, or merge.
