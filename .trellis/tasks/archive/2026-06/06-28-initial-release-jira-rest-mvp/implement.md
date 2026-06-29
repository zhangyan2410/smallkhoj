# Jira REST MVP implementation plan

## Order

1. Load `trellis-before-dev` and current backend specs.
2. Write red tests for:
   - config validation;
   - issue lookup request path/auth headers/normalized response;
   - comment append ADF body and mapping;
   - failure codes for missing config, missing credentials, 401, 404, and generic Jira error;
   - no daemon/runtime imports.
3. Implement `backend/services/jira_rest.py`.
4. Reuse `services.integration_gateway.create_external_mapping`.
5. Run targeted tests:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_jira_rest.py tests/test_integration_gateway.py tests/test_task_runs.py
```

6. Run full backend tests:

```bash
rtk env PYTHONPATH=. uv run pytest
```

7. Run Trellis validation:

```bash
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-jira-rest-mvp
```

## Implementation Notes

- Prefer `httpx.AsyncClient`-compatible duck typing for the HTTP client.
- Keep ADF conversion simple: paragraph nodes with text content, split by newline.
- Normalize response shape; do not leak full raw Jira response by default.
- Raise local typed exceptions or return structured result objects with stable failure codes. Tests should pin the codes.
- Keep Jira REST service independent from FastAPI routers until Feishu/Jira full loop wiring is implemented.

## Definition Of Done

- Jira service can fetch issue and append comment through fake HTTP client tests.
- Successful comment append creates an external mapping.
- Failure cases have stable local codes/reasons.
- No real network or credentials are required for tests.
- Full backend tests pass.
