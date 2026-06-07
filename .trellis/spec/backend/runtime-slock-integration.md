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

- CLI entry: `slock message check|send|read|search|react`, `slock channel members|join|leave`, `slock server info`, `slock task list|create|claim|update`, `slock profile get|update`, `slock integration list|login`, `slock reminder list|schedule|create|update|cancel|delete`, `slock attachment view|download|upload`
- Daemon runtime flags:
  - `aaa-daemon start --runtime none` (default)
  - `aaa-daemon start --runtime claude`
  - `aaa-daemon start --import-slock-runtime <runtimeDir>`
  - `aaa-daemon start --runtime-command <command>`
  - `aaa-daemon start --runtime-command-arg <arg>` (repeatable)
  - `aaa-daemon start --runtime-model <model>`
  - `aaa-daemon start --runtime-resume-session-id <id>`
  - `aaa-daemon start --runtime-restart-on-crash`
  - `aaa-daemon start --runtime-stall-timeout-ms <ms>`
- Daemon attach entry:
  - `aaa-daemon attach --target <proxyUrl>`
  - local HTTP endpoint: `POST /internal/daemon/jsonrpc`
- Wrapper outputs: `.slock/slock`, `.slock/slock.cmd`, `.slock/slock.ps1`
- Claude system prompt file: `.slock/claude-system-prompt.md`, rewritten immediately before each managed Claude launch
- Token file: `~/.slock/agent-proxy-tokens/{agentId}/{launchId}.token`
- MCP entry: `chat-bridge.js --agent-id <id> --server-url <url> --auth-token <token> --runtime claude --runtime-actions-only`
- MCP tool: `runtime_profile_migration_done({ migration_key?: string })`
- Existing runtime import entry: `aaa-daemon smoke --import-slock-runtime <runtimeDir>`
- Daemon control endpoints:
  - `POST /internal/agent-api/daemon/register`
  - `POST /internal/agent-api/daemon/heartbeat`
  - `GET /internal/agent-api/events?since=latest`
  - `WS /internal/agent-api/ws`
- Runtime control command envelope:
  - Raw/control event: `{type:"control", command:{type:"start_runtime"|"stop_runtime"|"restart_runtime", agentId, workspaceId?, config?}}`
  - JSON-RPC control notification: `{jsonrpc:"2.0", method:"daemon.command.start_runtime"|"daemon.command.stop_runtime"|"daemon.command.restart_runtime", params:{agent_id|agentId, workspace_id|workspaceId?, config?}}`
  - `config.runtime`: currently `claude_code`
  - `config.runtimeCommand?: string`
  - `config.runtimeCommandArgs?: string[]`
  - `config.runtimeModel?: string`
  - `config.workspacePath?: string`
  - `config.workspaceId?: string`

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
  - set `FORCE_COLOR=0`
  - set `SLOCK_HOME` to the generated workspace `.slock` directory
  - set `SLOCK_AGENT_ID`
  - set `SLOCK_AGENT_LAUNCH_ID` to the launch id used for the proxy token file
  - set `SLOCK_SERVER_URL`
  - set `SLOCK_CURRENT_WORKSPACE_PATH`
  - prepend the generated `.slock` wrapper directory to `PATH`
  - remove `SLOCK_AGENT_TOKEN`
  - remove `SLOCK_AGENT_PROXY_URL`
  - remove `SLOCK_AGENT_PROXY_TOKEN`
  - remove `SLOCK_AGENT_PROXY_TOKEN_FILE`
  - remove `SLOCK_AGENT_ACTIVE_CAPABILITIES`
- Claude runtime args must use Claude Code process flags, not settings JSON, for permissions and prompt injection:
  - include `--allow-dangerously-skip-permissions`
  - include `--dangerously-skip-permissions`
  - include `--permission-mode bypassPermissions`
  - include `--output-format stream-json`
  - include `--input-format stream-json`
  - include `--disallowed-tools EnterPlanMode,ExitPlanMode,ScheduleWakeup,CronCreate,CronList,CronDelete`
  - include `--append-system-prompt-file .slock/claude-system-prompt.md`
  - do not use inline `--system-prompt` for the managed Slock prompt
