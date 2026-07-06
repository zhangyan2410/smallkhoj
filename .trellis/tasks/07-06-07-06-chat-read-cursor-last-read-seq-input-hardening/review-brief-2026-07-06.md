Active task: .trellis/tasks/07-06-07-06-chat-read-cursor-last-read-seq-input-hardening

Please review the completed backend read-cursor `lastReadSeq` input hardening
slice.

Scope to review:

- Task docs:
  - `prd.md`
  - `design.md`
  - `implement.md`
  - `evidence/source-contract-validation.md`
- Curated specs:
  - `check.jsonl`
- Changed backend/test files:
  - `backend/routers/public_api.py`
  - `backend/services/chat_read_cursors.py`
  - `backend/tests/test_chat_read_cursors.py`
  - `backend/tests/test_chat_read_cursors_http.py`
  - `backend/tests/test_chat_read_cursors_postgres_http.py`
- Frontend compatibility:
  - `frontend/test/chat-unread-state.test.ts`

Review questions:

1. Does `_parse_read_cursor_last_read_seq` preserve compatibility while
   rejecting malformed/negative/boolean/object/array/null values with stable
   HTTP 400 `Invalid lastReadSeq`?
2. Does `lastReadSeq` correctly win over `last_read_seq` when both are present?
3. Do channel, DM, and thread cursor writes all use the validated value?
4. Do invalid writes avoid commits and cursor mutation?
5. Is monotonic valid cursor behavior preserved?
6. Any P1/P2 blocker before marking this child task completed?

Validation already rerun by main session:

- backend cursor suite: `57 passed`
- backend py_compile: pass
- frontend unread compatibility: `13 passed`
- `task.py validate`: pass
- `git diff --check`: pass

Please do not commit, push, pull, reset, or broaden the task scope.
