# Implementation Plan

1. Add fake-session support for a thread last-seen message in
   `backend/tests/test_chat_read_cursors_http.py`.
2. Add failing tests for:
   - out-of-thread lastSeenMessageId;
   - malformed lastSeenMessageId;
   - valid reply lastSeenMessageId still accepted.
3. Implement route-level validation in `backend/routers/public_api.py`.
4. Run focused backend tests:
   - `backend/tests/test_chat_read_cursors.py`
   - `backend/tests/test_chat_read_cursors_http.py`
   - `backend/tests/test_chat_read_cursors_postgres_http.py`
5. Run syntax/lint gates available in this repo.
6. Record evidence and spawn a check worker.
