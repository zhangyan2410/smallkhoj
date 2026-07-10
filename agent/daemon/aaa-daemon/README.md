# aaa-daemon v0.2.1

Minimal Slock agent daemon prototype for Claude Code runtime integration.

The current architecture follows the real Slock daemon direction:

- Chat and task communication goes through the `slock` CLI.
- `slock` talks to a local HTTP proxy with a `sap_*` proxy token.
- The local proxy rewrites `/internal/agent/{agentId}/...` paths to `/internal/agent-api/...`.
- MCP is only a compatibility bridge and exposes the no-op `runtime_profile_migration_done` tool.
- Claude Code is started only when `--runtime claude` is explicitly set.
- Codex CLI can be started as the same daemon-managed runtime boundary with `--runtime codex`.

## Layout

```text
src/cmd/main.ts              CLI entry: start / attach / status / stop / smoke
src/cmd/smoke.ts             read-only smoke test against imported Slock runtime
src/daemon/daemon.ts         lifecycle orchestration, proxy registration, runtime spawn
src/proxy/agent-proxy.ts     local HTTP proxy, bearer auth, path rewrite, response buffering
src/runtime/                 Claude/Codex runtime drivers, .slock wrapper generation, runtime import
src/slock-cli.ts             minimal agent-facing slock CLI
src/chat-bridge.ts           MCP compatibility server for Claude Code
src/mcp-bridge.ts            daemon JSON-RPC MCP bridge prototype
test/                        Node test runner integration and E2E tests
```

## Commands

```powershell
npm install
npm run build
npm test
```

Start the daemon in foreground without a model runtime:

```powershell
node dist/cmd/main.js start --foreground
```

Start Claude Code through aaa-daemon:

```powershell
node dist/cmd/main.js start --foreground --runtime claude
```

Start Codex CLI through aaa-daemon:

```powershell
node dist/cmd/main.js start --foreground --runtime codex
```

Codex currently uses `codex exec --json` per delivered daemon event. It still runs inside the agent workspace with the generated `.slock` wrapper first in `PATH`, and user-visible communication must go through `slock message send`.

Start the daemon against the local smallkhoj FastAPI backend and its daemon WebSocket:

```powershell
node dist/cmd/main.js start --foreground --runtime none --server http://127.0.0.1:8000 --ws auto --agent-id aaaa0000-0000-0000-0000-000000000001 --proxy-port 3457
```

This generates a local `.slock/slock` wrapper. Read calls work directly:

```powershell
.slock/slock server info
.slock/slock message check
.slock/slock task list --channel "#all"
```

Write calls require the normal safety gate:

```powershell
$env:SLOCK_ALLOW_WRITES = "1"
.slock/slock message send --target "#all" "hello from local daemon"
.slock/slock task create --channel "#all" --title "example task"
.slock/slock task claim --channel "#all" --number 2
.slock/slock task update --channel "#all" --number 2 --status done
```

Daemon-managed runtimes also default to fail-closed for writes. Starting the daemon with a connect or machine token does not automatically enable write-capable wrapper commands; use `SLOCK_ALLOW_WRITES=1` / `AAA_DAEMON_ALLOW_WRITES=1`, or pass `--allow-writes` explicitly. Add `SLOCK_WRITE_TARGET_ALLOWLIST`, `AAA_DAEMON_WRITE_TARGET_ALLOWLIST`, or `--write-target-allowlist "#all,dm:@owner"` to constrain allowed targets.

Import an existing Slock runtime and start Claude Code through aaa-daemon:

```powershell
node dist/cmd/main.js start --foreground --runtime claude --import-slock-runtime "C:\Users\<you>\.slock\agents\<agent-id>\.slock"
```

Run a read-only smoke test against an existing Slock runtime:

```powershell
node dist/cmd/main.js smoke --import-slock-runtime "C:\Users\<you>\.slock\agents\<agent-id>\.slock"
```

The smoke command calls only `slock server info`. It does not send messages.

## Supported `slock` CLI

Implemented commands:

