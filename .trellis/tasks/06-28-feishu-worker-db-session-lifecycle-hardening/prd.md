# Feishu worker DB session lifecycle hardening

## Goal

Ensure the Feishu Channel SDK worker opens and closes a database session per incoming message so the long-running worker can process live Feishu events without leaking DB sessions.

This hardening is required before live Feishu long-connection testing because `feishu_worker_cli` turns the SDK transport into a long-running process.

## Requirements

- `FeishuChannelSDKTransport._on_message()` must run each incoming message inside a DB session lifecycle when `db_factory()` returns an async context manager, such as `models.async_session()`.
- Existing tests and callers that provide a direct fake DB/session object must remain supported.
- Dependencies created per message must still be closed through `handle_feishu_worker_raw_event(..., close_dependencies=True)`.
- The transport must still avoid business logic: no command parsing, route resolution, Jira calls, TaskRun creation, or daemon/runtime execution.
- The worker startup connector load path should keep using an async DB context.

## Acceptance Criteria

- [x] A unit test proves SDK message handling enters and exits an async DB context around `handle_feishu_worker_raw_event`.
- [x] Existing direct-session fake transport tests still pass.
- [x] Feishu channel transport, worker runtime, and worker CLI tests pass.
- [x] Full backend tests pass.

## Verification

- `rtk env PYTHONPATH=. uv run pytest tests/test_feishu_channel_transport.py -k "opens_and_closes_db_context"`
- `rtk env PYTHONPATH=. uv run pytest tests/test_feishu_channel_transport.py`
- `rtk env PYTHONPATH=. uv run pytest tests/test_feishu_channel_transport.py tests/test_feishu_worker_runtime.py tests/test_feishu_worker_cli.py`
- `rtk env PYTHONPATH=. uv run python -m compileall services/feishu_channel_transport.py`
- `rtk env PYTHONPATH=. uv run pytest`
- `rtk python3 ./.trellis/scripts/task.py validate 06-28-feishu-worker-db-session-lifecycle-hardening`

## Out Of Scope

- Changing DB transaction commit/rollback semantics inside event processing.
- Adding process supervision or retry policy.
- Running a real Feishu live connection.
