# Feishu Jira TaskRun loop implementation plan

## Order

1. Read current backend specs and task artifacts.
2. Write red tests for:
   - rejecting non-accepted Feishu outcomes;
   - Jira lookup -> message/task/run creation;
   - mapping local task/run to Jira issue;
   - TaskRun result -> Jira comment mapping;
   - Jira lookup/write-back failure codes;
   - no daemon/runtime imports.
3. Implement `backend/services/release_loop.py`.
4. Add code-spec section if the orchestration introduces stable contracts.
5. Run:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_release_loop.py tests/test_feishu_adapter.py tests/test_jira_rest.py tests/test_integration_gateway.py tests/test_task_runs.py
```

6. Run full backend tests:

```bash
rtk env PYTHONPATH=. uv run pytest
```

7. Validate task:

```bash
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-feishu-jira-taskrun-loop
```

## Definition Of Done

- The first service-level loop can be tested without real external credentials.
- The loop creates TaskRun state but does not execute runtime work.
- Jira issue/comment mappings are persisted.
- Tests pass.
