# Runtime Slock Integration

> This file covers Claude runtime, Slock CLI, local proxy, provider, and connect-token integration. Event visibility, activity/event separation, and runtime token-safety rules live in `event-delivery-contracts.md`; read that file before changing `ActivityLog`, `EventRecord`, daemon WS/SSE/polling, or runtime delivery classification.

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

- CLI entry: `slock message check|send|read|search|resolve|react`, `slock channel members|join|leave`, `slock thread read|summary|unfollow`, `slock server info`, `slock task list|create|claim|unclaim|update`, `slock profile show|get|update`, `slock integration list|login`, `slock reminder list|schedule|create|snooze|update|cancel|delete|log`, `slock attachment view|download|upload`
- Daemon runtime flags:
  - `aaa-daemon start --runtime none` (default)
  - `aaa-daemon start --runtime claude`
  - `aaa-daemon start --import-slock-runtime <runtimeDir>`
  - `aaa-daemon start --runtime-command <command>`
  - `aaa-daemon start --runtime-command-arg <arg>` (repeatable)
  - `aaa-daemon start --runtime-model <model>`
  - `aaa-daemon start --runtime-provider <providerName>`
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
  - `config.runtimeProvider?: string`
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
  - WebSocket `message_received` / `message` events are normalized into a bracketed text envelope such as `[target=dm:@zy-ean channel=<uuid> msg=12345678 time=... sender=@zy-ean type=human] @zy-ean: message`.
  - Runtime prompts must state that `target=` is the only reply target to reuse. `channel=` / `channelId` are machine metadata only and must not be used as `slock message send --target`.
  - Backend `message.created` event payloads must include a reply-safe `target`/`channel` string for runtime prompts, plus `channelId` for machine lookup. Public/private channel targets use `#name`; DM targets use the sender peer handle from the receiving runtime's perspective, for example a human-authored DM to an agent uses `target:"dm:@zy-ean"`. Thread targets append the root short id, for example `dm:@zy-ean:a1b2c3d4`. A bare channel UUID is valid as an API fallback target, but it must not be the primary runtime prompt target.
  - Event replay must backfill reply-safe `target`/`channel` for historical `message.created` rows whose stored payload lacks those fields. Polling, SSE, and daemon WebSocket expansion must derive the target from `event_records.message_id` -> message/channel/root thread plus the receiving agent's DM peer, so reconnecting daemons do not replay old DM thread messages as targetless top-level DMs.
  - Backend event records use dotted canonical event names such as `message.created`, `task.created`, `task.claimed`, `task.updated`, `message.reaction_added`, `channel.member_joined`, and `thread.summary_requested`, while also returning `legacyType` for older consumers.
- Backend daemon WebSocket delivery is computer-scoped. `WS /internal/agent-api/ws` authenticates with the machine token, keeps a per-connection `eventLogCursor`, expands `EventRecord` rows by every agent on that computer that can see the event, and sets both `agentId` and `targetAgentId` to the receiving agent id before sending. Do not reuse `EventRecord.actor_id` as the delivery target. See `event-delivery-contracts.md` for self-echo suppression, activity/event separation, and non-actionable event filtering rules.
  - Backend daemon WebSocket push must run after the database commit that creates the `EventRecord`. If no WS peer is connected, the event remains in `event_records` for reconnect/SSE/polling fallback.
  - The daemon WebSocket reconnect URL must include `eventLogCursor=<last delivered event seq>` once it has received message/task events, so reconnect does not replay old chat into the runtime.
  - A daemon WebSocket connection with no cursor, `eventLogCursor=0`, or an invalid cursor is a live subscription starting at the current max `EventRecord.seq`. It must not replay historical chat into Claude or other runtimes on daemon restart. Historical context is pulled explicitly by the agent with read/check/search commands when needed.
  - Daemon proxy/runtime code must treat dotted `message.*` events as legacy `message_received` for inbox buffering, freshness tracking, and runtime delivery. When a dotted message event has `payload.message`, flatten that nested message before buffering.
  - Daemon proxy/runtime code must accept both snake-case task events (`task_created`) and dotted task events (`task.created`) and deliver them as non-message runtime events without touching pending-message freshness state.
  - Tasks created from chat messages must preserve source linkage (`Task.message_id`, event `messageId`, and `payload.source`) and stay in the source channel/DM. `assigneeId` / `targetAgentId` is assignment metadata that controls both event delivery and claim eligibility. When `targetAgentId` is set, the event is delivered directly to that agent regardless of channel membership, and only that agent may claim the task. When `targetAgentId` is not set, the event follows normal channel visibility rules and any channel member may claim the task.
  - An assigned `task.created` / `task_created` event is actionable runtime work for the assigned visible agent, not a passive notification. Runtime formatting and prompts must tell the model to claim/start the task, do the work, reply to the source target/thread, and move the task to `in_review` when ready.
  - Agent task status transitions are intentionally narrower than supervisor transitions: an agent assigned to the task may move `todo -> in_progress` by claiming/starting it, `in_progress -> in_review` when submitting work, and `in_progress -> todo` when unclaiming. Agents must not set `done`; human/supervisor review owns approval.
  - Daemon proxy/runtime code must accept thread events such as `thread.summary_requested` and deliver them as non-message runtime events. Targeted thread events must preserve `targetAgentId` so only the selected runtime receives the request.
  - Agent-scoped proxy `/events` and SSE responses must annotate buffered/emitted events with the registration `agentId` before normalization, unless the upstream event already includes `agentId`/`agent_id`. Multi-runtime delivery depends on this marker to avoid sending one agent's inbox item to another runtime.
  - proxy `/internal/agent-api/events` and SSE events use the same event buffer and emit the same `message_received` delivery path
  - runtime delivery calls `ClaudeRuntimeDriver.sendUserMessage()`; if Claude is busy, the runtime queue owns deferral until a safe turn boundary
