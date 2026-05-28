# Runtime Slock Integration

## Scenario: Claude Runtime Uses Slock CLI, Not MCP, For Chat

### Environment Notes

This implementation was developed and verified on:

- OS: Windows
- Shell for manual commands: PowerShell and Git CMD
- Runtime: Node.js v22.14.0
- Claude Code CLI: `claude` installed under `%APPDATA%\npm`; the Windows shim delegates to `node_modules\@anthropic-ai\claude-code\bin\claude.exe`
- Path separator: `;`
- Wrapper priority target: `.slock` directory must be first in `PATH`

Windows-specific behavior observed during testing:

- PowerShell can let `claude mcp add ... -- <server args>` flags be parsed by the outer Claude command. Use Git CMD or `cmd /c "..."` for manual MCP add commands with server flags.
- Node `spawn('claude')` may not resolve the npm shim on Windows. Tests that need the real Claude executable should resolve the underlying `claude.exe` path or use shell execution intentionally.
- Node `spawnSync('slock.cmd')` needs `shell: true` on Windows. Fake-runtime tests use this to match how Claude's Bash tool reaches command shims.
- Temporary directories used by spawned Windows processes can remain locked briefly after exit. Tests should tolerate cleanup retry/failure for temp dirs only.

Future environment support must validate:

- macOS/Linux bash wrapper execution and executable bit behavior.
- WSL path conversion between Windows paths and Linux paths if Claude runs under WSL.
- PATH separator and command resolution for `slock`, `slock.cmd`, and `slock.ps1`.
- Claude CLI location and whether npm shims are resolved by `spawn`.
- Shell quoting for `claude mcp add ... -- <server args>`.

### 1. Scope / Trigger

- Trigger: daemon/runtime integration for Claude Code, local HTTP proxy, generated `slock` wrapper, and MCP compatibility bridge.
- This is an infra and cross-boundary contract: Claude Code process -> `slock` CLI wrapper -> local proxy -> Slock API, with MCP used only for runtime compatibility actions.

### 2. Signatures

- CLI entry: `slock message check|send|read|search|react`, `slock channel members|join|leave`, `slock server info`, `slock task list|create|claim|update`, `slock profile get|update`, `slock integration list|login`, `slock reminder list|create|update|delete`, `slock attachment download|upload`
- Daemon runtime flags:
  - `aaa-daemon start --runtime none` (default)
  - `aaa-daemon start --runtime claude`
  - `aaa-daemon start --import-slock-runtime <runtimeDir>`
  - `aaa-daemon start --runtime-command <command>`
  - `aaa-daemon start --runtime-command-arg <arg>` (repeatable)
  - `aaa-daemon start --runtime-model <model>`
- Wrapper outputs: `.slock/slock`, `.slock/slock.cmd`, `.slock/slock.ps1`
- Token file: `~/.slock/agent-proxy-tokens/{agentId}/{launchId}.token`
- MCP entry: `chat-bridge.js --agent-id <id> --server-url <url> --auth-token <token> --runtime claude --runtime-actions-only`
- MCP tool: `runtime_profile_migration_done({ migration_key?: string })`
- Existing runtime import entry: `aaa-daemon smoke --import-slock-runtime <runtimeDir>`

### 3. Contracts

- `slock` wrapper must set:
  - `SLOCK_AGENT_PROXY_URL`
  - `SLOCK_AGENT_PROXY_TOKEN_FILE`
  - `SLOCK_AGENT_ACTIVE_CAPABILITIES`
  - `SLOCK_AGENT_ID`
  - `SLOCK_SERVER_URL`
  - `SLOCK_CURRENT_WORKSPACE_PATH`
- `slock` CLI must authenticate local proxy requests with `Authorization: Bearer {sap_token}` read from `SLOCK_AGENT_PROXY_TOKEN_FILE`.
- Proxy path rewriting must preserve query strings:
  - `/internal/agent/{agentId}/receive?limit=10` -> `/internal/agent-api/events?limit=10&since=latest`
  - `/internal/agent/{agentId}/history?channel=%23general` -> `/internal/agent-api/history?channel=%23general`
