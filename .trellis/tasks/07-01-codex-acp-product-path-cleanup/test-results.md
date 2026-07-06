# Codex ACP product path cleanup test results

Date: 2026-07-01
Machine: SH-zhangyan04
Repo: `D:/ai/khoj/smallkhoj`

## Summary

Implemented the first repair pass for task `07-01-codex-acp-product-path-cleanup`:

- Product Codex remains `runtime: "codex"` and uses the ACP runtime driver.
- Public agent creation no longer accepts the historical native `codex_cli` runtime.
- Daemon CLI no longer advertises or accepts `--runtime codex_cli`.
- Runtime provider inventory no longer publishes a `codex-cli` fallback provider from local `codex` command detection.
- Manual runtime provider parsing no longer accepts `codex_cli`.
- Codex ACP launcher resolution now chooses `npx.cmd` on Windows when that shim is available on `PATH`.
- Daemon startup logging no longer reports `pid=unknown` as if startup succeeded; it logs ACP start requested until the ACP session/warmup produces a real child process/result.
- The old CLI-oriented PRD was replaced with a superseded note that points to this ACP cleanup task.

## Windows launcher check

```text
where.exe npx
C:\Program Files\nodejs\npx
C:\Program Files\nodejs\npx.cmd

node --input-type=module -e "import { resolveNpxCommand } from './dist/runtime/codex-acp-bridge.js'; console.log(resolveNpxCommand());"
npx.cmd
```

## Automated tests

```bash
cd agent/daemon/aaa-daemon
npm run build
```

Result: pass.

```bash
cd agent/daemon/aaa-daemon
node --test test/codex-acp-mvp.test.mjs test/codex-acp-runtime.test.mjs
```

Result: 7 tests passed.

```bash
cd agent/daemon/aaa-daemon
node --test --test-name-pattern "daemon CLI rejects historical codex_cli runtime path|daemon starts public Codex runtime with ACP implementation" test/daemon-runtime.test.mjs
```

Result: 2 tests passed.

```powershell
cd backend
$env:PYTHONPATH='.'
uv run pytest -o addopts= tests/test_daemon_control.py
```

Result: 47 tests passed, 2 warnings.

## Notes

- A plain `python -m pytest backend/tests/test_daemon_control.py` from repo root failed because the parent `D:/ai/khoj/pytest.ini` injects `--reuse-db` and the ambient Python environment lacks the async pytest plugin. Running through `uv` with `PYTHONPATH=.` and `-o addopts=` uses the backend test dependencies and passes.
- Full `node --test test/daemon-runtime.test.mjs` was attempted once and timed out after about 184 seconds, so the final verification used targeted daemon runtime tests for the changed Codex ACP behavior.

## Follow-up fix: workspace memory seed and ACP startup readiness

After the first real Windows ACP validation, `@win-kimiCode` confirmed that the generated wrapper existed and was manually usable:

- `.slock/slock.cmd`
- `.slock/raft`

The blocker was not missing wrapper generation. The ACP model followed the system prompt and tried to read `MEMORY.md` before it reached the wrapper command. New runtime workspaces did not contain `MEMORY.md`, so startup drifted into failed environment exploration.

Changes made:

- `writeSlockWrapper()` now seeds a minimal `MEMORY.md` in a new runtime workspace and preserves an existing `MEMORY.md` if one is already present.
- Codex ACP session creation now marks the runtime ready with reason `codex_acp_session_ready`; the Slock wrapper warmup remains a capability check instead of the only definition of process startup. This separates:
  - ACP process/session startup
  - Slock wrapper capability verification
  - real end-to-end message round trip

Verification:

```bash
cd agent/daemon/aaa-daemon
npm run build
```

Result: pass.

```bash
cd agent/daemon/aaa-daemon
node --test test/proxy-wrapper.test.mjs test/codex-acp-runtime.test.mjs test/codex-acp-mvp.test.mjs
```

Result: 11 tests passed.

```bash
cd agent/daemon/aaa-daemon
node --test --test-name-pattern "daemon starts public Codex runtime with ACP implementation|daemon CLI rejects historical codex_cli runtime path" test/daemon-runtime.test.mjs
```

Result: 2 tests passed.

## Real Windows ACP end-to-end validation (task #11)

### Setup

- Daemon built from the same commit as task #10 (`npm ci && npm run build` passed).
- Started with product machine-token path:

