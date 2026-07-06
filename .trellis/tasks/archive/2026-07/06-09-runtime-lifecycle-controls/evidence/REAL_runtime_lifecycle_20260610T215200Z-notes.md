# REAL_runtime_lifecycle_20260610T215200Z

## Scope

Verified workspace-level runtime lifecycle controls without stopping the supervisor's active `@aaa` runtime.

## Evidence

* Screenshot: `REAL_runtime_lifecycle_20260610T215200Z-01-controls-visible.png`
* Public API before/after:
  * `@aaa` remained `running` with PID `24383`.
  * `@deepseek` moved to `stopped` with no PID after a stop action.
* Lifecycle API:
  * `POST /api/v1/workspaces/a0a10000-0000-0000-0000-000000000002/lifecycle`
  * Body: `{"action":"stop"}`
  * Response included `ok:true`, `action:"stop"`, `delivered:1`, and workspace `status:"stopped"`.
* Daemon log:
  * `WS event: control`
  * `Handling control command stop_runtime for agent d7942034-805b-4ee4-956d-4fe9483fdcd8`

## Quality Gates

* `python3 -m py_compile backend/services/daemon_control.py backend/routers/public_api.py backend/tests/test_daemon_control.py`
* `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_daemon_control.py -q`
* `cd frontend && npm run lint`
* `cd frontend && npm run build`

## Notes

Stop is intentionally idempotent: if the daemon has no active runtime for the target agent, the backend still moves the workspace to `stopped` and records the desired status as `stopped`. Start and restart move the workspace to `pending_start`, which lets later daemon heartbeat/register control paths recover if the WebSocket delivery is interrupted.
