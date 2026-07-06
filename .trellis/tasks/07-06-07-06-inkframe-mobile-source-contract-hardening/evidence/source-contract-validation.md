# Source Contract Validation

Date: 2026-07-06

## Change

Hardened the chat mobile header/tab-strip source contract:

- added `data-inkframe-mobile-role="chat-tab-strip"`;
- added local horizontal containment with `min-w-0` and `overflow-x-auto`;
- added `min-w-0` to the chat header flex row so the tab strip can shrink
  instead of widening the header.
- after check review, tightened the test so `overflow-x-auto`, `min-w-0`, and
  `flex-1` must exist on the same tab-strip element that carries the mobile
  proof role.

Files changed:

```text
frontend/app/chat/[channel]/channel-client.tsx
frontend/test/material-surface.test.tsx
```

## Red / Green

Red test added:

```text
chat mobile tab strip is horizontally contained instead of widening the header
```

Initial result: failed because `channel-client.tsx` did not expose
`data-inkframe-mobile-role="chat-tab-strip"` and did not explicitly protect the
tab row with `overflow-x-auto`.

Green result after the source change:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Result: passed.

- 17 tests passed.

Reviewer-tightened test result after self-fix:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Result: passed.

- 17 tests passed.

## Focused Source Suite

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
```

Result: passed.

- 37 tests passed.

Final focused suite after check-review fix:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
```

Result: passed.

- 37 tests passed.

Covered contracts include:

- shared Inkframe object primitives and object taxonomy;
- message density: short messages may tilt, medium/long messages do not;
- message actions default hidden;
- material static/active canvas behavior;
- app background owner/tint/pointer-capture contract;
- chat/task mobile role markers for later `./twd` checks;
- task board hydration and task material state source contracts;
- Markdown unknown tag escaping, including the previous `<marker>` warning class.

## Browser Gate Recheck

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

Result:

```json
{
  "ok": false,
  "status": "blocked_no_tab",
  "jsonPath": "/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/twd-inkframe-proof.json",
  "markdownPath": "/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/twd-inkframe-proof.md"
}
```

Observed exit code: `2`.

Interpretation:

- Source/component contracts improved.
- Real browser/mobile proof remains pending.
- No chat/task/mobile acceptance is claimed from this source-only task.

## Other Checks

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result: passed.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk npx tsc --noEmit --pretty false
```

Result: passed.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk npx eslint 'app/chat/[channel]/channel-client.tsx' test/material-surface.test.tsx
```

Result: passed.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening
```

Result: passed.

- `implement.jsonl`: 10 entries valid.
- `check.jsonl`: 10 entries valid.
