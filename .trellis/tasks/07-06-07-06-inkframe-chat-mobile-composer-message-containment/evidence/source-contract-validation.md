# Source Contract Validation

## Summary

Implemented chat mobile containment hardening for the Inkframe chat surface:

- `chat-message-list` keeps its explicit mobile scroll-owner contract.
- The inner message stack now carries `min-w-0`.
- `MessageFrame` keeps containment centralized on the shared message prefab.
- `chat-composer` now suppresses horizontal overflow and its composer surface
  can wrap on narrow widths.
- Main chat input and thread reply input now use `min-w-0 flex-1`.
- Thread panel message scroller and reply composer now follow the same
  containment grammar.

The previous chat unread/event Trellis task was included in this round by
rerunning its frontend cursor contract test.

## RED

Command:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Result before implementation:

```text
not ok - chat mobile message and composer surfaces are contained flex regions
The input did not match /(?:^|\s)min-w-0(?:\s|$)/
Input: 'mr-auto w-full max-w-[1248px] space-y-3'
```

This confirmed the new test caught the missing inner message stack containment.

## GREEN

Focused material/mobile source contract:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx
```

Result:

```text
20 pass
```

Previous chat unread/event task validation:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
```

Result:

```text
13 pass
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
40 pass
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
rtk npx eslint 'app/chat/[channel]/channel-client.tsx' components/message-frame.tsx test/material-surface.test.tsx
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
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-chat-mobile-composer-message-containment
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

Check rerun note:

```text
The check worker reran the same guard command. In this sandbox it returned
status="failed_twd" because the initial ./twd tabs command hit
PermissionError: [Errno 1] Operation not permitted. No route assertions ran.
```

No browser-visible acceptance is claimed for this slice while `./twd` has no
connected tab or cannot execute the tab gate.

## Check Worker Review

Channel:

```text
cr-07-06-chat-mobile-composer-message-containment
```

Reviewer result:

```text
Self-Check Complete
```

Mechanical fixes made by the check worker:

- Added `overflow-x-hidden` to `data-slot="message-paper-content"` in
  `MessageFrame`.
- Added the matching source-test assertion for `message-paper-content`.
- Added the check-rerun note above for the sandbox `failed_twd` result.

Open scope notes from reviewer:

- The broader worktree already contains adjacent Inkframe material UI and chat
  unread/read-cursor changes. Those were not reverted because they belong to
  adjacent slices already present in this shared branch.

Post-review rerun:

```text
material-surface.test.tsx: 20 pass
chat-unread-state.test.ts: 13 pass
inkframe regression set: 40 pass
tsc --noEmit --pretty false: pass
scoped eslint: pass
git diff --check: pass
task.py validate: pass
```
