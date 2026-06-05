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
  - proxy `/internal/agent-api/events` and SSE events use the same event buffer and emit the same `message_received` delivery path
  - runtime delivery calls `ClaudeRuntimeDriver.sendUserMessage()`; if Claude is busy, the runtime queue owns deferral until a safe turn boundary
- WebSocket manager must:
  - send activity payloads on connect and heartbeat (`{type:"activity",status,at}`)
  - ack recognized message events with `{type:"ack",message_id?,seq?,at}`
  - support both raw event payloads and JSON-RPC `daemon/message.received` notifications
  - support JSON-RPC dotted notifications: `message.*` maps to message delivery, and `task.*` maps to the generic event path for runtime delivery
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
  - daemon records captured Claude session ids in `SessionManager`
  - runtime trace events are emitted for start, stream events, session capture, message send, exit, error, restart scheduling, and stall detection
  - `--runtime-restart-on-crash` enables one restart after unexpected Claude exit, resuming the last known session id when available
  - `--runtime-stall-timeout-ms` enables an optional watchdog; it only terminates a busy runtime when no runtime progress occurs for the configured threshold
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
- `POST /internal/daemon/jsonrpc` with malformed JSON -> returns JSON-RPC parse error.
- `POST /internal/daemon/jsonrpc` before daemon RPC handler registration -> returns HTTP 503 `daemon_rpc_unavailable`.
- Imported MCP `--auth-token` used as direct agent-api bearer token -> upstream may return `invalid_principal`; fix by importing managed proxy credentials or minting a self-managed `sk_agent_*` profile.
- MCP `tools/list` must list only `runtime_profile_migration_done` for the compatibility bridge.

### 5. Good/Base/Bad Cases

- Good: Claude Code calls `slock message send --target "#general"` with content on stdin; wrapper injects proxy env; CLI posts to `/internal/agent/{agentId}/send`; proxy rewrites to `/internal/agent-api/send`.
- Base: `slock message check --limit 10` maps to `/internal/agent/{agentId}/receive?limit=10`; proxy rewrites to `/internal/agent-api/events?limit=10&since=latest`.
- Base: attach receives a JSON-RPC line on stdin, posts it to `/internal/daemon/jsonrpc`, and writes only the JSON-RPC response frame to stdout.
- Base: a new WebSocket or SSE message is buffered; a stale send is held until `message.check` or history consumption marks the message read.
- Base: `aaa-daemon smoke --import-slock-runtime <runtimeDir>` reads `.slock/slock.cmd`, chains through the existing managed proxy, and calls only `server info`.
- Base: `aaa-daemon start --import-slock-runtime <runtimeDir> --runtime claude` starts a managed Claude runtime whose first `slock server info` call reaches the imported managed proxy.
- Bad: implementing `message.send`, `message.check`, or task operations as MCP tools. This diverges from the Slock runtime contract and breaks Claude Code compatibility expectations.
- Bad: treating `claude-mcp-config.json --auth-token` as an agent API key for direct `/internal/agent-api/*` requests.
- Bad: adding write-capable CLI operations such as task claim/update, channel join/leave, profile update, reactions, or reminders create/update without explicit tests and safety gates.
- Bad: posting attach JSON-RPC to the local agent API root; the proxy root is bearer-authenticated Slock API traffic, not the daemon control endpoint.

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
- Claude stream-json unit tests:
  - parse stdout JSON lines for system/session-init, assistant/tool-use, user/tool-result, and result events
  - assert `sendUserMessage()` writes the expected JSONL stdin shape
  - assert captured `session_id` is included on later user messages
  - assert resume session id is passed via args and used before the first init event
  - assert queued messages do not flush while busy and flush at a `result` boundary
- WebSocket/message delivery tests:
  - assert raw and JSON-RPC WebSocket message events normalize to daemon message events
  - assert ack and activity payload builders preserve message id/seq where present
- Proxy freshness/SSE tests:
  - assert stale sends return HTTP 409 held responses before upstream send
  - assert checking/reading messages advances `readUpToSeq` enough for a later send
  - assert SSE `/events` frames are parsed and buffered into inbox events
  - assert dotted SSE and polling `message.*` events are normalized to `message_received` buffer methods and still advance message freshness from the nested or top-level message seq
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

## Scenario: User Management Flow APIs And Agent-Facing E2E

### 1. Scope / Trigger

- Trigger: product management flow APIs and browser E2E span UI, public API, machine credentials, daemon registration, member/workspace binding, channel membership, and agent-facing send behavior.
- This is a cross-layer contract: browser UI -> `/api/v1` management endpoints -> database models -> `/internal/agent-api` daemon/agent endpoints -> chat UI verification.

### 2. Signatures

- `POST /api/v1/computers/credential`
- `POST /api/v1/members/agents`
- `POST /api/v1/channels`
- `POST /api/v1/channels/{channel_id}/members`
- `DELETE /api/v1/channels/{channel_id}/members/{member_id}`
- `GET /api/v1/channels/{channel_id}/members`
- `POST /api/v1/dm`
- Existing daemon registration: `POST /internal/agent-api/daemon/register`
- Existing agent send: `POST /internal/agent-api/send`

