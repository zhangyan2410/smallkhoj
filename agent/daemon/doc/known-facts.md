# Known Facts

This file records facts discovered while implementing and validating `aaa-daemon`. It is intentionally factual and should be updated when a fact is disproven.

## Current Date Of These Notes

2026-05-28.

## Validated Environments

- OS: Windows.
- Shells used: PowerShell and Git CMD.
- Node.js: v22.14.0.
- Claude Code CLI is available as `claude` through npm on this machine.
- Windows `PATH` separator is `;`.
- `slock.cmd` invoked from Node tests needs `shell: true`.
- OS: macOS.
- Shell used: zsh.
- Node.js: v22.14.0.
- macOS `PATH` separator is `:`.

## Slock Communication Facts

- Chat communication goes through the `slock` CLI, not MCP tools.
- The MCP chat bridge is only a compatibility stdio server.
- The only MCP tool currently exposed by the chat bridge is `runtime_profile_migration_done`.
- `slock` CLI requests must go through a local proxy using a `sap_*` local proxy token.
- The local proxy rewrites `/internal/agent/{agentId}/...` to `/internal/agent-api/...`.
- The proxy injects upstream `Authorization`, `X-Agent-Id`, `X-Slock-Client`, and `X-Slock-Agent-Active-Capabilities`.

## Runtime Import Facts

- Existing Slock runtime directories contain `claude-mcp-config.json`.
- On Windows, an existing runtime can also contain `.slock/slock.cmd` with `SLOCK_AGENT_PROXY_URL` and `SLOCK_AGENT_PROXY_TOKEN_FILE`.
- On macOS, an existing runtime can contain `.slock/slock` with `SLOCK_AGENT_PROXY_URL` and `SLOCK_AGENT_PROXY_TOKEN_FILE`, without `claude-mcp-config.json`.
- `aaa-daemon` can import a managed proxy runtime from either Windows `slock.cmd` or macOS/Linux `slock` wrappers.
- `claude-mcp-config.json --auth-token` is a machine token for the chat bridge path. It is not a valid direct bearer token for `/internal/agent-api/*`.
- Directly using the MCP `--auth-token` against `/internal/agent-api/server` returned `invalid_principal`.
- Reading the original `slock.cmd` managed proxy settings and chaining through that proxy succeeded for read-only `server info`.
- A direct call to the original Slock `slock.cmd server info` requires `SLOCK_AGENT_ID` and `SLOCK_SERVER_URL` in the process environment. The original wrapper does not necessarily set those variables itself.
- macOS managed proxy wrapper import was validated against an existing local `.slock/slock` wrapper by confirming the source is `managed-proxy`, a proxy token file is present, the imported server URL is local, and the agent id is inferred from the runtime path.

## Validated Real Smoke

The read-only smoke command succeeded against the existing local Slock runtime:

```powershell
node dist/cmd/main.js smoke --import-slock-runtime "C:\Users\<you>\.slock\agents\<agent-id>\.slock"
```

Observed non-sensitive result shape:

```json
{
  "ok": true,
  "source": "managed-proxy",
  "serverUrl": "https://api.slock.ai",
  "channels": 2,
  "agents": 5,
  "humans": 1
}
```

The smoke command calls only `server info` and does not send a chat message.

## Implemented aaa-daemon Facts

- `aaa-daemon start` defaults to `--runtime none`.
- Claude Code is started only when `--runtime claude` is provided.
- `aaa-daemon start --import-slock-runtime <runtimeDir> --runtime claude` is implemented.
- `aaa-daemon smoke --import-slock-runtime <runtimeDir>` is implemented and read-only.
- The generated aaa wrapper directory must be first in the Claude runtime `PATH`.
- The Claude runtime environment strips raw proxy secret variables before spawn; the child gets access through the generated wrapper.
- The system prompt tells Claude to use `slock` CLI for Slock communication.

## Implemented CLI Facts

Implemented:

- `slock server info`
- `slock message check`
- `slock message read`
- `slock message search`
- `slock message send`
- `slock channel members`
- `slock task list`
- `slock profile get`
- `slock integration list`
- `slock reminder list`

Not implemented:

- task claim/update/create
- channel join/leave
- reactions
- attachment upload/download CLI
- profile update
- integration login
- reminder create/update/delete

## Test Facts

- `npm test` currently builds TypeScript and runs Node's built-in test runner.
- The suite includes daemon runtime E2E with fake Claude.
- The suite includes `start --import-slock-runtime` E2E where a fake Claude child process calls `slock server info`.
- The suite includes Windows `slock.cmd` managed-proxy import with and without `claude-mcp-config.json`.
- The suite includes macOS/Linux `slock` managed-proxy import with and without `claude-mcp-config.json`.
- The real Claude E2E script exists but is not part of default tests because it may call the real Claude CLI/model.

## Open Risks

- Real `message send` against Slock should remain behind an explicit opt-in test flag and target.
- WSL path conversion has not been validated.
- Real Claude Code end-to-end behavior beyond controlled fake Claude tests still needs explicit manual validation.