- WebSocket manager must:
  - send activity payloads on connect and heartbeat (`{type:"activity",status,at}`)
  - ack recognized message events with `{type:"ack",message_id?,seq?,at}`
  - support both raw event payloads and JSON-RPC `daemon/message.received` notifications
  - support JSON-RPC dotted notifications: `message.*` maps to message delivery, and `task.*` maps to the generic event path for runtime delivery
  - support raw `control` events and JSON-RPC `daemon.command.*` / `control.*` notifications; for JSON-RPC methods, the command type comes from the method suffix and must be preserved before dispatch.
  - stop inbox polling while WS is connected, and restart legacy agent-scoped inbox polling only when WS disconnects and the daemon has a concrete `agentId`.
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
  - On daemon register/heartbeat, the `workspaces` array is the authoritative list of runtimes currently managed by that daemon process. Any workspace on the same computer that was previously `running`, `active`, or `idle` but is missing from the payload must be treated as stale and re-armed as `pending_start` so the next control response can send `start_runtime` again.
- Daemon and legacy agent heartbeat endpoints update current-state fields such as `computers.last_heartbeat_at`, `computers.status`, `agent_workspaces.status`, `agent_workspaces.session_id`, and `agent_workspaces.pid`, but must not create high-volume `ActivityLog(kind="workspace_heartbeat")`, heartbeat-like `ActivityLog(kind="custom")`, or `EventRecord(event_type="workspace.heartbeat")` rows. Registration/update events remain valid when a workspace is first registered or explicitly updated. Heartbeat/activity telemetry must never be delivered to runtime as work.
  - explicit stops report `status:"stopped"`; unexpected exits report `status:"exited"` before the runtime record is removed, so backend state does not stay falsely running.
  - Runtime drivers that spawn CLI wrappers or provider shims must terminate the whole runtime process tree, not only the direct child. On POSIX, launch wrapper-based runtimes in their own process group and send lifecycle stop signals to the process group. If the runtime ignores graceful `SIGTERM`, schedule a bounded `SIGKILL` fallback for the same process group. Otherwise stopping a Claude/Codex wrapper can kill only the shim while the real provider child continues consuming tokens and emitting stdout.
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
  - `message resolve <id>` -> `/messages/{id}/resolve`; exact-only proof that the id exists and is visible, not a context navigation command
  - `channel members --channel <target>` -> `/channel-members?channel=...`
  - `thread read --thread-id <id>` -> `/threads/{id}`
  - `profile show|get [--handle <handle>]` -> `/profile` or `/profile/{handle}`
  - `integration list` -> `/integrations`
  - `reminder list` -> `/reminders`
  - `reminder log <id>` -> `/reminders/{id}/log`
- Write-capable CLI commands must require explicit opt-in before making local proxy requests:
  - `SLOCK_ALLOW_WRITES=1` or `AAA_DAEMON_ALLOW_WRITES=1`
  - optional target guard: `SLOCK_WRITE_TARGET_ALLOWLIST` or `AAA_DAEMON_WRITE_TARGET_ALLOWLIST`
- `thread summary --thread-id <id> --summary <text>` is write-capable and maps to `POST /threads/{id}/summary` with body `{summary}`.
- `thread unfollow --target <target>` is write-capable and maps to `POST /threads/unfollow` with body `{threadId}`.
- `task unclaim --id <id>` maps to `POST /tasks/{id}/unclaim`; `task unclaim --channel <target> --number <n>` maps to `POST /tasks/update-status` with body `{channel, task_number, status:"todo"}`.
- `reminder snooze <id> --delay-seconds <n>` or `--fire-at <iso>` is write-capable and maps to `PATCH /reminders/{id}` with body `{delaySeconds}` or `{fireAt}`.
- Attachment upload resolves `--channel` through `/resolve-channel`, then forwards multipart form data (`file`, `channelId`, optional `mimeType`) to `/upload`.

## Scenario: Runtime Prompt Command Parity

### 1. Scope / Trigger

- Trigger: adding or exposing Slock CLI commands that managed runtimes may call from the Claude system prompt.
- This is cross-layer: prompt text, generated CLI parser, local proxy rewrite, daemon JSON-RPC forwarding, backend agent API, and tests must agree before the command is documented for workers.

### 2. Signatures

- `GET /internal/agent/{agentId}/messages/{messageRef}/resolve` -> backend `GET /internal/agent-api/messages/{messageRef}/resolve`
- `POST /internal/agent/{agentId}/threads/unfollow` body `{threadId}`
- `POST /internal/agent/{agentId}/tasks/{taskId}/unclaim`
- `POST /internal/agent/{agentId}/tasks/update-status` body `{channel, task_number, status:"todo"}`
- `PATCH /internal/agent/{agentId}/reminders/{reminderId}` body `{delaySeconds? | fireAt?}`
- `GET /internal/agent/{agentId}/reminders/{reminderId}/log`
- Daemon JSON-RPC methods: `daemon/message.resolve`, `daemon/task.unclaim`, `daemon/reminder.snooze`, `daemon/reminder.log`

