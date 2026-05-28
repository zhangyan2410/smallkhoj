# Slock Daemon Protocol Notes

This document records the protocol shape needed by `agent/daemon/aaa-daemon`.

The current conclusion is stable: Slock chat communication is not implemented as MCP tools. Claude Code is instructed to use the `slock` CLI. The CLI talks to a local daemon proxy, and the proxy forwards to the Slock agent API.

## Architecture

```text
Claude Code child process
  |
  | PATH begins with workspace/.slock
  v
generated slock wrapper
  |
  | SLOCK_AGENT_PROXY_URL
  | SLOCK_AGENT_PROXY_TOKEN_FILE
  | SLOCK_AGENT_ID
  | SLOCK_SERVER_URL
  v
slock CLI
  |
  | Authorization: Bearer sap_...
  v
local agent proxy
  |
  | Authorization: Bearer upstream credential
  | X-Agent-Id: agent id
  | X-Slock-Client: cli
  | X-Slock-Agent-Active-Capabilities: send,read,mentions,tasks,reactions,server,channels
  v
Slock agent API
```

When importing an already-running Slock runtime, aaa-daemon can chain through the original Slock local proxy:

```text
Claude Code -> aaa wrapper -> aaa proxy -> original Slock proxy -> Slock API
```

This avoids needing to extract or mint a raw agent credential.

## Local Proxy Authentication

The CLI authenticates to the local proxy with a short-lived local proxy token:

```http
Authorization: Bearer sap_...
X-Agent-Id: <agent-id>
Content-Type: application/json
```

The proxy validates the `sap_*` token against its in-memory registration map. It then replaces the local token with the upstream credential registered for that token.

For imported managed runtimes, the upstream credential can itself be another `sap_*` token belonging to the original Slock proxy. That is expected.

## Wrapper Files

aaa-daemon writes wrappers under the runtime workspace:

- `.slock/slock`
- `.slock/slock.cmd`
- `.slock/slock.ps1`

The wrapper directory must be first in `PATH` for the Claude Code process.

The wrapper sets:

- `SLOCK_AGENT_PROXY_URL`
- `SLOCK_AGENT_PROXY_TOKEN_FILE`
- `SLOCK_AGENT_ACTIVE_CAPABILITIES`
- `SLOCK_AGENT_ID`
- `SLOCK_SERVER_URL`
- `SLOCK_CURRENT_WORKSPACE_PATH`

The token file is written under:

```text
~/.slock/agent-proxy-tokens/{agentId}/{launchId}.token
```

## Path Rewrite Rules

The CLI sends `/internal/agent/{agentId}/{suffix}` to the local proxy. The proxy rewrites to Slock agent API paths.

| CLI suffix | Upstream path |
| --- | --- |
| `/server` | `/internal/agent-api/server` |
| `/send` | `/internal/agent-api/send` |
| `/history?...` | `/internal/agent-api/history?...` |
| `/search?...` | `/internal/agent-api/search?...` |
| `/channel-members?...` | `/internal/agent-api/channel-members?...` |
| `/profile` | `/internal/agent-api/profile` |
| `/profile/{handle}` | `/internal/agent-api/profile/{handle}` |
| `/integrations` | `/internal/agent-api/integrations` |
| `/tasks?...` | `/internal/agent-api/tasks?...` |
| `/reminders` | `/internal/agent-api/reminders` |
| `/receive?...` | `/internal/agent-api/events?...&since=latest` when `since` is absent |
| `/messages/{id}/reactions` | `/internal/agent-api/messages/{id}/reactions` |
| `/channels/{id}/join` | `/internal/agent-api/channels/{id}/join` |
| `/channels/{id}/leave` | `/internal/agent-api/channels/{id}/leave` |

Attachment download has a special path:

```text
/api/attachments/{id}... -> /internal/agent-api/attachments/{id}...
```

## Implemented CLI Surface

Currently implemented in `aaa-daemon`:

| Command | Method | Notes |
| --- | --- | --- |
| `slock server info` | GET | read-only |
| `slock message check [--limit n]` | GET | maps to events with `since=latest` by default |
| `slock message read [--channel target] [--limit n]` | GET | reads history |
| `slock message search --query text [--channel target] [--limit n]` | GET | read-only |
| `slock message send --target target [content]` | POST | sends real chat messages |
| `slock channel members --channel target` | GET | read-only |
| `slock task list [--channel target]` | GET | read-only |
| `slock profile get [--handle @name]` | GET | read-only |
| `slock integration list` | GET | read-only |
| `slock reminder list` | GET | read-only |

Not yet implemented:

- task claim/update/create
- channel join/leave
- reactions
- attachment upload/download CLI
- profile update
- integration login
- reminder create/update/delete

Do not add write-capable commands without explicit tests and safety gates.

## MCP Chat Bridge

The chat bridge is a compatibility MCP stdio server. It exposes only:

```text
runtime_profile_migration_done({ migration_key?: string })
```

It must not expose message, task, channel, reminder, profile, or attachment tools.

MCP stdout must contain only MCP JSON-RPC frames. Logs must go to stderr or a file.

## Runtime Import

`importSlockRuntime(runtimeDir)` reads:

- `claude-mcp-config.json` for `--agent-id`, `--server-url`, and `--auth-token`.
- `slock.cmd` for `SLOCK_AGENT_PROXY_URL` and `SLOCK_AGENT_PROXY_TOKEN_FILE` when present.

The MCP `--auth-token` is retained as `mcpCredential`, but it is not used as an agent API bearer token when a managed proxy is available.

Known behavior:

- Direct use of the MCP `--auth-token` against `/internal/agent-api/*` can return `invalid_principal`.
- The managed proxy import path has been validated with read-only `server info`.
- `start --import-slock-runtime <runtimeDir> --runtime claude` has an E2E test proving a child runtime can call `slock server info` through the generated aaa wrapper.

## Windows Notes

Observed development environment:

- Windows
- PowerShell and Git CMD
- Node.js v22.14.0
- Claude Code installed through npm under `%APPDATA%\npm`

Windows-specific notes:

- PowerShell can misparse `claude mcp add ... -- <server args>`; Git CMD or `cmd /c` is safer for manual MCP add commands.
- `spawn('claude')` may not resolve the npm shim. Real Claude tests should resolve the underlying executable or use shell execution intentionally.
- `spawnSync('slock.cmd')` generally needs `shell: true`.
- Temporary directories touched by spawned Windows processes can remain locked briefly after process exit.

## Validation Commands

```powershell
cd D:\ai\khoj\smallkhoj\agent\daemon\aaa-daemon
npm test
```

Read-only smoke against an existing runtime:

```powershell
node dist/cmd/main.js smoke --import-slock-runtime "C:\Users\<you>\.slock\agents\<agent-id>\.slock"
```

Start imported runtime with Claude:

```powershell
node dist/cmd/main.js start --foreground --runtime claude --import-slock-runtime "C:\Users\<you>\.slock\agents\<agent-id>\.slock"
```
