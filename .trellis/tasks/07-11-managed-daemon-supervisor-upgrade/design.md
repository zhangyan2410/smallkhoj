# Architecture Design

## 1. Problem Statement

The current SmallKhoj daemon distribution is versioned and installable, but the
running process is still fundamentally a user-started daemon. Upgrading changes
the installed launcher target and requires a manual restart. The web product can
control individual agent workspaces but cannot manage the Computer process or
observe an upgrade transaction.

The design introduces a stable local supervisor that owns the short-lived or
restartable server runner. This separates "the process responsible for
upgrading" from "the process being upgraded".

## 2. Target Process Model

```text
OS service manager
└── smallkhoj-computer supervisor
    ├── local IPC server
    ├── version/install/upgrade manager
    ├── per-server attachment registry
    └── smallkhoj runner <server-id>
        ├── WebSocket + heartbeat/register
        ├── workspace/runtime reconciliation
        └── agent runtime children
            ├── Claude Code invocation/process
            ├── Codex invocation/process
            └── other managed runtime drivers
```

### Supervisor responsibilities

- OS-service lifecycle and local singleton lock;
- stable local state and IPC endpoint;
- installed-version ledger and current/previous pointer;
- release channel and artifact resolver;
- upgrade transaction state machine;
- start/stop/restart runner;
- coordinate drain and health checking;
- rollback and diagnostics.

### Runner responsibilities

- authenticate one Computer attachment to one SmallKhoj Server;
- preserve current daemon event/control protocol;
- register/heartbeat runtime inventory and versions;
- execute workspace start/stop/restart;
- expose drain/stop/status over local IPC;
- never install or replace its own executable.

### Runtime responsibilities

Remain unchanged: provider-specific invocation, session/workspace state,
progress reporting, and Slock/Raft command bridge.

## 3. Cross-Platform Service Adapters

Define one `ServiceManager` interface:

```text
install(config) -> result
uninstall() -> result
start() / stop() / restart()
status() -> ServiceStatus
```

Adapters:

- macOS P0: per-user launchd LaunchAgent by default. A system LaunchDaemon is a
  later option if multi-user/root operation becomes required.
- Linux follow-up: systemd user unit by default, system unit where explicitly
  installed by an administrator.
- Windows follow-up: Windows Service controlled through SCM.
- Development: foreground adapter with no persistence.

The service manager owns restart after binary activation. The running
supervisor must not assume it can replace itself and continue executing the
upgrade reliably.

## 4. Local Filesystem Layout

```text
~/.smallkhoj/
├── bin/
│   ├── smallkhoj-computer        # stable CLI/launcher
│   └── smallkhoj-daemon          # compatibility alias during migration
├── computer/
│   ├── state.json                # login/service summary, no raw secret output
│   ├── service.pid
│   ├── service.sock
│   ├── service.log
│   ├── channel.json
│   ├── installed.json            # version ledger/current/previous/LKG
│   ├── upgrades/<request-id>.json
│   ├── upgrades/<request-id>.log
│   └── servers/<server-id>/
│       ├── attachment.json        # protected machine credential
│       ├── runner.pid
│       ├── runner.state.json
│       └── runner.log
└── daemon/
    └── versions/v<semver>-<platform>/
        ├── manifest.json
        ├── smallkhoj-computer
        ├── runner payload
        └── runtime dependencies
```

Credentials retain restrictive permissions and never enter normal status/log
payloads. Upgrade state files must be crash-safe: write temporary file, fsync
where practical, then atomic rename.

## 5. Version Model

### Local report

The supervisor reports a version bundle:

```json
{
  "desiredVersion": "0.4.0",
  "releaseChannel": "latest",
  "installedVersion": "0.4.0",
  "supervisorVersion": "0.4.0",
  "runnerVersion": "0.4.0",
  "previousVersion": "0.3.9",
  "protocolVersion": 2,
  "platform": "darwin-arm64"
}
```

Backend continues exposing a compatibility `daemonVersion` during migration,
derived from `runnerVersion`, but new UI and compatibility checks use the
explicit fields.

### Compatibility

Artifact manifest should include:

- product version;
- platform/architecture;
- git commit/build timestamp;
- protocol min/max;
- minimum supported server version where necessary;
- checksums for payload files;
- signature/key ID when signing ships.

The server rejects impossible target/platform combinations before creating an
operation, while the local supervisor revalidates independently.

## 6. Backend Data Model

### Extend `computers`

Add current observation fields (names illustrative):

- `computer_mode`: `legacy_daemon | managed_supervisor`;
- `supervisor_version`, `runner_version`, `installed_version`;
- `desired_version`, `release_channel`, `previous_version`;
- `upgrade_state`, `upgrade_request_id`, `upgrade_updated_at`;
- `service_status`, `service_last_seen_at`;
- `protocol_version`.

