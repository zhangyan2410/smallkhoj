# Check Brief: Inkframe Member And Computer Entity Containment

Active task:

```text
.trellis/tasks/07-06-07-06-inkframe-member-computer-entity-containment
```

Please review the uncommitted diff for this slice against:

- `.trellis/tasks/07-06-07-06-inkframe-member-computer-entity-containment/prd.md`
- `.trellis/tasks/07-06-07-06-inkframe-member-computer-entity-containment/design.md`
- `.trellis/tasks/07-06-07-06-inkframe-member-computer-entity-containment/implement.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/product-ui-style.md`
- `.trellis/spec/frontend/quality-guidelines.md`

Intended slice-specific files:

- `frontend/app/members/members-list.tsx`
- `frontend/app/computers/page.tsx`
- `frontend/app/globals.css`
- `frontend/test/material-surface.test.tsx`

Important context:

- This worktree already contains many unrelated uncommitted changes from the
  broader Inkframe branch. Do not revert unrelated files.
- This slice is only about member/computer sidebar entity alignment and mobile
  containment. The broader material runtime/background/backend cursor task is
  referenced as parent context but not implemented here.
- Browser proof is currently blocked by no connected `./twd` tab; do not claim
  browser acceptance from source tests.

Main-session validation already run:

```text
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
PASS 22

rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/member-avatar.test.tsx
PASS 32

rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/task-board-hydration.test.tsx test/markdown-message.test.tsx test/chat-unread-state.test.ts
PASS 55

rtk npx tsc --noEmit --pretty false
PASS

rtk npx eslint app/members/members-list.tsx app/computers/page.tsx test/material-surface.test.tsx
PASS

rtk git diff --check
PASS

rtk python3 .trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-member-computer-entity-containment
PASS

rtk ./tools/twd-guard/twd-inkframe-proof --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof --account zy-ean --json
blocked_no_tab
```

Review focus:

1. Did members/computers left-list rows really become `SidebarEntityItem`
   prefab instances, without accidentally moving the wrong surface?
2. Are the new roles on the actual list/row owners rather than nearby wrappers?
3. Did we preserve `AvatarObject` for member identities and `ComputerInkstone`
   for detail/runtime surfaces?
4. Are mobile containment classes sufficient and not broad page-level clipping?
5. Is the source test too brittle or too loose?