- Claude runtime stdin/stdout must use stream-json JSONL protocol:
  - daemon writes one JSON object per line to stdin
  - user-message input shape is `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]},"session_id":"..."}`; omit `session_id` until Claude reports one
  - daemon parses stdout JSON lines into runtime events while preserving raw-line diagnostics
  - capture `session_id` from `system` / session-init style events when present
  - when launched with `--runtime-resume-session-id`, pass `--resume <id>` to Claude and use that session id for user-message payloads until Claude reports a newer one
  - treat `assistant` events with `tool_use` blocks as busy
  - treat matching `user` events with `tool_result` blocks as tool completion evidence
  - treat `result` events as turn boundaries where queued user messages may be flushed
- Daemon-originated message delivery:
  - WebSocket `message_received` / `message` events are normalized into a text envelope with fields such as `target=`, `msg=`, `time=`, `sender=`, `type=`
  - Backend event records use dotted canonical event names such as `message.created`, `task.created`, `task.claimed`, `task.updated`, `message.reaction_added`, and `channel.member_joined`, while also returning `legacyType` for older consumers.
  - Daemon proxy/runtime code must treat dotted `message.*` events as legacy `message_received` for inbox buffering, freshness tracking, and runtime delivery. When a dotted message event has `payload.message`, flatten that nested message before buffering.
  - Daemon proxy/runtime code must accept both snake-case task events (`task_created`) and dotted task events (`task.created`) and deliver them as non-message runtime events without touching pending-message freshness state.
  - Agent-scoped proxy `/events` and SSE responses must annotate buffered/emitted events with the registration `agentId` before normalization, unless the upstream event already includes `agentId`/`agent_id`. Multi-runtime delivery depends on this marker to avoid sending one agent's inbox item to another runtime.
  - proxy `/internal/agent-api/events` and SSE events use the same event buffer and emit the same `message_received` delivery path
  - runtime delivery calls `ClaudeRuntimeDriver.sendUserMessage()`; if Claude is busy, the runtime queue owns deferral until a safe turn boundary
- WebSocket manager must:
  - send activity payloads on connect and heartbeat (`{type:"activity",status,at}`)
  - ack recognized message events with `{type:"ack",message_id?,seq?,at}`
  - support both raw event payloads and JSON-RPC `daemon/message.received` notifications
  - support JSON-RPC dotted notifications: `message.*` maps to message delivery, and `task.*` maps to the generic event path for runtime delivery
  - support raw `control` events and JSON-RPC `daemon.command.*` / `control.*` notifications; for JSON-RPC methods, the command type comes from the method suffix and must be preserved before dispatch.
- Proxy freshness must hold stale sends:
  - sends to `/internal/agent-api/send` check `seenUpToSeq` when supplied, otherwise `readUpToSeq`
  - when pending message events have seq greater than `seenUpToSeq`, return HTTP 409 with `{state:"held",reason:"pending_messages",seenUpToSeq,pendingCount,pending}`
  - `message.check`, `/events` JSON responses, and `/history` responses advance `readUpToSeq`; SSE events are buffered but do not mark read on their own
- Attach/client JSON-RPC must use the daemon endpoint, not the agent API root:
  - attach posts one JSON-RPC object per line to `/internal/daemon/jsonrpc`
  - attach stdout must contain only JSON-RPC frames; status/log text goes to stderr
  - `ClientHandler` forwards daemon Slock methods through the local proxy with `Authorization: Bearer {sap_token}`, never with the proxy URL as a token
  - forwarded daemon methods include message, task, channel, thread, profile, integration, reminder, attachment, and knowledge read/search operations
