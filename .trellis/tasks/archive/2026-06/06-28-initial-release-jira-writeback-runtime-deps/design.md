# Initial release Jira write-back runtime dependencies design

## Boundary

Add a small service module, tentatively `backend/services/integration_runtime.py`.

Responsibilities:

- Read Jira write-back credentials from `config.settings`.
- Create `TaskRunWritebackDependencies` for the TaskRun lifecycle route.
- Keep secrets out of connector config, event normalized payloads, task data, and mappings.

Non-responsibilities:

- Tenant-specific credential storage.
- Jira OAuth installation flow.
- Feishu production long-connection worker.

## Settings

Add to `config.Settings`:

- `jira_email: str = ""`
- `jira_api_token: str = ""`

`.env.example` documents:

```env
JIRA_EMAIL=
JIRA_API_TOKEN=
```

The Jira site URL remains non-secret connector config (`ExternalConnector.config.siteUrl`), already handled by `services.jira_rest.resolve_jira_config`.

## Dependency Construction

Use `httpx.AsyncClient(trust_env=False)` to match the backend's existing LLM client approach and avoid accidental proxy dependency.

Provide:

```python
def resolve_jira_writeback_credentials(connector, configured_settings=settings) -> dict[str, str] | None
def build_task_run_writeback_dependencies(configured_settings=settings) -> TaskRunWritebackDependencies
```

The resolver can ignore connector-specific secret refs for this child. Later secret-manager work can extend this same function.

## Router Wiring

`routers.agent_api.update_task_run_lifecycle_endpoint` calls:

```python
handle_terminal_task_run_writeback(
    db,
    task_run=run,
    dependencies=build_task_run_writeback_dependencies(),
)
```

Tests monkeypatch `build_task_run_writeback_dependencies` in `agent_api` to prove dependencies are passed without real HTTP calls.

## Operational Tradeoff

Creating a short-lived `httpx.AsyncClient` per terminal write-back is acceptable for the initial release because TaskRun terminal events are low-volume. If volume increases, this can move to FastAPI lifespan-managed shared client without changing the write-back hook contract.
