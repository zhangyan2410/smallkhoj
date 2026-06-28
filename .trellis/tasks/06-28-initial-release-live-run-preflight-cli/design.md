# Initial release live-run preflight CLI design

## Boundary

The preflight is read-only readiness inspection. It must reuse the same code paths the live worker uses for config and connector validation, then add route-readiness checks for the exact first supported command.

It owns:

- settings readiness summary;
- connector existence/provider/status readiness;
- route match readiness;
- non-secret config shape checks;
- JSON report rendering.

It does not own:

- creating bootstrap rows;
- connecting to Feishu;
- calling Jira;
- starting the worker;
- daemon/runtime execution.

## Proposed Files

- `backend/services/live_run_preflight.py`
  - dataclasses for request/check/report;
  - `run_initial_release_preflight(db, request, configured_settings=settings)`;
  - serializer.
- `backend/live_run_preflight_cli.py`
  - argparse wrapper;
  - async DB session lifecycle;
  - JSON output and exit code.
- `backend/tests/test_live_run_preflight.py`
  - fake DB tests, no network.
- `docs/initial-release-integration-bootstrap.md`
  - add preflight between bootstrap and worker launch.

## Check Model

Each check should return:

```json
{
  "name": "workerConfig",
  "status": "passed",
  "reasonCode": "READY",
  "reason": "Worker config is ready."
}
```

Top-level report:

```json
{
  "ready": true,
  "checks": []
}
```

`ready` is true only when every check has `status="passed"`.

## Data Flow

```text
env/settings -> resolve_feishu_worker_config
  -> load_feishu_worker_connectors
  -> validate connector config
  -> resolve_external_route(source={chatId, chatType, command})
  -> validate route channel/default assignee
  -> JSON readiness report
```

## Exit Codes

- `0`: ready.
- `2`: preflight completed but not ready.
- `1`: unexpected exception.

## Secret Handling

The CLI accepts only selector fields. It must not accept app secrets, Jira API tokens, tenant access tokens, daemon tokens, or cloud credentials.
