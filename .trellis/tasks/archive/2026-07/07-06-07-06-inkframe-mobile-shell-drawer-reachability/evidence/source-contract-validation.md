# Source Contract Validation

Task: `.trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability`

## Change Summary

- Added `ProductShellBody` mobile list drawer state:
  - `mobileDrawerId = "inkframe-mobile-sidebar-drawer"`
  - `mobileListOpen` local UI state
  - mobile-only drawer toggle with `aria-controls` and `aria-expanded`
  - drawer `data-inkframe-state="open|collapsed"`
  - mobile-only in-drawer close control
- Kept desktop shell ownership in `ProductShellBody`; routes do not duplicate
  the list/sidebar drawer.
- Kept the desktop resizable list width through `--inkframe-list-width` and
  `sm:w-[var(--inkframe-list-width)]`.
- Kept drawer content as the scroll owner with `min-h-0 min-w-0 flex-1
  overflow-y-auto`.

## Red/Green Notes

RED:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Expected failure observed: `ProductShell mobile list drawer has a reachable
toggle and coupled open state` failed because `ProductShellBody` did not expose
`mobileDrawerId`, `mobileListOpen`, a mobile drawer toggle, or coupled drawer
open state.

GREEN:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Result: 18 pass.

## Validation

Focused and source/mobile regression:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
```

Result: 38 pass.

TypeScript:

```bash
cd frontend
rtk npx tsc --noEmit --pretty false
```

Result: pass, no errors.

ESLint:

```bash
cd frontend
rtk npx eslint components/product-shell-body.tsx test/material-surface.test.tsx
```

Result: pass, no issues.

Whitespace/task validation:

```bash
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability
```

Result: both pass.

## Browser Gate

Command:

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

Result:

```json
{"ok":false,"status":"blocked_no_tab"}
```

The real browser/mobile acceptance remains pending. This task only claims source
contract hardening until a `./twd` tab is connected.

## Check-Agent Review

Check-agent review completed after implementation. One mechanical test-hardening
fix was applied: the ProductShell drawer test now verifies the scroll-owner
classes on the same `data-slot="paper-stack-content"` element, instead of
matching those classes broadly on the entire drawer aside. It also verifies the
close control targets the stable drawer id.

Post-review validation:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
rtk npx tsc --noEmit --pretty false
rtk npx eslint components/product-shell-body.tsx test/material-surface.test.tsx
```

Result: focused test 18 pass; broader suite 38 pass; TypeScript pass; ESLint pass.

Repo/task gates were re-run after the check-agent edit:

```bash
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

Result: diff check pass; task validation pass; browser proof remains
`blocked_no_tab`.

The check-agent sandbox could not execute its own `npx tsx --test` form because
`tsx` attempted to open a local IPC pipe and hit `EPERM`; it used the equivalent
`node --import tsx --test` command there. The main session re-ran the requested
`npx tsx --test` form successfully afterward.
