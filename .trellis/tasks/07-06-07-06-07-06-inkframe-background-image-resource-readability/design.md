# Design: Inkframe Background Image Resource And Readability Contract

## Contract Shape

The product shell owns one global desk background:

```text
ProductShell
  -> AppDeskBackground
      -> MaterialSurface(ownerKind="app-background", tint="desk")
  -> foreground list/main/sidebar regions
```

The background is a material surface, but it is a different resource class from
message/task/evidence surfaces.

## Resource Model

Use the existing resource shape from `frontend/components/inkframe`:

```text
MaterialResource
  id
  ownerKind
  tint
  sourceKind
  visualUrl
  restoreUrl?
  sourceUrl?
```

For the app background:

```text
ownerKind = app-background
tint = desk
sourceKind = procedural | image
```

The key behavior to protect is ownership stability. A background resource may
use an imported/generated image, but its owner kind and tint remain the desk.

## Fallback

`AppDeskBackground` should pass an explicit default resource into
`MaterialSurface`.

Discarding or replacing a private resource returns to:

```text
ownerKind = app-background
tint = desk
sourceKind = procedural
```

If a test seeds `defaultResource` with `sourceKind="image"`, `MaterialSurface`
must preserve that metadata while still reporting `app-background` / `desk`.

## Readability Layering

Source tests should assert stable hooks rather than visual screenshots:

- Product shell outer node has background owner markers.
- Background layer has an identifiable slot/region.
- Foreground body/list/main/sidebar content is rendered after/above the
  background layer.
- Inactive background layer uses a non-interactive pointer contract.

If code lacks a stable marker, add `data-inkframe-*` or `data-region` hooks in
the component that owns the region. Do not rely on generated class names.

## Pointer Ownership

The material engine can be active, but background editing must be deliberate.

Expected pattern:

```text
inactive/static background:
  pointer-events: none

explicit edit/render mode:
  background editor controls own pointer events
```

Tests can assert source/DOM metadata for the inactive path. Real pointer testing
belongs to the browser proof task when `./twd` is connected.

## Test Strategy

Primary frontend tests:

```text
frontend/test/inkframe-object-ui.test.tsx
frontend/test/material-surface.test.tsx
frontend/test/material-resource.test.ts
frontend/test/material-surface-restore.test.ts
```

Add or refine tests for:

- route coverage;
- shell ownership;
- default app-background resource;
- image resource metadata preservation;
- discard fallback owner/tint;
- non-interactive inactive background source hook.

## Non-Design Choices

- Do not persist image blobs.
- Do not create per-route backgrounds.
- Do not create always-live WebGL canvases for every page.
- Do not move background ownership into chat/task pages.
