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

python3 scripts/production_image_transfer.py \
  --task-scoped --task-id <trellis-task-id> ...

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
- A functional task-scoped image transfer must opt in with both
  `--task-scoped` and an existing `--task-id`. Its release evidence records
  `deploymentScope.type=task-scoped` and `capacityClaim=not-asserted`; it cannot
  be used as formal capacity or initial-release evidence. Formal transfers keep
  the accepted `--capacity-report` path.

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
| Task-scoped transfer omits/combines its gate flags or references a missing task | Refuse before any SSH/Docker command. |

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

---

## Scenario: Single-Active Daemon Lease Enforcement at WebSocket Registration

### 1. Scope / Trigger

Use this spec when changing the daemon WS endpoint (`/internal/agent-api/ws`),
`DaemonControlHub` connection handling, daemon reconnect policy, or the
`active_daemon_id` / `daemon_lease_expires_at` fields. Trigger: the 2026-08-16
incident — six daemon processes holding the same machine credentials each kept
a WS connection, and every `push`/`push_events` delivered one copy per
connection (one user message produced six replies). Connect-time preflight
(Scenario 1) does not cover daemons that reconnect straight to `/ws`.

### 2. Signatures

```text
services.daemon_control.DaemonControlHub.add_exclusive(computer_id, websocket, event_cursor) -> list[WebSocket]
GET /internal/agent-api/ws?daemonId=<process-uuid>
WS control frame: {"type": "lease.revoked", "reason": "superseded_by_new_daemon" | "lease_taken_over"}
WS close code 4001  # lease revoked / taken over
daemon exports: isLeaseRevokedMessage(input): boolean, LEASE_REVOKED_CLOSE_CODE = 4001
```

### 3. Contracts

- One WS connection per computer, enforced at registration: `add_exclusive`
  replaces any existing peers and returns them; the endpoint sends each
  displaced socket a `lease.revoked` frame (best-effort) and closes it with
  code 4001.
- WS register claims the lease unconditionally when `daemonId` is present
  (newest instance wins): `active_daemon_id = daemonId`,
  `daemon_lease_expires_at = now + DAEMON_LEASE_SECONDS`,
  `last_heartbeat_at = now`, `status = "online"`, committed before the first
  command/event delivery. A connection without `daemonId` must not displace an
  active lease holder — close 4001 immediately and never enter the hub.
- Runtime control commands (`start_runtime` / `cancel_turn` / …) and event
  pushes reach only the single active connection by construction; there is no
  per-command routing decision to add later.
- Heartbeat (`activity`/`ack`) whose `daemonId` lost the lease to a newer
  instance: the server sends `lease.revoked` and closes 4001 instead of
  skipping the write and leaving a zombie consumer.
- Daemon side: `lease.revoked` message or close 4001 → stop all runtimes,
  disconnect, exit, and do NOT auto-reconnect. Reconnecting would displace the
  new holder and start a takeover ping-pong between two managed instances
  (orphan cleanup: `docs/orphan-daemon-cleanup.md`).

### 4. Validation & Error Matrix

- no daemonId + active lease held by another daemon -> close 4001 "active lease held by another daemon"; hub untouched
- send/close on a displaced socket raises -> best-effort ignore; hub already dropped it
- heartbeat daemonId ≠ active_daemon_id with active lease -> notify `lease.revoked` + close 4001
- same socket re-registered (reconnect) -> displaced == [], lease refreshed in place

### 5. Good/Base/Bad Cases

- Good: daemon restart registers a new daemonId → stale socket displaced, lease transferred, single-delivery resumes without a restart race.
- Base: single healthy daemon → `add_exclusive` is a no-op on an empty set; behavior unchanged.
- Bad: two managed daemons both auto-reconnect on 4001 → takeover loop; the daemon exit-without-reconnect contract is what breaks the loop.

### 6. Tests Required

- `backend/tests/test_daemon_control.py::test_daemon_hub_add_exclusive_displaces_previous_websockets` — displaced set is exactly the previous sockets AND `push` delivers exactly once (only the active socket receives).
- `backend/tests/test_daemon_control.py::test_daemon_hub_add_exclusive_is_idempotent_for_same_socket` — re-registering the same socket displaces nothing.
- `backend/tests/test_daemon_control.py::test_agent_api_lease_helpers_still_guard_conflict_paths` — conflict true for a different daemonId, false for the holder, false once the lease expires.
- `agent/daemon/aaa-daemon/test/daemon-lease.test.mjs` — `isLeaseRevokedMessage` matches plain/wrapped payloads and rejects control/runtime types; close-code constant is 4001.

### 7. Wrong vs Correct

#### Wrong

```python
daemon_control_hub.add(computer.id, websocket, event_cursor)  # multi-connection hub
if _apply_daemon_ws_activity(computer, daemon_id, now):        # conflict → skip write
    await db.commit()                                          # zombie keeps consuming events
```

#### Correct

```python
for stale in daemon_control_hub.add_exclusive(computer.id, websocket, event_cursor):
    await stale.send_json({"type": "lease.revoked", "reason": "superseded_by_new_daemon"})
    await stale.close(code=4001, reason="superseded by new daemon")
# register claims the lease unconditionally (daemonId present); a later
# heartbeat conflict closes this socket with 4001 instead of skipping.
```