- Runtime lifecycle:
  - daemon manages runtime instances by `agentId`; do not use a single global `ClaudeRuntimeDriver` for dynamic agents.
  - each runtime has its own proxy registration, generated `.slock` wrapper directory, token file, workspace path, captured session id, restart timer, stall watchdog, and lifecycle status.
  - dynamic `start_runtime` commands may arrive through `/daemon/register`, `/daemon/heartbeat`, polling `/events`, or `/ws`; all transports must dispatch the same parsed command object.
  - dynamic runtime workspaces must be isolated. If a command omits `workspacePath`, use a per-agent path under the daemon workspace instead of sharing the daemon root `.slock` wrapper.
  - heartbeat/register workspace payloads for active runtimes use `status:"running"` and include `workspaceId`, `runtime`, `runtimeCommand`, `runtimeModel`, `sessionId`, `cwd`, and `pid` when known.
  - explicit stops report `status:"stopped"`; unexpected exits report `status:"exited"` before the runtime record is removed, so backend state does not stay falsely running.
  - daemon records captured Claude session ids in `SessionManager`
  - runtime trace events are emitted for start, stream events, session capture, message send, exit, error, restart scheduling, and stall detection
  - `--runtime-restart-on-crash` enables one restart after unexpected Claude exit, resuming the last known session id when available
  - `--runtime-stall-timeout-ms` enables an optional watchdog; it only terminates a busy runtime when no runtime progress occurs for the configured threshold
- Daemon must start Claude runtime only when `--runtime claude` is explicitly set. Default daemon startup must not spawn a model process.
- `aaa-daemon start --ws auto` derives the backend control WebSocket from `--server` as `/internal/agent-api/ws` with `http -> ws` and `https -> wss`. Use `--ws none` to disable WebSocket and rely on register/heartbeat/polling fallback.
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
- Attachment upload resolves `--channel` through `/resolve-channel`, then forwards multipart form data (`file`, `channelId`, optional `mimeType`) to `/upload`.

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
- Pending unread messages during send -> proxy returns HTTP 409 JSON `{state:"held",reason:"pending_messages",...}` and does not call upstream send.
- Unsupported dynamic runtime in `start_runtime.config.runtime` -> daemon logs a warning and does not start a runtime.
- Control command without `agentId` -> daemon logs a warning and ignores it.
- `POST /internal/daemon/jsonrpc` with malformed JSON -> returns JSON-RPC parse error.
- `POST /internal/daemon/jsonrpc` before daemon RPC handler registration -> returns HTTP 503 `daemon_rpc_unavailable`.
- Imported MCP `--auth-token` used as direct agent-api bearer token -> upstream may return `invalid_principal`; fix by importing managed proxy credentials or minting a self-managed `sk_agent_*` profile.
- MCP `tools/list` must list only `runtime_profile_migration_done` for the compatibility bridge.

### 5. Good/Base/Bad Cases

