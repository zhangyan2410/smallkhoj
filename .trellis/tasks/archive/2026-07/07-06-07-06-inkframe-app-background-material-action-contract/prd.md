# Inkframe app background material action contract hardening

## Goal

Harden the product shell app-background material event/action contract so desk render/draw/water/keep/discard modes are explicit, source-tested, and protected against tint/pointer drift before background image work.

This is the next frontend-first optimization loop under:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization
```

It exists because the product background is not a static CSS skin. The user
explicitly wants every user-facing product page to start from a material-capable
Inkframe desk background, and future background images should be possible
without making the page drift into chat-card tint or unreadable dirty paper.

## Confirmed Facts

- `ProductShell` mounts `AppDeskBackground` once.
- `AppDeskBackground` already exposes the shell owner metadata:
  - `data-inkframe-surface="app-background"`
  - `data-inkframe-owner-kind="app-background"`
  - `data-inkframe-owner-id="global-desk"`
  - `data-inkframe-region="app-background"`
  - `data-inkframe-tint="desk"`
- `AppDeskBackground` listens for `smallkhoj:app-desk-material`.
- The action vocabulary is:
  - `activate`
  - `draw`
  - `water`
  - `keep`
  - `discard`
  - `static`
- Existing tests check the static owner contract, but the event/action contract
  is still too implicit. Future agents could accidentally remove or weaken the
  mapping and still pass most source tests.
- `./twd` currently has no connected tab, so browser proof may remain
  `blocked_no_tab`. This task should still improve executable source/unit proof.

## Requirements

### R1. Make The Background Action Contract Explicit

The app desk background must expose an importable/testable action-to-state
contract. Tests should not have to infer behavior only by reading a private
function inside a React component.

Each action maps to a material mode and pointer mode:

| Action | Material mode | Pointer mode | Pointer capture |
|---|---|---|---|
| `activate` | `active` | `none` | false |
| `draw` | `active` | `draw` | true |
| `water` | `active` | `water` | true |
| `keep` | `keeping` | `none` | false |
| `discard` | `discarding` | `none` | false |
| `static` | `static` | `none` | false |

### R2. Protect The Desk Owner/Tint Contract

The shell background must remain:

```text
ownerKind = app-background
ownerId = global-desk
region = app-background
tint = desk
```

This must stay true for:

- initial static render;
- future image/default resource render;
- action-driven active/draw/water/keep/discard/static states.

The task must specifically guard against the known class of bug where a kept
background turns into chat/message paper tint after collapse or re-render.

### R3. Keep Pointer Capture Deliberate

Static background must never steal scroll or input. Pointer capture should be
true only when the background is explicitly in active draw or water mode.

This matters for mobile:

- page scroll wins by default;
- background material interaction requires explicit activation;
- chat composer and task controls must not lose pointer behavior to the
  background.

### R4. Keep The Background Image-Ready Resource Contract

Future background images need three separate resource roles:

- visual snapshot for static display;
- restore resource for editable ink/material state;
- source resource for source color/fidelity.

This task does not implement a user-facing image picker. It must keep the
source/image-ready contract testable on `AppDeskBackground`.

### R5. No New Persistence

Do not add backend, `localStorage`, or IndexedDB persistence for material
images/ink. Background material resources are session-local in this iteration.

### R6. Honest Browser Evidence

If `./twd` has no connected tab, record `blocked_no_tab` honestly. Source/unit
tests are readiness evidence, not browser/mobile acceptance.

## Acceptance Criteria

- [ ] `AppDeskMaterialAction` and the action resolver are importable from
      `app-desk-background.tsx` or a nearby module.
- [ ] Tests prove every background material action maps to the expected
      material mode and pointer mode.
- [ ] Tests prove pointer capture is false for `activate`, `keep`, `discard`,
      and `static`, and true only for `draw` / `water` active modes.
- [ ] Tests prove `AppDeskBackground` preserves `app-background/global-desk/desk`
      owner metadata when rendered with a future image resource.
- [ ] Tests prove the component source still listens for
      `APP_DESK_MATERIAL_EVENT` and does not use browser storage for material
      resources.
- [ ] Focused frontend tests pass.
- [ ] Full relevant frontend tests pass or any skipped browser proof is recorded
      honestly.
- [ ] `git diff --check` passes.
- [ ] Review evidence records that this is a source/unit contract hardening
      slice, not real connected-browser proof.

## Notes

- This task is deliberately small but product-critical: it makes the background
  material lifecycle harder to regress before the larger image/background
  polish pass.
