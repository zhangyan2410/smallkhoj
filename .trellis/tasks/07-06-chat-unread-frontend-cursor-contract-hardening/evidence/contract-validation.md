# Contract Validation

## Scope

Task: `07-06-chat-unread-frontend-cursor-contract-hardening`

This task hardens the frontend side of the earlier unread/event PRD:

```text
.trellis/tasks/07-02-chat-event-unread-indicators
```

It is source/static/unit evidence only. Browser/mobile proof remains pending
until a connected `./twd` tab is available.

## Findings

The existing implementation already satisfies the current source contract:

- `frontend/app/chat/layout.tsx` fetches `/api/v1/chat/read-cursors` and merges
  cursor data into channel/DM entities.
- `frontend/lib/chat-unread-state.ts` defines stable backend cursor keys:
  `channel:id:<channelId>`, `dm:id:<channelId>`, and
  `thread:id:<rootMessageId>`.
- `mergeChatReadCursorsIntoEntities(...)` preserves backend-projected unread
  counts before falling back to cursor-derived counts.
- `chatReadCursorRequestForEntity(...)` builds channel/DM backend cursor writes.
- `chatReadCursorRequestForThread(...)` builds thread backend cursor writes from
  the highest visible message sequence and includes `lastSeenMessageId`.
- `frontend/app/chat/[channel]/chat-sidebar.tsx` clears local overlay and posts
  `/api/v1/chat/read-cursors` for the active channel/DM.
- `frontend/app/chat/[channel]/channel-client.tsx` posts thread read cursors and
  clears local thread markers after successful write.
- Realtime out-of-scope `message.created` events use `markChatUnreadScope(...)`,
  while duplicate/replayed seq values are suppressed by helper tests.

No production code changes were required in this pass. The work here is a
coverage/evidence migration: prove the previous unread/event Trellis task is
now backed by real cursor contracts instead of decorative-only badges.

## Validation

Frontend unread contract tests:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
```

Result:

```text
13 passed
```

Frontend typecheck:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false
```

Result:

```text
pass
```

Backend cursor contract cross-check:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
```

Result:

```text
28 passed
```

Repository whitespace:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result:

```text
pass
```

Task context validation:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-chat-unread-frontend-cursor-contract-hardening
```

Result:

```text
All validations passed
```

## Browser Proof

Not claimed.

This task deliberately does not claim visible browser/mobile acceptance. The
browser proof task remains:

```text
.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof
```

## Self-Review

Checklist:

- [x] Cursor keys align with backend scopes.
- [x] Backend projection has priority over cursor fallback/local overlay.
- [x] Channel/DM active clear writes backend cursor.
- [x] Thread open writes backend cursor.
- [x] Thread markers can derive from backend projection or local overlay.
- [x] Duplicate realtime events do not inflate counts.
- [x] Evidence does not claim browser acceptance.

No issues found in this source-contract pass.
