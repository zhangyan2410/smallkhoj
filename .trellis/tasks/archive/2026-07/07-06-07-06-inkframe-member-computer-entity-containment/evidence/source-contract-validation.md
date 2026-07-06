# Source Contract Validation

## Scope

This slice aligns Members and Computers left-sidebar rows with the shared
`SidebarEntityItem` prefab used by Chat. It is intentionally a containment and
source-hook pass, not a broad visual redesign.

Changed files for this slice:

- `frontend/app/members/members-list.tsx`
- `frontend/app/computers/page.tsx`
- `frontend/app/globals.css`
- `frontend/test/material-surface.test.tsx`

## Red-Green Evidence

RED:

```text
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
not ok 21 - members and computers sidebar entity lists share contained prefab rows
error: MembersList should expose the contained members-list owner
```

GREEN:

```text
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
1..22
# pass 22
# fail 0
```

## Implemented Contracts

- `MembersList` now exposes `data-inkframe-mobile-role="members-list"` on a
  contained owner with `min-h-0 min-w-0 overflow-x-hidden`.
- Member rows now use `SidebarEntityItem` with
  `data-inkframe-mobile-role="member-entity-item"`.
- Member rows still use `AvatarObject`, preserving the shared avatar prefab.
- Computers list now exposes `data-inkframe-mobile-role="computers-list"` on a
  contained scroll owner with `min-h-0 min-w-0 overflow-x-hidden overflow-y-auto`.
- Computer rows now use `SidebarEntityItem` with
  `data-inkframe-mobile-role="computer-entity-item"`.
- `ComputerInkstone` remains on computer detail/runtime-binding surfaces, not
  as the left-sidebar row prefab.
- `SidebarEntityItem` active tone coverage now includes green and yellow,
  matching the member/computer tones this slice uses.

## Validation Commands

```text
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
PASS 22

rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/member-avatar.test.tsx
PASS 32

rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/task-board-hydration.test.tsx test/markdown-message.test.tsx test/chat-unread-state.test.ts
PASS 55

rtk npx tsc --noEmit --pretty false
TypeScript: No errors found

rtk npx eslint app/members/members-list.tsx app/computers/page.tsx test/material-surface.test.tsx
ESLint: No issues found

rtk git diff --check
PASS

rtk python3 .trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-member-computer-entity-containment
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
cr-07-06-member-computer-entity-containment
```

Result:

```text
check-codex done
```

Finding fixed by the check worker:

- `frontend/test/material-surface.test.tsx` member entity assertion was too
  loose. It now slices the real `renderItem` source before asserting
  `SidebarEntityItem`, the `member-entity-item` role, `AvatarObject`, and no
  direct `MemberAvatar` reintroduction.

Open issues:

```text
None for this slice.
```
