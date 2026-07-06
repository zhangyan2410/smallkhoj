# Contract Validation

## Scope

Task: `07-06-07-06-07-06-inkframe-background-image-resource-readability`

This task records and hardens the contract for shell-owned Inkframe app
background resources, especially future image resources. It intentionally does
not introduce backend/localStorage/IndexedDB blob persistence.

## Findings

The current branch already has the key product contracts covered by source and
unit tests:

- `ProductShell` mounts exactly one `AppDeskBackground`.
- The shell root exposes:
  - `data-inkframe-background-owner="product-shell"`
  - `data-inkframe-background-scope="global-desk"`
- `AppDeskBackground` uses `MaterialSurface` with:
  - `ownerKind="app-background"`
  - `ownerId="global-desk"`
  - `region="app-background"`
  - `tint="desk"`
- A future image resource keeps:
  - `ownerKind="app-background"`
  - `tint="desk"`
  - `sourceKind="image"`
  - a stable resource id
  - a visual object URL
- Material resources keep visual / restore / source object URLs separated.
- `discardMaterialResource(...)` revokes the current private background
  resource and returns the shared/fallback desk resource.
- Route coverage enumerates the user-facing route set and rejects duplicate
  page-local `AppDeskBackground` mounts.
- `/login` and `/join/[token]` are explicitly treated as auth entry surfaces:
  they keep the clean dry-paper workbench background without mounting
  `ProductShell` navigation or a duplicate route-local `AppDeskBackground`.
- Pointer capture is false for static/fallback/inactive background states and
  only true for active draw/water material modes.

No production code changes were required in this pass. The work here is a
detailed Trellis task plus evidence that the current implementation already
matches the requested background/image-resource direction.

## Validation

Focused frontend material/background contract tests:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts test/material-surface-restore.test.ts
```

Result:

```text
53 passed
```

Frontend typecheck:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false
```

Result:

```text
pass
```

Repository whitespace:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result:

```text
pass
```

Task validation:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability
```

Result:

```text
All validations passed
```

## Context Manifests

The task `implement.jsonl` and `check.jsonl` were replaced with real curated
spec entries before review. They now include frontend component/style/quality/
state guidelines and the cross-layer thinking guide instead of the seed
`_example` row.

## Browser Gate

Command:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
./twd --compact tabs
```

Result:

```json
{"ok": true, "tabs": [], "count": 0}
```

Note: `./twd --compact tabs` returns the JSON above and exits with code `2` for
the no-connected-tab state. The status is still classified as `blocked_no_tab`,
not as a product/browser failure.

Classification:

```text
blocked_no_tab
```

No browser/mobile visible acceptance is claimed for this task.

## Review Follow-Up

Check worker `check-codex` found one P2 contract mismatch: the PRD originally
listed `/login` and `/join/[token]` in a way that could be read as requiring
`ProductShell`/`AppDeskBackground` ownership, while the implementation and tests
correctly keep those routes as auth entry surfaces.

Resolution:

- PRD R1 and R6 now document `/login` and `/join/[token]` as auth entry
  exceptions.
- Product routes still require `ProductShell`/`AppDeskBackground` ownership.
- Auth entry routes must keep the clean dry-paper `workbench-desk` surface and
  must not mount a duplicate route-local `AppDeskBackground`.

## Self-Review

Checklist:

- [x] Background owner remains `product-shell`.
- [x] Material owner remains `app-background`.
- [x] Background tint remains `desk`.
- [x] Image resource path preserves app-background/desk/image metadata.
- [x] Discard fallback returns to a desk resource.
- [x] No blob persistence was introduced.
- [x] Static/fallback background does not capture pointer input.
- [x] Route coverage remains explicit.
- [x] Browser proof is honestly marked `blocked_no_tab`.

No issues found in this source-contract pass.