### 3. Contracts

- `message resolve` is read-only and exact-only. It returns `{ok:true, resolved:true, message, messageId, shortId}` for a visible message and must fail closed for missing or invisible refs.
- Runtime prompt guidance must present `message resolve` as proof for cited ids. Historical context still comes from `message search` and `message read`.
- `thread unfollow`, `task unclaim`, and `reminder snooze` are write-capable and must pass the local write gate before the proxy request is made.
- `profile show` is an alias for `profile get`; both must stay read-only.
- `reminder snooze` re-arms a non-cancelled reminder by setting `status:"pending"` when `fireAt` or `delaySeconds` changes.
- Do not expose commands in the runtime prompt until the CLI, proxy, daemon method forwarding, backend endpoint, and tests all exist. Keep design-only affordances such as action preparation out of the prompt.

### 4. Validation & Error Matrix

- Missing message id -> CLI `MISSING_MESSAGE_ID`; daemon forwarding rejects empty `/messages//resolve`.
- Invisible resolved message -> backend HTTP 403.
- Missing thread id -> CLI `MISSING_THREAD_ID`.
- Missing task id and no channel/number pair -> CLI `MISSING_TASK_ID`.
- Missing reminder id -> CLI `MISSING_REMINDER_ID`.
- Snooze without `delaySeconds` or `fireAt` -> CLI `MISSING_AT`.
- Invalid reminder UUID in log endpoint -> backend HTTP 400.
- Reminder not owned by the current agent/server -> backend HTTP 404.

### 5. Good/Base/Bad Cases

- Good: `slock message resolve abc12345` returns the canonical message row, then `slock message read --around abc12345` is used only if surrounding context is needed.
- Base: `slock task unclaim --channel "#general" --number 3` transitions an assigned in-progress task back to `todo`.
- Bad: prompt advertises `slock action prepare` without a complete action-card product contract; workers may depend on a workflow humans have not accepted.

### 6. Tests Required

- CLI parser coverage asserts new commands map to the expected local proxy method/path/body and write safety.
- Proxy rewrite coverage asserts `/messages/{id}/resolve` reaches `/internal/agent-api/messages/{id}/resolve`.
- ClientHandler coverage asserts the JSON-RPC methods forward with correct paths and missing identifiers fail early.
- Runtime prompt coverage asserts implemented commands are listed and non-implemented commands such as `slock action prepare` are absent.
- Backend compile or unit coverage must include the new endpoints' import/signature validity; integration tests should cover visibility and ownership checks when backend fixtures are available.

### 7. Wrong vs Correct

#### Wrong

```text
Tell Claude it can call `slock action prepare` because the proxy can rewrite an action path.
```

#### Correct

```text
Only list commands whose CLI parse path, daemon forwarding path, backend endpoint, safety behavior, and tests all exist.
```

## Scenario: Codex Runtime Uses Invocation Driver, Not Long-Lived Stdin

### 1. Scope / Trigger

- Trigger: daemon-managed Codex runtime for Slock workspaces.
- Codex is not the same shape as Claude Code stream-json. Treat it as a turn-based CLI invocation runtime: one `codex exec --json` or `codex exec resume --json` process handles one delivered Slock event, emits JSONL, then exits.
- Reference implementation to study, not copy blindly: Clowder AI `CodexAgentService`, `codex-event-transform`, and invocation tracking. The portable lessons are invocation lifecycle, MCP/config injection, context accounting, diagnostics, and event normalization.

### 2. Signatures

- First turn:
  - `codex exec --json --sandbox danger-full-access --skip-git-repo-check [--model <model>] [--config <key=value>...] -- -`
  - prompt body is passed through stdin, never argv.
- Resume turn:
  - `codex exec resume --json --skip-git-repo-check [--model <model>] [--config <key=value>...] <thread_id> -`
  - `thread_id` is captured from `thread.started.thread_id`.
- Runtime driver:
  - `CodexRuntimeDriver.sendUserMessage(text)` starts exactly one child process when idle.
  - additional messages are queued until the running child exits.
  - `sessionId` means Codex `thread_id`, not Claude `session_id`.
- Optional MCP config injection:
  - use per-invocation `--config mcp_servers.<name>.*=...` entries when exposing runtime-specific tools.
  - do not mutate global `~/.codex/config.toml` for daemon-managed sessions.

### 3. Contracts

- Prompt/context injection:
  - preferred stable instruction channel is per-invocation config when supported, for example `--config developer_instructions=<toml-string>`.
  - if the active Codex CLI version cannot carry daemon instructions as config, prepend the Slock system block to stdin and record that capability gap in runtime status.
  - the Slock prompt prefix should be stable across turns where possible to improve cache hits; variable event payload belongs after a clear `Current Slock Event` delimiter.
- Process security:
  - prompt text, chat history, credentials, and task context must not appear in process argv.
  - OAuth mode may need the real Codex home for login refresh; API-key/custom-provider mode should support isolated `HOME` / `USERPROFILE` to avoid stale OAuth interference.
  - daemon-managed config must be per invocation or per runtime workspace; never overwrite user-global Codex config.
