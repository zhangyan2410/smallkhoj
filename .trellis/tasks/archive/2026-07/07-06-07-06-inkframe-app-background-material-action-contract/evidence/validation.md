# Validation

Date: 2026-07-06

## Scope

Task:

```text
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract
```

Changed code:

```text
frontend/components/inkframe/app-desk-background.tsx
frontend/components/inkframe/material-surface-lifecycle.ts
frontend/test/material-surface.test.tsx
```

Planning/context files:

```text
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/prd.md
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/design.md
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/implement.md
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/implement.jsonl
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/check.jsonl
```

## Red Test

Added a test requiring an importable app-desk material action resolver.

Command:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Expected failure before implementation:

```text
AppDeskBackground exposes an explicit material action contract
TypeError: resolveAppDeskMaterialAction is not a function
```

This proved the new test was exercising a missing source contract rather than
only reasserting existing behavior.

## Implementation

Exported:

```ts
resolveAppDeskMaterialAction(action: AppDeskMaterialAction)
```

from:

```text
frontend/components/inkframe/app-desk-background.tsx
```

`AppDeskBackground` now uses the exported resolver when handling:

```text
smallkhoj:app-desk-material
```

Post-review hardening also changed the shared pointer-capture helper:

```text
shouldMaterialSurfaceCapturePointer(mode, pointerMode)
```

It now returns true only for `mode === "active"` with `pointerMode === "draw"`
or `"water"`. `keeping` and `discarding` states no longer capture the pointer,
which keeps background keep/discard from stealing page scroll or input.

The tested action matrix is:

| Action | Mode | Pointer mode | Pointer capture |
|---|---|---|---|
| `activate` | `active` | `none` | false |
| `draw` | `active` | `draw` | true |
| `water` | `active` | `water` | true |
| `keep` | `keeping` | `none` | false |
| `discard` | `discarding` | `none` | false |
| `static` | `static` | `none` | false |

Added source-safety assertions that the app background component still listens
for `APP_DESK_MATERIAL_EVENT` and does not introduce `localStorage`,
`indexedDB`, or `fetch` persistence for material resources.

## Checks

Focused frontend test + related object UI test:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx test/inkframe-object-ui.test.tsx
```

Result:

```text
43 passed
```

Main-session re-run after check-agent fixes:

```text
43 passed
```

Typecheck:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false
```

Result: pass.

Main-session re-run after check-agent fixes: pass.

Full frontend tests:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
```

Result:

```text
136 passed
```

Main-session re-run after check-agent fixes:

```text
136 passed
```

Frontend lint:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk npm run lint -- --max-warnings=0
```

Result: pass.

Main-session re-run after check-agent fixes: pass.

Diff whitespace:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result: pass.

Trellis context:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract
```

Result: pass.

## Browser Evidence Status

Command:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./twd --compact tabs
```

Result:

```json
{"ok": true, "tabs": [], "count": 0}
```

No connected browser tab is available. This task does not claim browser/mobile
acceptance. It is a source/unit contract hardening slice.

## Acceptance Mapping

- Importable `AppDeskMaterialAction` and resolver: covered by
  `AppDeskBackground exposes an explicit material action contract`.
- Action-to-mode and pointer-mode matrix: covered by the same test.
- Pointer capture false except explicit draw/water: covered through
  `shouldMaterialSurfaceCapturePointer`.
- Future image resource preserves `app-background/global-desk/desk`: covered by
  `AppDeskBackground preserves the desk owner contract with a future image resource`.
- No new persistence: covered by `AppDeskBackground keeps material resources
  session-local`.
- Browser honesty: recorded as `blocked_no_tab` / no connected tab above.
