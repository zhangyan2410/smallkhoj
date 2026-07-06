# Source Contract Validation

## Summary

Implemented the next frontend optimization loop for the Tasks page mobile board
path:

- Added a stable `task-filters` mobile role to the task filter surface.
- Hardened the filter surface with `min-w-0`, one-column mobile base, and
  `overflow-x-hidden`.
- Hardened `TaskDndBoard` wrapper with `min-w-0 overflow-x-hidden`.
- Hardened `TaskBoard` root, board grid, status columns, task stacks, sortable
  cards, source chips, list rows, and drag overlay containment.
- Kept board mobile base at one column while preserving desktop expansion to
  five status columns.
- Corrected the `task-board-root` source hook to point at the actual TaskBoard
  root, not the inline task detail surface.

## RED

Command:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Initial result before implementation:

```text
not ok - task board mobile filters, board, cards, list, and overlay are contained
Tasks route should expose a stable mobile filter surface role
```

This confirmed the new source contract test caught a real missing role and
containment anchor.

## GREEN

Focused material/mobile source contract:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Result:

```text
21 pass
```

Inkframe regression set:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
```

Result:

```text
41 pass
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
rtk npx eslint app/tasks/page.tsx components/task-dnd-board.tsx components/task-board.tsx test/material-surface.test.tsx
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
pass
```

Task validation:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-task-board-mobile-containment
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
{"ok":false,"status":"blocked_no_tab"}
```

No browser-visible acceptance is claimed for this slice while `./twd` has no
connected tab.

## Check Review

`check-codex` reviewed the slice against the PRD, design, implementation plan,
changed source, and frontend specs. One mechanical source-test gap was fixed:
the list row assertion now also pins the real `TaskMaterialSurface` list-row
containment owner, including `min-w-0` and `overflow-x-hidden`.

Check verification used `node --import tsx --test` because this sandbox rejects
the `npx tsx --test` IPC pipe with `EPERM`. Results after the self-fix:

```text
material-surface.test.tsx: 21 pass
inkframe regression set: 41 pass
tsc --noEmit --pretty false: pass
scoped eslint: pass
git diff --check: pass
task.py validate: pass
```

The browser gate was rerun during check and still produced no browser-visible
acceptance evidence. In this sandbox it failed before route assertions because
`./twd --compact tabs` hit `PermissionError: [Errno 1] Operation not permitted`;
the slice remains source-validated only until a connected browser tab can run
the mobile route assertions.

Main-session post-check rerun:

```text
material-surface.test.tsx: 21 pass
inkframe regression set: 41 pass
tsc --noEmit --pretty false: pass
scoped eslint: pass
git diff --check: pass
task.py validate: pass
```

## Continuation Re-Verification

The current session re-ran the task gates after later branch changes:

```text
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
23 pass

rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/task-board-hydration.test.tsx test/markdown-message.test.tsx
43 pass

rtk npx tsc --noEmit --pretty false
TypeScript: No errors found

rtk npx eslint app/tasks/page.tsx components/task-dnd-board.tsx components/task-board.tsx test/material-surface.test.tsx
ESLint: No issues found

rtk git diff --check
PASS

rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-task-board-mobile-containment
PASS
```

Browser/mobile route acceptance remains unclaimed because no connected `./twd`
tab has been available for route assertions in this environment.
