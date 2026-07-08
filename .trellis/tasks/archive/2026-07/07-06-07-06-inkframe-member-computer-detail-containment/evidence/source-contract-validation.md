# Source Contract Validation

## Scope

This slice hardens Members and Computers detail surfaces for mobile
containment/source locality after the left-sidebar entity alignment slice.

Changed files for this slice:

- `frontend/app/members/page.tsx`
- `frontend/app/computers/page.tsx`
- `frontend/test/material-surface.test.tsx`

## Red-Green Evidence

RED:

```text
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
not ok 22 - member and computer detail surfaces expose contained mobile owners
error: MemberDetail should expose a contained member-detail owner
```

GREEN:

```text
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
1..23
# pass 23
# fail 0
```

## Implemented Contracts

Members:

- `member-detail` on the selected member detail card with `min-w-0 overflow-x-hidden`.
- `member-profile` on the top identity/profile object with containment.
- `member-tab-bar` on the horizontal tab strip with `min-w-0 overflow-x-auto`.
- `member-permission-entry` on permission and action rows with contained keys.
- `member-workspace-binding` on workspace/bound-computer material owners.

Computers:

- `computer-detail` on the selected computer detail owner with containment.
- `computer-lifecycle` on lifecycle controls.
- `computer-reconnect-command` on reconnect command material surface.
- `computer-workspace-list` on agent workspace list/table owner.
- `computer-workspace-row` on each workspace row.

## Validation Commands

```text
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
PASS 23

rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/task-board-hydration.test.tsx test/markdown-message.test.tsx test/chat-unread-state.test.ts
PASS 56

rtk npx eslint app/members/page.tsx app/computers/page.tsx test/material-surface.test.tsx
PASS

rtk npx tsc --noEmit --pretty false
PASS

rtk git diff --check
PASS

rtk python3 .trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-member-computer-detail-containment
PASS
```

## Browser Proof

Attempted:

```text
rtk ./tools/twd-guard/twd-inkframe-proof --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof --account zy-ean --json
```

Result:

```json
{"ok":false,"status":"blocked_no_tab"}
```

No browser/mobile acceptance is claimed for this slice while `./twd` has no
connected tab.

## Check Worker Review

Channel:

```text
cr-07-06-member-computer-detail-containment
```

Result:

```text
check-codex done
```

Findings fixed by the check worker:

- Added the missing `member-workspace-binding` role/containment to the
  `ProfileTab` runtime binding `ComputerInkstone` and pinned it in the source
  test.
- Hardened the permission/action add rows with `min-w-0 flex-wrap
  overflow-x-hidden`, made the key input a contained flex child, and kept the
  select controls from collapsing with `shrink-0`.

Post-check main-session validation:

```text
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
PASS 23

rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/task-board-hydration.test.tsx test/markdown-message.test.tsx test/chat-unread-state.test.ts
PASS 56

rtk npx eslint app/members/page.tsx app/computers/page.tsx test/material-surface.test.tsx
PASS

rtk npx tsc --noEmit --pretty false
PASS

rtk git diff --check
PASS

rtk python3 .trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-member-computer-detail-containment
PASS
```

Open issues:

```text
None for this slice.
```
