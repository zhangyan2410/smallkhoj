# Initial release Jira write-back runtime dependencies implementation plan

## Step 1: RED tests

- Add tests for settings-based Jira credential resolution.
- Add tests for dependency builder creating an HTTP client and resolver.
- Extend the lifecycle endpoint test to assert dependencies are passed to `handle_terminal_task_run_writeback`.
- Add a missing-settings test to keep structured skip behavior.

## Step 2: Implementation

- Update `backend/config.py` with Jira env settings.
- Add `backend/services/integration_runtime.py`.
- Wire `routers.agent_api` to `build_task_run_writeback_dependencies`.
- Update `backend/.env.example`.

## Step 3: Spec update

- Update `.trellis/spec/backend/database-guidelines.md` or a backend runtime section with the release bridge rule: Jira site URL in connector config, Jira credentials from settings/secret resolver.

## Step 4: Validation

Run:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_task_run_writeback.py tests/test_task_runs.py tests/test_jira_rest.py
rtk env PYTHONPATH=. uv run pytest
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-jira-writeback-runtime-deps
```