- Claude runtime env must prepend the wrapper directory to `PATH`, but must not expose proxy secret env vars directly to Claude:
  - remove `SLOCK_AGENT_TOKEN`
  - remove `SLOCK_AGENT_PROXY_URL`
  - remove `SLOCK_AGENT_PROXY_TOKEN`
  - remove `SLOCK_AGENT_PROXY_TOKEN_FILE`
  - remove `SLOCK_AGENT_ACTIVE_CAPABILITIES`
- Daemon must start Claude runtime only when `--runtime claude` is explicitly set. Default daemon startup must not spawn a model process.
- Runtime command args supplied by `--runtime-command-arg` are placed before daemon-managed Claude args. This supports tests such as `node fake-claude.mjs ...managed args...`.
- MCP stdout must contain only MCP JSON-RPC frames. Logs must go to stderr or a log file.
- `claude-mcp-config.json --auth-token` is the chat bridge machine token, not an agent-api credential. Do not use it as the upstream token for `/internal/agent-api/*` calls against `https://api.slock.ai`; the server rejects that path with `invalid_principal`.
- When importing an already-running Slock runtime, prefer the managed local proxy from `.slock/slock.cmd`:
  - parse `SLOCK_AGENT_PROXY_URL`
  - parse `SLOCK_AGENT_PROXY_TOKEN_FILE`
  - read the `sap_*` token from that file
  - keep the MCP config token only as `mcpCredential`, not as the direct agent-api token
- A chained read-only smoke is valid for local verification: aaa CLI -> aaa local proxy -> original Slock local proxy -> Slock API. This verifies real communication without sending messages or requiring a raw `sk_agent_*` credential.
- `aaa-daemon start --import-slock-runtime <runtimeDir> --runtime claude` must load the imported runtime credential before proxy registration, then generate an aaa wrapper for the managed Claude process. The Claude process must call the aaa wrapper, not the original runtime wrapper directly.
- Read-only CLI commands must stay GET-only:
  - `message search --query <q> [--channel <target>] [--limit <n>]` -> `/search?q=...`
  - `channel members --channel <target>` -> `/channel-members?channel=...`
  - `profile get [--handle <handle>]` -> `/profile` or `/profile/{handle}`
  - `integration list` -> `/integrations`
  - `reminder list` -> `/reminders`
- Write-capable CLI commands must require explicit opt-in before making local proxy requests:
  - `SLOCK_ALLOW_WRITES=1` or `AAA_DAEMON_ALLOW_WRITES=1`
  - optional target guard: `SLOCK_WRITE_TARGET_ALLOWLIST` or `AAA_DAEMON_WRITE_TARGET_ALLOWLIST`
- Attachment upload currently forwards metadata (`path`, `name`, `contentType`, `size`) to `/attachments`; real binary/multipart upload still needs upstream validation before large-file use.

### 4. Validation & Error Matrix

- Missing `SLOCK_AGENT_PROXY_URL` -> CLI exits non-zero with JSON error code `MISSING_SLOCK_AGENT_PROXY_URL`.
- Missing `SLOCK_AGENT_PROXY_TOKEN_FILE` -> CLI exits non-zero with JSON error code `MISSING_SLOCK_AGENT_PROXY_TOKEN_FILE`.
- Unreadable token file -> CLI exits non-zero with JSON error code `TOKEN_READ_FAILED`.
- Missing `--target` for `slock message send` -> CLI exits non-zero with JSON error code `MISSING_TARGET`.
- Missing send content -> CLI exits non-zero with JSON error code `MISSING_CONTENT`.
- Missing `--query` for `slock message search` -> CLI exits non-zero with JSON error code `MISSING_QUERY`.
- Missing `--channel` for `slock channel members` -> CLI exits non-zero with JSON error code `MISSING_CHANNEL`.
- Missing write opt-in for write-capable commands -> CLI exits non-zero with JSON error code `WRITES_NOT_ALLOWED`.
- Target rejected by write allowlist -> CLI exits non-zero with JSON error code `WRITE_TARGET_NOT_ALLOWED`.
- Invalid local proxy token -> proxy returns HTTP 401 JSON error `invalid_agent_proxy_token`.
- Imported MCP `--auth-token` used as direct agent-api bearer token -> upstream may return `invalid_principal`; fix by importing managed proxy credentials or minting a self-managed `sk_agent_*` profile.
- MCP `tools/list` must list only `runtime_profile_migration_done` for the compatibility bridge.