Keep `daemon_version` during migration as a compatibility field.

### New `computer_upgrade_operations`

Recommended durable table:

- `id` UUID / request ID;
- `server_id`, `computer_id`;
- `requested_by`;
- `idempotency_key` unique within Computer;
- `source_version`, `target_version`, `channel`;
- `state`, `progress`, `error_code`, `safe_error_message`;
- `rollback_target`, `rollback_outcome`;
- `requested_at`, `acknowledged_at`, `started_at`, `finished_at`, `expires_at`;
- `metadata` JSONB for bounded non-secret diagnostics.

The operation row is the UI source of truth. Computer columns are the latest
observation/cache for list rendering.

### Audit/events

Emit product events such as:

- `computer.upgrade.requested`;
- `computer.upgrade.state_changed`;
- `computer.upgrade.succeeded`;
- `computer.upgrade.failed`;
- `computer.upgrade.rolled_back`;
- `computer.version.updated`.

These events are not delivered to agent prompts by default; they are control
plane/activity data and must follow event-delivery token-safety rules.

## 7. Control Protocol

Extend the existing daemon Computer channel rather than adding a second remote
transport.

### Server -> Computer

```json
{
  "type": "control",
  "controlType": "computer_upgrade",
  "command": {
    "type": "computer_upgrade",
    "requestId": "uuid",
    "targetVersion": "0.4.0",
    "channel": "latest",
    "artifact": {
      "manifestUrl": "https://.../manifest.json"
    },
    "expectedCurrentVersion": "0.3.9",
    "drainTimeoutSeconds": 90,
    "requestedAt": "ISO-8601",
    "expiresAt": "ISO-8601"
  }
}
```

Do not place credentials or a browser-supplied arbitrary artifact URL in the
command. The server generates URLs from trusted release configuration.

### Computer -> Server

State transitions are reported by an authenticated endpoint and repeated in
heartbeat until acknowledged:

```json
{
  "requestId": "uuid",
  "state": "draining",
  "sourceVersion": "0.3.9",
  "targetVersion": "0.4.0",
  "progress": 45,
  "activeRuntimeCount": 2,
  "timestamp": "ISO-8601",
  "errorCode": null
}
```

State updates are monotonic except the defined rollback branch. Backend ignores
stale/duplicate updates using request ID and transition ordering.

### Delivery semantics

- Persist operation before push.
- Push through `DaemonControlHub` when connected.
- Include pending upgrade command in heartbeat/register fallback.
- Supervisor acknowledges request before destructive work.
- One in-flight operation per Computer.
- Duplicate command with same request ID returns current state.

## 8. Upgrade State Machine

```text
requested
  -> acknowledged
  -> downloading
  -> verified
  -> draining
  -> installing
  -> restarting
  -> health_checking
  -> succeeded
```

Failure before activation -> `failed` and keep current version.

Failure after activation -> `rolling_back -> rolled_back` when recovery works,
otherwise `failed` with `rollback_failed` diagnostics.

### Detailed transaction

1. Acquire local upgrade lock and persist request.
2. Reject expired, incompatible, duplicate-conflicting, or concurrent request.
3. Resolve trusted channel/manifest and download to a staging directory.
4. Verify checksum/signature, platform, version, and protocol compatibility.
5. Ask runner to enter drain mode; backend/UI block new starts.
6. Wait for runtime count zero; escalate after timeout and record forced stops.
7. Extract into a new immutable version directory.
8. Run local preflight (`--version`, manifest files, dependency probe).
9. Mark current version as rollback target and atomically switch pointer.
10. Ask OS service manager/updater helper to restart service.
11. New supervisor starts, reads persisted operation, starts target runner.
12. Health gate waits for local IPC, runner process, server connection,
    heartbeat version convergence, and stable interval.
13. Mark target last-known-good and operation succeeded; re-arm configured
    runtimes according to policy.
14. On failure, switch pointer back, restart previous version, verify health,
    and report rollback outcome.

## 9. Agent Drain and Runtime Recovery

Add a Computer-level maintenance flag enforced in both backend lifecycle API and
local runner.

Drain protocol:

1. stop accepting `start_runtime`;
2. finish no new queued deliveries;
3. send graceful stop to every runtime;
4. wait for runtime process exit and final status report;
5. force terminate remaining children after deadline;
6. runner reports drain summary and exits gracefully.

The current daemon `stop()` path is reusable but needs a bounded completion
result rather than fire-and-forget only. Existing desired runtime state in
member/workspace records is not deleted. After healthy restart, missing-runtime
reconciliation may re-arm autostart runtimes, or the product may defer restart
until the next event; this is an explicit product policy decision.