- Workspace isolation:
  - each channel/runtime agent needs an independent workspace path and generated `.slock` wrapper.
  - the channel may also have a shared project space, but the runtime process `cwd` must identify the agent's own workspace/session root.
- Slock communication:
  - user-visible chat/task/attachment writes still go through the generated `slock` CLI wrapper unless the product explicitly adds a separate MCP write contract.
  - stdout/stderr from `codex exec` are daemon telemetry only. They are not Slock replies.
- Event normalization:
  - `thread.started` -> session capture.
  - `item.started` for `command_execution` / `mcp_tool_call` -> tool-use activity.
  - `item.completed` for `agent_message` -> assistant text telemetry.
  - `item.completed` for `command_execution` / `mcp_tool_call` -> tool-result telemetry.
  - `turn.completed.usage` -> token/cache/context accounting when present.
  - raw JSONL must be archived or traceable with sensitive tokens redacted.
- Lifecycle:
  - busy means a child process is running.
  - queued Slock events must flush only after a terminal child exit or semantic completion.
  - exit code `0` is success; non-zero exits require diagnostic classification before deciding whether to retry, surface an error, or suppress a known harmless CLI quirk.

### 4. Validation & Error Matrix

- CLI not found -> fail the runtime start with `CODEX_CLI_NOT_FOUND`; do not silently fall back to another runtime.
- no `thread.started.thread_id` on first successful turn -> keep runtime usable for one-shot work, but mark session continuity degraded.
- malformed stdout JSON before any structured event -> treat as text telemetry; after structured events, keep it as raw diagnostic only.
- child exits while messages are queued -> flush the next message exactly once.
- child stalls past configured timeout -> emit liveness warning, then terminate according to daemon stall policy.
- resume fails because session id is invalid/missing -> classify as session-continuity failure and start a new session only if the control-plane policy allows it.
- MCP server config cannot be resolved -> continue without that MCP server only if Slock CLI communication still works; otherwise fail closed.

### 5. Good/Base/Bad Cases

- Good: a DM event starts `codex exec --json`, captures `thread.started.thread_id`, Codex uses `slock message send`, daemon records usage and final exit, then the next DM resumes the same thread id.
- Base: Codex emits command/tool JSONL and a final answer but no token usage; daemon still records the session id and stream events, with usage omitted.
- Bad: daemon passes the full Slock event body as a command-line argument; other local processes can inspect it through process listings.
- Bad: daemon rewrites `~/.codex/config.toml` to add MCP or developer instructions; concurrent user Codex sessions inherit the wrong agent identity.

### 6. Tests Required

- Unit: build first-turn args and resume args, asserting prompt is stdin-only and thread id placement matches `codex exec resume --help`.
- Unit: parse `thread.started`, `item.started`, `item.completed`, `turn.completed`, malformed JSON, and stderr diagnostics.
- Unit: queue behavior sends one child at a time and flushes exactly one queued message after each exit.
- Integration: fake Codex CLI receives generated Slock wrapper in `PATH`, isolated workspace `cwd`, and no proxy secret env vars.
- Integration: resume session id from daemon restart is reused for the next turn.
- Regression: global Codex config files are not created or modified by daemon-managed runtime launch.

### 7. Wrong vs Correct

#### Wrong

- Model Codex as a persistent process that can safely receive arbitrary future messages over stdin.
- Put Slock prompt, event payload, or message history in argv.
- Treat Codex stdout text as delivered chat.
- Use one global workspace/session for every channel agent.

#### Correct

- Model Codex as a per-turn invocation driver with explicit session resume.
- Pass the prompt through stdin and keep daemon-owned config per invocation/runtime workspace.
- Normalize JSONL into daemon telemetry and require `slock message send` for visible replies.
- Keep independent runtime workspaces and session ids per joined agent/channel context.

## Scenario: Codex ACP Resident Runtime Spike

### 1. Scope / Trigger

- Trigger: evaluating Codex as a resident runtime to reduce `codex exec resume` per-turn startup overhead.
- ACP is a separate runtime path from `codex exec/resume`. Do not replace the stable exec driver until ACP proves startup, session resume/load, prompt, cancel, event translation, and cleanup in local daemon tests.
- Reference implementation: Neutree Agent Platform `agents/codex` uses `codex-acp` plus an ACP bridge with one child process per active session and LRU eviction.

### 2. Signatures

- Package sources:
  - `@zed-industries/codex-acp` exposes `codex-acp`.
  - `@agentclientprotocol/sdk` provides `ClientSideConnection`, `ndJsonStream`, and ACP types.
- MVP decision: default Codex ACP launch uses `@zed-industries/codex-acp@0.16.0`, but the daemon runtime command remains configurable so the package can later switch to `@agentclientprotocol/codex-acp` or a fork.
- Product naming: external APIs and UI expose the runtime as `codex`; `codex_acp` is an implementation detail and historical alias. Explicit `codex_cli` remains a daemon/debug fallback only.
- MVP smoke:
  - `npm run smoke:codex-acp -- --npm-package @zed-industries/codex-acp@0.16.0 --prompt "<text>"`
  - `npm run smoke:codex-acp -- --command codex-acp --prompt "<text>"`