```bash
cd agent/daemon/aaa-daemon
node dist/cmd/main.js start --foreground \
  --server http://124.222.40.40 \
  --ws ws://124.222.40.40/internal/agent-api/ws \
  --machine-token <sk_machine_...> \
  --register-daemon \
  --pid-file D:/ai/khoj/smallkhoj/.trellis/tasks/07-01-codex-acp-product-path-cleanup/daemon.pid \
  --log-file D:/ai/khoj/smallkhoj/.trellis/tasks/07-01-codex-acp-product-path-cleanup/daemon-stdout.log
```

- Logs captured:
  - `daemon-stdout.log`
  - `daemon-stderr.log`

### Agent creation

Created via public API:

```bash
curl -s -X POST http://124.222.40.40/api/v1/members/agents \
  -H 'X-Public-Key: sk_public_local' \
  -H 'X-Account-Token: <sk_session_...>' \
  -H 'X-Server-Id: 3893c518-c8f8-43ba-af0d-54a7773bbb6d' \
  -H 'Content-Type: application/json' \
  -d '{"name":"win-codex-acp-20260701060000","computerId":"4c9fafa5-2cd5-4dc6-b150-c6dd6d683414","runtime":"codex","autoStart":true}'
```

Response: workspace `59cfbd5b-1e6b-45c9-b2f8-ecb6830b45c2`, agent `@win-codex-acp-20260701060000`.

### What succeeded

1. **No CLI path confusion**: the created agent has `runtime: "codex"` and `runtimeProvider: null`; backend never rejected it as unavailable.
2. **Windows ACP launcher resolved correctly**: daemon logs show the command resolved to `npx -y @zed-industries/codex-acp@0.16.0`, and the actual spawned process uses `npx.cmd` (Windows shim). No `spawn npx ENOENT`.
3. **ACP bridge process started** and connected: processes `npx-cli.js -y @zed-industries/codex-acp@0.16.0` and `codex-acp.js` are alive.
4. **No misleading `pid=unknown` success log**: daemon reports `codex runtime start requested ... (status=starting, awaiting ACP session/warmup)`.
5. **Daemon WebSocket connection stable**: `[WS] Connected` and `/daemon/register` returns the computer as online.

### What failed

The ACP runtime never completed warmup, so the workspace stayed `status: "pending_start"` and did not reply to the marker message.

Daemon-injected warmup probe asks the runtime to run the workspace `slock` wrapper `server info`. The ACP runtime instead emitted a series of tool calls before calling `slock`:

```text
[Daemon] codex runtime 90089732-b520-4c4f-b067-dce188f117da stderr: Codex ACP Slock prompt written to ...\codex-acp-slock-prompt.md
[Daemon] codex runtime 90089732-b520-4c4f-b067-dce188f117da stderr: npm warn deprecated @zed-industries/codex-acp@0.16.0 ...
[Daemon] codex runtime 90089732-b520-4c4f-b067-dce188f117da stderr: ERROR codex_core::tools::router: error=Exit code: 1
[Daemon] codex runtime 90089732-b520-4c4f-b067-dce188f117da stderr: Get-Content : 找不到路径"MEMORY.md"...
[Daemon] codex runtime 90089732-b520-4c4f-b067-dce188f117da stderr: Get-Content : Cannot find path '...\MEMORY.md' ...
[Daemon] codex runtime 90089732-b520-4c4f-b067-dce188f117da stderr: rg : The term 'rg' is not recognized ...
```

After creating `MEMORY.md` in the workspace, no further ACP output was observed and the runtime remained in `starting` awaiting ACP session/warmup.

A marker message was sent to the validation channel:

```bash
curl -s -X POST http://124.222.40.40/api/v1/channels/win-runtime-validation-20260630223748/messages ...
"REAL_codex_acp_windows_20260701060500: please reply with a short acknowledgment ..."
```

The message appeared in channel history (seq 18) but no reply was received from `@win-codex-acp-20260701060000`.

### Root cause / remaining blocker

The Codex ACP runtime on Windows stalls during the daemon warmup phase. Before executing the required `slock server info` probe, the ACP model issues PowerShell `Get-Content` and `rg` tool calls that fail on this Windows/Git Bash environment (`MEMORY.md` missing, `rg` not installed). The runtime does not recover from these tool failures and never reaches the `slock` tool success that the daemon uses to flip status to `running`.