### 3. Contracts

- Public management endpoints require `X-Public-Key: sk_public_local` in local test/dev flows.
- `POST /api/v1/computers/credential` request:
  - `name?: string`
  - `serverUrl?: string`
- `POST /api/v1/computers/credential` response:
  - `computerId: string`
  - `apiKey: string` with `sk_machine_` prefix
  - `command: string` containing `npx @slock-ai/daemon@latest --server-url ... --api-key ...`
- The generated machine credential must be persisted in `api_keys` with `resource_type="computer"` and a SHA-256 `token_hash`.
- `POST /api/v1/members/agents` request:
  - `name: string`
  - `computerId: uuid`
  - `runtime?: string`
  - `runtimeCommand?: string`
  - `runtimeModel?: string`
  - `backend?: string`
  - `cwd?: string`
- Creating an agent must create both a `Member(kind="agent")` and an `AgentWorkspace` bound to the selected computer/runtime.
- `POST /api/v1/channels` creates `public` or `private` channels and adds the creator to `channel_members`.
- `POST /api/v1/channels/{channel_id}/members` and `DELETE /api/v1/channels/{channel_id}/members/{member_id}` operate by UUID channel id, not by display channel name.
- `POST /api/v1/dm` request uses peer display name (`peer: string`) and returns a real DM channel name shaped `dm:<uuid>-<uuid>`.
- Browser routes may contain URL-encoded DM names (`dm%3A...`). Frontend code must decode route params once for state/display and encode once when constructing API path segments.
- Agent-facing sends use:
  - Header `Authorization: Bearer <machine-or-agent-token>`
  - Header `X-Agent-Id: <agent-member-id>`
  - Body `{ "target": "#channel" | "dm:<peer_display_name>", "content": string }`
- For agent-facing DM sends, the target is `dm:<peer display name>` such as `dm:zy-ean`, not the full stored DM channel name `dm:<uuid>-<uuid>`.

### 4. Validation & Error Matrix

- Missing public key -> `401 Missing API key`.
- Invalid public key -> `401 Invalid API key`.
- Missing computer credential name -> allowed; default to `unregistered-computer`.
- Invalid `computerId` for agent creation -> `400 Invalid computerId`.
- Unknown `computerId` for agent creation -> `404 Computer not found`.
- Missing channel name -> `400 Missing name`.
- Duplicate channel name on a server -> `409 Channel #<name> already exists`.
- Invalid channel member channel UUID -> `400 Invalid channel id`.
- Unknown channel id -> `404 Channel not found`.
- Missing channel member id -> `400 Missing memberId`.
- Unknown channel member id -> `404 Member not found`.
- Adding an existing channel member -> `{ "added": false, "reason": "already_member" }`.
- Removing a non-member -> `{ "removed": false, "reason": "not_member" }`.
- Agent-facing DM send using full stored DM name `dm:<uuid>-<uuid>` -> peer lookup fails with `404 Peer ... not found`; use `dm:<peer display name>`.

### 5. Good/Base/Bad Cases

- Good: browser generates a machine credential, then daemon registration uses that exact `sk_machine_...` token with `X-Computer-Id`.
- Good: browser creates an agent bound to the generated computer and selected runtime; e2e looks up the member id only after verifying the UI-created agent is visible.
- Good: browser creates a channel, adds the agent by channel id/member id, sends a human message, and verifies an agent-authored response created through `/internal/agent-api/send`.
- Good: browser opens a DM through `/api/v1/dm`, sends a human DM message, then verifies an agent-authored response sent to `dm:zy-ean`.
- Bad: testing agent replies by posting to public `/api/v1/channels/{channel}/messages` with `sender: agentName`; that proves message rendering, not agent-facing auth/send contracts.
- Bad: using the URL-encoded DM route segment directly as the public API channel name or agent-facing DM target.

### 6. Tests Required

- Browser E2E for the full management flow:
  - UI generates machine credential and command
  - generated credential registers a daemon/computer
  - UI creates an agent bound to that computer/runtime
  - UI creates a channel and adds the agent
  - UI sends a channel message
  - agent-facing `/internal/agent-api/send` posts a channel reply using the generated machine credential plus `X-Agent-Id`
  - UI starts a DM and sends a DM message
  - agent-facing `/internal/agent-api/send` posts a DM reply with target `dm:<peer display name>`
- Regression assertions:
  - DM route heading displays decoded `dm:` text, not `dm%3A`
  - Playwright artifacts under `frontend/test-results` and `frontend/playwright-report` are ignored

### 7. Wrong vs Correct

#### Wrong

```typescript
const dmChannelName = decodeURIComponent(page.url().split("/chat/").at(-1) ?? "")
await agentSend(apiKey, agentId, dmChannelName, dmReply)
```

#### Correct

```typescript
await agentSend(apiKey, agentId, "dm:zy-ean", dmReply)
```