- Bridge API:
  - `CodexAcpBridge.start()`
  - `CodexAcpBridge.createSession({cwd?, mcpServers?}) -> sessionId`
  - `CodexAcpBridge.loadSession(sessionId, {cwd?, mcpServers?}) -> sessionId`
  - `CodexAcpBridge.prompt(sessionId, text) -> PromptResponse`
  - `CodexAcpBridge.cancel(sessionId)`
  - `CodexAcpBridge.stop()`

### 3. Contracts

- ACP child process is a runtime-session carrier, not a one-turn CLI.
- The daemon may cache one ACP child per live Codex session, then evict idle sessions by TTL/count once product policy is defined.
- `session/update` notifications are runtime telemetry. Translate at least:
  - `agent_message_chunk` -> message delta telemetry.
  - `tool_call` -> tool-use telemetry.
  - `tool_call_update` terminal statuses -> tool-result telemetry.
  - `usage_update` -> token/context accounting once wired.
- `session/new` creates a new runtime session; `session/load` restores an existing runtime session. A failed load must be surfaced as a session-continuity error, not silently converted to a new session.
- MCP servers are passed to ACP `session/new` / `session/load`, so session-scoped headers such as Slock/session tokens belong there, not in global Codex config.
- Process cleanup must terminate the process group when launched through wrappers such as `npx`, otherwise the smoke can finish the turn but leave the ACP child alive.

### 4. Validation & Error Matrix

- `codex-acp` command missing -> smoke fails before daemon runtime selection changes.
- ACP initialize fails -> runtime state `failed_start`, no session id.
- `session/new` fails -> no active runtime session; report agent-visible startup error.
- `session/load` fails -> do not create a new session unless an explicit recovery policy allows it.
- prompt returns `stopReason:"cancelled"` -> invocation status `cancelled`.
- child exits while prompt is in flight -> reject the prompt and mark invocation failed, so backend does not remain `agent`/busy forever.
- stop/eviction must kill `npx` process groups on POSIX and direct child processes on Windows.

### 5. Good/Base/Bad Cases

- Good: `@zed-industries/codex-acp@0.16.0` starts through `npx`, creates an ACP session, streams `agent_message_chunk` deltas, emits `usage_update`, returns `stopReason:"end_turn"`, and exits cleanly after `stop()`.
- Good: public daemon runtime `codex` starts a managed ACP child, creates or loads a session, queues prompts while a turn is in flight, maps ACP updates into daemon-compatible `assistant` / `usage` / `result` events, and reports heartbeat workspace state with `runtime:"codex"`, `sessionId`, `pid`, and `status`.
- Base: fake ACP server exercises initialize/session/prompt/update/cancel without requiring model credentials.
- Bad: use ACP only for prompt but keep Slock/MCP session headers in global `.codex/config.toml`; concurrent sessions can leak identity or lose per-session auth.
- Bad: kill only the `npx` wrapper and leave `codex-acp` running.

### 6. Tests Required

- Unit/integration: fake ACP child covers initialize, `session/new`, `session/load`, `session/prompt`, `session/update`, and process stop.
- Smoke: real `@zed-industries/codex-acp` starts via npx and completes one prompt locally.
- Future runtime integration: daemon heartbeat includes ACP `sessionId`, `pid`, `busy`, queued count, and last event time.
- Future MCP integration: session-scoped Slock MCP headers are visible to the ACP session and not persisted globally.

### 7. Wrong vs Correct

#### Wrong

```text
Treat `codex-acp` as a global singleton for all agents and all channel workspaces.
```

#### Correct

```text
Keep ACP session identity scoped to one daemon-managed agent/workspace runtime, then add TTL/count eviction once reuse is proven.
```

## Scenario: Daemon-Local Runtime Provider Selection

### 1. Scope / Trigger

- Trigger: users can select a local Claude or Codex provider/profile for a runtime, while provider credentials and launch details must remain local to the daemon machine.
- This is a cross-layer contract: daemon local capability detection -> backend capability display/storage -> `start_runtime` provider selection -> daemon-local runtime launch.

### 2. Signatures

- Daemon CLI:
  - `aaa-daemon start --runtime-provider <providerName>`
- Daemon local provider launcher:
  - default command discovery order: `SLOCK_CCS_CLAUDE_COMMAND`, `CCS_CLAUDE_COMMAND`, `/Users/lee/.local/bin/ccs-claude`, `ccs-claude`
  - discovery: `<ccsClaudeCommand> list`
  - launch: `<ccsClaudeCommand> <providerName> <model>`
- Manual provider inventory:
  - env var discovery order: `SLOCK_RUNTIME_PROVIDERS_JSON`, `AAA_DAEMON_RUNTIME_PROVIDERS_JSON`, `RUNTIME_PROVIDERS_JSON`
  - JSON shape: `[{id,name,runtime,model?,command?,commandArgs?}]`
  - `command` and `commandArgs` are daemon-local launch data only; they must not be echoed through backend/public heartbeat payloads.
- CC Switch Codex provider inventory:
  - default database discovery order: `SLOCK_CC_SWITCH_DB`, `CC_SWITCH_DB`, `$HOME/.cc-switch/cc-switch.db`
  - query only local `providers` rows with `app_type='codex'`
  - provider rows are parsed into public runtime `codex`; ACP remains an implementation detail
