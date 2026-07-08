# Design: Inkframe Material Source Image Fidelity And Foreground Contrast Proof

## Architecture Boundary

This task is a frontend contract-hardening slice. It does not add persistence or
full upload UI.

The relevant stack is:

```text
MaterialResource
  -> restoreMaterialResourceIntoSurface(...)
  -> MaterialSurface
  -> AppDeskBackground / MessageFrame / TaskMaterialSurface
  -> ProductShell foreground regions
```

The key design boundary is that material image resources may be rich in memory
but remain session-local. The backend stores read cursors and product data, not
large ink/image blobs.

## Resource Channel Contract

`MaterialResource` already supports:

```text
visualBlob / visualObjectUrl
restoreBlob / restoreObjectUrl
sourceBlob / sourceObjectUrl
```

This task should strengthen tests and metadata so future background/image work
does not accidentally reduce the model to a single flattened image.

Rules:

- `visual` is what inactive surfaces display.
- `restore` is what the engine bakes back into editable ink/material state.
- `source` is the original/source-color asset used to keep image fidelity.
- Restore happens before source/color composition.
- Replacing/discarding private resources revokes every private URL exactly once.

## Foreground Contrast Contract

Readable foreground is owned by the shell and product primitives:

- `ProductShell` places `AppDeskBackground` behind content.
- `ProductShellBody` owns header/list/main/sidebar foreground regions.
- `sk-paper-field`, `sk-paper-stack`, `sk-side-paper`, chat message papers, and
  task surfaces provide paper backgrounds.
- Text should not sit directly on the app background unless it is a deliberate
  decorative/empty-state treatment with contrast evidence.

Recommended data/style hooks:

```text
data-inkframe-background-source-mode
data-inkframe-contrast-owner
data-inkframe-foreground-surface
```

Do not add these everywhere blindly. Add them only on region owners where tests
or future proof runner checks need stable selectors.

## Implementation Shape

Likely code/test files:

```text
frontend/components/inkframe/material-resource.ts
frontend/components/inkframe/material-surface-restore.ts
frontend/components/inkframe/material-surface.tsx
frontend/components/inkframe/app-desk-background.tsx
frontend/components/product-shell-body.tsx
frontend/test/material-resource.test.ts
frontend/test/material-surface-restore.test.ts
frontend/test/material-surface.test.tsx
frontend/test/inkframe-object-ui.test.tsx
tools/twd-guard/twd-inkframe-proof.mjs
tools/twd-guard/twd-inkframe-proof.test.mjs
```

## Browser Proof

Real proof still depends on a connected `./twd` tab. Until then, the proof
runner and DOM/source selectors should be made stronger, but evidence must
state `blocked_no_tab`.

## Risks

| Risk | Mitigation |
|---|---|
| Source color is lost by using restore image as the only image | tests require separate `sourceObjectUrl` for image resources |
| Background image lowers contrast | foreground region data hooks and source tests for paper surfaces |
| Image resources accidentally become persisted preferences | tests grep material/background code for storage APIs |
| Future proof runner has no stable selector | add minimal `data-inkframe-*` hooks at region owners |
| Over-design creates visible clutter | no new user-visible controls in this slice |