- Good: Claude Code calls `slock message send --target "#general"` with content on stdin; wrapper injects proxy env; CLI posts to `/internal/agent/{agentId}/send`; proxy rewrites to `/internal/agent-api/send`.
- Base: `slock message check --limit 10` maps to `/internal/agent/{agentId}/receive?limit=10`; proxy rewrites to `/internal/agent-api/events?limit=10&since=latest`.
- Base: attach receives a JSON-RPC line on stdin, posts it to `/internal/daemon/jsonrpc`, and writes only the JSON-RPC response frame to stdout.
- Base: a new WebSocket or SSE message is buffered; a stale send is held until `message.check` or history consumption marks the message read.
- Base: backend returns `controlCommands` from register/heartbeat or emits a WS/polling control event; daemon starts/stops/restarts the addressed agent runtime without affecting other runtime records.
- Base: an agent-scoped `message.check` buffers events with that `agentId`, so delivery routes to the matching runtime in a 1:N daemon.
- Base: `aaa-daemon smoke --import-slock-runtime <runtimeDir>` reads `.slock/slock.cmd`, chains through the existing managed proxy, and calls only `server info`.
- Base: `aaa-daemon start --import-slock-runtime <runtimeDir> --runtime claude` starts a managed Claude runtime whose first `slock server info` call reaches the imported managed proxy.
- Bad: implementing `message.send`, `message.check`, or task operations as MCP tools. This diverges from the Slock runtime contract and breaks Claude Code compatibility expectations.
- Bad: treating `claude-mcp-config.json --auth-token` as an agent API key for direct `/internal/agent-api/*` requests.
- Bad: adding write-capable CLI operations such as task claim/update, channel join/leave, profile update, reactions, or reminders create/update without explicit tests and safety gates.
- Bad: posting attach JSON-RPC to the local agent API root; the proxy root is bearer-authenticated Slock API traffic, not the daemon control endpoint.
- Bad: using the daemon global `workspacePath/.slock` wrapper for every dynamic agent. The later runtime overwrites wrapper/token env for earlier runtimes.
- Bad: dropping `agentId` when buffering agent-scoped events. In a 1:N daemon that can misroute or skip runtime delivery.

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
  - assert `SLOCK_HOME` points to the generated workspace `.slock` directory
  - assert `SLOCK_AGENT_LAUNCH_ID` is set and matches the token launch id shape
  - assert `.slock/claude-system-prompt.md` exists and is passed through `--append-system-prompt-file`
  - assert managed runtime args do not use inline `--system-prompt`
  - assert the fake Slock API receives `/internal/agent-api/server`
  - assert the fake Slock API receives `/internal/agent-api/send` with target/content body
  - start `aaa-daemon start --runtime none --register-daemon` against a fake backend that returns `controlCommands:[start_runtime]`
  - assert the control command starts the fake Claude runtime dynamically
  - assert the dynamic runtime uses the commanded `agentId`, isolated workspace path, wrapper, and backend token
  - assert heartbeat/register reports the dynamic workspace as `runtime:"claude_code"` and `status:"running"`
- Claude stream-json unit tests:
  - parse stdout JSON lines for system/session-init, assistant/tool-use, user/tool-result, and result events
  - assert `sendUserMessage()` writes the expected JSONL stdin shape
  - assert captured `session_id` is included on later user messages
  - assert resume session id is passed via args and used before the first init event
  - assert queued messages do not flush while busy and flush at a `result` boundary
- WebSocket/message delivery tests:
  - assert raw and JSON-RPC WebSocket message events normalize to daemon message events
  - assert ack and activity payload builders preserve message id/seq where present
  - assert raw `control` payloads and JSON-RPC `daemon.command.*` payloads classify as control events and preserve command type, agent id, workspace id, and runtime config
- Proxy freshness/SSE tests:
  - assert stale sends return HTTP 409 held responses before upstream send
  - assert checking/reading messages advances `readUpToSeq` enough for a later send
  - assert SSE `/events` frames are parsed and buffered into inbox events
  - assert dotted SSE and polling `message.*` events are normalized to `message_received` buffer methods and still advance message freshness from the nested or top-level message seq
  - assert agent-scoped SSE and polling events keep the proxy registration `agentId` in emitted events and buffer params
  - assert dotted `task.*` events are buffered as task methods, delivered to runtime, and never block later sends as pending unread messages
- Attach/client-handler tests:
  - assert `postDaemonRpc` posts to `/internal/daemon/jsonrpc`
  - assert extended daemon methods use local proxy bearer auth and reach expected upstream paths
  - assert `message.check` marks buffered messages read before `message.send`
  - assert knowledge paths rewrite and forward through `/internal/agent-api/knowledge...`
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

## Scenario: One Computer One Daemon Connect Model

### 1. Scope / Trigger

