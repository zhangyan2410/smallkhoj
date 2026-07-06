# Implementation Plan: Inkframe Mobile Source Contract Hardening

## Phase 0: Preflight

1. Confirm worktree and active task:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
rtk python3 ./.trellis/scripts/task.py current
```

2. Read required context:

```bash
rtk sed -n '1,260p' .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening/prd.md
rtk sed -n '1,260p' .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening/design.md
rtk sed -n '1,260p' .trellis/spec/frontend/quality-guidelines.md
rtk sed -n '1,260p' .trellis/spec/frontend/product-ui-style.md
```

3. Inspect existing tests before adding new files:

```bash
rtk rg -n "data-inkframe|message-actions|chat-workspace|task-workspace|pointer-capture|density" frontend/test frontend/components frontend/app/chat frontend/app/tasks
```

## Phase 1: Test First

Add failing or strengthened tests before changing components.

Suggested targets:

- strengthen `frontend/test/inkframe-object-ui.test.tsx` for shared object and
  shell contracts;
- strengthen `frontend/test/material-surface.test.tsx` for static
  pointer-capture and owner metadata;
- strengthen `frontend/test/task-board-hydration.test.tsx` for task mobile
  roles;
- add a small chat source/component test only if no existing test can render
  the relevant chat/mobile attributes cleanly.

Required red/strengthened assertions:

- chat workspace/list/composer role markers exist in the render path;
- message object exposes density metadata and message actions default hidden;
- long message contract differs from short message tilt/readability contract;
- task workspace/controls/board role markers exist;
- task detail/evidence/review role markers exist in fixtures that render them;
- static material surfaces do not capture pointer by default;
- app background uses app-background owner, global-desk id, desk tint, and
  pointer capture false.

Run the focused tests and confirm the new assertions fail or meaningfully
strengthen existing coverage before implementation.

## Phase 2: Minimal Implementation

Make the smallest source changes needed to satisfy the tests:

- add missing `data-inkframe-*` attributes where the product surface already
  owns the object;
- adjust existing tests if the component already exposes equivalent attributes;
- avoid broad CSS redesign;
- do not introduce new visual directions;
- do not make every item tilt or hover-animate.

## Phase 3: Source Evidence

Create:

```text
.trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening/evidence/source-contract-validation.md
```

Include:

- exact focused test commands and results;
- exact full or relevant suite commands and results;
- list of contracts proven by source/component tests;
- explicit statement that real browser/mobile proof remains pending until
  `./twd` has a connected tab.

## Phase 4: Browser Gate Recheck

Run:

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

If status is still `blocked_no_tab`, reference the generated evidence and do
not claim browser/mobile acceptance.

## Phase 5: Validation

Run the focused tests changed by this task.

Minimum expected validation:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test \
  test/inkframe-object-ui.test.tsx \
  test/material-surface.test.tsx \
  test/task-board-hydration.test.tsx \
  test/markdown-message.test.tsx
```

Then run:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening
```

Broader frontend lint/typecheck should run if the implementation touches shared
components beyond data attributes/tests.

## Phase 6: Review

Attempt a check worker:

```bash
rtk trellis channel create cr-07-06-mobile-source-contract-hardening \
  --task .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening \
  --by main

rtk trellis channel spawn cr-07-06-mobile-source-contract-hardening \
  --agent check \
  --as check \
  --file .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening/prd.md \
  --file .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening/design.md \
  --file .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening/implement.md \
  --jsonl .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening/check.jsonl \
  --cwd "$PWD" \
  --timeout 20m
```

Review prompt must start with:

```text
Active task: .trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening
```

If the check worker cannot start because of provider/auth failure, record that
under `evidence/review-status.md` and perform a main-session self-review.

## Definition Of Done

- New/strengthened tests prove the requested source/mobile contracts.
- Focused tests pass.
- `git diff --check` passes.
- `twd-inkframe-proof` is rerun and its browser gate result is recorded
  truthfully.
- Review attempted and either completed or provider failure recorded.
