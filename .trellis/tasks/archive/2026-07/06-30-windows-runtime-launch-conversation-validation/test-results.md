# Windows runtime launch and conversation validation

## Test setup

| Item | Value |
|------|-------|
| Date | 2026-06-30 |
| Test machine | SH-zhangyan04 |
| OS | Windows 10 (win32 10.0.18363 x64) |
| Shell | Git Bash |
| Node.js | v22.14.0 |
| Daemon package | `@smallkhoj/smallkhoj-daemon` v0.2.0 (built from source) |
| Repo commit tested | `4e325f1` (origin/main, includes `9bf1812` productized runtime provider detection) |
| Backend | http://124.222.40.40 (Slock Server `3893c518-c8f8-43ba-af0d-54a7773bbb6d`) |

## Commands used

```bash
# 1. Build daemon on Windows
cd agent/daemon/aaa-daemon
npm run build

# 2. Start daemon with product command path (backgrounded, logs captured)
node dist/cmd/main.js start \
  --server-url http://124.222.40.40 \
  --machine-token <sk_machine_...> \
  > windows-daemon-stdout.log 2> windows-daemon-stderr.log

# 3. Login to backend (public API) to obtain session token
curl -s -X POST http://124.222.40.40/api/v1/auth/login \
  -H 'X-Public-Key: sk_public_local' \
  -H 'Content-Type: application/json' \
  -d '{"name":"zy-ean"}'
# Response included sessionToken: sk_session_<redacted>

# 4. Create Windows-backed Claude runtime agent workspace
curl -s -X POST http://124.222.40.40/api/v1/members/agents \
  -H 'X-Public-Key: sk_public_local' \
  -H 'X-Account-Token: sk_session_<redacted>' \
  -H 'X-Server-Id: 3893c518-c8f8-43ba-af0d-54a7773bbb6d' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"win-runtime-test-20260630234426",
    "computerId":"4c9fafa5-2cd5-4dc6-b150-c6dd6d683414",
    "runtime":"claude_code",
    "autoStart":true
  }'

# 5. Verify runtime detection through the agent workspace slock CLI
cd ~/.smallkhoj/daemon/workspaces/.slock-runtimes/3893c518-c8f8-43ba-af0d-54a7773bbb6d/4c9fafa5-2cd5-4dc6-b150-c6dd6d683414/5c4a3413-7c80-45d0-be07-e726cbd5c5d4
./.slock/slock.cmd server info

# 6. Runtime sends an initial marker to the validation channel
SLOCK_ALLOW_WRITES=1 ./.slock/slock.cmd message send \
  --target '#win-runtime-validation-20260630223748' \
  'Hello from Windows claude_code runtime. Marker message sent by validation harness.'

# 7. Human sends a real marker message through the backend public API
curl -s -X POST http://124.222.40.40/api/v1/channels/win-runtime-validation-20260630223748/messages \
  -H 'X-Public-Key: sk_public_local' \
  -H 'X-Account-Token: sk_session_<redacted>' \
  -H 'X-Server-Id: 3893c518-c8f8-43ba-af0d-54a7773bbb6d' \
  -H 'Content-Type: application/json' \
  -d '{"content":"REAL_windows_runtime_20260630234426: please reply with a short acknowledgment so we can validate the conversation path."}'

# 8. Read channel history to capture the runtime reply
curl -s 'http://124.222.40.40/api/v1/channels/win-runtime-validation-20260630223748/messages?limit=25' \
  -H 'X-Public-Key: sk_public_local' \
  -H 'X-Account-Token: sk_session_<redacted>' \
  -H 'X-Server-Id: 3893c518-c8f8-43ba-af0d-54a7773bbb6d'
```

## Runtime detection

Daemon-reported detected runtimes for `SH-zhangyan04`:

```json
[
  {"type":"claude_code","status":"available"},
  {"type":"codex_cli","source":"codex-cli","status":"available","command":"codex.cmd","provider":"Codex","runtimeProvider":"codex-cli"}
]
```

- Claude Code is detected as available with no hardcoded path.
- Codex CLI (`codex.cmd`) is detected as available with explicit provider metadata.

## Conversation validation (Claude Code runtime)

Agent: `@win-runtime-test-20260630234426`  
Workspace: `5c4a3413-7c80-45d0-be07-e726cbd5c5d4`  
Runtime process: `claude_code` started by the daemon, pid `23952`.

