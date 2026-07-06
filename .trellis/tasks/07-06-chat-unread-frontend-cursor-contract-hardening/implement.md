# Implementation Plan: Chat Unread Frontend Cursor Contract Hardening

## Phase 0: Preflight

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
rtk sed -n '1,220p' .trellis/spec/frontend/quality-guidelines.md
rtk sed -n '1,260p' .trellis/spec/frontend/product-ui-style.md
rtk sed -n '1,220p' .trellis/spec/guides/index.md
```

## Phase 1: Baseline Audit

Read:

```bash
rtk sed -n '1,280p' frontend/lib/chat-unread-state.ts
rtk sed -n '1,220p' frontend/hooks/use-chat-unread-store.ts
rtk sed -n '1,260p' frontend/test/chat-unread-state.test.ts
rtk sed -n '1,180p' frontend/app/chat/layout.tsx
rtk sed -n '1,220p' 'frontend/app/chat/[channel]/chat-sidebar.tsx'
rtk rg -n "read-cursors|chatReadCursorRequest|hasUnreadThreadActivity|markChatUnreadScope" 'frontend/app/chat/[channel]/channel-client.tsx'
```

## Phase 2: Test First

Add targeted tests before changing production code, if gaps are found:

- cursor key/request shape edge cases;
- backend projection priority over cursor fallback;
- negative/missing seq clamping;
- duplicate realtime sequence suppression;
- real route source still writes `/api/v1/chat/read-cursors`.

Run:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
```

If new tests pass immediately, record this as coverage migration and do not make
production changes.

## Phase 3: Minimal Implementation

Only change production code if a new test reveals a real mismatch.

Likely files:

- `frontend/lib/chat-unread-state.ts`
- `frontend/hooks/use-chat-unread-store.ts`
- `frontend/app/chat/[channel]/chat-sidebar.tsx`
- `frontend/app/chat/[channel]/channel-client.tsx`

Do not change visual design unless the test proves a contract issue.

## Phase 4: Validation

At minimum:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
```

If production TypeScript changes happen, also run:

```bash
rtk env NODE_PATH=./node_modules npx tsc --noEmit
```

Repo:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Backend cursor tests remain the cross-check:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
```

## Phase 5: Evidence

Write:

```text
.trellis/tasks/07-06-chat-unread-frontend-cursor-contract-hardening/evidence/contract-validation.md
```

Include:

- commands;
- results;
- whether production code changed;
- what remains browser-only and pending.

## Phase 6: Review

Spawn a check worker:

```bash
rtk trellis channel create cr-07-06-chat-unread-frontend-cursor-contract-hardening \
  --task .trellis/tasks/07-06-chat-unread-frontend-cursor-contract-hardening \
  --by codex-main \
  --cwd /Users/code/project/smallkhoj-inkframe-object-ui

rtk trellis channel spawn cr-07-06-chat-unread-frontend-cursor-contract-hardening \
  --agent check \
  --provider codex \
  --as check-unread-contract \
  --file .trellis/tasks/07-06-chat-unread-frontend-cursor-contract-hardening/prd.md \
  --file .trellis/tasks/07-06-chat-unread-frontend-cursor-contract-hardening/design.md \
  --file .trellis/tasks/07-06-chat-unread-frontend-cursor-contract-hardening/implement.md \
  --file frontend/lib/chat-unread-state.ts \
  --file frontend/test/chat-unread-state.test.ts \
  --file 'frontend/app/chat/[channel]/chat-sidebar.tsx' \
  --file 'frontend/app/chat/[channel]/channel-client.tsx' \
  --cwd /Users/code/project/smallkhoj-inkframe-object-ui \
  --timeout 20m
```

Ask reviewer to check helper contract, source anchors, and evidence honesty.

## Definition Of Done

- Contract tests pass.
- Any production code changes are minimal and test-backed.
- Backend cursor tests still pass.
- Evidence file exists.
- Check agent review complete or provider failure/self-review recorded.
- Browser proof remains explicitly pending until `./twd` connects.
