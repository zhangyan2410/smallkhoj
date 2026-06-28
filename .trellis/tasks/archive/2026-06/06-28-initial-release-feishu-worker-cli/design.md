# Initial release Feishu worker CLI design

## Boundary

The CLI is a process wrapper. It should make the existing Channel SDK worker launchable without changing integration semantics.

It owns:

- parsing process flags such as `--json`;
- creating the DB session factory from `models.async_session`;
- calling `run_feishu_channel_worker`;
- printing startup/failure outcome JSON;
- holding the process open;
- disconnecting the transport on shutdown.

It does not own:

- Feishu SDK callback logic;
- route resolution;
- Jira REST;
- TaskRun creation or execution;
- credential storage.

## Proposed Files

- `backend/feishu_worker_cli.py`
  - `build_parser()`
  - `run_until_stopped(...)`
  - `main(...)`
- `backend/tests/test_feishu_worker_cli.py`
  - fake outcome/transport tests;
  - no real DB, Feishu SDK, or network.
- `docs/initial-release-integration-bootstrap.md`
  - extend runbook with the next worker launch command.

## Runtime Shape

```text
operator env -> python -m feishu_worker_cli -> run_feishu_channel_worker -> FeishuChannelSDKTransport.connect()
```

On success, `run_feishu_channel_worker` returns a transport object. The CLI prints:

```json
{"status": "started", "reasonCode": "FEISHU_CHANNEL_TRANSPORT_STARTED", "reason": "..."}
```

Then it waits forever until interrupted. On shutdown, it calls `transport.disconnect()` if present.

## Testability

The wait behavior should be injectable:

- production wait: `asyncio.Event().wait()`;
- tests: a coroutine that raises `KeyboardInterrupt` or returns immediately.

This keeps tests deterministic and avoids a real long-running process.

## Error Handling

- Worker startup outcome `status!="started"` -> print JSON, return exit code `2`.
- Startup exception -> print JSON with `FEISHU_WORKER_CLI_FAILED`, return exit code `1`.
- Shutdown disconnect exception -> print JSON with `FEISHU_WORKER_CLI_DISCONNECT_FAILED`, return exit code `1`.
- KeyboardInterrupt after successful start -> disconnect and return `0`.

## Secret Handling

The CLI should not accept app secret or Jira token flags. Secrets are already part of `config.Settings` through env or `.env`.