This is a **new blocker**, not the previous `spawn npx ENOENT` or `codex_cli` product-path confusion.

### Pass/fail for task #11 acceptance

| Criterion | Result | Notes |
|-----------|--------|-------|
| Rebuild daemon with task #10 fixes | Pass | `npm run build` succeeded |
| Connect/register daemon via product path | Pass | Used machine token; `[WS] Connected` |
| Create `runtime=codex` agent from backend | Pass | No provider-availability rejection |
| ACP launch uses `npx.cmd` on Windows | Pass | Process list confirms `npx-cli.js -y @zed-industries/codex-acp@0.16.0` |
| No `spawn npx ENOENT` | Pass | None observed |
| No `codex_cli` product path | Pass | Runtime stays `codex` / provider null |
| No misleading `pid=unknown` | Pass | Log says `awaiting ACP session/warmup` |
| Real marker round-trip | Fail | ACP runtime stuck in warmup; no reply |

### Second validation attempt after workspace MEMORY.md seed + ACP ready-gate fixes

A new agent was created to verify the follow-up fixes:

```bash
curl -s -X POST http://124.222.40.40/api/v1/members/agents \
  -H 'X-Public-Key: sk_public_local' \
  -H 'X-Account-Token: <sk_session_...>' \
  -H 'X-Server-Id: 3893c518-c8f8-43ba-af0d-54a7773bbb6d' \
  -H 'Content-Type: application/json' \
  -d '{"name":"win-codex-acp-20260701070000","computerId":"4c9fafa5-2cd5-4dc6-b150-c6dd6d683414","runtime":"codex","autoStart":true}'
```

Response: workspace `97d8c00c-8bfc-4180-af3b-238621ca6019`, agent `@win-codex-acp-20260701070000`.

#### What succeeded

1. **New runtime workspace now contains a seeded `MEMORY.md`** at `C:\Users\zhangyan.ean\.smallkhoj\daemon\workspaces\.slock-runtimes\...\97d8c00c-...\MEMORY.md` with a minimal runtime-memory template.
2. **ACP session creation succeeded**: the new workspace quickly obtained an ACP `sessionId` (`019f1b99-...` then `019f1ba1-...`), and the daemon no longer blocks on the wrapper warmup before allowing the runtime to accept messages.
3. **Real ACP round-trip succeeded on the original codex ACP agent**: marker `REAL_codex_acp_windows_20260701060000` (seq 15) received a reply from `@win-codex-acp-20260701060000` (seq 17), and a second marker (seq 18) also received a reply (seq 19):

```text
15 @zy-ean        REAL_codex_acp_windows_20260701060000: please reply ...
17 @win-codex-acp-20260701060000 Acknowledged - ACP conversation path looks live from my side.
18 @zy-ean        REAL_codex_acp_windows_20260701060500: please reply ...
19 @win-codex-acp-20260701060000 Acknowledged - ACP conversation path is working from my side.
```

This proves that a `runtime=codex` ACP agent can receive a channel marker and reply through the generated Slock/Raft wrapper.

#### What still failed / new blocker

When the new workspace was restarted (to exercise the clean startup path with seeded `MEMORY.md`), the daemon attempted to spawn `claude` instead of the ACP `npx` launcher:

```text
[Daemon] codex runtime 07ec9a5c-3fb9-4d39-8c57-0ab35cdba3ca error: spawn claude ENOENT
[Daemon] codex runtime 07ec9a5c-3fb9-4d39-8c57-0ab35cdba3ca error: ACP connection closed
```

The backend is persisting `runtimeCommand: "claude"` for `runtime: "codex"` workspaces and sending that command to the daemon on restart. The daemon treats the backend-provided command as explicit and does not override it with the detected ACP launcher, so the ACP runtime fails to start.

Also, both codex ACP workspaces still appear as `status: "pending_start"` in `/daemon/register` even after an ACP session exists; the daemon-side `codex_acp_session_ready` status transition is not reaching the backend workspace status.

### Updated pass/fail for task #11 acceptance