## 10. API and UI Surface

Illustrative APIs:

- `POST /api/v1/computers/{id}/upgrade-operations`
- `GET /api/v1/computers/{id}/upgrade-operations/current`
- `GET /api/v1/computers/{id}/upgrade-operations`
- `POST /api/v1/computers/{id}/upgrade-operations/{requestId}/cancel`
- `POST /api/v1/computers/{id}/upgrade-operations/{requestId}/rollback`
- authenticated internal progress endpoint for Computer reports.

Computer detail UI adds:

- Managed/legacy mode and service health;
- explicit version matrix;
- channel selector and target version;
- check-for-update / upgrade / rollback controls;
- active-runtime interruption confirmation;
- progress timeline and last operation history;
- safe diagnostics command.

Server actions follow existing Computers page patterns and revalidate persisted
backend data; progress should later subscribe to the existing public event
stream rather than depend only on redirects.

## 11. Packaging and Distribution Changes

Evolve `scripts/build_daemon_distribution.py` rather than replace it.

The distribution should package:

- supervisor/CLI entry point;
- runner entry point;
- manifest and payload checksums;
- service definition template/helper;
- install/setup command;
- compatibility alias for `smallkhoj-daemon` during migration.

Installer becomes idempotent:

1. download/verify artifact;
2. place immutable version directory;
3. install/update stable CLI launcher;
4. install service definition;
5. attach/adopt Computer identity;
6. start/restart through service manager;
7. run doctor and print safe recovery commands.

Artifact signing should be added before broad untrusted-network production
rollout. Checksum-only is useful integrity evidence but does not authenticate a
compromised release origin.

## 12. Failure and Recovery Matrix

| Failure | Required behavior |
| --- | --- |
| Download timeout | Keep current version, retryable failure |
| Hash/signature mismatch | Abort before drain/activation, security error |
| Drain timeout | Force-stop bounded children, record runtime IDs, continue or abort per policy |
| Disk full/extract failure | Keep current version, clean staging safely |
| Preflight failure | Keep current version |
| Service restart failure | OS manager/helper retries, then rollback |
| Target runner cannot connect | Roll back after health timeout |
| Backend unavailable after restart | Local health remains pending; bounded timeout then rollback or degraded policy |
| Rollback restart failure | Terminal `rollback_failed`, preserve logs and manual recovery command |
| Duplicate request | Return existing operation, do not repeat actions |
| Supervisor crash mid-upgrade | Resume from persisted transaction and filesystem markers |

## 13. Security Boundaries

- Web user chooses allowed channel/version, not arbitrary URL or command.
- Backend validates authority, tenancy, target Computer, compatibility, and
  release metadata.
- Local supervisor trusts only configured server identity and release roots.
- Upgrade helper accepts a narrow local request file/socket message, not shell
  text.
- Service definitions and version directories must not be writable by other
  users in the default model.
- Logs redact machine tokens, connect tickets, headers, and environment values.
- Signed release metadata needs key ID, rotation, expiry/revocation strategy,
  and rollback protection decision.

## 14. Migration Strategy

1. Add backend fields/operation table and dual-read API while legacy daemon
   remains unchanged.
2. Add supervisor-capable artifact and local CLI; install explicitly on a test
   Mac and adopt the existing Computer record.
3. Managed heartbeat reports explicit version bundle and mode; legacy heartbeat
   continues filling compatibility fields.
4. Enable UI upgrade only for `managed_supervisor` Computers.
5. Validate migration and rollback on a real Mac.
6. Make managed setup the default macOS onboarding command.
7. Deprecate terminal daemon path after a measured migration window.

## 15. Important Trade-offs

### Supervisor in the same release artifact vs tiny immutable bootstrapper

Recommended initial approach: same versioned product artifact plus OS service
manager/updater helper. A separately versioned immutable bootstrapper provides
stronger self-update isolation but creates another security and compatibility
surface. Introduce it only if service-manager restart proves insufficient.

### Immediate runtime restart vs lazy restart

Recommended default: restore only runtimes whose durable desired state is
`running`/autostart, after the Computer health gate passes. This matches current
reconciliation semantics while preventing every historical workspace from
starting.

### Checksum vs signed artifacts

Checksum is already available and should remain mandatory. Signed manifests are
recommended before broad production rollout because checksum served from the
same compromised origin is not authenticity protection.

### Per-user vs system service

Recommended macOS default: per-user LaunchAgent. It avoids root installation and
matches user-owned runtime credentials. It starts on login, not before login;
system daemon support can be added for dedicated always-on hosts.
