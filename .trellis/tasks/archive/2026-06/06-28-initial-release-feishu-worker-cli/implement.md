# Initial release Feishu worker CLI implementation plan

## Checklist

1. [x] Add failing tests for worker CLI success/failure/shutdown behavior.
2. [x] Add failing parser test that secret flags are rejected.
3. [x] Implement `backend/feishu_worker_cli.py`.
4. [x] Extend `docs/initial-release-integration-bootstrap.md` with worker launch.
5. [x] Run targeted tests:
   - `PYTHONPATH=. uv run pytest tests/test_feishu_worker_cli.py tests/test_feishu_channel_transport.py tests/test_feishu_worker_runtime.py`
6. [x] Run full backend tests.
7. [x] Run compile check for changed Python modules.
8. [x] Validate and archive the Trellis task.

## Validation Notes

- No real Feishu/Jira calls in tests.
- CLI import must not create an SDK channel or DB connection.
- The worker process should be stoppable with Ctrl-C.
