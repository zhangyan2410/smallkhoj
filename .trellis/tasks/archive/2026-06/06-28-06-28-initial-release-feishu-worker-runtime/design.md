# Feishu production worker runtime design

## Boundary

Add a backend runtime layer for the first-release Feishu worker. This layer owns dependency resolution and transport-facing event handling. It delegates business logic to the existing raw event loop.

Target flow:

```text
Feishu SDK / injected transport
-> Feishu worker runtime
-> configured connector + credential resolution
-> services.feishu_event_loop.process_feishu_raw_event
-> structured outcome for logs/health
```

## New / Updated Modules

- `backend/services/feishu_worker_runtime.py`
  - Runtime config validation.
  - Connector lookup.
  - Single raw-event handling with resolved dependencies.
  - Optional fake-transport runner for tests and future SDK integration.
- `backend/services/integration_runtime.py`
  - Extend settings/dependency helpers for Feishu worker runtime if shared dependencies fit there.
- `backend/config.py`
  - Add safe empty defaults for release-worker settings.

## Runtime Settings

Safe empty defaults:

- `feishu_worker_enabled: bool = False`
- `feishu_worker_connector_id: str = ""`
- `feishu_worker_jira_connector_id: str = ""`
- `feishu_worker_creator_id: str = ""`
- `feishu_worker_bot_open_id: str = ""`
- `feishu_worker_bot_name: str = "SmallKhoj"`
- `feishu_worker_app_id: str = ""`
- `feishu_worker_app_secret: str = ""`

Only non-secret example placeholders may be committed. Real app secret, access token, and Jira token values stay in deployment environment or a future secret manager.

## Contracts

### Config Resolution

`resolve_feishu_worker_config(configured_settings=settings)` returns either:

- a valid config dataclass with parsed UUIDs and stripped strings; or
- a structured error/outcome with stable reason code.

Missing connector ids, creator id, app id, or app secret should fail before network clients are created.

### Connector Resolution

`load_feishu_worker_connectors(db, config)`:

- loads `ExternalConnector` rows by `config.feishu_connector_id` and `config.jira_connector_id`;
- requires Feishu connector provider `feishu`;
- requires Jira connector provider `jira`;
- rejects connectors whose status is not `active`;
- returns typed success/failure rather than raising for normal config mistakes.

### Event Handling

`handle_feishu_worker_raw_event(db, raw_event, config, connectors, dependencies)`:

- passes one raw event to `process_feishu_raw_event`;
- supplies resolved server id, connector ids, Jira connector, creator id, HTTP clients, credentials, reply config, and bot identity;
- returns the raw event loop outcome wrapped in worker metadata.

The function must not inspect or parse Feishu message text itself.

### Owned Dependency Lifecycle

`build_feishu_worker_dependencies(...)` creates:

- Jira HTTP client;
- Feishu reply HTTP client;
- Jira credential resolver;
- Feishu reply config.

`close_feishu_worker_dependencies(...)` closes both clients. The worker handler must close owned clients in `finally` paths.

### Transport Boundary

The production SDK runner should be a thin adapter:

```text
SDK raw payload callback -> handle_feishu_worker_raw_event
```

Tests use fake event streams instead of SDK imports. This keeps SDK churn isolated and avoids real network calls.

## Failure Codes

Suggested stable reason codes:

- `FEISHU_WORKER_CONFIG_MISSING_CONNECTOR_ID`
- `FEISHU_WORKER_CONFIG_MISSING_JIRA_CONNECTOR_ID`
- `FEISHU_WORKER_CONFIG_MISSING_CREATOR_ID`
- `FEISHU_WORKER_CONFIG_MISSING_APP_CREDENTIALS`
- `FEISHU_WORKER_CONNECTOR_NOT_FOUND`
- `FEISHU_WORKER_CONNECTOR_PROVIDER_MISMATCH`
- `FEISHU_WORKER_CONNECTOR_DISABLED`
- `FEISHU_WORKER_JIRA_CREDENTIALS_MISSING`
- `FEISHU_WORKER_EVENT_LOOP_FAILED`
- `FEISHU_WORKER_EVENT_PROCESSED`

## Reference Project Decision

Multica's Lark integration has a richer Hub/lease/connector architecture. SmallKhoj should not copy the multi-replica lease subsystem for this single-instance 7-15 release, but should reuse the separation:

- connector/transport emits raw or normalized events;
- dispatcher/service owns durable business decisions;
- outbound replies are best effort and detached from transport health;
- production lifecycle must have visible failure outcomes and bounded cleanup.

## Rollout

This task should make worker invocation possible from a future CLI/process hook. It does not need to start automatically inside FastAPI yet. Starting it automatically is a deployment decision that depends on server topology and process manager choice.

## Rollback

The changes are additive. Disable worker launch by leaving `FEISHU_WORKER_ENABLED=false` and no connector ids configured. Existing backend APIs and TaskRun lifecycle hooks continue to work.