- Public/backend payload fields:
  - `Member.config.runtimeProvider?: string`
  - `AgentWorkspace.runtimeProvider?: string` in serialized responses
  - `Computer.detectedRuntimes[]` may include `{type:"claude_code"|"codex", status:"available", provider, runtimeProvider, model, source:"cc-switch"}`
  - `start_runtime.command.config.runtimeProvider?: string`

### 3. Contracts

- `runtimeProvider` is a provider/profile name, not an API key, shell command, or serialized credential.
- The backend may store and return `runtimeProvider`, but it must not store API keys, CC Switch provider config, generated Claude settings files, command args, or auth headers.
- The daemon owns provider detection and launch resolution. If local CC Switch DB/`ccs-claude` is unavailable, `detectedRuntimes` still includes the default runtime capability and existing default runtime launch behavior continues.
- Detected manual and CC Switch providers are reported as sanitized capabilities only: `type`, `status`, `provider`, `runtimeProvider`, `model`, and `source`. Do not include `ccs-claude` path, CC Switch DB path, provider config JSON, tokens, request headers, provider command, or command args.
- `backend` is a legacy/old display field. Do not infer `runtimeProvider` from `backend` during serialization or runtime start command construction.
- Creating or updating an agent may set `runtimeProvider` explicitly. Old `backend` values remain old data and must not silently become provider selections.
- If a Claude `start_runtime` command includes `runtimeProvider` and omits `runtimeCommand`, the daemon resolves the provider locally and starts Claude Code via the local provider launcher.
- If a Codex `start_runtime` command includes a CC Switch `runtimeProvider`, the daemon records the selected sanitized provider identity and starts public runtime `codex`; provider-specific Codex launch isolation requires a future `ccs-codex`-equivalent launcher or per-runtime Codex config writer before it can guarantee switching without mutating CC Switch global state.
- If a manually configured `runtimeProvider` includes `command` / `commandArgs`, the daemon may use them for local launch resolution, but heartbeat and backend storage still carry only the provider id/name/model/source.
- If `runtimeCommand` is explicitly supplied, it takes precedence over provider resolution for test/custom-launch paths.
- Daemon workspace register/heartbeat payloads for provider-launched runtimes include `runtimeProvider`, but omit `runtimeCommand` and `runtimeModel` unless those were explicitly configured outside provider launch.
- Reconnect/re-register currently re-arms expected-running workspaces that are missing from daemon heartbeat, including last observed `stopped`, `offline`, `exited`, or `crashed` states. A future desired-state controller may narrow this once explicit stop/reset controls exist.

### 4. Validation & Error Matrix

- No local `ccs-claude` available -> report no Claude CC Switch provider capabilities; keep default runtime path usable.
- No local CC Switch DB or `sqlite3` available -> report no Codex CC Switch provider capabilities; keep default runtime path usable.
- `runtimeProvider` supplied but not found in local provider inventory -> daemon logs a sanitized warning and does not start that runtime.
- Manual provider JSON is malformed or contains unsupported runtime values -> skip those entries; keep other detection sources usable.
- `runtimeProvider` supplied with `runtimeCommand` -> daemon uses the explicit command and does not try to resolve the provider locally.
- Provider launch exits or crashes -> runtime follows normal runtime exit/crash reporting and restart policy.
- Backend receives `backend` only -> keep it as legacy/display data; do not create `config.runtimeProvider` from it.
- Daemon heartbeat contains provider runtime -> backend persists provider name only; command path/args must remain absent from public serialized workspace payloads.

### 5. Good/Base/Bad Cases

- Good: `create_agent` receives `{runtimeProvider:"Kimi"}`; backend stores `Member.config.runtimeProvider`; daemon receives `start_runtime.config.runtimeProvider:"Kimi"` and launches `ccs-claude Kimi kimi-for-coding` locally.
- Good: `SLOCK_RUNTIME_PROVIDERS_JSON` defines `local-codex-krill`; daemon heartbeat reports `{type:"codex", provider:"Local Codex Krill", runtimeProvider:"local-codex-krill", source:"manual"}` while launch resolution uses the local command privately.
- Good: CC Switch DB contains Codex provider `krill`; daemon heartbeat reports `{type:"codex", provider:"krill", runtimeProvider:"<local-provider-id>", source:"cc-switch"}` without exposing `settings_config`.
- Base: no CC Switch on the machine; the daemon reports only the base runtime capability and starts the default Claude runtime when no provider is selected.
- Base: daemon reports `Kimi`, `Zhipu GLM`, and Codex providers such as `krill` in `detectedRuntimes`; UI lists provider names/models but cannot see API keys, DB paths, settings JSON, or launcher arguments.
- Bad: storing `CCS_PROVIDER_DEFAULTS`, provider tokens, or provider command args on the backend.
- Bad: treating `backend:"Claude"` as `runtimeProvider:"Claude"`; that can block default Claude startup when no such CC Switch provider exists.
- Bad: sending `/Users/.../ccs-claude` or generated Claude settings paths through server APIs.

### 6. Tests Required

