# Feishu long-connection MVP implementation plan

## Order

1. Load backend specs and current task docs.
2. Write red tests for:
   - raw event normalization;
   - group addressing filter;
   - `分析 JIRA-123` command parsing;
   - duplicate event outcome;
   - unaddressed group drop;
   - unknown route;
   - matched route creating session/linking event;
   - no runtime/daemon imports.
3. Implement `backend/services/feishu_adapter.py`.
4. Add backend spec section for Feishu event boundary if the implementation introduces reusable contracts.
5. Run targeted tests:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_feishu_adapter.py tests/test_integration_gateway.py tests/test_jira_rest.py tests/test_task_runs.py
```

6. Run full backend tests:

```bash
rtk env PYTHONPATH=. uv run pytest
```

7. Run Trellis validation:

```bash
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-feishu-long-connection-mvp
```

## Definition Of Done

- Feishu normalized event and first command parser exist.
- The adapter uses integration gateway event/session/route primitives.
- No direct runtime execution is introduced.
- Tests pass without real Feishu credentials or network calls.
- Follow-up orchestration child can consume accepted `jira_analysis` outcomes.
