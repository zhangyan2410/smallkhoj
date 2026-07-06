# Carried By 07-06 Implementation

Date: 2026-07-06

This task is intentionally carried by:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization
```

The original `07-04` demo lifecycle requirements became the product
`MaterialSurface` resource/lifecycle contract:

- session-only material resources;
- no backend, `localStorage`, or IndexedDB storage for large ink/image blobs;
- restore/visual/source resources remain distinct;
- keep/restore/discard behavior must preserve owner/tint/source metadata;
- private resources must be released when replaced, discarded, or unloaded;
- repeated keep/restore paths must stay bounded;
- static product surfaces must not create one always-live WebGL context per
  message/task/background object.

Relevant completed child tasks:

- `.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract`
- `.trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract`
- `.trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability`
- `.trellis/tasks/07-06-inkframe-material-source-image-fidelity-contrast`

Current evidence status:

- product `MaterialSurface` and background resource/source/restore metadata are
  covered by unit/source/proof-runner tests;
- image fidelity and foreground contrast selectors are in place for product
  proof;
- real browser draw/keep/restore proof is still blocked by
  `./twd --compact tabs` returning no connected tabs.

Future material work should preserve this contract and add connected-browser
proof rather than introducing persistent storage or one-canvas-per-object
rendering.
