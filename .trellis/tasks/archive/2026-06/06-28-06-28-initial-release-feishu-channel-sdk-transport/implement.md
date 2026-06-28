# Feishu Channel SDK transport implementation plan

## Step 1: Context

- Read this task's PRD/design/implement.
- Read backend database/integration specs and shared guides.
- Reuse existing worker runtime helpers instead of duplicating config or connector resolution.

## Step 2: RED Tests

Add `backend/tests/test_feishu_channel_transport.py` covering:

- `sdk_message_to_raw_event` converts fake Channel messages into a raw event accepted by `normalize_feishu_message`;
- transport registers `message` handler and forwards one callback to `handle_feishu_worker_raw_event`;
- transport connect/disconnect call underlying fake channel;
- channel factory lazy imports `lark_channel.FeishuChannel`;
- worker entrypoint returns structured config failure before creating channel;
- worker entrypoint resolves connectors and starts injected channel on happy path;
- boundary test forbids daemon/TaskRun/Jira business imports.

## Step 3: Implementation

- Add `lark-channel-sdk>=1.1.0` to `backend/pyproject.toml`.
- Add `backend/services/feishu_channel_transport.py`.
- Keep imports lazy and channel factory injectable.
- Do not add FastAPI startup wiring in this task.

## Step 4: Spec Update

Update backend spec with the Channel SDK transport boundary:

- SDK transport owns SDK construction/callbacks only;
- converter emits raw event shape;
- business logic stays in worker runtime/raw event loop;
- tests must not open real Feishu connections.

## Step 5: Validation

Run:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_feishu_channel_transport.py tests/test_feishu_worker_runtime.py tests/test_feishu_event_loop.py tests/test_feishu_adapter.py
rtk env PYTHONPATH=. uv run pytest
rtk python3 ./.trellis/scripts/task.py validate 06-28-06-28-initial-release-feishu-channel-sdk-transport
```

## Definition Of Done

- Real Channel SDK adapter exists with lazy import.
- Fake-channel tests prove callback -> raw event -> worker runtime handoff.
- Full backend tests pass.
- Task is committed and archived.
