# Implementation Plan

1. RED: add backend HTTP route tests in
   `backend/tests/test_chat_read_cursors_http.py` for:
   - JSON list body;
   - JSON string body;
   - JSON null body;
   - `scope: []`;
   - `scope: "thread"`;
   - valid top-level thread fallback.
2. Run the focused backend HTTP test file and confirm the new malformed cases
   fail for the expected pre-fix reason.
3. GREEN: add request-body and scope parser helpers in
   `backend/routers/public_api.py`, then route through them before `.get`.
4. Run the focused backend cursor suites:
   - `tests/test_chat_read_cursors.py`
   - `tests/test_chat_read_cursors_http.py`
   - `tests/test_chat_read_cursors_postgres_http.py`
5. Run backend compile check for changed backend modules.
6. Run frontend unread-state compatibility test because frontend badge semantics
   depend on this API contract.
7. Validate the Trellis task and record evidence.
8. Send the completed slice to a Trellis check worker. If the worker cannot run,
   record a self-review and the exact blockage.
