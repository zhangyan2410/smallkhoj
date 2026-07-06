# Check Review

Date: 2026-07-06

Channel:

```text
cr-inkframe-bg-resource
```

Worker:

```text
check-codex
```

## Round 1

The reviewer checked the background image/resource/readability contract against
the task PRD, design, implementation plan, curated specs, and relevant frontend
source/tests.

Finding:

- P2: `/login` and `/join/[token]` were listed in the PRD route coverage in a
  way that could be read as requiring `ProductShell` / shell-owned
  `AppDeskBackground`, while the current implementation and tests intentionally
  treat them as auth entry surfaces.

The reviewer found no issues with the core `ProductShell` /
`AppDeskBackground` / `MaterialResource` contract for shell-mounted product
routes.

## Fix

Main session resolved the P2 as a contract/documentation fix:

- product routes require `ProductShell` and shell-owned `AppDeskBackground`;
- `/login` and `/join/[token]` are documented auth entry-surface exceptions;
- auth entry routes must keep the clean dry-paper `workbench-desk` surface;
- auth entry routes must not mount a duplicate route-local `AppDeskBackground`.

Updated files:

- `prd.md`
- `evidence/contract-validation.md`

## Round 2

The reviewer rechecked the resolved P2 and reported:

```text
Issues Not Fixed
None. The previously open P2 is resolved.
```

The reviewer also reported:

```text
Checked 5 files, found 0 new issues, fixed 0, 0 open.
```

## Validation

Main session validation after the fix:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts test/material-surface-restore.test.ts
```

Result:

```text
53 passed
```

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability
rtk git diff --check
```

Result:

```text
pass
```

Browser proof remains honestly blocked:

```json
{"ok": true, "tabs": [], "count": 0}
```

Classification:

```text
blocked_no_tab
```
