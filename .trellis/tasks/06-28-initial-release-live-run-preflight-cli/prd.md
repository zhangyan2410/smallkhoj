# Initial release live-run preflight CLI

## Goal

Add a no-network preflight command that validates Feishu/Jira bootstrap records, worker env, route matching, and launch readiness before live Feishu/Jira credentials are used.

The command should make the next live-run step deterministic: before starting `feishu_worker_cli`, the operator can see whether env, connectors, non-secret config, and route matching are ready.

## Requirements

- Provide a backend CLI runnable as `python -m live_run_preflight_cli` from `backend/`.
- The preflight must not call Feishu, Jira, Tencent Cloud, daemon, or external networks.
- The preflight must validate:
  - `FEISHU_WORKER_*` settings resolve through `services.feishu_worker_runtime.resolve_feishu_worker_config`;
  - configured Feishu/Jira connector rows exist, have correct provider values, and are active;
  - Feishu connector config has app ID, bot open ID, and bot name;
  - Jira connector config has a valid `siteUrl`;
  - runtime Jira credentials are present enough for write-back dependency wiring;
  - a Feishu `jira_analysis` route matches the supplied `chatId`, `chatType`, and `command`;
  - the matched route has a channel and default assignee.
- The CLI should accept `--feishu-chat-id`, `--feishu-chat-type`, and `--command` to validate the exact source selector that will be used by the first live command.
- The output must be structured JSON with per-check statuses and a top-level `ready` boolean.
- Missing config should produce human-readable reasons and machine-readable reason codes.
- The command must not accept real secret values as CLI flags. Secrets stay in env/.env or future secret manager.

## Acceptance Criteria

- [x] Unit tests prove a ready preflight checks config, connectors, route, and credentials without network calls.
- [x] Unit tests prove missing worker config returns `ready=false` with the worker config reason code.
- [x] Unit tests prove missing/disabled/mismatched route returns `ready=false`.
- [x] Unit tests prove route without channel/assignee returns `ready=false`.
- [x] CLI help loads without DB/network access and the parser rejects secret-shaped flags.
- [x] Runbook documents `bootstrap -> preflight -> worker launch`.
- [x] Targeted preflight/worker/gateway tests and full backend tests pass.

## Verification

- `rtk env PYTHONPATH=. uv run pytest tests/test_live_run_preflight.py`
- `rtk env PYTHONPATH=. uv run python -m live_run_preflight_cli --help`
- `rtk env PYTHONPATH=. uv run pytest tests/test_live_run_preflight.py tests/test_feishu_worker_runtime.py tests/test_integration_gateway.py`
- `rtk env PYTHONPATH=. uv run python -m compileall live_run_preflight_cli.py services/live_run_preflight.py`
- `rtk env PYTHONPATH=. uv run pytest`
- `rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-live-run-preflight-cli`

## Out Of Scope

- Real Feishu SDK connection.
- Real Jira issue lookup/comment write-back.
- Creating or mutating connector/route rows.
- Deployment server/domain checks.