- `slock server info`
- `slock message check [--limit n]`
- `slock message read [--channel target] [--limit n]`
- `slock message search --query text [--channel target] [--limit n]`
- `slock message send --target target [content]`
- `slock message react --message-id id --reaction value [--remove]`
- `slock channel members "target"` (legacy aliases: `--channel`, `--target`, `-c`)
- `slock channel join --channel target`
- `slock channel leave --channel target`
- `slock task list [--channel target]`
- `slock task create --channel target --title title`
- `slock task claim --channel target --number n`
- `slock task update --channel target --number n --status status`
- `slock profile get [--handle @name]`
- `slock profile update [--display-name name] [--description text] [--avatar-file path]`
- `slock integration list`
- `slock integration login --service name [--scope scope]`
- `slock reminder list`
- `slock reminder schedule --title text --fire-at iso [--channel target]` (alias: `create`)
- `slock reminder update --id id [--fire-at iso] [--title text]`
- `slock reminder cancel --id id` (aliases: `delete`, `remove`)
- `slock attachment view id --output path` (compatibility alias: `download`)
- `slock attachment upload --channel target --path path [--mime-type type]`

Write-capable operations require `SLOCK_ALLOW_WRITES=1` or `AAA_DAEMON_ALLOW_WRITES=1`. They can also be constrained with `SLOCK_WRITE_TARGET_ALLOWLIST` or `AAA_DAEMON_WRITE_TARGET_ALLOWLIST`.

Attachment upload sends multipart form data through the local proxy after resolving the target channel. Real writes still require the safety gate above.

## Runtime Import

`--import-slock-runtime <runtimeDir>` reads:

- `<runtimeDir>/claude-mcp-config.json` for agent ID and public server URL.
- `<runtimeDir>/slock.cmd` for `SLOCK_AGENT_PROXY_URL` and `SLOCK_AGENT_PROXY_TOKEN_FILE` when present.

When a managed proxy is present, aaa-daemon uses the imported local proxy as its upstream:

```text
Claude Code -> aaa .slock wrapper -> aaa local proxy -> original Slock local proxy -> Slock API
```

This is the currently validated path for real communication without requiring a raw `sk_agent_*` credential.

Important: `claude-mcp-config.json --auth-token` is a chat bridge machine token, not an agent API credential for `/internal/agent-api/*`. Using it directly against `https://api.slock.ai` returns `invalid_principal`.

## MCP Bridge

`aaa-chat-bridge` is a standard MCP stdio server. It intentionally exposes only:

- `runtime_profile_migration_done`

Do not add message, task, or channel tools to MCP. Claude Code should use the `slock` CLI for those operations.

## Validation

Current local validation:

```powershell
npm test
```

For the local smallkhoj backend mode, the validated path is:

```text
worker runtime -> .slock/slock wrapper -> aaa local proxy -> smallkhoj FastAPI /internal/agent-api/*
```

The backend must receive `X-Agent-Id` from the proxy and a valid bearer token. The local seed creates `sk_agent_aaa_local`, `sk_agent_deepseek_local`, and `sk_machine_local`; local backend runs can set `SLOCK_AGENT_TOKEN=sk_machine_local` or the matching agent token. Add `--register-daemon` when the daemon should register its computer/workspace lifecycle with `/internal/agent-api/daemon/register` and `/internal/agent-api/daemon/heartbeat`. `slock message check` maps to `/internal/agent-api/events?since=latest`; the first call advances the cursor without replaying old messages, then later calls return new messages.

Example local backend run:

```bash
SLOCK_AGENT_TOKEN=sk_machine_local \
node dist/cmd/main.js start --foreground \
  --runtime none \
  --server http://127.0.0.1:8000 \
  --ws auto \
  --agent-id aaaa0000-0000-0000-0000-000000000001 \
  --register-daemon
```

The test suite covers:

- proxy path rewrite and token injection
- wrapper generation
- MCP compatibility tool list/call
- `slock` CLI command routing
- daemon runtime E2E with fake Claude
- `start --import-slock-runtime` E2E proving the Claude child process can call `slock server info`
- read-only smoke import behavior

There is also a real Claude E2E script:

```powershell
npm run test:claude-e2e
```

That script may invoke the real Claude Code CLI/model and should not be part of default tests.
