# Operator Scope Addendum

Date: 2026-07-06

This note records the latest operator clarification for the integrated Inkframe
runtime/product refactor.

## Latest Clarification

The material runtime should not be treated conservatively as a small local
decoration. The current demo has reached a usable quality bar, so the product
work should assume the Inkframe material system is worth integrating properly.

The app background must be material-capable by default across product pages.
Every user-facing page mounted through the product shell should start from the
same clean dry-paper desk foundation, and that foundation should be able to
enter the render/edit lifecycle when the product exposes controls for it.

Future background images are expected. The implementation must keep the
background owner/resource model correct now so images can later be added without
making foreground text unreadable, changing desk tint into message/card tint, or
storing large blobs in backend/localStorage/IndexedDB.

The earlier Trellis tasks remain part of the same delivery:

- `07-05-inkframe-product-ui-refactor` is the umbrella product acceptance
  contract.
- `07-04-ink-material-card-restore-resource` is the material lifecycle contract:
  restore after re-render, editable restored ink, discard cleanup, private URL
  revocation, and bounded repeated keep.
- `07-02-chat-event-unread-indicators` is the chat attention contract:
  channel/DM/thread unread indicators replace low-value message counts and
  should be backed by backend read cursor metadata when implemented.

## Implementation Implications

- Do not ship a static-only background as the final product direction. A static
  fallback is acceptable for WebGL failure, mobile low-power mode, or test
  isolation, but the shell background component itself must have a material
  lifecycle contract.
- Do not let route-local backgrounds drift. Chat, tasks, members, computers,
  settings, and product landing routes should share the shell-owned desk
  background if they are user-facing product pages.
- Do not store large material/image blobs outside the browser session in this
  iteration. Backend state is appropriate for small read/unread cursor metadata,
  not for ink resources.
- Do not claim mobile/browser acceptance from static source tests. Real UI proof
  must use `./twd` when a browser tab is connected.
- If implementation time forces cuts, cut surface breadth before cutting the
  core lifecycle contracts: keep the material resource model, owner tint, active
  surface coordinator, and read cursor invariants intact.

## Acceptance Additions

- Background material owner stays `app-background` with `desk` tint after
  activate, keep, collapse, and re-render.
- Product shell route sweep verifies the clean material-capable desk background
  on user-facing pages.
- Background image readiness is represented in the resource contract through
  visual/restore/source ownership, even if the user-facing import UI is deferred.
- The final quality gate maps the merged earlier tasks (`07-02`, `07-04`,
  `07-05`) to concrete tests or explicitly documented cuts.
