# Initial release integration bootstrap CLI implementation plan

## Checklist

1. [x] Add failing tests for `services.integration_bootstrap`:
   - creates Feishu/Jira connectors and Feishu route from existing references;
   - repeated input updates/reuses existing rows;
   - missing references fail with clear reason codes;
   - secret-shaped config is not persisted or emitted.
2. [x] Add a failing test for `external_feishu` assignment mode consistency in ORM and startup DDL.
3. [x] Implement `backend/services/integration_bootstrap.py` with dataclasses and async helpers.
4. [x] Implement `backend/integration_bootstrap_cli.py` using `argparse` and `models.async_session`.
5. [x] Update `backend/models/slock.py` and `backend/models/seed.py` so `external_feishu` is accepted.
6. [x] Add `docs/initial-release-integration-bootstrap.md` runbook.
7. [x] Run targeted tests:
   - `PYTHONPATH=. uv run pytest tests/test_integration_bootstrap.py`
   - `PYTHONPATH=. uv run pytest tests/test_task_runs.py tests/test_integration_gateway.py tests/test_feishu_adapter.py tests/test_feishu_worker_runtime.py tests/test_release_loop.py`
8. [x] Run full backend tests if targeted tests pass.
9. [x] Run Trellis validate for this child task.

## Validation Notes

- Tests must use fakes/monkeypatches and must not call real Feishu/Jira APIs.
- The CLI should be importable without opening a network connection.
- Output should be JSON or stable line-oriented text; JSON is preferred for deployment scripts.

## Risk Points

- Existing DB constraints are startup-DDL based, not Alembic migrations; update ORM and `models/seed.py` together.
- Connector/route idempotency is service-enforced because there is no unique DB constraint for `(server_id, provider, name)`.
- Do not let convenience CLI flags accept secret values, because shell history and docs would then become a credential leak path.
