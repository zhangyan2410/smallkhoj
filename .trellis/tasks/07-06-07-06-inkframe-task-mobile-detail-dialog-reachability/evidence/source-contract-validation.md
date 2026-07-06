# Source Contract Validation

Task: `.trellis/tasks/07-06-07-06-inkframe-task-mobile-detail-dialog-reachability`

## Change Summary

- Added a task mobile detail dialog source contract:
  - `data-inkframe-mobile-role="task-detail-dialog"`
  - viewport width: `w-[calc(100vw-1rem)]`
  - mobile viewport height: `max-h-[calc(100svh-1rem)]`
  - scroll owner: `overflow-y-auto`
  - horizontal containment: `overflow-x-hidden`
  - compact mobile padding with `p-3 sm:p-6`
- Hardened the task detail material frame with `min-w-0` and
  `overflow-x-hidden`.
- Hardened evidence/review form containment:
  - evidence form row uses `min-w-0`;
  - evidence path/content inputs use `min-w-0`;
  - review note input uses `min-w-0`.

## Red/Green Notes

RED:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Expected failure observed:

```text
task mobile detail dialog contains material detail, evidence, and review surfaces
not ok
TaskDetailDialog should expose a stable mobile detail dialog role
```

GREEN:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Result:

```text
19 tests
19 pass
0 fail
```

## Validation

Broader source/mobile suite:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
```

Result:

```text
39 tests
39 pass
0 fail
```

TypeScript:

```bash
cd frontend
rtk npx tsc --noEmit --pretty false
```

Result: pass, no errors.

ESLint:

```bash
cd frontend
rtk npx eslint components/task-detail-dialog.tsx components/task-material-state.tsx \
  app/tasks/page.tsx test/material-surface.test.tsx
```

Result: pass, no issues.

Repo/task gates:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-07-06-inkframe-task-mobile-detail-dialog-reachability
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

Real browser/mobile acceptance remains pending. This task only claims source
contract hardening until a `./twd` tab is connected.

## Check-Agent Review

Review channel:

```text
cr-07-06-task-mobile-detail-dialog-reachability
```

Worker:

```text
check-codex
```

Result:

```text
0 issues found
0 fixes required
0 open issues
```

The check worker confirmed:

- the `task-detail-dialog` role and viewport/overflow classes are on the actual
  `DialogContent` instance;
- the generic dialog atom was not changed;
- the task detail material frame owns its `min-w-0` and `overflow-x-hidden`
  containment locally;
- evidence and review containment are on the actual form/row/input elements;
- the source test binds to exact elements rather than whole-file matches;
- browser/mobile acceptance is not claimed while the WebDriver gate is
  unavailable.

Main-session post-review validation:

```bash
cd frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
rtk npx tsc --noEmit --pretty false
rtk npx eslint components/task-detail-dialog.tsx components/task-material-state.tsx \
  app/tasks/page.tsx test/material-surface.test.tsx
```

Result: focused test 19 pass; broader source/mobile suite 39 pass; TypeScript
pass; ESLint pass.

