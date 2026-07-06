# Implementation Plan: Inkframe Runtime Browser Proof And Product Polish Optimization

This task now uses `12-hour-product-refactor-plan.md` as the detailed execution
plan. The phases below remain the shorter operational checklist. Do not narrow
the task to browser proof only: this task also includes the earlier
`07-05-inkframe-product-ui-refactor`,
`07-04-ink-material-card-restore-resource`, and
`07-02-chat-event-unread-indicators` acceptance surfaces.

## Phase 0. Preflight

1. Confirm worktree and task state.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
rtk python3 ./.trellis/scripts/task.py current
```

2. Read carry-over artifacts.

```bash
rtk sed -n '1,260p' .trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/quality-gate.md
rtk sed -n '1,320p' .trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/evidence/2026-07-06-progress.md
rtk sed -n '1,260p' .trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/evidence/product-surface-audit.md
```

3. Read applicable specs before edits.

```bash
rtk sed -n '1,220p' .trellis/spec/frontend/component-guidelines.md
rtk sed -n '1,220p' .trellis/spec/frontend/quality-guidelines.md
rtk sed -n '1,220p' .trellis/spec/frontend/state-management.md
rtk sed -n '1,260p' .trellis/spec/backend/database-guidelines.md
rtk sed -n '1,260p' .trellis/spec/backend/event-delivery-contracts.md
rtk sed -n '1,260p' .trellis/spec/guides/cross-layer-thinking-guide.md
```

## Phase 1. Browser / Runtime Connectivity

1. Try WebDriver connection.

```bash
rtk ./twd --compact tabs
```

2. If no tab is connected:

- record output in `evidence/browser-proof.md`;
- try the documented guard/open flow only if the bridge has a connected tab;
- do not open raw `twd.py`;
- proceed with code-level evidence and leave browser proof marked pending.

3. If a tab is connected:

- authenticate via guarded helper if needed;
- open `/chat`;
- open `/tasks`;
- save focused screenshots and DOM assertion JSON under `evidence/`.

## Phase 2. Chat Product Proof And Polish

1. Add/strengthen tests around:

- `activeMaterialMessageId`;
- `data-slot="message-material-toggle"`;
- one active message canvas;
- static message list creates no unbounded canvases;
- toolbar stays message-local.

2. Use browser evidence if available:

- focus/hover first message;
- click paintbrush;
- assert one active message canvas;
- click another message paintbrush;
- assert previous is static and new one active.

3. Polish only if evidence shows an issue:

- active affordance too invisible/noisy;
- toolbar clipped;
- canvas text contrast/readability issue;
- mobile overflow.

## Phase 3. Task Product Proof And Polish

1. Add/strengthen tests around:

- `activeMaterialTaskId`;
- `data-slot="task-material-toggle"`;
- one active task canvas;
- toggle does not propagate to select/drag logic;
- selected task detail shares active task state.

2. Use browser evidence if available:

- open `/tasks`;
- click task paintbrush;
- assert one active task canvas;
- click another task paintbrush;
- assert previous deactivates;
- verify list/detail variants.

3. Polish only if evidence shows an issue:

- toggle placement conflicts with status pill;
- active canvas hurts content readability;
- mobile task controls clip or overflow.

## Phase 4. Product Surface Audit

Update:

```text
.trellis/tasks/07-06-inkframe-runtime-browser-proof-product-polish/evidence/product-surface-audit.md
```

Rows:

- `/chat`
- `/chat/[channel]`
- `/tasks`
- `/members`
- `/computers`
- `/settings`
- `/login`
- `/join`
- product landing/dashboard route
- chat mobile `390px`
- task mobile `390px`

Classify each as:

- pass with evidence;
- code-level pass, browser pending;
- failed with fix link;
- deferred out of scope.

## Phase 5. Backend Cursor Hardening

1. Inspect existing test harness and fixtures.
2. Add route-flow tests where feasible:

- `POST /api/v1/chat/read-cursors` channel cursor;
- `POST /api/v1/chat/read-cursors` DM cursor;
- `POST /api/v1/chat/read-cursors` thread cursor;
- invalid DM/channel kind rejection;
- list projection after write.

3. If authenticated route-flow is too large, add service/router focused tests
and document why full route-flow is deferred.

## Phase 6. Verification

Required commands:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
```

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py
```

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Browser commands if connected:

```bash
rtk ./twd --compact tabs
rtk ./tools/twd-guard/twd-open /chat
rtk ./tools/twd-guard/twd-open /tasks
```

## Phase 7. Review

Spawn a Trellis channel check worker if available. Otherwise perform self-review
with the same review brief.

Review must cover:

- browser evidence truthfulness;
- active foreground material UX;
- mobile layout;
- backend cursor route/test hardening;
- no unrelated broad refactor.

Do not commit, push, merge, pull, or reset inside this task unless explicitly
directed by the user.