### 5. Good/Base/Bad Cases

- Good: Claude Code calls `slock message send --target "#general"` with content on stdin; wrapper injects proxy env; CLI posts to `/internal/agent/{agentId}/send`; proxy rewrites to `/internal/agent-api/send`.
- Base: `slock message check --limit 10` maps to `/internal/agent/{agentId}/receive?limit=10`; proxy rewrites to `/internal/agent-api/events?limit=10&since=latest`.
- Base: `aaa-daemon smoke --import-slock-runtime <runtimeDir>` reads `.slock/slock.cmd`, chains through the existing managed proxy, and calls only `server info`.
- Base: `aaa-daemon start --import-slock-runtime <runtimeDir> --runtime claude` starts a managed Claude runtime whose first `slock server info` call reaches the imported managed proxy.
- Bad: implementing `message.send`, `message.check`, or task operations as MCP tools. This diverges from the Slock runtime contract and breaks Claude Code compatibility expectations.
- Bad: treating `claude-mcp-config.json --auth-token` as an agent API key for direct `/internal/agent-api/*` requests.
- Bad: adding write-capable CLI operations such as task claim/update, channel join/leave, profile update, reactions, or reminders create/update without explicit tests and safety gates.

### 6. Tests Required

- Unit test `rewriteAgentPath`:
  - preserves query strings for `history`, `search`, `tasks`, and attachment paths
  - adds `since=latest` for `/receive` when not supplied
- Unit test wrapper generation:
  - creates all platform wrappers
  - writes proxy token file under the agent token directory
  - wrappers contain the expected proxy and agent env keys
- CLI integration test with a local fake HTTP server:
  - `slock message send` posts JSON body with `target` and `content`
  - request includes `Authorization: Bearer {sap_token}`
  - `slock message check` calls `/internal/agent/{agentId}/receive?...`
- MCP compatibility test:
  - SDK client can connect to `chat-bridge.js`
  - `tools/list` returns only `runtime_profile_migration_done`
  - `tools/call` returns a text no-op response
- Daemon runtime E2E test:
  - start `aaa-daemon start --runtime claude` with a fake runtime command
  - fake runtime calls `slock server info`
  - fake runtime calls `slock message send --target "#general" ...`
  - assert the fake runtime sees `.slock` at the head of `PATH`
  - assert the fake Slock API receives `/internal/agent-api/server`
  - assert the fake Slock API receives `/internal/agent-api/send` with target/content body
- Claude Code health check:
  - `claude mcp get <chat-bridge-name>` reports `Connected`
- Runtime import tests:
  - `importSlockRuntime` falls back to MCP config when no wrapper exists
  - `importSlockRuntime` prefers wrapper proxy URL/token file when `.slock/slock.cmd` exists
  - read-only smoke against an imported managed proxy sends `Authorization: Bearer {sap_token}` to the imported proxy and calls only `/internal/agent-api/server`
  - daemon start with `--import-slock-runtime` and a fake Claude runtime calls only `slock server info` and reaches the imported managed proxy
- Read-only CLI tests:
  - assert `message search`, `channel members`, `profile get`, `integration list`, and `reminder list` route to expected GET endpoints
  - assert no read-only CLI command posts a request body

### 7. Wrong vs Correct

#### Wrong

```typescript
// Do not route chat through MCP tools.
server.registerTool('message_send', {}, async () => {
  // sends chat messages
});
```

#### Correct

```typescript
// MCP is only a compatibility bridge.
server.registerTool('runtime_profile_migration_done', {
  inputSchema: { migration_key: z.string().optional() },
}, async () => ({
  content: [{ type: 'text', text: 'Runtime profile migration is no longer required.' }],
}));
```

```bash
# Chat communication goes through slock CLI.
slock message send --target "#general" <<'SLOCKMSG'
hello
SLOCKMSG
```
