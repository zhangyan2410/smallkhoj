# Inkframe Proof Runner Product Shell Route Sweep

## Goal

Extend the selector-driven Inkframe `./twd` proof runner so the future connected
browser proof checks the product-shell background contract across the main
user-facing product routes, not only `/chat` and `/tasks`.

This is a small frontend/tooling optimization loop under
`07-05-inkframe-product-ui-refactor`. It supports the latest operator direction:
the clean material-capable desk background should be the default shell
foundation for every user-facing product page.

## Confirmed Facts

- Existing runner:
  `tools/twd-guard/twd-inkframe-proof`
- Existing implementation:
  `tools/twd-guard/twd-inkframe-proof.mjs`
- Existing tests:
  `tools/twd-guard/twd-inkframe-proof.test.mjs`
- Existing selector manifest covers product shell checks on `/chat` and
  `/tasks`.
- Product requirements now explicitly include shared product shell background on
  chat, tasks, members, computers, settings, and product landing routes.
- Real browser proof remains blocked while `./twd --compact tabs` returns no
  connected tabs. This task must not claim browser acceptance.

## Requirements

### R1. Product Shell Route Sweep Manifest

The proof runner must include product-shell background assertions for these
user-facing routes:

- `/chat`
- `/tasks`
- `/members`
- `/computers`
- `/settings`

The assertions must verify stable Inkframe DOM attributes:

- `data-inkframe-surface="app-background"`
- `data-inkframe-owner-kind="app-background"`
- `data-inkframe-owner-id="global-desk"`
- `data-inkframe-region="app-background"`
- `data-inkframe-tint="desk"`
- `data-inkframe-pointer-capture="false"`

### R2. Route List Is Testable

The runner should expose a readable route list or equivalent structure so tests
can prove the product shell route sweep includes the required routes.

### R3. No Browser Claim

The runner must retain its no-tab behavior:

- starts with `./twd --compact tabs`;
- writes `blocked_no_tab` evidence when no connected tab exists;
- does not launch Chrome;
- does not use Playwright;
- does not claim browser/mobile acceptance from manifest tests.

## Acceptance Criteria

- [ ] Runner manifest/check structure includes product-shell checks for `/chat`,
      `/tasks`, `/members`, `/computers`, and `/settings`.
- [ ] Tests fail if any required product-shell route is missing from the proof
      route sweep.
- [ ] Tests prove each required route has the app background owner/tint/pointer
      contract selectors.
- [ ] Existing no-tab classification tests still pass.
- [ ] `node --test tools/twd-guard/twd-inkframe-proof.test.mjs` passes.
- [ ] `node --test tools/twd-guard/*.test.mjs` passes.
- [ ] `./tools/twd-guard/twd-inkframe-proof` still reports
      `blocked_no_tab` honestly when no tab is connected.
- [ ] `git diff --check` passes.
- [ ] Evidence records this as proof-runner readiness, not real browser proof.

## Out Of Scope

- Launching Chrome.
- Replacing `./twd`.
- Product visual redesign.
- Adding route-specific UI controls.
- Backend cursor changes.
