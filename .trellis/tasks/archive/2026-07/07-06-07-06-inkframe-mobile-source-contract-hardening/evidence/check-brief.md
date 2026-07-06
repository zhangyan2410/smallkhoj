Active task: .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening

Review the mobile source contract hardening diff.

Prioritize:

1. Does the new chat tab-strip role/overflow change genuinely support mobile
   containment without inventing a separate visual direction?
2. Does the test prove a useful source contract rather than a brittle unrelated
   implementation detail?
3. Does any wording or evidence claim real browser/mobile acceptance while
   `./twd` is still `blocked_no_tab`?
4. Does the change preserve existing Inkframe object language:
   short messages may tilt, long messages stay stable, message actions hidden
   by default, static material does not capture pointer?
5. Are there nearby mobile source contracts that this small diff accidentally
   weakens?

Diff scope:

- `frontend/app/chat/[channel]/channel-client.tsx`
- `frontend/test/material-surface.test.tsx`
- `.trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening/**`
- `.trellis/spec/frontend/quality-guidelines.md`
- browser-proof task evidence updates that record the current no-tab state

Validation already run:

- `cd frontend && rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx`
- `cd frontend && rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/task-board-hydration.test.tsx test/markdown-message.test.tsx`
- `rtk ./tools/twd-guard/twd-inkframe-proof --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof --account zy-ean --json`
- `rtk git diff --check`
- `rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening`

Do not commit. Fix small mechanical issues if safe. Report open issues with
file/line references.
