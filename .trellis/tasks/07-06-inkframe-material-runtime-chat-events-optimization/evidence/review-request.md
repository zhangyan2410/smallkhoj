Active task: .trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization

Please review the current uncommitted diff in `/Users/code/project/smallkhoj-inkframe-object-ui`, focusing on the backend-backed chat read cursor work and the material runtime integration already present in this task.

Review priorities:

0. Product refactor carry-over:
   - `07-05-inkframe-product-ui-refactor` is now part of this task's acceptance
     frame.
   - Check that the current task artifacts and product surface audit correctly
     treat chat, task, global clean desk background, mobile, and object-language
     constraints as required scope rather than future notes.

1. Backend cursor correctness:
   - `backend/models/slock.py`, `backend/models/seed.py`, `backend/services/chat_read_cursors.py`, `backend/routers/public_api.py`, `backend/tests/test_chat_read_cursors.py`
   - Check scoping by active server/member, monotonic cursor writes, channel/DM/thread scope validation, and list payload projection of `latestSeq`, `unreadCount`, and `hasUnread`.

2. Frontend cursor reconciliation:
   - `frontend/lib/chat-unread-state.ts`, `frontend/hooks/use-chat-unread-store.ts`, `frontend/app/chat/layout.tsx`, `frontend/app/chat/chat-data-context.tsx`, `frontend/app/chat/[channel]/chat-sidebar.tsx`, `frontend/app/chat/[channel]/channel-client.tsx`, `frontend/test/chat-unread-state.test.ts`
   - Check that backend cursors are the source of truth, local unread remains only an optimistic/fallback overlay, active channel/DM and opened threads write cursors, and realtime duplicate events do not inflate unread.

3. Material runtime regression risk:
   - `frontend/components/inkframe/*`, `frontend/components/message-frame.tsx`, `frontend/components/task-*.tsx`, `frontend/components/product-shell.tsx`, `frontend/app/globals.css`, related tests.
   - Check object URL lifecycle, restore token races, one-active-surface coordinator rules, fallback behavior, and whether chat/task/background stay static by default instead of creating unbounded WebGL canvases.

Validation already run by main session:

- Frontend: `rtk npm run lint -- --max-warnings=0` passed.
- Frontend: `rtk env NODE_PATH=./node_modules npx tsc --noEmit` passed.
- Frontend: `rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx` passed with 119 tests.
- Backend: `rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py -q` passed with 9 tests.
- Backend: `rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py` passed.
- Repo hygiene: `rtk git diff --check` passed.

Known evidence gaps:

- `./twd --compact tabs` returns `{"ok": true, "tabs": [], "count": 0}` even after `./twd serve`, so main session does not yet have real `./twd` browser evidence.
- Direct unauthenticated API curl returns `Login required for Server access`; use authenticated/browser flow if you can attach a tab.

Please self-fix only small mechanical issues. Do not commit, push, merge, or reset.
