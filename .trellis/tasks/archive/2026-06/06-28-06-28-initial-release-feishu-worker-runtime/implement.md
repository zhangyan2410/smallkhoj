# Feishu production worker runtime implementation plan

## Step 1: Pre-Development Context

- Read this task's `prd.md`, `design.md`, and `implement.md`.
- Load backend specs and shared thinking guides.
- Re-check reference notes from Multica Lark connector/Hub only for boundary guidance, not code copying.

## Step 2: RED Tests

Add `backend/tests/test_feishu_worker_runtime.py` covering:

- settings expose safe empty defaults for worker config and credentials;
- config resolver returns missing-config outcomes for missing ids/app credentials;
- connector loader rejects missing, wrong-provider, and disabled connectors;
- happy path delegates one raw event to `process_feishu_raw_event` with resolved dependencies and bot identity;
- owned HTTP clients are closed on success and event-loop failure;
- fake transport can emit raw events without importing Feishu SDK;
- runtime module does not import daemon/runtime execution helpers or TaskRun creation helpers.

## Step 3: Implementation

- Add or extend settings in `backend/config.py`.
- Extend `backend/services/integration_runtime.py` with Feishu worker dependency/config helpers when shared.
- Add `backend/services/feishu_worker_runtime.py`.
- Keep SDK-specific code behind injected callables; no required real Feishu network in unit tests.

## Step 4: Spec Update

Update `.trellis/spec/backend/database-guidelines.md` or a more appropriate backend spec with the Feishu worker runtime boundary:

- worker resolves configuration and dependencies;
- worker calls raw event loop;
- worker does not parse commands or execute runtime work;
- missing config/credentials are structured outcomes.

## Step 5: Validation

Run:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_feishu_worker_runtime.py tests/test_integration_runtime.py tests/test_feishu_event_loop.py
rtk env PYTHONPATH=. uv run pytest tests/test_feishu_adapter.py tests/test_release_loop.py tests/test_feishu_reply_orchestration.py
rtk env PYTHONPATH=. uv run pytest
rtk python3 ./.trellis/scripts/task.py validate 06-28-06-28-initial-release-feishu-worker-runtime
```

## Definition Of Done

- Worker runtime can be invoked with environment-backed config and fake raw events.
- Missing runtime setup fails with stable, loggable outcomes before local work starts.
- Existing raw event loop and TaskRun lifecycle contracts remain unchanged.
- Full backend tests pass.
- Task is committed and archived.