| Seq | Sender | Short id | Content excerpt |
|-----|--------|----------|-----------------|
| 10 | `@win-runtime-test-20260630234426` | `c7a6d928` | `Hello from Windows claude_code runtime. Marker message sent by validation harness.` |
| 12 | `@zy-ean` | `945eb57b` | `REAL_windows_runtime_20260630234426: please reply with a short acknowledgment so we can validate the conversation path.` |
| 14 | `@win-runtime-test-20260630234426` | `3e1afdc6` | `Acknowledged — REAL_windows_runtime_20260630234426. This is win-runtime-test-20260630234426 replying live from the Windows claude_code runtime on SH-zhangyan04. Conversation path validated: message received and round-trip reply working. Standing by for any further steps.` |

The runtime received the marker sent through the SmallKhoj backend public API and replied back into the same channel through the Slock CLI proxy. Round-trip confirmed.

## Codex ACP runtime attempt

Because the product runtime is `codex`, a Codex runtime was also attempted through the same product/backend path. Product direction after review: Codex should use ACP, not the historical native CLI path.

Create command:

```bash
curl -s -X POST http://124.222.40.40/api/v1/members/agents \
  -H 'X-Public-Key: sk_public_local' \
  -H 'X-Account-Token: sk_session_<redacted>' \
  -H 'X-Server-Id: 3893c518-c8f8-43ba-af0d-54a7773bbb6d' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"win-codex-test-20260630234426",
    "computerId":"4c9fafa5-2cd5-4dc6-b150-c6dd6d683414",
    "runtime":"codex",
    "autoStart":true
  }'
```

Result: the backend created a workspace with runtime `codex`, but the daemon launched it as Codex ACP and immediately failed:

```text
[Daemon] codex runtime b2e9d16c-d51f-4a70-9cf4-e8da307e6df7 stderr: Codex ACP Slock prompt written to ...\5edfbec0-f585-4210-a199-9aaa0799e292\.slock\codex-acp-slock-prompt.md
[Daemon] codex runtime started for agent b2e9d16c-d51f-4a70-9cf4-e8da307e6df7: pid=unknown
[Daemon] codex runtime b2e9d16c-d51f-4a70-9cf4-e8da307e6df7 error: spawn npx ENOENT
[Daemon] codex runtime b2e9d16c-d51f-4a70-9cf4-e8da307e6df7 error: ACP connection closed
```

Direct attempt to request the historical `runtime="codex_cli"` / `runtimeProvider="codex-cli"` through `/api/v1/members/agents` was rejected by the backend:

```text
Runtime provider codex-cli is not available for codex on this computer
```

Review correction: this should not be fixed by restoring the native Codex CLI product path. The correct follow-up is to make the `runtime="codex"` ACP launch reliable on Windows and remove or clearly supersede the historical `codex_cli` product path.

## Daemon log inspection

Checked `windows-daemon-stdout.log` and `windows-daemon-stderr.log` for the forbidden patterns required by the acceptance criteria:

- `cc-switch.ps1` — not found
- `ccs-claude` — not found
- hardcoded `/Users/lee/...` — not found
- `spawn claude ENOENT` / `spawn codex ENOENT` — not found for the Claude runtime
- misleading `pid=unknown` on successful startup — not found for the Claude runtime

The only `pid=unknown` / `spawn npx ENOENT` occurrences are from the Codex ACP failure above, which is captured as a startup failure.

## Pass/fail matrix

| Acceptance criterion | Result | Notes |
|----------------------|--------|-------|
| Windows test machine identified in `test-results.md` | Pass | See Test setup table |
| Daemon connect/register succeeds on Windows using normal product command path | Pass | Computer `SH-zhangyan04` online, daemon v0.2.0 |
| Runtime inventory reports local Claude Code command | Pass | Detected as `claude_code` available |
| Runtime inventory reports local Codex command | Pass, legacy diagnostic | Detected as `codex_cli` / `codex.cmd` available, but product Codex should use ACP |
| `claude_code` managed runtime starts from backend/daemon control | Pass | Runtime pid 23952, status running |
| Runtime receives real SmallKhoj/Slock message and replies | Pass | Marker seq 12, reply seq 14 |
| Logs free of implicit scripts/hardcoded paths/late ENOENT | Pass for Claude | Codex failure captured separately |
| Runtime startup failures captured with log excerpt and fix note | Pass | Codex ACP `spawn npx ENOENT` and backend provider mismatch documented |
| Codex runtime startup and conversation | Fail | Product/backend path uses ACP but Windows launch failed at `spawn npx ENOENT` |

## Remaining fixes

1. **Codex ACP Windows launch**: ensure the Windows daemon resolves the ACP launcher deterministically (`npx.cmd` or another explicit ACP command strategy) instead of failing with `spawn npx ENOENT`.
2. **Legacy CLI cleanup**: remove or supersede the historical native `codex_cli` product path and update backend/frontend/tests/docs so future work does not treat CLI as the desired Codex integration.
