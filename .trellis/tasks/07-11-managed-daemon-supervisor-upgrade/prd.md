# Managed Daemon Supervisor and Web-Controlled Upgrade

## Goal

Design a product-grade local Computer/daemon architecture for SmallKhoj that
does not require a visible terminal window, can be started and diagnosed as an
operating-system background service, and can receive a safe upgrade request
from the SmallKhoj web UI.

The outcome of this task is planning documentation only. It must leave enough
detail for a later implementation task to be decomposed, estimated, tested, and
rolled out without rediscovering the architecture.

## User Value

- A normal user installs SmallKhoj Computer once and does not keep a terminal
  window open.
- An owner/admin can see installed and running versions, request an upgrade,
  and understand whether it is queued, draining agents, installing, restarting,
  healthy, failed, or rolled back.
- Running agents stop gracefully before a daemon replacement instead of being
  orphaned or killed without state reporting.
- Failed upgrades recover automatically to the last known-good version.
- Operators retain foreground/debug commands and local diagnostics.

## Confirmed Existing Capabilities

- SmallKhoj already builds a versioned macOS arm64 daemon archive, SHA-256,
  manifest, npm package, and install script in
  `scripts/build_daemon_distribution.py`.
- The installer already uses version directories under
  `~/.smallkhoj/daemon/versions/` and a stable launcher under
  `~/.smallkhoj/bin/`.
- The daemon reports `daemonVersion` through connect/register/heartbeat, while
  the backend records it on `Computer.daemon_version` and enforces
  `MINIMUM_DAEMON_VERSION`.
- `Computer` and `AgentWorkspace` already model machine identity, daemon lease,
  heartbeat, runtime status, PID, and session ID.
- The backend has WebSocket and heartbeat control delivery and already sends
  `start_runtime`, `stop_runtime`, and `restart_runtime` commands.
- The daemon already handles SIGTERM and calls its normal shutdown path, which
  stops runtime watchdogs, disconnects transport, stops managed runtimes, and
  reports daemon shutdown.
- The Computers UI already provides connect/reconnect and per-workspace
  start/stop/restart actions.
- Current product upgrade is manual: install the new artifact, replace the
  launcher target, and manually restart the running daemon.

## Product Scope

### P0: Managed background service

- Introduce a SmallKhoj Computer supervisor process distinct from the current
  server-connected daemon runner.
- The supervisor runs without a terminal and owns runner lifecycle, local IPC,
  installed versions, release channel, upgrade transactions, diagnostics, and
  rollback.
- The first supported production platform is macOS arm64 using launchd.
- The CLI must retain foreground mode for development and troubleshooting.
- Linux systemd and Windows Service are explicit follow-up adapters over the
  same supervisor contract, not separate product architectures.

### P0: Web-controlled upgrade

- Server owner/admin can request an upgrade from Computer detail UI.
- The request targets one Computer and includes a unique request ID, desired
  version or release channel, current observed version, and idempotency data.
- The backend persists an upgrade operation before delivery; WebSocket is the
  low-latency path and heartbeat is the recovery/fallback path.
- The local supervisor, not the web server, downloads and installs the package.
- Upgrade supports dry-run/check, explicit target version, saved release
  channel, and rollback to the previous known-good version.

### P0: Graceful agent drain

- Upgrade places the Computer into maintenance/draining state and blocks new
  runtime starts.
- Supervisor requests the runner to stop accepting new work and gracefully stop
  all managed runtimes.
- A bounded grace period is configurable; timeout escalates to process
  termination and records which runtimes did not stop cleanly.
- Workspace desired state remains durable so runtimes configured for autostart
  can be re-armed after the upgraded runner is healthy.
- The UI warns that active turns will be interrupted before the user confirms
  upgrade.

### P0: Atomic install, restart, health, and rollback

- Artifacts must be versioned and integrity-checked before activation.
- Activation changes an atomic `current` pointer/launcher; it never mutates the
  currently running version directory in place.
- Keep at least one previous known-good version.
- A process may not rely on replacing and fully restarting itself. The old
  supervisor delegates activation/restart to an OS service manager or a small
  updater/helper outside the binary being replaced.
- After restart, health requires supervisor IPC, server runner connection,
  heartbeat/register with the target version, and a stable observation window.
- Failed health triggers automatic rollback and emits a terminal operation
  result with error code and diagnostic path.

### P0: Explicit version/state model

The product must distinguish at least:

- `desired_version`: version/channel requested by server or local CLI;
- `installed_version`: artifact selected by the local `current` pointer;
- `supervisor_version`: code currently running as the local service;
- `runner_version`: server-connected daemon runner currently running;
- `reported_daemon_version`: last version accepted by backend heartbeat;
- `previous_version`: last known-good rollback target.

UI must not collapse these into one ambiguous `daemonVersion` label.

Upgrade operation states:

`requested -> acknowledged -> downloading -> verified -> draining -> installing -> restarting -> health_checking -> succeeded`

Terminal alternatives:

`failed`, `rolled_back`, `cancelled`, `expired`.

### P0: Security and authorization

- Only server owner/admin with Computer management authority may request
  upgrade or rollback.
- Commands are scoped to server and Computer identity and cannot target another
  tenant.
- Artifact origin is allowlisted by server/release-channel configuration.
- SHA-256 verification is mandatory; signed manifests/artifacts are the target
  production security model and may be phased after checksum MVP only if the
  limitation is explicit.