- Backend unit tests:
  - `runtime_start_command` includes explicit `runtimeProvider` and does not require `runtimeCommand`/`runtimeModel`.
  - `backend` alone does not become `runtimeProvider`.
  - missing expected-running workspaces are re-armed to `pending_start`, but `runtimeDesiredStatus:"stopped"` is not re-armed.
- Daemon unit/integration tests:
  - parse `ccs-claude list` output into sanitized providers.
  - parse CC Switch Codex provider rows into sanitized public `codex` providers.
  - parse manual provider JSON and verify command/args are launch-only, not heartbeat payload fields.
  - fake `ccs-claude` launches the selected provider/model from `start_runtime.config.runtimeProvider`.
  - daemon register/heartbeat reports provider capabilities and provider workspace state without command args.
- Real test:
  - create a marker agent with `runtimeProvider:"Kimi"`.
  - verify browser `/computers` shows the provider and running workspace.
  - verify API state shows `runtimeProvider:"Kimi"`, `runtimeCommand:null`, `runtimeModel:null`.
  - verify `smallkhoj-trace` contains `CC Switch provider: Kimi` and the selected model line.

### 7. Wrong vs Correct

#### Wrong

```json
{
  "backend": "Claude",
  "runtimeProvider": "Claude",
  "runtimeCommand": "/Users/lee/.local/bin/ccs-claude",
  "runtimeCommandArgs": ["Kimi", "kimi-for-coding"]
}
```

#### Correct

```json
{
  "backend": null,
  "runtimeProvider": "Kimi",
  "runtimeCommand": null,
  "runtimeModel": null
}
```

The daemon resolves `Kimi` to the local launcher and model from its own machine-local inventory.

### 4. Validation & Error Matrix

- Missing `SLOCK_AGENT_PROXY_URL` -> CLI exits non-zero with JSON error code `MISSING_SLOCK_AGENT_PROXY_URL`.
- Missing `SLOCK_AGENT_PROXY_TOKEN_FILE` -> CLI exits non-zero with JSON error code `MISSING_SLOCK_AGENT_PROXY_TOKEN_FILE`.
- Unreadable token file -> CLI exits non-zero with JSON error code `TOKEN_READ_FAILED`.
- Missing `--target` for `slock message send` -> CLI exits non-zero with JSON error code `MISSING_TARGET`.
- Missing send content -> CLI exits non-zero with JSON error code `MISSING_CONTENT`.
- Missing `--query` for `slock message search` -> CLI exits non-zero with JSON error code `MISSING_QUERY`.
- Missing `--channel` for `slock channel members` -> CLI exits non-zero with JSON error code `MISSING_CHANNEL`.
- Missing `--thread-id` for `slock thread read|summary` -> CLI exits non-zero with JSON error code `MISSING_THREAD_ID`.
- Missing summary text for `slock thread summary` -> CLI exits non-zero with JSON error code `MISSING_SUMMARY`.
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
- Base: public UI message creation commits a `message.created` event, then pushes it over the computer-level daemon WS to each visible agent on that computer with `targetAgentId` set to the recipient runtime id.
- Base: daemon WS initial connect with no cursor, `eventLogCursor=0`, or an invalid cursor receives only future events and control commands, not old `message.created` rows.
- Base: an agent-scoped `message.check` buffers events with that `agentId`, so delivery routes to the matching runtime in a 1:N daemon.
- Base: `aaa-daemon smoke --import-slock-runtime <runtimeDir>` reads `.slock/slock.cmd`, chains through the existing managed proxy, and calls only `server info`.
- Base: `aaa-daemon start --import-slock-runtime <runtimeDir> --runtime claude` starts a managed Claude runtime whose first `slock server info` call reaches the imported managed proxy.
- Bad: implementing `message.send`, `message.check`, or task operations as MCP tools. This diverges from the Slock runtime contract and breaks Claude Code compatibility expectations.
- Bad: treating `claude-mcp-config.json --auth-token` as an agent API key for direct `/internal/agent-api/*` requests.
- Bad: adding write-capable CLI operations such as task claim/update, channel join/leave, profile update, reactions, or reminders create/update without explicit tests and safety gates.
- Bad: posting attach JSON-RPC to the local agent API root; the proxy root is bearer-authenticated Slock API traffic, not the daemon control endpoint.
- Bad: using the daemon global `workspacePath/.slock` wrapper for every dynamic agent. The later runtime overwrites wrapper/token env for earlier runtimes.
- Bad: dropping `agentId` when buffering agent-scoped events. In a 1:N daemon that can misroute or skip runtime delivery.
- Bad: using the event actor as the daemon WS delivery target. Human-authored UI messages must route to the agent recipient, not the human sender.
- Bad: treating `ActivityLog` or runtime state telemetry as actionable runtime events. This can feed a runtime its own activity, create loops, and burn tokens.
- Bad: emitting only `channelId`/bare UUID for a DM runtime prompt. Models tend to reuse the visible header, so missing `target=dm:@peer` causes replies to hit "Channel ... not found" or land outside the visible DM.

### 6. Tests Required

For product-facing runtime/control-plane changes, also use the task-local Real Test SOP template in `docs/real-test-sop-template.md`. Runtime evidence must cross-check visible browser state with API/DB state and `smallkhoj-trace` output when daemon or agent delivery is involved.

