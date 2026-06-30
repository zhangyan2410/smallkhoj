# Design

## Decision

Move runtime provider discovery toward daemon-local product behavior:

- detect local executable commands directly;
- read CC Switch provider metadata from the local DB;
- remove implicit `cc-switch.ps1` and hardcoded personal launcher paths;
- keep manual command providers as explicit opt-in only.

The daemon should treat provider selection as local machine capability, not as backend-provided launch data and not as a shell script side effect.

## Current Problem Shape

The existing implementation mixes three concerns:

1. `detectCcsClaudeProviders` shells out to `ccs-claude list` or `cc-switch.ps1 list`.
2. `resolveRuntimeProviderLaunch` launches selected Claude providers by prepending provider name/model to a wrapper command.
3. `ClaudeRuntimeDriver` appends daemon-required Claude Code arguments to whatever command is selected.

That makes `cc-switch.ps1` receive arguments like `--output-format stream-json`, which is not a product contract. It also leaves the default Claude path as raw `claude`.

## Architecture

### Local Command Detection

Create a shared local command detection helper for daemon runtime commands:

- Inputs:
  - explicit env var candidates;
  - executable names such as `claude`, `claude.cmd`, `codex`, `codex.cmd`;
  - common platform-specific paths derived from env vars through `path.join`;
  - a spawn probe argument such as `--version`.
- Outputs:
  - local command path/string if the probe succeeds;
  - no secret data and no backend serialization.

This helper must avoid personal absolute paths and avoid shelling out to provider switching scripts.

### Runtime Inventory

`RuntimeProviderInventory` should include local commands:

- `claudeCommand?: string`
- `codexCommand?: string`
- future `codexAcpCommand?: string` if needed
- `providers: LocalRuntimeProvider[]`

`detectedRuntimesForInventory(...)` may report a sanitized default Claude/Codex capability, but not the executable path.

### CC Switch DB Providers

Replace the Codex-only DB loader with a generic CC Switch provider loader:

```text
loadCcSwitchProviders(env, homeDir)
```

It reads the DB path from:

1. `SLOCK_CC_SWITCH_DB`
2. `CC_SWITCH_DB`
3. platform home path `.cc-switch/cc-switch.db`

It queries local provider rows for `app_type in ('claude', 'codex')`, then maps:

- `app_type='claude'` -> `runtime: 'claude_code'`
- `app_type='codex'` -> `runtime: 'codex'`

Only sanitized fields survive:

- `id`
- `name`
- `runtime`
- `model`
- `source: 'cc-switch'`

No `settings_config`, auth JSON, token, DB path, command, or command args should leave the daemon.

### Provider Launch

Manual providers:

- unchanged as explicit advanced opt-in;
- command/args are local only.

CC Switch Claude providers:

- launch using `inventory.claudeCommand`;
- pass selected provider model to the existing Claude runtime model field;
- do not call `ccs-claude` or `cc-switch.ps1`.

CC Switch Codex providers:

- launch as public Codex runtime with selected model and local Codex/Codex ACP command when available;
- do not claim global provider isolation through CC Switch scripts.

If a later implementation needs exact provider credentials from CC Switch DB, it should add a local config writer that creates an isolated per-runtime config from DB data. That must remain daemon-local and must not mutate global user state.

## Compatibility

- Existing manual provider JSON still works for teams that intentionally want wrappers.
- Existing backend `runtimeProvider` storage remains a provider id/name only.
- Existing heartbeat must remain sanitized.
- Removing implicit `cc-switch.ps1` can reduce automatic provider detection on Windows until DB parsing covers that user's CC Switch installation. This is intentional: product behavior should fail clearly rather than launch an incompatible script.

## Rollback

The change is local to daemon provider detection/launch. Rollback is a revert of daemon runtime-provider files and tests. No database migration or backend schema change is required.