- Durable machine credentials, filesystem paths containing secrets, and raw
  update tokens must never be returned to the browser or logs.
- Upgrade request IDs are idempotent; replaying the same request cannot run two
  concurrent transactions.

### P0: Observability and recovery

- Persist local operation state, bounded logs, installed-version ledger, and
  last-known-good marker under `~/.smallkhoj/computer/`.
- Backend persists operation status and timestamped transitions for UI/history.
- CLI surface includes `status`, `doctor`, `logs`, `start`, `stop`, `restart`,
  `channel`, `upgrade --dry-run`, `upgrade --target-version`, and
  `upgrade --rollback`.
- A local restart or temporary WebSocket disconnect must resume or reconcile an
  in-flight operation from persisted state.
- Stale operations expire with a machine-readable reason.

## UX Requirements

- Computer detail shows current health, supervisor/runner/installed versions,
  desired channel/version, latest available version, and last upgrade result.
- Upgrade button is disabled when Computer is offline, another operation is in
  flight, or the selected artifact is incompatible.
- Confirmation shows active runtime count, interruption warning, target
  version, and rollback availability.
- Progress survives page refresh and is driven by persisted server state, not
  optimistic browser-only state.
- Failure view exposes a safe error summary, operation ID, retry/rollback
  actions when valid, and local diagnostic command.

## Compatibility and Migration

- Existing foreground daemon and installed `smallkhoj-daemon` command remain
  available during migration.
- The managed Computer setup must adopt an existing Computer identity and
  machine credential instead of creating a duplicate Computer record.
- Existing workspace rows and agent-to-Computer assignment remain intact.
- First managed install may require one explicit local setup command and admin
  confirmation because a browser cannot install an OS service by itself.
- Backend must accept both legacy daemon heartbeat and managed supervisor/runner
  reporting during a bounded migration window.

## Out of Scope for the First Implementation

- Cloud-hosted Computers supplied by SmallKhoj.
- Silent forced upgrades without owner/admin action.
- Fleet-wide automatic rollout to every Computer in one click.
- Delta/binary patch updates; full versioned artifact download is sufficient.
- Native graphical installer or menu-bar application.
- Linux and Windows production adapters in the first macOS arm64 milestone.
- Preserving an in-progress model turn across daemon process replacement.
- Automatically upgrading model runtimes such as Claude Code or Codex.

## Acceptance Criteria for a Future Implementation

### Service lifecycle

- [ ] On a fresh macOS arm64 machine, setup installs and starts the supervisor
  through launchd; closing the terminal does not disconnect the Computer.
- [ ] `smallkhoj-computer status/doctor/logs/start/stop/restart` work without a
  repository checkout.
- [ ] Foreground mode remains available and is explicitly marked as a developer
  or diagnostic mode.

### Upgrade transaction

- [ ] Owner/admin can request a target version or saved channel from the
  Computer UI and receives a persistent operation ID.
- [ ] Repeated submission with the same idempotency key produces one operation.
- [ ] Offline delivery is reconciled on next heartbeat without creating a
  second operation.
- [ ] New runtime starts are blocked while the Computer is draining/upgrading.
- [ ] Running workspaces receive graceful stop; timeout escalation is recorded.
- [ ] The new artifact is checksum/signature verified before activation.
- [ ] Activation is atomic and preserves a previous version.
- [ ] Successful restart reports matching supervisor, runner, installed, and
  backend-observed versions before operation status becomes `succeeded`.
- [ ] Failed health automatically restores the previous version and reports
  `rolled_back` or a precise unrecoverable failure.

### UI and observability

- [ ] Computer detail separately displays desired, installed, supervisor,
  runner, and last-reported versions.
- [ ] Upgrade progress survives page reload and shows timestamped transitions.
- [ ] Failure output contains no secrets and points to a local diagnostic
  command and operation ID.
- [ ] Backend audit/event history records requester, Computer, source version,
  target version, final outcome, and rollback result.

### Regression and real validation

- [ ] Existing connect/reconnect, heartbeat lease, and per-workspace
  start/stop/restart behavior continue to work for legacy daemons.
- [ ] Real Mac validation covers terminal close, OS login/restart behavior,
  successful upgrade, forced health failure, automatic rollback, offline
  command recovery, and active-runtime drain timeout.
- [ ] Tests cover authorization, tenant isolation, operation state transitions,
  idempotency, incompatible versions, artifact verification failure, and
  rollback failure.

## Planning Decisions

- First implementation target: macOS arm64 + launchd.
- Control plane: extend existing Computer/daemon WebSocket and heartbeat path;
  do not create an unrelated update transport.
- Process model: stable local supervisor + one server-connected runner; managed
  agent runtimes remain children of the runner.
- Upgrade policy: explicit owner/admin action by default; channels prepare for
  later staged automation.
- Process continuity: active turns may be interrupted, but runtime desired
  state and workspace identity must recover.

## Open Questions

These do not block the architecture plan but must be resolved before starting
implementation:

1. Product command/name: evolve `smallkhoj-daemon` into
   `smallkhoj-computer`, or ship both names with one compatibility alias.
2. Artifact signing authority and key-rotation process for production.
3. Default agent drain timeout and whether the UI may override it.
4. Whether successfully upgraded autostart runtimes should restart immediately
   or wait for the next message/control event.
