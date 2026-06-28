# Initial release live-run preflight CLI implementation plan

## Checklist

1. [x] Add failing service tests for ready, missing config, route failure, route missing local target, and secret flag rejection.
2. [x] Implement `services.live_run_preflight` using existing worker/gateway helpers.
3. [x] Implement `live_run_preflight_cli.py`.
4. [x] Add runbook and backend spec entries.
5. [x] Run targeted tests:
   - `PYTHONPATH=. uv run pytest tests/test_live_run_preflight.py tests/test_feishu_worker_runtime.py tests/test_integration_gateway.py`
6. [x] Run CLI `--help`.
7. [x] Run full backend tests.
8. [x] Validate and archive the Trellis task.