| Criterion | Result | Notes |
|-----------|--------|-------|
| Rebuild daemon with task #10 fixes | Pass | `npm run build` succeeded |
| Connect/register daemon via product path | Pass | Used machine token; `[WS] Connected` |
| Create `runtime=codex` agent from backend | Pass | No provider-availability rejection |
| New workspace seeded with `MEMORY.md` | Pass | `MEMORY.md` present after workspace creation |
| ACP session created without wrapper-warmup deadlock | Pass | Session id assigned quickly |
| No `spawn npx ENOENT` on initial launch | Pass | Process list confirms `npx-cli.js -y @zed-industries/codex-acp@0.16.0` |
| No `codex_cli` product path | Pass | Runtime stays `codex` / provider null |
| No misleading `pid=unknown` | Pass | Log says `awaiting ACP session/warmup` |
| Real marker round-trip via ACP | Pass | `@win-codex-acp-20260701060000` replied to seq 15/18 |
| Clean restart of a codex ACP workspace | Fail | Backend sends `runtimeCommand: "claude"`, causing `spawn claude ENOENT` |
| Backend workspace status reflects ACP session ready | Fail | Status remains `pending_start` despite session id |

### Suggested next fix

1. **Backend**: stop storing/defaulting `runtime_command = "claude"` for `runtime = "codex"` workspaces; leave it null so the daemon resolves the ACP launcher (`npx` / `npx.cmd`) from its runtime-provider inventory.
2. **Daemon**: as a defense-in-depth, when `runtime = "codex"` and the backend-supplied `runtimeCommand` does not look like an ACP launcher, fall back to `resolveDetectedRuntimeCommand('codex', inventory)` instead of blindly spawning it.
3. **Daemon/backend heartbeat**: ensure the `codex_acp_session_ready` state transition reaches the backend workspace status (check that `markRuntimeReady` is reflected in the heartbeat payload and not overwritten by `mark_missing_runtimes_pending_start`).

### Third validation attempt after command/heartbeat fixes

A fresh agent was created to verify the latest round of fixes:

```bash
curl -s -X POST http://124.222.40.40/api/v1/members/agents \
  -H 'X-Public-Key: sk_public_local' \
  -H 'X-Account-Token: <sk_session_...>' \
  -H 'X-Server-Id: 3893c518-c8f8-43ba-af0d-54a7773bbb6d' \
  -H 'Content-Type: application/json' \
  -d '{"name":"win-codex-acp-20260701080000","computerId":"4c9fafa5-2cd5-4dc6-b150-c6dd6d683414","runtime":"codex","autoStart":true}'
```

Response: workspace `f43c6520-0e72-4138-9115-640708a640a8`, agent `@win-codex-acp-20260701080000`.

#### What succeeded

1. **Clean ACP startup with no `spawn claude ENOENT`**: daemon logs show the defense-in-depth working:

```text
Ignoring non-ACP control runtimeCommand for codex runtime: claude
[Daemon] codex runtime start requested for agent 7d26678a-... (status=starting, awaiting ACP session/warmup)
```

2. **Backend no longer stores a polluted command**: `/daemon/register` returns `runtimeCommand: null` for the new codex workspace.
3. **ACP session created successfully**: `sessionId` assigned immediately after start.
4. **Real marker round-trip on first start**:

```text
23 @zy-ean        REAL_codex_acp_windows_20260701080000: please reply ...
24 @win-codex-acp-20260701080000 Acknowledged — ACP conversation path is live on this runtime.
```

5. **Real marker round-trip after a backend `restart` lifecycle action**:

```text
25 @win-codex-acp-20260701060000 Short acknowledgment from this restarted runtime...
26 @win-codex-acp-20260701080000 Short acknowledgment from this restarted runtime...
```

Both codex ACP agents replied after restart, confirming the ACP conversation path survives a clean restart.

#### Remaining blocker

Backend workspace status still does not reflect ACP readiness. Even after the runtime has an active session and has replied to messages, `/daemon/register` continues to report:

```json
{ "status": "pending_start", "sessionId": "019f1bb4-461a-72d2-bb66-604b062ab82e" }
```

The daemon-side `codex_acp_session_ready` transition is therefore either not being sent in the heartbeat payload or is being overwritten by a later `pending_start` projection.

### Final pass/fail for task #11 acceptance

