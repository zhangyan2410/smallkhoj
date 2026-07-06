# Inkframe Desk Background Owner And Route Coverage

## Goal

Continue the frontend-first Inkframe optimization loop by hardening the global
desk background as a real material owner across user-facing product routes.

This slice exists because the product direction is no longer "use WebGL in a
few local widgets." The app background is part of the material system: it should
default to the clean dry-paper desk, be capable of render/keep/restore, and be
ready for future background images without accidentally inheriting chat-card or
task-paper tint/resource behavior.

This is a child of:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

It carries requirements from:

```text
.trellis/tasks/07-06-inkframe-runtime-browser-proof-product-polish/12-hour-product-refactor-plan.md
.trellis/tasks/07-04-ink-material-card-restore-resource/prd.md
```

## Current Facts

- `ProductShell` renders `AppDeskBackground` and `InkMaterialRuntimeScript`.
- `AppDeskBackground` already exposes `data-region="app-desk-background"`,
  `data-inkframe-owner-kind="app-background"`, `data-inkframe-owner-id="global-desk"`,
  `data-inkframe-tint="desk"`, and `data-material-tint="desk"`.
- `MaterialResource` already carries `ownerKind`, `tint`, `sourceKind`, and
  separate `visualObjectUrl`, `restoreObjectUrl`, and `sourceObjectUrl`.
- `MaterialSurface` already receives `ownerKind`, `region`, `tint`, and
  resource props, but existing tests do not fully prove that app-background
  resources cannot be reused as message/task surfaces or that product route
  coverage remains complete.
- Product pages have been heavily refactored in this branch. Future agents need
  a source-level contract that says which pages are user-facing product routes
  and whether they get the shell-owned material desk.
- Real browser proof through `./twd` remains blocked when no browser tab is
  connected; this task must be honest about that and use source/component tests
  as the current hardening layer.

## In Scope

- Strengthen source/component tests for `ProductShell`, `AppDeskBackground`, and
  material resource owner/tint separation.
- Add explicit route coverage assertions for user-facing product pages:
  `/`, `/chat`, `/chat/[channel]`, `/tasks`, `/members`, `/computers`,
  `/settings`, `/login`, and `/join/[token]`.
- Prove `ProductShell` owns exactly one app desk background and that route pages
  do not mount a second app-background owner.
- Prove background resources preserve `ownerKind="app-background"` and
  `tint="desk"` through capture/replace/discard-like code paths.
- Prove source/visual/restore URLs remain separate for background image
  readiness.
- Record browser proof status honestly using `./twd` / `twd-inkframe-proof`.
- Spawn a Trellis check worker after implementation.

## Out Of Scope

- Full background image management UI.
- Cross-refresh persistence for background images or ink.
- Backend/localStorage/IndexedDB persistence of large material blobs.
- Redesigning chat/task objects again.
- Full object-level redesign of members/computers/settings.
- Using Playwright or raw `twd.py` as a substitute for project WebDriver proof.
- Claiming real mobile/browser acceptance without a connected `./twd` tab.

## Requirements

### R1. Shell-Owned Background Contract

`ProductShell` must own one global desk background for user-facing app routes:

```text
data-region="app-desk-background"
data-inkframe-owner-kind="app-background"
data-inkframe-owner-id="global-desk"
data-inkframe-region="app-background"
data-inkframe-tint="desk"
```

It must also load the material engine script once at shell level.

### R2. Route Coverage Contract

The following user-facing pages must either compose `ProductShell` or explicitly
render the same dry-paper entry surface contract where authentication makes
`ProductShell` inappropriate:

- `/`
- `/chat`
- `/chat/[channel]`
- `/tasks`
- `/members`
- `/computers`
- `/settings`
- `/login`
- `/join/[token]`

No route in that set should introduce route-local pink/dark/dirty background
blocks that bypass the shared desk language.

### R3. No Duplicate App Background Owners

Product pages must not mount their own app-background material owner in addition
to `ProductShell`. There should be one shell-owned background owner in the shell
path, not a page-local background per route.

### R4. Owner/Tint Separation

App background material resources must preserve:

```text
ownerKind = "app-background"
tint = "desk"
region = "app-background"
```

Chat messages, tasks, evidence, and review surfaces may use their own tints, but
they must not overwrite or reuse the app-background owner/tint contract.

### R5. Background Image Readiness

Background material resources must keep source/visual/restore separation:

- visual snapshot for static display;
- restore map for editable material state;
- source image resource for color fidelity.

Tests must prove these can coexist on an app-background resource without
collapsing into a black-only restore or message-card resource shape.

### R6. Browser Evidence Honesty

Run project WebDriver proof if possible. If no tab is connected, record the
exact blocker and do not claim browser/mobile acceptance.

## Acceptance Criteria

- [ ] Source/component test fails before implementation for at least one missing
      route/background owner contract.
- [ ] `ProductShell` is source-tested as the single app-background owner and
      shell-level material engine loader.
- [ ] `AppDeskBackground` is tested for owner id, region, tint, pointer capture,
      material mode, and resource id attributes.
- [ ] User-facing route coverage is source-tested for `/`, `/chat`,
      `/chat/[channel]`, `/tasks`, `/members`, `/computers`, `/settings`,
      `/login`, and `/join/[token]`.
- [ ] Product routes are tested not to mount duplicate app-background material
      owners outside `ProductShell`.
- [ ] Material resource tests prove app-background resources preserve
      `ownerKind="app-background"` and `tint="desk"` while keeping
      source/visual/restore resources separate.
- [ ] Focused frontend tests pass.
- [ ] Relevant TypeScript and scoped lint pass.
- [ ] `git diff --check` and task validation pass.
- [ ] Trellis check worker reviews the slice, or self-review is recorded if
      worker startup fails.
- [ ] Browser/mobile acceptance is not claimed while `./twd` remains blocked.
