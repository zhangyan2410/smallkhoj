# Design: Proof Runner App Background Material Surface Contract

## Boundary

Only the selector-driven proof runner and tests should change:

```text
tools/twd-guard/twd-inkframe-proof.mjs
tools/twd-guard/twd-inkframe-proof.test.mjs
```

No product UI visual redesign is intended in this slice.

## Selector Contract

The route sweep should continue to generate product-shell checks from
`PRODUCT_SHELL_PROOF_ROUTES`, but each route should also require the inner
`MaterialSurface` contract:

```text
[data-inkframe-surface="material"][data-inkframe-owner-kind="app-background"][data-inkframe-owner-id="global-desk"]
[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-tint="desk"]
[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-mode="static"]
[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-pointer-capture="false"]
```

The outer app background wrapper remains checked separately:

```text
[data-inkframe-surface="app-background"]
```

This split matters because a route could preserve the wrapper while removing
the material runtime layer.

## Test Strategy

Extend the existing route-shell test:

- for each `PRODUCT_SHELL_PROOF_ROUTES` route;
- find product-shell checks for that route;
- assert each required inner material selector exists;
- assert every required selector has `minCount === 1`.

Keep no-tab classification tests unchanged.

## Browser Behavior

No browser behavior changes. With no connected tab the runner still writes
`blocked_no_tab`; with a future connected tab it will run the expanded selector
manifest.
