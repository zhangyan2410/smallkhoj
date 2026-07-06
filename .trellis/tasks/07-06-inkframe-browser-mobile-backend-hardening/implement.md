# Implementation Plan: Inkframe Browser Mobile And Backend Route Flow Hardening

## Phase 0. Preflight

1. Confirm current worktree and active task.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
rtk python3 ./.trellis/scripts/task.py current
```

2. Read previous-loop evidence.

```bash
rtk sed -n '1,260p' .trellis/tasks/07-06-inkframe-runtime-browser-proof-product-polish/evidence/browser-proof.md
rtk sed -n '1,260p' .trellis/tasks/07-06-inkframe-runtime-browser-proof-product-polish/evidence/product-surface-audit.md
rtk sed -n '1,320p' .trellis/tasks/07-06-inkframe-runtime-browser-proof-product-polish/evidence/2026-07-06-progress.md
```

3. Read relevant specs.

```bash
rtk sed -n '1,260p' .trellis/spec/frontend/component-guidelines.md
rtk sed -n '1,260p' .trellis/spec/frontend/quality-guidelines.md
rtk sed -n '1,260p' .trellis/spec/frontend/state-management.md
rtk sed -n '1,260p' .trellis/spec/backend/database-guidelines.md
rtk sed -n '1,260p' .trellis/spec/backend/event-delivery-contracts.md
```

## Phase 1. Diagnose `./twd`

1. Check tabs.

```bash
rtk ./twd --compact tabs
```

2. If no tabs, start a controlled bridge.

```bash
rtk ./twd serve
```

Keep the session open only while running a follow-up `tabs`. Stop it afterward
unless a connected tab appears.

3. Record:

- bridge host/ports;
- `tabs` output;
- whether any frontend localhost tab is visible;
- whether a connected extension/client appears.

Evidence file:

```text
evidence/browser-connectivity.md
```

## Phase 2. Browser Product Proof

If a tab is connected:

```bash
rtk ./tools/twd-guard/twd-open /chat
rtk ./tools/twd-guard/twd-open /tasks
```

Save focused DOM JSON:

```bash
rtk ./twd --compact eval --url-match 127.0.0.1:3000/chat "return {...}"
rtk ./twd --compact eval --url-match 127.0.0.1:3000/tasks "return {...}"
```

Save screenshots:

```bash
rtk ./twd screenshot --url-match 127.0.0.1:3000/chat .trellis/tasks/07-06-inkframe-browser-mobile-backend-hardening/evidence/screenshots/chat-desktop.png
rtk ./twd screenshot --url-match 127.0.0.1:3000/tasks .trellis/tasks/07-06-inkframe-browser-mobile-backend-hardening/evidence/screenshots/tasks-desktop.png
```

If no tab is connected, do not claim browser proof. Continue to backend route
flow work and leave browser acceptance pending.

## Phase 3. Mobile Proof

Use `./twd` viewport/CDP if a tab is connected. Assert:

- `document.documentElement.scrollWidth <= document.documentElement.clientWidth`;
- visible composer/task controls do not exceed viewport bounds;
- material pointer mode is `none` before explicit activation.

Evidence file:

```text
evidence/mobile-proof.json
```

## Phase 4. Backend Route-Flow Tests

1. Inspect existing public API test fixtures.

```bash
rtk rg -n "TestClient|AsyncClient|verify_public_api_key|requireCurrentAccount|server_memberships|public_api" backend/tests backend/routers backend/services
```

2. Add failing route-flow tests in `backend/tests/test_chat_read_cursors.py` or
a new focused route-flow test file.

Required behaviors:

- authenticated channel cursor POST persists and GET returns it;
- authenticated DM cursor POST persists and GET returns it;
- authenticated thread cursor POST persists and root-message projection clears;
- cursor writes are monotonic;
- cursor writes are scoped to active server/member;
- channel/DM kind mismatch rejects;
- unread count uses actual newer message rows, not global sequence difference.

3. Implement only the smallest backend fixture/route changes needed.

4. Run:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_server_account_membership.py -q
```

## Phase 5. Fix Evidence-Discovered UI Issues

Only if browser/mobile proof reveals issues:

- add missing `data-region` / `data-slot`;
- fix overflow with component-level `min-w-0`, scroll owners, or stable
  dimensions;
- fix task/chat material activation bugs;
- update tests before implementation where feasible.

## Phase 6. Full Verification

Frontend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
```

Backend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_server_account_membership.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py
```

Repo:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

## Phase 7. Review

Create a Trellis channel review after implementation:

```bash
rtk trellis channel create cr-07-06-inkframe-browser-mobile-backend-hardening \
  --task .trellis/tasks/07-06-inkframe-browser-mobile-backend-hardening \
  --by codex-main \
  --cwd /Users/code/project/smallkhoj-inkframe-object-ui
```

Review focus:

- browser evidence truthfulness;
- mobile DOM measurements;
- backend authenticated route-flow coverage;
- no new visual direction;
- no fake material persistence.

