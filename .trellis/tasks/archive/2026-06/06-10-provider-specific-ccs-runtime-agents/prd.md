# provider specific local runtime providers

## Goal

Add provider-specific runtime launch as a local daemon extension, not as server-side command storage. The daemon should own a generic runtime provider/switch layer: today it supports Claude Code provider switching through local CC Switch / `ccs-claude`, and later it should be able to add Codex, Pi, OpenCode, and other runtimes behind the same abstraction. The daemon advertises safe provider names to the backend and resolves selected providers locally when it receives `start_runtime`. Reconnecting a daemon should restart agents whose desired lifecycle is running, while preserving the existing default Claude behavior when no provider is selected or CC Switch is unavailable.

## What I Already Know

* API keys, base URLs, provider headers, command arguments that may contain secrets, and local runtime credentials must never be stored on the server or transmitted through backend control payloads.
* Provider names are acceptable to upload as sanitized local capabilities when the daemon has detected that CC Switch and `ccs-claude` are available.
* `backend` is an old, overloaded field and should not be the primary semantic for this feature. The new flow should use an explicit provider/profile selection concept.
* This is an extension: machines without CC Switch / `ccs-claude` must continue to launch runtimes through the existing default `claude` path.
* The daemon can own the `ccs-claude` integration directly for Claude Code. When `start_runtime` includes a selected Claude Code provider, the daemon resolves it locally and launches the correct provider/model through CC Switch.
* The runtime switch layer should not be hard-coded only for `ccs-claude`; it should be shaped so future Codex/Pi/OpenCode launchers can plug in without changing the backend control contract.
* Current reconnect bug: existing workspaces are `status="stopped"`, and backend only re-arms missing workspaces that were `running` / `active` / `idle`, so reconnect heartbeat does not emit `start_runtime`.
* Desired lifecycle and observed runtime status are currently conflated. A later product task should add explicit user controls such as stop/reset and split desired vs observed state.

## Requirements

* The daemon detects local provider capability:
  * If `ccs-claude` is available and CC Switch has providers, daemon reports sanitized provider names/capabilities to the backend.
  * If unavailable, daemon reports the existing default runtime capability and keeps current behavior.
* Provider selection is safe:
  * Server may store the selected provider name/profile id for an agent or workspace.
  * Server must not store API keys, command args, raw CC Switch settings, headers, base URLs, or generated Claude settings paths.
  * Server control payloads must not include `runtimeCommandArgs` for provider-specific launch.
* Runtime launch is local:
  * `start_runtime` may include a provider/profile name selected by the user.
  * The daemon maps that provider/profile to local launch details at runtime.
  * For Claude Code providers, the daemon may use local `ccs-claude` internally.
  * The daemon runtime switch abstraction should leave room for future runtime families such as Codex, Pi, and OpenCode.
  * If a provider is missing locally, daemon should log a clear sanitized error and leave the workspace failed/stopped without leaking local config.
  * If no provider is selected, daemon keeps the current default launch path.
* Reconnect autostart is fixed without leaking runtime config:
  * Backend should understand an agent/workspace that is intended to run separately from its last observed status.
  * Until a full lifecycle-control model exists, reconnect should re-arm previously managed agent workspaces that are expected to run and are missing from daemon heartbeat/register payloads.
  * Explicit future stop/reset controls are out of scope except that the design must not block them.
* UI/API creation flow:
  * User can choose from provider names that the daemon safely reported.
  * Agent creation stores only the selected provider/profile name, not command details.
  * New code should not rely on `backend` as the long-term runtime-provider field.

## Acceptance Criteria

* [x] Daemon capability detection reports provider names only when local `ccs-claude` / CC Switch is usable.
* [x] `POST /api/v1/members/agents` can store a selected provider/profile name without storing command args or secrets.
* [x] Backend `start_runtime` control commands do not contain provider command args or secret-bearing runtime launch config.
* [x] Daemon receives `start_runtime` with a selected provider and launches through local `ccs-claude`.
* [x] Runtime provider selection uses an explicit provider/profile field rather than new `backend` inference.
* [x] Machines without CC Switch / `ccs-claude` still launch through existing default Claude behavior.
* [x] Reconnecting daemon re-arms expected-to-run workspaces and emits `start_runtime` even when last observed status was `stopped`.
* [x] Tests cover provider detection fallback, sanitized payloads, local provider launch resolution, and reconnect autostart.

## Out Of Scope

* Full user-facing runtime lifecycle controls such as stop/reset/restart UI.
* Permanent desired-state schema redesign beyond the minimal field/compatibility needed for reconnect.
* Storing raw local runtime configuration on the backend.
* Cloud-provider credential management.

## Technical Notes

* Current backend command builder: `backend/services/daemon_control.py`.
* Current agent creation endpoint: `backend/routers/public_api.py`.
* Current daemon runtime launch path: `agent/daemon/aaa-daemon/src/daemon/daemon.ts`.
* Current runtime driver appends daemon-managed Claude args after command args: `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts`.
* Current runtime integration contract: `.trellis/spec/backend/runtime-slock-integration.md`.
* Existing PRD direction was rejected because it put provider command inference and `runtimeCommandArgs` in backend/server state.
