# aaa-daemon v0.2.0

Minimal Slock agent daemon prototype for Claude Code runtime integration.

The current architecture follows the real Slock daemon direction:

- Chat and task communication goes through the `slock` CLI.
- `slock` talks to a local HTTP proxy with a `sap_*` proxy token.
- The local proxy rewrites `/internal/agent/{agentId}/...` paths to `/internal/agent-api/...`.
- MCP is only a compatibility bridge and exposes the no-op `runtime_profile_migration_done` tool.
- Claude Code is started only when `--runtime claude` is explicitly set.

## Layout

```text
src/cmd/main.ts              CLI entry: start / attach / status / stop / smoke
src/cmd/smoke.ts             read-only smoke test against imported Slock runtime
src/daemon/daemon.ts         lifecycle orchestration, proxy registration, runtime spawn
src/proxy/agent-proxy.ts     local HTTP proxy, bearer auth, path rewrite, response buffering
src/runtime/                 Claude runtime, .slock wrapper generation, runtime import
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
- `slock channel members --channel target`
- `slock task list [--channel target]`
- `slock profile get [--handle @name]`
- `slock integration list`
- `slock reminder list`

Write-capable operations other than `message send` are intentionally not implemented yet. That includes task claim/update, channel join/leave, reactions, profile update, reminder create/update/delete, and attachment upload.

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
