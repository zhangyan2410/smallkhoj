# Initial release TaskRun write-back hook implementation plan

## Step 1: RED tests

- Add `backend/tests/test_task_run_writeback.py`.
- Cover non-terminal skip, successful terminal write-back, idempotent skip, missing credentials skip, Jira failure preservation, and no daemon/runtime imports.
- Extend `backend/tests/test_task_runs.py` or router-focused tests for endpoint hook invocation.

## Step 2: Minimal service

- Add `backend/services/task_run_writeback.py`.
- Implement structured outcome dataclasses and stable reason codes.
- Implement terminal status guard.
- Implement mapping/event/task/connector discovery.
- Implement injected Jira credentials/http dependency handling.
- Call `release_loop.write_back_task_run_to_jira`.

## Step 3: Router wiring

- Import the write-back service in `routers.agent_api`.
- After local lifecycle update, call the hook.
- Swallow hook failure only through structured outcome handling; unexpected programming errors should still be visible in tests.
- Include write-back outcome in the endpoint response for future UI/debugging.

## Step 4: Spec update

- Update `.trellis/spec/backend/database-guidelines.md` with the TaskRun write-back contract if the implementation adds reusable rules.

## Step 5: Validation

Run:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_task_run_writeback.py tests/test_task_runs.py tests/test_release_loop.py tests/test_integration_gateway.py tests/test_jira_rest.py tests/test_feishu_adapter.py
rtk env PYTHONPATH=. uv run pytest
rtk python3 ./.trellis/scripts/task.py validate 06-28-06-28-initial-release-taskrun-writeback-hook
```
