# P2 LAN Daemon Registration Runbook

Use this runbook to repeat the P2 validation where a daemon on another computer connects to the SmallKhoj backend over a private network and registers without starting a model runtime.

Do not commit real LAN addresses, Tailscale addresses, connect tokens, machine tokens, machine IDs, or personal workspace paths. Put those values in an untracked local env file.

## Local Env

Create a local env file such as `.env.p2.local`. It is ignored by git.

```bash
export SMALLKHOJ_SERVER_URL="http://<private-backend-host>:8000"
export SMALLKHOJ_PUBLIC_API_KEY="<local-public-api-key>"
export SMALLKHOJ_COMPUTER_NAME="<computer-name>"
export SMALLKHOJ_WORKSPACE="<absolute-path-to-smallkhoj-on-the-daemon-host>"
export SMALLKHOJ_PROXY_PORT="3457"
export SMALLKHOJ_AGENT_ID="00000000-0000-0000-0000-000000000006"
```

Use a one-time connect token only in the shell that starts the daemon:

```bash
export SLOCK_CONNECT_TOKEN="<one-time-connect-token>"
export SLOCK_ALLOW_WRITES="1"
```

Never paste `SLOCK_CONNECT_TOKEN`, `sk_machine_*`, or real private addresses into public chat, task descriptions, docs, screenshots, or commits.

## What This Validates

This runbook validates only computer registration and daemon connectivity:

- The backend listens on an address reachable from another computer.
- The remote computer can reach the backend before any credential is issued.
- A one-time connect token is generated and handed off privately.
- The remote daemon starts with `--runtime none`.
- The control plane shows the computer record as online with a recent heartbeat.

Because the daemon is started with `--runtime none`, `agentWorkspaces: []` is expected. A workspace entry appears only when a real runtime is started.

## Procedure

1. Start or verify the backend on the control-plane host.

```bash
curl -fsS "${SMALLKHOJ_SERVER_URL}/docs" >/dev/null
```

2. From the daemon host, verify network reachability before generating any credential.

```bash
curl -fsS "${SMALLKHOJ_SERVER_URL}/docs" >/dev/null
```

If this fails, fix private-network routing, firewall rules, or backend binding first. Do not issue a connect token until this request succeeds.

3. Confirm the daemon host has the same committed source as the control-plane host.

```bash
cd "${SMALLKHOJ_WORKSPACE}"
git fetch origin
git checkout main
git pull --ff-only
git rev-parse HEAD
```

4. Build the daemon on the daemon host.

```bash
cd "${SMALLKHOJ_WORKSPACE}/agent/daemon/aaa-daemon"
npm ci
npm run build
test -f dist/cmd/main.js
```

On Windows PowerShell:

```powershell
cd $env:SMALLKHOJ_WORKSPACE
git fetch origin
git checkout main
git pull --ff-only
git rev-parse HEAD

cd agent\daemon\aaa-daemon
npm ci
npm run build
Test-Path .\dist\cmd\main.js
```

Do not use `npm ci --omit=dev` before `npm run build`; TypeScript is a dev dependency and the build needs `tsc`.

5. Generate a one-time connect token on the control-plane host.

```bash
curl -sS -X POST "${SMALLKHOJ_SERVER_URL}/api/v1/computers/connect-command" \
  -H "Content-Type: application/json" \
  -H "X-Public-Key: ${SMALLKHOJ_PUBLIC_API_KEY}" \
  --data "{\"name\":\"${SMALLKHOJ_COMPUTER_NAME}\",\"serverUrl\":\"${SMALLKHOJ_SERVER_URL}\"}"
```

Send the returned token privately to the daemon operator. Treat it as expired if it is not used immediately.

6. Start the daemon on the daemon host with no model runtime.

```bash
cd "${SMALLKHOJ_WORKSPACE}/agent/daemon/aaa-daemon"
SLOCK_ALLOW_WRITES=1 \
SLOCK_CONNECT_TOKEN="${SLOCK_CONNECT_TOKEN}" \
node dist/cmd/main.js start --foreground \
  --runtime none \
  --server "${SMALLKHOJ_SERVER_URL}" \
  --ws auto \
  --agent-id "${SMALLKHOJ_AGENT_ID}" \
  --proxy-port "${SMALLKHOJ_PROXY_PORT}" \
  --register-daemon \
  --workspace "${SMALLKHOJ_WORKSPACE}"
```

On Windows PowerShell:

```powershell
cd "$env:SMALLKHOJ_WORKSPACE\agent\daemon\aaa-daemon"
$env:SLOCK_ALLOW_WRITES = "1"
$env:SLOCK_CONNECT_TOKEN = "<one-time-connect-token>"
node dist\cmd\main.js start --foreground `
  --runtime none `
  --server $env:SMALLKHOJ_SERVER_URL `
  --ws auto `
  --agent-id $env:SMALLKHOJ_AGENT_ID `
  --proxy-port $env:SMALLKHOJ_PROXY_PORT `
  --register-daemon `
  --workspace $env:SMALLKHOJ_WORKSPACE
```

Expected daemon log shape:

```text
[Daemon] Starting aaa-daemon v0.2.0...
[Proxy] Listening on http://127.0.0.1:<proxy-port>
[WS] Connecting to ws://<backend-host>:8000/internal/agent-api/ws...
[Daemon] All modules started. Proxy: http://127.0.0.1:<proxy-port>
[WS] Connected
```

7. Verify registration from the control-plane host.

```bash
curl -sS "${SMALLKHOJ_SERVER_URL}/api/v1/computers" \
  -H "X-Public-Key: ${SMALLKHOJ_PUBLIC_API_KEY}"
```

Pass criteria for this P2 registration check:

- The expected computer name appears.
- `status` is `online`.
- `activeDaemonId` is present.
- `lastHeartbeatAt` is recent.
- `daemonLeaseExpiresAt` is in the future and continues to renew.
- `agentWorkspaces` is empty when using `--runtime none`.

## Result From The P2 Debug Session

The P2 session completed successfully:

- The control-plane backend was reachable from the daemon host over the private network.
- The daemon host pulled the pushed `main` commit and rebuilt `aaa-daemon`.
- An initial token expired before use, so a fresh token was generated only after the daemon binary was confirmed present.
- The daemon started in foreground mode with `--runtime none`.
- The local proxy listened on the configured loopback port.
- WebSocket connectivity to the backend was established.
- The control plane listed the remote computer as online with an active daemon lease and recent heartbeat.
- No model runtime was started, so no model quota was consumed.

## Follow-Up Choice

After registration is verified, choose one operational mode:

- Keep the foreground daemon running for short-term validation.
- Stop the foreground process and restart without `--foreground` for daemonized operation.
- Stop the process and reconnect later when a real runtime test is needed.
