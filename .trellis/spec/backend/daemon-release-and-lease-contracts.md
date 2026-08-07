# Daemon Release and Lease Contracts

> Executable contracts for Aura release pointers, installer recovery, explicit
> rollback, and daemon lease conflict preflight across backend, CLI, and UI.

## Scenario: Recoverable Aura Release Activation and Lease-Aware Connect

### 1. Scope / Trigger

Use this spec when changing Aura installers, the stable launcher, release
selection/rollback, Computer Connect/Reconnect preview or command generation,
daemon connect 409 handling, or the Computers onboarding status surface.

### 2. Signatures

```text
aura rollback --target-version <installed-semver>

<install-root>/active.json
<install-root>/previous.json
<install-root>/versions/v<version>-<platform>/

POST /api/v1/computers/connect-preview
POST /api/v1/computers/{computer_id}/reconnect-preview
POST /api/v1/computers/connect-command
POST /api/v1/computers/{computer_id}/reconnect-command
POST /internal/agent-api/daemon/connect
```

Lease conflict detail:

```json
{
  "reasonCode": "DAEMON_LEASE_ACTIVE",
  "message": "...",
  "computerId": "uuid",
  "activeDaemonId": "uuid-or-null",
  "leaseExpiresAt": "ISO-8601-or-null",
  "retryAfterSeconds": 42,
  "recoveryActions": ["stop", "wait", "retry"]
}
```

### 3. Contracts

- `active.json` is the only active release pointer. The stable Windows
  `aura.cmd`/`aura.ps1` launcher reads it at invocation time; it must not embed a
  version directory.
- Before activating a different complete release, installers atomically copy the
  old active pointer to `previous.json`. A failed download, extraction, manifest
  check, checksum, or `aura --version` probe leaves the old pointer and old
  release directory usable.
- A normal install refuses an implicit downgrade. An explicit recovery install
  requires `SMALLKHOJ_DAEMON_FORCE=1` or `AURA_DAEMON_FORCE=1`; normal user
  rollback uses `aura rollback --target-version` and may select only an already
  installed, complete release inside the install root.
- Rollback requires the daemon to be stopped and never rewrites Setup config,
  machine ID, or credential files. The version being left remains installed so
  the operation is reversible.
- PowerShell JSON pointers use UTF-8 without BOM. Readers strip one leading BOM
  defensively so PowerShell 5.1 or a user editor cannot make `status`/`doctor`
  misclassify an installed release.
- Preview endpoints return `connectPreflight` and do not create or consume a
  ConnectTicket. When the named Computer has an active lease, command endpoints
  fail with HTTP 409 and the structured detail above before ticket creation.
- `/internal/agent-api/daemon/connect` uses the same 409 reason code. The daemon
  CLI must surface stop/wait/fresh-ticket/retry guidance and must not persist a
  machine credential after the rejected exchange.
- Frontend server actions accept both legacy `{detail: string}` and structured
  `{detail: {message}}` errors. The onboarding surface renders the active-lease
  warning in `connect-status-region`; it must not degrade to a bare `HTTP 409`.
- `recoveryActions` are ordered identifiers, not executable commands. Clients may
  localize their display text but must preserve the stop -> wait -> retry order.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Target version is missing, incomplete, outside the install root, or invalid semver | Refuse rollback; active pointer and credentials stay unchanged. |
| Daemon PID is active during rollback | Refuse and instruct the user to run `aura stop`; never force-kill. |
| Active local version is newer than installer target | Refuse unless an explicit recovery force flag is set. |
| New Windows executable fails `aura --version` | Restore the replaced target directory if any; do not switch `active.json`. |
| Same complete version is already active | Refresh stable launchers and skip the archive download. |
| Preview sees an active server lease | Return `connectPreflight.ok=false`; create zero tickets. |
| Connect/Reconnect command sees an active lease | HTTP 409 `DAEMON_LEASE_ACTIVE`; create/consume zero tickets. |
| Daemon receives structured active-lease 409 | Exit nonzero with stop/wait/fresh-ticket/retry guidance; persist no credential. |
| UI receives structured active-lease 409 | Show localized message in `connect-status-region`, not `HTTP 409`. |

### 5. Good/Base/Bad Cases

- Good: stage and probe v0.2.7, preserve v0.2.6 and its pointer, atomically
  activate v0.2.7, then explicitly roll back to the still-complete v0.2.6.
- Good: preview an online Computer, show the lease expiry/recovery warning, and
  reject ticket generation before any credential exists.
- Base: a legacy backend returns `{detail: "Computer already has an active
  daemon"}`; the frontend still shows that text, while structured clients receive
  richer recovery metadata from upgraded servers.
- Bad: delete the old version before probing the new executable, hard-code a
  version into `aura.cmd`, create a ticket and then return 409, or display only
  `HTTP 409` to the user.

### 6. Tests Required

- Daemon CLI tests switch an installed pointer, preserve Setup/machine/credential
  state and the old directory, reject missing/incomplete targets, reject a running
  daemon, and tolerate a BOM in `active.json`.
- Installer generator/integration tests assert version comparison, no implicit
  downgrade, same-version zero archive download, stable pointer-aware launchers,
  pre-activation health probe, `previous.json`, and failed-staging restoration.
- Backend tests assert preview is ticket-free, active lease returns the exact
  structured fields, command rejection happens before ticket creation/consumption,
  and expired leases still allow a fresh ticket.
- Daemon connect tests assert the structured 409 message and absence of persisted
  credential state.
- Frontend type-check/tests cover `connectPreflight`; marker-based `./twd` evidence
  asserts visible localized text in `connect-status-region` on the exact candidate
  tab.
- Windows x64 real-host acceptance rebuilds the latest PE carrier and exercises
  upgrade, failed upgrade recovery, explicit rollback, and lease stop/wait/retry.

### 7. Wrong vs Correct

#### Wrong

```text
download -> delete current version -> move new files -> write version-specific aura.cmd
active lease -> create ticket -> HTTP 409 "conflict"
```

#### Correct

```text
download -> verify -> stage -> probe -> preserve previous pointer -> atomic activate
active lease -> structured preflight/409 before ticket creation -> stop/wait/retry UI
```
