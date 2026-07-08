# Inkframe proof runner app background material surface contract

## Goal

Extend the selector-driven `./twd` proof runner so connected-tab route sweeps
verify the shell app background is backed by an inner `MaterialSurface` with
`app-background/global-desk/desk` metadata, static mode, and no default pointer
capture.

This is the next proof-hardening loop after:

```text
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract
```

The previous slice made the app background action contract source-testable. This
slice makes the browser proof runner capable of detecting a product regression
where a route still has the outer background wrapper but loses the actual
material surface inside it.

## Confirmed Facts

- Existing proof runner:
  `tools/twd-guard/twd-inkframe-proof.mjs`
- Existing tests:
  `tools/twd-guard/twd-inkframe-proof.test.mjs`
- The route sweep already covers:
  - `/chat`
  - `/tasks`
  - `/members`
  - `/computers`
  - `/settings`
- Current product-shell checks assert the outer app background owner/tint and
  pointer contract.
- They do not yet require the inner material surface:
  `[data-inkframe-surface="material"][data-inkframe-owner-kind="app-background"]...`
- `./twd` currently has no connected tab, so browser proof may remain
  `blocked_no_tab`. This task must not claim browser/mobile acceptance.

## Requirements

### R1. Route Sweep Requires Inner App Background Material Surface

For every `PRODUCT_SHELL_PROOF_ROUTES` route, the runner must assert the
presence of an inner material surface for the app background:

```text
[data-inkframe-surface="material"]
[data-inkframe-owner-kind="app-background"]
[data-inkframe-owner-id="global-desk"]
[data-inkframe-region="app-background"]
[data-inkframe-tint="desk"]
```

### R2. Route Sweep Requires Static Default Mode

The app background material surface should default to:

```text
data-inkframe-mode="static"
data-inkframe-pointer-capture="false"
```

This protects mobile scroll/input and prevents default background rendering from
stealing pointer events.

### R3. Tests Must Prove Every Route Is Covered

Tests must fail if any required product-shell route lacks the inner material
surface selectors or uses `minCount: 0` for the required material surface
contract.

### R4. Preserve No-Tab Honesty

The runner must keep its no-tab behavior:

- parse `./twd --compact tabs`;
- write `blocked_no_tab` evidence when there are no connected tabs;
- not launch Chrome;
- not use Playwright;
- not claim real browser/mobile proof from manifest tests.

## Acceptance Criteria

- [ ] `INKFRAME_SELECTOR_CHECKS` includes an app-background material surface
      selector for every `PRODUCT_SHELL_PROOF_ROUTES` route.
- [ ] Each route requires the inner material surface selector with
      `minCount === 1`.
- [ ] Each route requires `static` mode and pointer capture false for the inner
      material surface.
- [ ] Existing product shell route sweep tests pass.
- [ ] No-tab runner behavior remains `blocked_no_tab` when `./twd` has no tab.
- [ ] `node --test tools/twd-guard/twd-inkframe-proof.test.mjs` passes.
- [ ] `node --test tools/twd-guard/*.test.mjs` passes.
- [ ] `git diff --check` passes.
- [ ] Evidence records this as proof-runner readiness, not connected-browser
      acceptance.

## Notes

- This is intentionally a tooling/proof-runner slice. It does not change the
  product UI itself unless the runner exposes a real missing selector.
