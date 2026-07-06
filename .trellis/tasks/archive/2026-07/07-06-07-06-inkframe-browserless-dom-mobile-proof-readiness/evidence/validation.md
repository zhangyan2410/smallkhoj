# Validation

Date: 2026-07-06

## Code Changes

Frontend DOM contract markers were added to real Inkframe product components:

```text
frontend/components/inkframe/material-surface.tsx
frontend/components/inkframe/app-desk-background.tsx
frontend/components/inkframe-object-ui.tsx
frontend/components/message-frame.tsx
frontend/app/chat/[channel]/channel-client.tsx
frontend/app/tasks/page.tsx
frontend/components/task-dnd-board.tsx
```

Tests were hardened in:

```text
frontend/test/material-surface.test.tsx
frontend/test/inkframe-object-ui.test.tsx
```

Evidence/checklist files:

```text
.trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness/evidence/dom-contract-inventory.md
.trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness/evidence/twd-proof-checklist.md
```

## TDD Red / Green Notes

Red:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Expected failures appeared for missing `data-inkframe-*` markers on:

- `MaterialSurface`;
- `AppDeskBackground`;
- message material object/density;
- task material object/state;
- chat/task mobile proof roles.

Red:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx
```

Expected failure appeared for missing `data-inkframe-object` markers on
evidence/review/task-link objects.

Green focused tests:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx
```

Result:

```text
material-surface.test.tsx: 16 pass
inkframe-object-ui.test.tsx: 16 pass
```

## Target Matrix

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/chat-unread-state.test.ts \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx
```

Result:

```text
48 tests
48 pass
0 fail
```

## Lint

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk npm run lint -- --max-warnings=0
```

Result:

```text
pass
```

## TypeScript

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false
```

Result:

```text
pass
```

## Repository Whitespace

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result:

```text
pass
```

## Browser Status

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./twd --compact tabs
```

Result:

```json
{"ok": true, "tabs": [], "count": 0}
```

No browser/mobile acceptance is claimed from this task yet. The task only
establishes browserless DOM contract readiness and a deterministic `./twd`
checklist for the later connected-tab pass.

## Check Worker Review

Review channel:

```text
cr-07-06-browserless-dom-mobile-proof-readiness
```

Worker:

```text
check-dom-readiness
```

Result:

```text
7 DOM-contract readiness gaps found and fixed
0 open code issues
```

Worker fixes:

- Added `data-inkframe-object="event-badge"` and
  `data-inkframe-unread="true|false"` to `EventBadge`.
- Added `data-inkframe-object="sidebar-entity"` and
  `data-inkframe-unread="true|false"` to `SidebarEntityItem`.
- Added `data-inkframe-object="message-actions"` and
  `data-inkframe-state="toolbar-hidden"` to the real message actions container
  and shared message tool strip.
- Added `data-inkframe-mobile-role="sidebar-drawer"` and
  `data-inkframe-state="collapsed"` to the product shell list/sidebar panel.
- Added mobile proof roles for task detail/evidence/review:
  `task-detail`, `task-evidence`, and `task-review`.
- Hardened tests so they assert the stable `data-inkframe-*` vocabulary rather
  than only generic `data-object` or route-local markers.
- Updated `dom-contract-inventory.md` and `twd-proof-checklist.md` so later
  browser proof uses the same selectors.

Worker verification:

```text
48 pass, 0 fail
typecheck pass
lint pass
git diff --check pass
```

The check-worker sandbox could not run `./twd` due a local permission error, so
the main-session `./twd` result remains the authoritative browser status:

```json
{"ok": true, "tabs": [], "count": 0}
```

## Main-Session Post-Review Verification

Target matrix after worker fixes:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/chat-unread-state.test.ts \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx
```

Result:

```text
48 tests
48 pass
0 fail
```

Lint:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk npm run lint -- --max-warnings=0
```

Result:

```text
pass
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

Repository whitespace:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result:

```text
pass
```

## Wide Regression Matrix

Frontend wide target matrix after review fixes:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/chat-unread-state.test.ts \
  test/inkframe-object-ui.test.tsx \
  test/material-resource.test.ts \
  test/material-surface-restore.test.ts \
  test/material-surface-store.test.ts \
  test/material-surface.test.tsx \
  test/ink-material-engine.test.ts \
  test/member-avatar.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
```

Result:

```text
84 tests
84 pass
0 fail
```

Backend cursor/account matrix after review fixes:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest \
  tests/test_chat_read_cursors.py \
  tests/test_chat_read_cursors_http.py \
  tests/test_chat_read_cursors_postgres_http.py \
  tests/test_server_account_membership.py -q
```

Result:

```text
57 passed in 1.81s
```