- Trigger: the computer connection flow spans browser UI, public API, database identity, daemon startup, daemon-facing auth, heartbeat lease renewal, and agent workspace creation.
- The invariant is: a computer row exists only after a daemon successfully connects with a one-time ticket; one `machineId` maps to one computer per server; one computer has at most one active daemon lease.

### 2. Signatures

- `POST /api/v1/computers/connect-command`
- `POST /internal/agent-api/daemon/connect`
- `POST /internal/agent-api/daemon/register`
- `POST /internal/agent-api/daemon/heartbeat`
- `POST /api/v1/members/agents`
- `POST /api/v1/channels`
- `POST /api/v1/channels/{channel_id}/members`
- `DELETE /api/v1/channels/{channel_id}/members/{member_id}`
- `GET /api/v1/channels/{channel_id}/members`
- `POST /api/v1/dm`
- Agent send: `POST /internal/agent-api/send`

### 3. Contracts

- Public management endpoints require `X-Public-Key: sk_public_local` in local test/dev flows.
- `POST /api/v1/computers/connect-command` request:
  - `name: string`
  - `serverUrl?: string`
- `POST /api/v1/computers/connect-command` response:
  - `connectToken: string` with `sk_connect_` prefix
  - `command: string`
  - `expiresAt: iso datetime`
  - Must not include `computerId`, `apiKey`, or any `sk_machine_...` token.
- The command must contain:
  - `cd <absolute repo path>/agent/daemon/aaa-daemon`
  - `SLOCK_CONNECT_TOKEN=sk_connect_...`
  - `node dist/cmd/main.js start --foreground`
  - `--runtime none`
  - `--server ...`
  - `--ws none`
  - `--proxy-port 0`
  - `--register-daemon`
  - It must not include `--agent-id` by default and must not reference `@slock-ai/daemon`.
- Connect ticket storage:
  - `connect_tickets.token_hash` stores SHA-256 of the full connect token.
  - `connect_tickets.key_prefix` stores `token[:20]` for lookup.
  - Tickets have `requested_name`, `expires_at`, `consumed_at`, and `revoked_at`.
- `POST /internal/agent-api/daemon/connect` request:
  - Header `Authorization: Bearer sk_connect_...`
  - Body `{ daemonId?: string, machineId: string, name?: string, os?: string, daemonVersion?: string, status?: string, detectedRuntimes?: list }`
- `POST /internal/agent-api/daemon/connect` response:
  - `connected: true`
  - `daemonId: string`
  - `machineToken: string` with `sk_machine_` prefix
  - `leaseExpiresAt: iso datetime`
  - `computer: serialized Computer`
- Database identity:
  - `computers.machine_id` is the daemon-generated persistent machine UUID.
  - Unique per server when present: `(server_id, machine_id)`.
  - Computer names are unique per server.
  - Member display names are unique per server.
  - Lease fields are `active_daemon_id`, `daemon_lease_expires_at`, and `last_heartbeat_at`.
- Daemon behavior:
  - First startup creates a UUID `machineId` under `~/.slock/aaa-daemon/machine-id` unless `AAA_DAEMON_MACHINE_ID_FILE` or `SLOCK_MACHINE_ID_FILE` overrides it.
  - `SLOCK_CONNECT_TOKEN` is used only for `/daemon/connect`.
  - The returned `machineToken` is kept in memory and used for `/daemon/register`, `/daemon/heartbeat`, and agent-facing calls after a user-created agent exists.
  - Heartbeat interval is 15 seconds; backend lease window is 90 seconds.
  - No `agentId` means no workspace registration and no inbox polling.
- Agent creation:
  - `POST /api/v1/members/agents` creates both a `Member(kind="agent")` and an `AgentWorkspace` bound to a selected computer/runtime.
  - Daemon connect must not auto-create an agent.
