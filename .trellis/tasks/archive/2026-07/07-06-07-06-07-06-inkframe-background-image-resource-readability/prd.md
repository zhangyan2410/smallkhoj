# Inkframe Background Image Resource And Readability Contract

## Goal

Harden the shell-owned Inkframe app background so rendered/image resources
preserve owner tint, foreground readability, and route coverage without
persisting image blobs.

This is a child of:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization
```

It carries forward the user's product decision:

- the Inkframe material background is not a tiny decorative WebGL island;
- the product background should be material-capable by default on user-facing
  pages;
- later background images are expected, but this iteration must not store large
  blobs in the backend, localStorage, or IndexedDB;
- rendered background resources must not drift into message/task tint after
  keep/restore.

## User Value

The app should feel like one coherent physical workbench. When the background is
rendered, painted, kept, discarded, or later seeded from an image, it must remain
the desk surface, not accidentally become chat paper or task paper. Foreground
content must stay readable over the desk, including mobile layouts.

## Current Facts

- `ProductShell` owns the global app desk background.
- `AppDeskBackground` and `MaterialSurface` expose owner/resource metadata.
- Previous route-coverage work added source tests for shell-level ownership.
- The material demo can render/import images, but product background image
  resource behavior still needs a precise contract before broad integration.
- Product decision: no cross-refresh persistence for arbitrary ink/background
  image blobs in this iteration.

## In Scope

- Verify and harden the shell-owned `AppDeskBackground` contract.
- Preserve `ownerKind="app-background"`, `tint="desk"`, and source kind metadata
  when a background visual/image resource is active.
- Ensure keep/discard/restore for the app background falls back to the clean desk
  resource, not to message/task defaults.
- Ensure foreground readability and pointer ownership remain explicit:
  background edit/render mode is active only when intentionally enabled;
  normal product interaction and scroll remain foreground-owned.
- Add source/unit tests for future image-resource behavior without requiring
  browser blob persistence.
- Keep all product pages mounted through `ProductShell` on the clean
  material-capable desk background.
- Record honest evidence when `./twd` has no connected tab.

## Out Of Scope

- Backend storage of background images or ink blobs.
- localStorage/IndexedDB persistence for large material resources.
- Full painting UI polish.
- Reworking chat/task cards beyond foreground readability hooks.
- Claiming browser/mobile acceptance without `./twd`.
- Changing operator/control pages that are not user-facing product surfaces.

## Requirements

### R1. Single Shell Background Owner

There must be exactly one product shell owner for the app desk background on
user-facing routes mounted through `ProductShell`.

Expected markers:

- `data-inkframe-background-owner="product-shell"`
- `data-inkframe-background-scope="global-desk"`
- background `MaterialSurface` owner kind: `app-background`
- background tint: `desk`

Auth entry routes that intentionally do not mount `ProductShell` are a
documented exception. `/login` and `/join/[token]` must still use the clean
dry-paper workbench entry surface, but they should not receive the product
navigation shell or create a second route-local `AppDeskBackground` owner.

### R2. Image Resource Contract

When the app background uses a future image/visual resource, tests must prove
that the metadata remains:

```text
ownerKind = app-background
tint = desk
sourceKind = image
resource id present
visual URL present
```

This is a product resource contract only. It must not imply blob persistence
across reloads.

### R3. No Tint Drift After Keep/Discard

Keeping or discarding a rendered app background must not change the background
owner/tint into `message`, `task`, `evidence`, or any foreground material
category.

Discarding should return to the clean desk default resource.

### R4. Foreground Readability

The shell must expose source hooks or tests proving foreground regions can be
kept readable over a material/image background:

- main content region remains above the background layer;
- list/sidebar/content z-index relationship is explicit;
- foreground routes do not rely on background color assumptions that would fail
  over an image resource;
- mobile width must not introduce horizontal overflow from background canvas or
  resource layers.

### R5. Pointer Ownership

Background drawing/water/image editing must not capture normal product
interaction by default.

Expected contract:

- background edit/render mode is explicit;
- when inactive/static, background layer is non-interactive;
- when active, pointer capture is scoped to the background editor, not arbitrary
  foreground components.

### R6. Route Coverage

Source tests must enumerate the user-facing route set and classify it into
shell-owned product routes versus auth entry surfaces.

Product routes that should receive the shell desk background through
`ProductShell`:

- `/`
- `/chat`
- `/chat/[channel]`
- `/tasks`
- `/members`
- `/computers`
- `/settings`

Auth entry routes that should retain the clean dry-paper workbench surface
without mounting `ProductShell`:

- `/login`
- `/join/[token]`

The test should reject page-local duplicate `AppDeskBackground` usage in chat
and other product pages unless the task explicitly documents a justified
exception.

## Acceptance Criteria

- [ ] Source/unit tests assert exactly one shell-owned app background contract.
- [ ] Tests assert app background owner/tint/source metadata for default desk
      and image-resource cases.
- [ ] Tests prove discard fallback keeps `ownerKind="app-background"` and
      `tint="desk"`.
- [ ] Tests or source assertions prove foreground content remains layered above
      the background and the inactive background does not capture pointer input.
- [ ] Route coverage test enumerates the routes listed in R6, verifies
      ProductShell ownership for product routes, and verifies clean dry-paper
      entry surfaces for `/login` and `/join/[token]`.
- [ ] No backend/localStorage/IndexedDB blob persistence is introduced.
- [ ] Existing material surface/resource tests remain green.
- [ ] Relevant TypeScript tests and `tsc` pass.
- [ ] `git diff --check` and `task.py validate` pass.
- [ ] Browser proof is either captured with `./twd`, or explicitly recorded as
      `blocked_no_tab` without claiming visible acceptance.

## Review Focus

Reviewers should check:

- whether the app background remains a desk resource after keep/discard;
- whether image-resource tests are future-proof but not fake persistence;
- whether foreground readability is tested through real selectors/metadata
  rather than a screenshot-only claim;
- whether route coverage stays explicit and not heuristic;
- whether this task keeps material background broad enough for the user's
  direction without turning every foreground object into always-live WebGL.
