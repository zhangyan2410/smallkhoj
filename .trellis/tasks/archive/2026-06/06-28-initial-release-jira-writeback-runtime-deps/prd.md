# Initial release Jira write-back runtime dependencies

## Goal

Wire TaskRun terminal Jira write-back to production runtime dependencies: backend settings, env-based Jira credentials, and an HTTP client, while keeping secrets out of connector config and database payloads.

## Background

The previous child task added `services.task_run_writeback` and connected the agent TaskRun lifecycle endpoint to the hook. The hook is intentionally dependency-injected, but the endpoint currently calls it without a Jira HTTP client or credentials resolver. In a real backend run, terminal TaskRuns therefore produce a structured skip instead of appending the Jira comment.

This child turns the tested hook into a configurable production path without introducing a full secret manager.

## Requirements

- **R1: Runtime dependency builder.** Backend code can build `TaskRunWritebackDependencies` from runtime settings.
- **R2: Env-based Jira credentials.** Jira email/API token are read from environment-backed settings, not from connector config or persisted event/mapping payloads.
- **R3: Safe default.** Missing Jira settings must keep returning the existing structured missing-credentials outcome instead of crashing lifecycle updates.
- **R4: HTTP client boundary.** Use an async HTTP client compatible with the existing `services.jira_rest` helpers and avoid proxy surprises by following the backend's current `httpx.AsyncClient(trust_env=False)` pattern.
- **R5: Router wiring.** `update_task_run_lifecycle_endpoint` must pass the production dependencies into `handle_terminal_task_run_writeback`.
- **R6: Testability.** Tests must be able to monkeypatch dependency construction and settings without making real Jira network calls.
- **R7: Deployment visibility.** `.env.example` documents the required Jira variables for the 7-15 release path.

## Acceptance Criteria

- [ ] `config.Settings` exposes non-empty-by-default-safe Jira email/API token fields.
- [ ] A service function resolves Jira credentials from settings and returns `None` when incomplete.
- [ ] A service function builds `TaskRunWritebackDependencies` with an async HTTP client and credentials resolver.
- [ ] The TaskRun lifecycle endpoint passes those dependencies to the write-back hook.
- [ ] Existing endpoint tests prove terminal write-back receives dependencies.
- [ ] Missing Jira env remains a structured skip, not a request failure.
- [ ] `.env.example` documents the Jira settings without real secrets.
- [ ] Full backend tests pass.

## Notes

- This task is not the final multi-tenant secret manager. It is a release bridge for the first single-instance deployment.
