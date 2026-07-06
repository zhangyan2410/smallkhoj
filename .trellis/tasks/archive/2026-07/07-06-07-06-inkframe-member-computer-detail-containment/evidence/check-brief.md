# Check Brief: Inkframe Member And Computer Detail Containment

Active task:

```text
.trellis/tasks/07-06-07-06-inkframe-member-computer-detail-containment
```

Please review the uncommitted diff for this slice against:

- `.trellis/tasks/07-06-07-06-inkframe-member-computer-detail-containment/prd.md`
- `.trellis/tasks/07-06-07-06-inkframe-member-computer-detail-containment/design.md`
- `.trellis/tasks/07-06-07-06-inkframe-member-computer-detail-containment/implement.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/product-ui-style.md`
- `.trellis/spec/frontend/quality-guidelines.md`

Intended slice-specific files:

- `frontend/app/members/page.tsx`
- `frontend/app/computers/page.tsx`
- `frontend/test/material-surface.test.tsx`

Important context:

- This worktree already contains many unrelated uncommitted changes from the
  broader Inkframe branch. Do not revert unrelated files.
- This slice is only about member/computer detail containment and stable source
  roles. The material runtime/background/backend cursor umbrella task is
  referenced as parent context but not implemented here.
- Browser proof is currently blocked by no connected `./twd` tab; do not claim
  browser acceptance from source tests.

Main-session validation already run:

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

rtk ./tools/twd-guard/twd-inkframe-proof --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof --account zy-ean --json
blocked_no_tab
```

Review focus:

1. Are the new roles on the exact detail owners future agents would need to
   target?
2. Are containment classes sufficient without broad page-level clipping?
3. Are long keys/commands/paths contained inside their owning objects?
4. Is the source test too brittle or too loose?