- Existing management/chat contracts still apply:
  - Channel member APIs operate by UUID channel id.
  - `POST /api/v1/dm` uses peer display name and returns a stored `dm:<uuid>-<uuid>` channel.
  - Agent-facing DM sends target `dm:<peer display name>`, not the stored DM channel name.

### 4. Validation & Error Matrix

- Missing public key -> `401 Missing API key`.
- Invalid public key -> `401 Invalid API key`.
- Missing connect-command name -> `400 Missing name`.
- Invalid connect token -> `401 Invalid connect token`.
- Revoked connect token -> `401 Connect token revoked`.
- Expired connect token -> `401 Connect token expired`.
- Reused connect token -> `409 Connect token already used`.
- Missing daemon `machineId` -> `400 Missing machineId`.
- Duplicate computer name for a different machine -> `409 Computer name <name> already exists`.
- Same `machineId` while its computer has an unexpired active lease -> `409 Computer already has an active daemon`.
- Same `machineId` after lease expiry -> reuse the existing computer and issue a fresh machine token.
- Duplicate member display name -> `409 Member name <name> already exists`.
- Invalid `computerId` for agent creation -> `400 Invalid computerId`.
- Unknown `computerId` for agent creation -> `404 Computer not found`.
- Missing channel/member identifiers keep their existing `400`/`404` behavior.

### 5. Good/Base/Bad Cases

- Good: browser generates a connect command; no computer row appears until daemon calls `/daemon/connect`.
- Good: daemon connects with a persistent `machineId`; backend creates/reuses one computer and returns a fresh `sk_machine_...` token.
- Good: second daemon for the same online `machineId` is rejected until heartbeat lease expiry.
- Good: user creates an agent later on Members and binds it to the connected computer.
- Good: browser creates a channel, adds the agent by channel id/member id, sends a human message, and verifies an agent-authored response through `/internal/agent-api/send`.
- Bad: generating a long-lived machine token from the browser and creating a computer before the daemon has proven it can connect.
- Bad: putting `--agent-id aaaa...` into the default computer connection command, because daemon connect must not auto-create or steal an agent workspace.
- Bad: testing agent replies by posting to public `/api/v1/channels/{channel}/messages` with `sender: agentName`; that proves message rendering, not agent-facing auth/send contracts.

### 6. Tests Required

- API tests:
  - `connect-command` does not create a computer.
  - `/daemon/connect` creates a computer after a valid token.
  - Same offline `machineId` reuses the existing computer.
  - Same online `machineId` returns `409`.
  - Duplicate computer/member names return `409`.
  - Expired or reused connect tokens return `401`/`409`.
- Daemon tests:
  - `machineId` is generated once and persists across restarts.
  - `--proxy-port 0` starts on an available port.
  - No `--agent-id` means no workspace payload.
  - Heartbeat renews the lease.
- Browser E2E:
  - Generated command includes `SLOCK_CONNECT_TOKEN` and excludes `sk_machine_`.
  - Computer list does not show the pending computer until daemon connect succeeds.
  - Connected computer appears online and the pending command hides.
  - Duplicate agent name displays the backend `409` error.
  - DM route heading displays decoded `dm:` text, not `dm%3A`.

### 7. Wrong vs Correct

#### Wrong

```bash
npx @slock-ai/daemon@latest --server-url http://localhost:8000 --api-key sk_machine_...
```

#### Correct

```bash
cd /path/to/smallkhoj/agent/daemon/aaa-daemon && SLOCK_CONNECT_TOKEN=sk_connect_... node dist/cmd/main.js start --foreground --runtime none --server http://localhost:8000 --ws none --proxy-port 0 --register-daemon
```

#### Wrong

```typescript
const dmChannelName = decodeURIComponent(page.url().split("/chat/").at(-1) ?? "")
await agentSend(apiKey, agentId, dmChannelName, dmReply)
```

#### Correct

```typescript
await agentSend(apiKey, agentId, "dm:zy-ean", dmReply)
```