- Unit test `rewriteAgentPath`:
  - preserves query strings for `history`, `search`, `tasks`, and attachment paths
  - adds `since=latest` for `/receive` when not supplied
  - rewrites `/threads/{id}` and `/threads/{id}/summary` to canonical agent API thread endpoints
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
  - browser/API regression: create an agent workspace, sync it as `running`, then simulate daemon reconnect/register with an empty `workspaces` payload and assert the backend returns a `start_runtime` control command for that workspace
- Claude stream-json unit tests:
  - parse stdout JSON lines for system/session-init, assistant/tool-use, user/tool-result, and result events
  - assert `sendUserMessage()` writes the expected JSONL stdin shape
  - assert captured `session_id` is included on later user messages
  - assert resume session id is passed via args and used before the first init event
  - assert queued messages do not flush while busy and flush at a `result` boundary
- WebSocket/message delivery tests:
  - assert raw and JSON-RPC WebSocket message events normalize to daemon message events
  - assert ack and activity payload builders preserve message id/seq where present
  - assert `thread.summary_requested` is classified as a runtime event and formatted with target/thread context
  - assert raw `control` payloads and JSON-RPC `daemon.command.*` payloads classify as control events and preserve command type, agent id, workspace id, and runtime config
  - assert backend daemon WS sends committed `message.created` records to connected computer peers with `agentId`/`targetAgentId` set to the receiving agent, and advances its per-connection event cursor past invisible events
  - assert daemon heartbeat for an existing workspace updates state without writing `ActivityLog(kind="workspace_heartbeat")` or `EventRecord(event_type="workspace.heartbeat")`.
  - assert DM `message.created` events delivered to an agent include `target:"dm:@<human>"`, while `/internal/agent-api/send` accepts both that target and the raw DM `channelId`
  - assert a DM thread `message.created` event still returns `target:"dm:@<human>:<rootShortId>"` when the persisted event payload has had `target`/`channel` removed before replay
  - live smoke: start backend and `aaa-daemon start --ws auto` with a fake Claude runtime that records stdin; post `POST /api/v1/channels/{name}/messages`; assert the marker appears in runtime stdin without waiting for polling
- user-facing agent/chat/thread bugs and product-facing runtime/control-plane changes require an additional WebDriver acceptance pass against the running local app. Drive the real browser through the reported workflow with the `project-webdriver-cli` skill and `./twd`, use a unique marker, verify the visible DOM state, and cross-check persistence/API fields such as `parent_id`, `target`, `threadId`, workspace status, daemon id, or task id as relevant. When daemon/runtime delivery is involved, also cross-check `smallkhoj-trace` output. Treat this as a stronger acceptance gate than automated E2E alone; if WebDriver behavior disagrees with the requested behavior, keep fixing even when E2E is green.
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
  - `--ws auto`
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
  - Product-facing wrappers such as `smallkhoj-daemon` may keep a server-scoped pid lock for diagnostics, but must not automatically terminate an existing daemon before proving their own token is valid. If the same-server lock points at a live process, the wrapper must fail fast with a clear message; stale locks may be removed.
  - `smallkhoj-daemon` must `exec` the foreground daemon process instead of running it as a background child and waiting from a parent shell. The visible process should be the daemon that receives `SIGINT`/`SIGTERM`; otherwise wrapper-level signal handling can mask the real stop source.
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
- Daemon `register` / `heartbeat` with a different `daemonId` while the stored lease is expired -> accept and replace `active_daemon_id`; stale daemon ids must not block recovery after a process crash.
- Daemon `register` / `heartbeat` with a different `daemonId` while the stored lease is still active -> `409 Computer is leased by another daemon`.
- Duplicate member display name -> `409 Member name <name> already exists`.
- Invalid `computerId` for agent creation -> `400 Invalid computerId`.
- Unknown `computerId` for agent creation -> `404 Computer not found`.
- Missing channel/member identifiers keep their existing `400`/`404` behavior.

### 5. Good/Base/Bad Cases

- Good: browser generates a connect command; no computer row appears until daemon calls `/daemon/connect`.
- Good: daemon connects with a persistent `machineId`; backend creates/reuses one computer and returns a fresh `sk_machine_...` token.
- Good: second daemon for the same online `machineId` is rejected until heartbeat lease expiry.
- Good: an expired, reused, or invalid connect command cannot kill a healthy same-server daemon; it exits before launching when the server-scoped wrapper lock points at a live process.
- Good: user creates an agent later on Members and binds it to the connected computer.
- Good: browser creates a channel, adds the agent by channel id/member id, sends a human message, and verifies an agent-authored response through `/internal/agent-api/send`.
- Bad: generating a long-lived machine token from the browser and creating a computer before the daemon has proven it can connect.
- Bad: wrapper startup reads a pid lock, sends `SIGTERM` to that process, and only then attempts `/daemon/connect`; a stale retry with an invalid one-time token can otherwise kill a healthy daemon and fail authentication itself.
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
  - `smallkhoj-daemon` uses server-scoped locks only as a guard: different server URLs can run together, same-server startup exits without killing the existing daemon, and connect/start modes `exec` the foreground daemon process.
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
cd /path/to/smallkhoj/agent/daemon/aaa-daemon && SLOCK_CONNECT_TOKEN=sk_connect_... node dist/cmd/main.js start --foreground --runtime none --server http://localhost:8000 --ws auto --proxy-port 0 --register-daemon
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
