# Route Sweep Validation

Date: 2026-07-06

## Scope

Extended the selector-driven Inkframe `./twd` proof runner so its product-shell
background route sweep now covers the main user-facing product shell pages:

- `/chat`
- `/tasks`
- `/members`
- `/computers`
- `/settings`

This moves the runner closer to the current product requirement that every
user-facing product page uses the same clean, material-capable Inkframe desk
background.

## Files Changed

```text
tools/twd-guard/twd-inkframe-proof.mjs
tools/twd-guard/twd-inkframe-proof.test.mjs
```

Task files:

```text
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/prd.md
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/design.md
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/implement.md
```

## Implementation

Added:

```js
export const PRODUCT_SHELL_PROOF_ROUTES = ["/chat", "/tasks", "/members", "/computers", "/settings"]
```

The runner now generates product-shell checks for each route. Each route asserts:

- `[data-inkframe-surface="app-background"]`
- `[data-inkframe-owner-kind="app-background"][data-inkframe-owner-id="global-desk"]`
- `[data-inkframe-region="app-background"][data-inkframe-tint="desk"]`
- `[data-inkframe-surface="app-background"][data-inkframe-pointer-capture="false"]`

## Red / Green

Red:

```bash
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
```

Initial failure:

```text
SyntaxError: The requested module './twd-inkframe-proof.mjs' does not provide an export named 'PRODUCT_SHELL_PROOF_ROUTES'
```

After adding the route list and generated checks, one older test failed because
it still assumed product proof routes could only be `/chat` or `/tasks`.
That test was tightened to allow the exported product-shell route list rather
than accepting arbitrary routes.

Green:

```bash
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
```

Result:

```text
11 passed
```

Full twd guard tool tests:

```bash
rtk node --test tools/twd-guard/*.test.mjs
```

Result:

```text
20 passed
```

## Browser Gate

Ran the runner:

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep \
  --account zy-ean \
  --json
```

Result:

```json
{
  "ok": false,
  "status": "blocked_no_tab",
  "jsonPath": "/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/evidence/twd-inkframe-proof.json",
  "markdownPath": "/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/evidence/twd-inkframe-proof.md"
}
```

Interpretation:

- the runner remains honest when no browser tab is connected;
- no browser/mobile acceptance is claimed by this task;
- the generated blocked evidence now includes the broader route-sweep selector
  manifest for later connected-tab proof.

## Other Checks

```bash
rtk git diff --check
```

Result: pass.

```bash
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep
```

Result: pass.
