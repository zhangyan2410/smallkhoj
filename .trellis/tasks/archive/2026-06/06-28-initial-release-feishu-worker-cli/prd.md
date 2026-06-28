# Initial release Feishu worker CLI

## Goal

Add a repeatable backend CLI entrypoint for launching the Feishu Channel SDK worker from runtime env and database configuration after integration bootstrap.

The release operator should be able to set the env vars printed by `integration_bootstrap_cli`, run one command from `backend/`, and get a long-running Feishu worker process with structured startup/failure output.

## Requirements

- Provide a backend CLI entrypoint runnable as `python -m feishu_worker_cli` from `backend/`.
- The CLI must use existing runtime settings, `models.async_session`, and `services.feishu_channel_transport.run_feishu_channel_worker`.
- The CLI must not parse Feishu messages, resolve routes, call Jira, create TaskRuns, or send replies directly.
- On startup success, the CLI must print a structured JSON line containing `status`, `reasonCode`, and `reason`.
- On startup failure, the CLI must print a structured JSON line and exit non-zero.
- After successful startup, the CLI must keep the process alive until interrupted, then call `transport.disconnect()` when available.
- The CLI should support an injected wait primitive in tests so unit tests do not block forever.
- The CLI must not accept secret flags; secrets continue to come from `.env`, environment variables, or future secret manager wiring.
- Documentation must show the command that follows bootstrap and the expected relationship to `FEISHU_WORKER_*`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`.

## Acceptance Criteria

- [x] Unit tests prove startup success prints JSON and waits.
- [x] Unit tests prove startup failure prints JSON and returns non-zero.
- [x] Unit tests prove interrupt/shutdown calls `transport.disconnect()`.
- [x] Unit tests prove the CLI does not expose secret flags.
- [x] The CLI delegates to `run_feishu_channel_worker` and existing DB/session settings instead of duplicating worker runtime logic.
- [x] The runbook documents bootstrap -> env -> worker launch.
- [x] Targeted Feishu channel transport/worker CLI tests pass.

## Verification

- `rtk env PYTHONPATH=. uv run pytest tests/test_feishu_worker_cli.py`
- `rtk env PYTHONPATH=. uv run python -m feishu_worker_cli --help`
- `rtk env PYTHONPATH=. uv run pytest tests/test_feishu_worker_cli.py tests/test_feishu_channel_transport.py tests/test_feishu_worker_runtime.py`
- `rtk env PYTHONPATH=. uv run python -m compileall feishu_worker_cli.py services models`
- `rtk env PYTHONPATH=. uv run pytest`
- `rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-feishu-worker-cli`

## Out Of Scope

- Running a real Feishu SDK live connection in tests.
- Process supervision through systemd, Docker Compose, or FastAPI lifespan.
- Worker health endpoint.
- Deployment reverse proxy or Tencent Cloud automation.