| Criterion | Result | Notes |
|-----------|--------|-------|
| Rebuild daemon with task #10 fixes | Pass | `npm run build` succeeded |
| Connect/register daemon via product path | Pass | Used machine token; `[WS] Connected` |
| Create `runtime=codex` agent from backend | Pass | No provider-availability rejection |
| New workspace seeded with `MEMORY.md` | Pass | `MEMORY.md` present after workspace creation |
| ACP session created without wrapper-warmup deadlock | Pass | Session id assigned quickly |
| No `spawn npx ENOENT` on initial launch | Pass | Process list confirms `npx-cli.js -y @zed-industries/codex-acp@0.16.0` |
| No `spawn claude ENOENT` after restart | Pass | Daemon ignores polluted `claude` command and falls back to ACP launcher |
| No `codex_cli` product path | Pass | Runtime stays `codex` / provider null |
| No misleading `pid=unknown` | Pass | Log says `awaiting ACP session/warmup` |
| Real marker round-trip via ACP (first start) | Pass | `@win-codex-acp-20260701080000` replied to seq 23 |
| Real marker round-trip via ACP (after restart) | Pass | Both codex ACP agents replied after seq 24/25 |
| Backend workspace status reflects ACP session ready | Fail | Status remains `pending_start` despite session id and successful replies |

### Suggested final fix

Investigate the daemon-to-backend heartbeat serialization for the `running` status transition. Verify that:

1. `markRuntimeReady(runtime, 'codex_acp_session_ready')` is actually executed when the ACP `session` event fires.
2. The next `/internal/agent-api/daemon/heartbeat` payload includes `status: "running"` for that workspace.
3. The backend `_upsert_daemon_workspace` writes that status and the `mark_missing_runtimes_pending_start` guard does not overwrite it with a stale `pending_start`.

### Fourth (final) validation attempt after agent-scoped status-projection fix

The existing `runtime=codex` workspace `f43c6520-0e72-4138-9115-640708a640a8` was restarted under the new daemon build.

#### What succeeded

1. **No command pollution on restart**: daemon logs still show:

```text
Ignoring non-ACP control runtimeCommand for codex runtime: claude
[Daemon] codex runtime start requested for agent 7d26678a-... (status=starting, awaiting ACP session/warmup)
```

2. **ACP session created**: new `sessionId` assigned immediately after restart.
3. **Real marker round-trip after restart**:

```text
27 @zy-ean        REAL_codex_acp_windows_20260701083000 final check ...
28 @win-codex-acp-20260701080000 Acknowledged — ACP conversation path is confirmed live on this runtime after the status-projection fix.
```

4. **Another codex ACP agent also replied on the same channel** (seq 29), confirming the fix is not specific to one workspace.

#### Remaining blocker

Backend workspace status still does not transition to `running`. After the runtime has replied to the marker, `/internal/agent-api/daemon/register` still reports:

```json
{
  "status": "pending_start",
  "sessionId": "019f1bbf-0f4d-7d80-a24b-e3f0ac5ba7a3"
}
```

The daemon now sends an agent-scoped `/internal/agent-api/heartbeat` with `workspaceStatus: "running"` on `markRuntimeReady`, but the cloud backend workspace row is not reflecting the update. This suggests either the cloud backend is running a version that does not yet handle `workspaceStatus` in the agent heartbeat, or the agent heartbeat is being rejected/ignored for another reason (e.g., authentication/audience mismatch between the machine-scoped daemon and the agent-scoped endpoint).

### Final acceptance summary

| Criterion | Result | Notes |
|-----------|--------|-------|
| Rebuild daemon with task #10 fixes | Pass | `npm run build` succeeded |
| Connect/register daemon via product path | Pass | Used machine token; `[WS] Connected` |
| Create / restart `runtime=codex` agent | Pass | No provider-availability rejection; runtimeCommand stays null |
| New workspace seeded with `MEMORY.md` | Pass | `MEMORY.md` present after workspace creation |
| ACP session created without wrapper-warmup deadlock | Pass | Session id assigned quickly |
| No `spawn npx ENOENT` on launch | Pass | `npx-cli.js -y @zed-industries/codex-acp@0.16.0` used |
| No `spawn claude ENOENT` after restart | Pass | Daemon ignores polluted `claude` command |
| No `codex_cli` product path | Pass | Runtime stays `codex` / provider null |
| No misleading `pid=unknown` | Pass | Log says `awaiting ACP session/warmup` |
| Real marker round-trip via ACP (first start) | Pass | `@win-codex-acp-20260701080000` replied to seq 23 |
| Real marker round-trip via ACP (after restart) | Pass | Replied to seq 27/28/29 after multiple restarts |
| Backend workspace status reflects ACP session ready | Fail | Status remains `pending_start` despite successful replies; likely backend version / agent-heartbeat acceptance issue |

