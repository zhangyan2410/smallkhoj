# Source Contract Validation

## Summary

Implemented the next frontend optimization loop for the global Inkframe desk
background contract:

- Created detailed Trellis task artifacts for the desk background owner and
  route coverage slice.
- Added source tests proving `ProductShell` is the single shell-level owner of
  `AppDeskBackground` and `InkMaterialRuntimeScript`.
- Added user-facing route coverage tests for dashboard, chat, tasks, members,
  computers, settings, login, and join.
- Added tests preventing page-local `AppDeskBackground` mounts outside
  `ProductShell`.
- Added stable owner/scope attributes:
  - `data-inkframe-background-owner="product-shell"`;
  - `data-inkframe-background-scope="global-desk"`.
- Added material resource metadata attributes to `MaterialSurface`:
  - `data-resource-owner-kind`;
  - `data-resource-tint`;
  - `data-resource-source-kind`.
- Added app desk resource metadata attributes to `AppDeskBackground`:
  - `data-inkframe-resource-owner-kind`;
  - `data-inkframe-resource-tint`;
  - `data-inkframe-resource-source-kind`.
- Added material resource coverage proving app-background image resources keep
  `ownerKind="app-background"`, `tint="desk"`, and separated visual/restore/source
  channels.

Changed files for this slice:

- `frontend/components/product-shell.tsx`
- `frontend/components/inkframe/app-desk-background.tsx`
- `frontend/components/inkframe/material-surface.tsx`
- `frontend/test/inkframe-object-ui.test.tsx`
- `frontend/test/material-surface.test.tsx`
- `frontend/test/material-resource.test.ts`

## RED

Command:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts
```

Initial result before implementation:

```text
not ok - Inkframe background contract has one shell owner
The input did not match /data-inkframe-background-owner="product-shell"/

not ok - MaterialSurface renders owner, region, mode, tint, and static resource slots
The input did not match /data-resource-owner-kind="message"/

not ok - AppDeskBackground exposes the shell-owned Inkframe background contract
The input did not match /data-inkframe-background-owner="product-shell"/
```

This confirmed the source contracts caught real missing owner/resource markers.

## GREEN

Focused desk/background/material contracts:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts
```

Result:

```text
47 pass
```

Inkframe regression set:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/material-resource.test.ts \
  test/material-surface-restore.test.ts \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
```

Result:

```text
54 pass
```

TypeScript:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk npx tsc --noEmit --pretty false
```

Result:

```text
TypeScript: No errors found
```

Scoped lint:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk npx eslint components/product-shell.tsx components/inkframe/app-desk-background.tsx components/inkframe/material-surface.tsx components/inkframe/material-resource.ts test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts
```

Result:

```text
ESLint: No issues found
```

Whitespace:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result:

```text
PASS
```

Task validation:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-desk-background-owner-route-coverage
```

Result:

```text
All validations passed
```

## Browser Gate

Command:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

Result:

```json
{"ok":false,"status":"blocked_no_tab","jsonPath":"/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/twd-inkframe-proof.json","markdownPath":"/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/twd-inkframe-proof.md"}
```

No browser-visible acceptance is claimed for this slice while `./twd` has no
connected tab.

## Check Review

The Trellis channel check worker reviewed the slice and made two scoped
hardening updates:

- tightened route coverage so `/chat` and `/chat/[channel]` are both explicitly
  covered by `app/chat/layout.tsx`, while their page files are checked for no
  route-local `AppDeskBackground`;
- added a `defaultResource` path for `AppDeskBackground`, proving a future
  image resource preserves `ownerKind="app-background"`, `tint="desk"`,
  `sourceKind="image"`, and the visual object URL without changing the shell
  owner contract.

Check rerun of the browser gate:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

Result:

```json
{"ok":false,"status":"failed_twd","jsonPath":"/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/twd-inkframe-proof.json","markdownPath":"/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/twd-inkframe-proof.md"}
```

The generated TWD evidence records the immediate blocker as:

```text
./twd --compact tabs -> PermissionError: [Errno 1] Operation not permitted
```

No browser-visible or mobile acceptance is claimed for this slice.

Main-session follow-up verification after the worker fixes:

```text
rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts
48 pass

rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts test/material-surface-restore.test.ts test/task-board-hydration.test.tsx test/markdown-message.test.tsx
55 pass

rtk npx tsc --noEmit --pretty false
TypeScript: No errors found

rtk npx eslint components/product-shell.tsx components/inkframe/app-desk-background.tsx components/inkframe/material-surface.tsx components/inkframe/material-resource.ts test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts
ESLint: No issues found

rtk git diff --check
PASS

rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-desk-background-owner-route-coverage
PASS
```
