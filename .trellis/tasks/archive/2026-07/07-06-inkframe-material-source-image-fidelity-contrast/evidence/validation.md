# Validation

Date: 2026-07-06

## Scope

Task:

```text
.trellis/tasks/07-06-inkframe-material-source-image-fidelity-contrast
```

Implemented:

- `MaterialSurface` now exposes `data-inkframe-resource-*` metadata:
  - resource id;
  - owner kind;
  - tint;
  - source kind;
  - has visual channel;
  - has restore channel;
  - has source channel.
- `AppDeskBackground` now exposes background image/source proof hooks:
  - `data-inkframe-background-source-mode`;
  - `data-inkframe-background-has-visual`;
  - `data-inkframe-background-has-restore`;
  - `data-inkframe-background-has-source`.
- `ProductShellBody` foreground regions now expose contrast proof hooks:
  - `data-inkframe-contrast-owner`;
  - `data-inkframe-foreground-surface`.
- `tools/twd-guard/twd-inkframe-proof.mjs` now checks:
  - default background source mode;
  - workbench header foreground contrast ownership;
  - main panel foreground contrast ownership.

## RED

Before implementation, the focused test command failed as expected:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx test/inkframe-object-ui.test.tsx
```

Expected failures:

- missing `data-inkframe-background-source-mode`;
- missing `data-inkframe-background-has-*`;
- missing `data-inkframe-resource-*`;
- missing `data-inkframe-contrast-owner`;
- missing `data-inkframe-foreground-surface`.

Result:

```text
40 passed / 4 failed
```

## GREEN

Focused frontend material/background tests:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-resource.test.ts test/material-surface-restore.test.ts test/material-surface.test.tsx test/inkframe-object-ui.test.tsx
```

Result:

```text
54 passed / 0 failed
```

TypeScript:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false
```

Result:

```text
pass
```

Proof-runner tests:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
rtk node --test tools/twd-guard/*.test.mjs
```

Results:

```text
twd-inkframe-proof.test.mjs: 13 passed
tools/twd-guard/*.test.mjs: 22 passed
```

Task validation:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-inkframe-material-source-image-fidelity-contrast
```

Result:

```text
All validations passed
```

Whitespace:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result:

```text
pass
```

Browser gate:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./twd --compact tabs
```

Result:

```json
{"ok": true, "tabs": [], "count": 0}
```

Exit:

```text
2
```

Classification:

```text
blocked_no_tab
```

No visible browser/mobile acceptance is claimed for this task.