### Final suggested fix

Verify the cloud backend has the agent-heartbeat `workspaceStatus` handling deployed. If it does, add server-side logging or a targeted test that exercises the `/internal/agent-api/heartbeat` endpoint with `workspaceStatus: "running"` using the same credential type the daemon uses, to determine whether the request is rejected, ignored, or overwritten.

## Follow-up fix: Codex runtimeCommand pollution and pending status projection

After the second Windows ACP validation, two product-path blockers remained:

1. Clean restart of a `runtime=codex` workspace could receive a stale/default `runtimeCommand: "claude"` and the daemon would try `spawn claude`.
2. A Codex ACP workspace could still appear as `pending_start` even after an ACP session existed, likely from stale/empty daemon lifecycle updates racing with the ready heartbeat.

Changes made:

- Backend no longer stores a public `runtimeCommand` for newly created Codex workspaces.
- Backend daemon heartbeat upsert clears `runtime_command` for `runtime="codex"` rows instead of persisting daemon/runtime command hints.
- Backend `runtime_start_command()` suppresses `runtimeCommand` for Codex workspaces, so restarts use the daemon ACP launcher path instead of stale CLI commands.
- Daemon heartbeat/register payloads no longer publish `runtimeCommand` for running Codex workspaces.
- Daemon now ignores clearly non-ACP `runtimeCommand` values such as `claude` for `runtime=codex`, falling back to the ACP default launcher (`npx`/`npx.cmd` + `@zed-industries/codex-acp`).
- Backend missing-runtime rearm now gives a just-confirmed active workspace with `session_id` a short grace period, preventing older empty lifecycle updates from immediately downgrading a fresh ACP session back to `pending_start`.

Verification:

```bash
cd agent/daemon/aaa-daemon
npm run build
```

Result: pass.

```bash
cd agent/daemon/aaa-daemon
node --test test/proxy-wrapper.test.mjs test/codex-acp-runtime.test.mjs test/codex-acp-mvp.test.mjs
```

Result: 11 tests passed.

```bash
cd agent/daemon/aaa-daemon
node --test --test-name-pattern "daemon starts public Codex runtime with ACP implementation|daemon CLI rejects historical codex_cli runtime path" test/daemon-runtime.test.mjs
```

Result: 2 tests passed.

```powershell
cd backend
$env:PYTHONPATH='.'
uv run pytest -o addopts= tests/test_daemon_control.py
```

Result: 50 tests passed, 3 warnings.

Additional note: a broader targeted daemon run that also included `smallkhoj-daemon connect uses a computer-scoped default runtime workspace` passed the runtime assertions but failed during Windows temp-directory cleanup with `EBUSY`; the final validation used the two Codex-specific daemon tests above.

## Follow-up fix: explicit ready heartbeat projection

The third Windows validation confirmed that the Codex ACP product path now survives clean start and backend restart, including real ACP message round trips. The only remaining failure was that backend workspace status still showed `pending_start` even when the runtime had an ACP session and had already replied to marker messages.

Change made:

- When a daemon-managed runtime transitions to ready (`markRuntimeReady`, including `codex_acp_session_ready`), the daemon now also posts an agent-scoped `/internal/agent-api/heartbeat` with:
  - `workspaceId`
  - `workspaceStatus: "running"`
  - `sessionId`
  - `pid`
  - `cwd`

This is intentionally separate from the daemon lifecycle heartbeat. The daemon lifecycle heartbeat remains the computer-level inventory/control plane; the agent-scoped heartbeat directly projects the runtime-ready state onto the agent workspace row and avoids stale daemon lifecycle ordering from leaving a live ACP workspace in `pending_start`.

Verification:

```bash
cd agent/daemon/aaa-daemon
npm run build
```

Result: pass.

```bash
cd agent/daemon/aaa-daemon
node --test --test-name-pattern "daemon starts public Codex runtime with ACP implementation|daemon CLI rejects historical codex_cli runtime path" test/daemon-runtime.test.mjs
```

Result: 2 tests passed. The Codex ACP daemon test now asserts that the ready transition emits an agent-scoped heartbeat with `workspaceStatus: "running"` and the ACP session id.

```bash
cd agent/daemon/aaa-daemon
node --test test/proxy-wrapper.test.mjs test/codex-acp-runtime.test.mjs test/codex-acp-mvp.test.mjs
```

Result: 11 tests passed.
