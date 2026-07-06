# Design: Inkframe App Background Material Action Contract

## Boundary

This task changes only the app background material action contract and its
tests. It should not redesign chat/task visuals and should not add persistence
for material resources.

## Current Shape

`frontend/components/inkframe/app-desk-background.tsx` owns:

- the `APP_DESK_MATERIAL_EVENT` event name;
- the action type;
- the action-to-state resolver;
- the `AppDeskBackground` component;
- shell owner metadata;
- `MaterialSurface` composition for `app-background/global-desk/desk`.

The weak point is that the resolver is private and the tests mostly prove static
markup. A future refactor could silently change action semantics.

## Proposed Contract

Export a small function:

```ts
export function resolveAppDeskMaterialAction(action: AppDeskMaterialAction): {
  mode: MaterialSurfaceMode
  pointerMode: MaterialPointerMode
}
```

`AppDeskBackground` should use this exported function when handling
`APP_DESK_MATERIAL_EVENT`.

Tests can then assert the full action matrix directly without rendering a live
browser or dispatching DOM events in Node.

## State Matrix

| Action | mode | pointerMode |
|---|---|---|
| `activate` | `active` | `none` |
| `draw` | `active` | `draw` |
| `water` | `active` | `water` |
| `keep` | `keeping` | `none` |
| `discard` | `discarding` | `none` |
| `static` | `static` | `none` |

Pointer capture remains derived from the existing helper:

```ts
shouldMaterialSurfaceCapturePointer(mode, pointerMode)
```

This avoids duplicating pointer-capture logic inside the background component.

## Resource / Tint Contract

`AppDeskBackground` should keep these stable attributes:

```text
data-inkframe-owner-kind="app-background"
data-inkframe-owner-id="global-desk"
data-inkframe-region="app-background"
data-inkframe-tint="desk"
data-inkframe-resource-owner-kind={resource?.ownerKind ?? "app-background"}
data-inkframe-resource-tint={resource?.tint ?? "desk"}
data-inkframe-resource-source-kind={resource?.sourceKind ?? "none"}
```

The future image resource test should use:

```ts
ownerKind: "app-background"
tint: "desk"
sourceKind: "image"
visualObjectUrl
restoreObjectUrl
sourceObjectUrl
```

The important assertion is that a source image still belongs to the background
desk and does not collapse to message/paper tint.

## Non-Designs

- Do not introduce a global state library for the app background.
- Do not add URL/localStorage/IndexedDB persistence.
- Do not add hidden production UI controls in this slice.
- Do not make browser acceptance claims while `./twd` has no connected tab.
