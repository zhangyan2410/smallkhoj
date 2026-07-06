# Design: Inkframe Proof Runner Product Shell Route Sweep

## Boundary

This task changes only the selector-driven proof runner and its tests. The real
product components already expose the shell background contract; this task makes
the future browser evidence sweep broad enough to detect route-level drift.

## Route Contract

Define a small exported list for user-facing product-shell route proof:

```js
export const PRODUCT_SHELL_PROOF_ROUTES = [
  "/chat",
  "/tasks",
  "/members",
  "/computers",
  "/settings",
]
```

The selector manifest should generate or contain product-shell assertions for
each route. The same stable attributes are checked on each route:

- shell background surface;
- app-background owner kind/id;
- app-background region and desk tint;
- pointer capture false by default.

## Why Generate Checks

The current manifest hand-writes shell checks for `/chat` and `/tasks`. Adding
three more routes by copy/paste is possible, but a route list plus helper keeps
the route sweep auditable and prevents future routes from drifting out of tests.

## Browser Behavior

No browser behavior changes. When a connected tab is unavailable, the runner
continues to write `blocked_no_tab` evidence and exits with the existing blocked
exit code.
