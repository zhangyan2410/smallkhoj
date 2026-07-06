# Inkframe Browserless DOM Contract And Mobile Proof Readiness

## Goal

Make the real Inkframe chat/task/product-shell UI verifiable even while no
`./twd` browser tab is connected, then make the browser/mobile proof path
deterministic the moment a tab becomes available.

This is the next optimization loop under:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

It follows the completed/static-verified chat unread contract hardening in:

```text
.trellis/tasks/07-06-chat-unread-frontend-cursor-contract-hardening
```

## Why This Task Exists

The current blocker is not that all frontend contracts are untested. Many
frontend/backend contracts are green. The remaining high-value gap is visible
behavior:

- `./twd --compact tabs` currently returns no connected browser tab.
- We cannot honestly claim desktop/mobile browser acceptance.
- When a tab does connect, the app must expose stable DOM markers and state
attributes so `./twd` can assert behavior instead of relying on screenshot
interpretation.

This task therefore hardens the UI observability layer and browser-proof
readiness without pretending browser proof has happened.

## In Scope

- Add or harden stable DOM contracts for Inkframe product shell, chat, tasks,
  and mobile states.
- Add static/component/source tests that prove those contracts exist before
  browser proof is available.
- Ensure `./twd` acceptance scripts can target stable markers when a browser tab
  is connected.
- Ensure the current visual/product commitments are expressed as testable DOM:
  - product shell has one clean Inkframe desk background owner;
  - chat messages default to static material surfaces;
  - chat exposes at most one active foreground material owner;
  - task board/detail/evidence/review expose distinct object roles;
  - mobile layout exposes drawer/stack/composer/task-control affordance markers;
  - material pointer capture is explicit and not on by default;
  - unread/event badges are backed by cursor state markers, not decorative-only
    styling.
- Record browser proof as pending unless `./twd` reports a connected tab and the
  real checks are run.

## Out Of Scope

- Launching Chrome without explicit operator permission.
- Replacing `./twd` with Playwright.
- Backend storage of ink/image blobs.
- localStorage/IndexedDB persistence for material images.
- Full object-level redesign of members/computers/settings.
- New visual concepts beyond making the existing Inkframe product direction
  observable and testable.

## Requirements

### R1. Product Shell Background Contract

Every product route mounted in the user-facing shell must expose one global
Inkframe desk background owner with stable attributes:

- owner kind: app background;
- owner id: global desk;
- region: app background;
- tint: desk;
- static/active/fallback mode;
- pointer capture off unless explicit edit/draw/water mode is active.

This is a DOM contract, not only a CSS class preference.

### R2. Chat Message Material Contract

Chat messages must expose stable object/material markers:

- message object role;
- material owner kind/id;
- static mode by default;
- long/short density or stability state;
- hidden/revealed action toolbar state;
- unread/thread marker state when present.

The contract should make it possible for `./twd` to assert that ordinary message
lists do not mount one live WebGL canvas per message.

### R3. Task Material Contract

Task UI must expose distinct roles:

- task ticket;
- task material detail/surface;
- evidence surface;
- review markup;
- state marker such as running/review/done/blocked/idle.

These roles should not collapse into the same generic card marker.

### R4. Mobile Layout Contract

At mobile widths, chat/task must expose stable state markers for:

- sidebar collapsed/drawer state;
- message list;
- composer usability;
- task ticket/detail/evidence/review stacked or tabbed access;
- no active drawing pointer capture unless explicit material edit mode is on.

Static tests can check class/attribute availability; real dimensions still need
`./twd` once a browser is connected.

### R5. Browser Proof Harness Readiness

Add a documented `./twd` command sequence or helper notes that can be run later
without rediscovering selectors.

The proof path must cover:

- product shell background on chat/tasks/members/computers/settings;
- chat desktop material and unread markers;
- chat mobile composer/no-overflow markers;
- task desktop object roles;
- task mobile access markers;
- material active/static/pointer-capture markers.

### R6. Evidence Honesty

This task may claim browserless DOM/static contract readiness. It must not claim
browser/mobile acceptance unless:

```bash
rtk ./twd --compact tabs
```

returns at least one connected tab and the real `./twd` checks are executed.

## Acceptance Criteria

- [ ] Stable data attributes or equivalent testable DOM markers exist for the
      product shell background owner/mode/tint/pointer-capture state.
- [ ] Stable markers exist for chat message object/material/static/active
      behavior.
- [ ] Stable markers exist for task ticket/evidence/review/material roles.
- [ ] Static/component tests prove ordinary chat/task lists do not create
      unbounded active material canvases.
- [ ] Static/component tests prove mobile-specific affordance markers exist for
      chat and tasks.
- [ ] Unread/event markers remain tied to cursor-derived state markers.
- [ ] A `./twd` proof checklist or script is written with stable selectors.
- [ ] Frontend targeted tests pass.
- [ ] Frontend lint and TypeScript pass.
- [ ] `git diff --check` passes.
- [ ] Browser proof status is recorded honestly: either real evidence exists,
      or the evidence says no connected tab and no browser acceptance is claimed.

## Guardrails

- Do not add fake markers that tests pass while UI cannot actually expose the
  behavior.
- Do not add decorative hover/motion markers for objects that cannot be moved or
  acted on.
- Do not use screenshot-only evidence for resource/canvas-count claims.
- Do not make the product UI noisier to satisfy test selectors.
- Keep the DOM contract close to real product concepts: desk background,
  message paper, task ticket, evidence surface, review markup, sidebar entity,
  event badge.
