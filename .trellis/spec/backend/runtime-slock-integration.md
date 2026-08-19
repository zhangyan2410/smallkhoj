# Runtime Slock Integration

> This file covers managed Claude, Codex, OpenCode, and Pi runtime identity, Slock CLI, local proxy, provider, and connect-token integration. Event visibility, activity/event separation, and runtime token-safety rules live in `event-delivery-contracts.md`; read that file before changing `ActivityLog`, `EventRecord`, daemon WS/SSE/polling, or runtime delivery classification.

## Scenario: Runtime Agents Use Short Aura Commands From PATH

### 1. Scope / Trigger

- Trigger: any managed runtime prompt, warmup, environment, wrapper, or
  Activity preview that names the agent-facing collaboration CLI.
- This scenario is authoritative for the command name. Older `slock`/`raft`
  wording elsewhere in this file describes internal names or compatibility
  history; it must not be copied into new runtime prompts.

### 2. Signatures

- Agent-facing command: `aura <domain> <action> ...`.
- Runtime-local executable aliases: `.slock/aura`, `.slock/aura.cmd`, and
  `.slock/aura.ps1`.
- Compatibility-only aliases: `.slock/slock*` and `.slock/raft*`.
- Internal implementation names remain `.slock`, `SLOCK_*`, and
  `dist/slock-cli.js`; renaming those storage/env/API seams is out of scope.

### 3. Contracts

- Every managed runtime prepends its generated workspace `.slock` directory
  to the child `PATH`. That runtime-local path must win over any host/global
  executable named `aura`; the package-level global `aura` entry is the daemon
  command and is not the agent collaboration CLI.
- Managed runtime first start must not depend on a preinstalled global
  `aura`, `slock`, or `raft`, an existing workspace, or collaboration CLI
  state under the user's HOME. Once the daemon package is running, it creates
  the workspace wrapper and injects the complete runtime-local identity.
- Claude, Codex, Codex ACP, OpenCode, and Pi prompts use only bare
  `aura ...` collaboration commands. Prompts must not expose, recommend, or
  fall back to generated absolute `.slock/{slock,raft,aura}` paths.
- Startup warmup calls `aura server info` for runtimes that perform a provider
  warmup. This intentionally proves the PATH contract instead of bypassing it
  with an absolute wrapper path. Pi remains lazy and does not spend a synthetic
  provider turn at daemon startup; its first-start PATH contract is verified at
  the child-environment boundary before the first real turn.
- `slock` and `raft` wrappers remain for compatibility with old sessions and
  imports, but new runtime behavior and tests do not advertise them.
- Activity command previews reflect the actual provider tool input. They keep
  proxy-secret redaction, but they must not rewrite a long wrapper path into a
  different-looking short command. Correct short previews come from executing
  bare `aura`, not from display-layer substitution.
- Prompt changes in this migration are mechanical: command tokens and the PATH
  explanation change; task, safety, credential, routing, and communication
  semantics remain unchanged.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Runtime-local `.slock/aura` exists and PATH is injected | Bare `aura server info` resolves to the workspace wrapper. |
| Host/global `aura` also exists | Runtime-local wrapper wins because `.slock` is first in PATH. |
| OpenCode child starts | It receives the same PATH/SLOCK_HOME identity boundary as the other managed runtimes. |
| Provider reports `aura message send ...` tool input | Activity shows that exact semantic command after secret redaction. |
| Provider reports a legacy absolute wrapper path | Activity does not pretend it executed a different command; tests/runtime prompt must expose the upstream regression. |

### 5. Tests Required

- Wrapper: generated POSIX/cmd/PowerShell `aura` aliases target the agent CLI,
  and the runtime-local wrapper directory is the first PATH component.
- Clean first start: create a temporary HOME and empty workspace, place a
  deliberately wrong host `aura` later on PATH, and prove the Claude,
  Codex/Codex ACP, OpenCode, and Pi child environments all execute the newly
  generated workspace wrapper instead of the host command.
- Prompt: every managed runtime advertises `aura` only and contains no
  generated absolute wrapper path or `slock`/`raft` command example.
- OpenCode: child environment sets `SLOCK_HOME`, runtime identity fields, and
  PATH consistently while removing proxy-secret environment variables.
- Warmup: daemon integration proves each non-lazy warmup prompt asks for
  `aura server info` and never interpolates `runtime.wrapper.bashWrapper`;
  Pi coverage preserves its lazy-start exception and verifies the same PATH
  resolution through `buildPiRuntimeEnv`.
- Activity: proxy internals remain redacted and a short `aura` command remains
  unchanged; there is no wrapper-path collapsing assertion.

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
  - Raw/control event: `{type:"control", command:{type:"start_runtime"|"stop_runtime"|"restart_runtime"|"cancel_turn", agentId, workspaceId?, config?}}`
  - JSON-RPC control notification: `{jsonrpc:"2.0", method:"daemon.command.start_runtime"|"daemon.command.stop_runtime"|"daemon.command.restart_runtime"|"daemon.command.cancel_turn", params:{agent_id|agentId, workspace_id|workspaceId?, config?}}`
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
- POSIX `.slock/slock` must pass those variables as command-scoped assignments immediately before `exec`, not as standalone `export SLOCK_*` lines. Standalone export lines are easy for shell tracing, wrapper inspection, or runtime activity previews to surface as noisy output and may expose local proxy token-file paths.
- Existing-runtime import must remain backward-compatible with both old standalone `export KEY='value'` wrappers and new command-scoped `KEY='value' \` wrappers.
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
  - Creating an agent member may register its `AgentWorkspace` without immediately starting a runtime when the API request explicitly sets `autoStart:false` or `startRuntime:false`. In that case, store `runtimeDesiredStatus:"stopped"`, keep the workspace `status:"stopped"`, and do not push a `start_runtime` command to the daemon. The default remains autostart for existing callers.
  - each runtime has its own proxy registration, generated `.slock` wrapper directory, token file, workspace path, captured session id, restart timer, stall watchdog, and lifecycle status.
  - dynamic `start_runtime` commands may arrive through `/daemon/register`, `/daemon/heartbeat`, polling `/events`, or `/ws`; all transports must dispatch the same parsed command object.
  - dynamic runtime workspaces must be isolated. If a command omits `workspacePath`, use a per-Server, per-Computer, and per-workspace path under the daemon workspace root: `<daemon workspace root>/.slock-runtimes/<serverId>/<computerId-or-machineId>/<workspaceId>`. If the backend does not provide `workspaceId`, fall back to the agent id for the final path segment. Never share the daemon root `.slock` wrapper between dynamic agents from different Servers or different Computers.
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
- TaskRun completion observability:
  - runtime activity remains ActivityLog/trace telemetry; do not create a separate runtime-activity table for TaskRun rows.
  - daemon-owned TaskRun lifecycle reports may update `tokenUsage`, `contextUsage`, `toolUsageSummary`, and `outputMessageId` on the existing TaskRun.
  - completed runs with missing output/token/context/tool evidence must be classified by the API serializer so `/control/integration` can show a concise human-readable gate result.
  - `tokenUsage.totalTokens` may include `cacheReadInputTokens` because it is billing/usage evidence.
  - `contextUsage.knownTokens` and `contextUsage.occupancyRatio` must not fall back to cache-inclusive totals. If no runtime usage event reports active context directly, use `inputTokens + outputTokens` as the fallback known-token value, then divide by `contextWindow`.
  - `contextWindow` may arrive through provider-specific `modelUsage.{model}.contextWindow`; prefer non-`total` model entries before aggregate `total`.
- Daemon launch / lease preflight:
  - daemon WebSocket URLs must include `daemonId`; backend WS activity/acks may renew a computer lease only when the daemon id matches the active lease or the previous lease is expired.
  - packaged daemon starts that omit `--workspace` use the stable default daemon workspace root `~/.smallkhoj/daemon/workspaces` or `SMALLKHOJ_DAEMON_WORKSPACE_ROOT` / `SMALLKHOJ_DAEMON_HOME/workspaces`. Development or custom starts may pass `--workspace`, but runtime paths under that root must still include server and computer segments.
  - runtime warmup must call the generated project wrapper path such as `{workspace}/.slock/slock server info`, not a global `slock` binary on `PATH`.
- Lifecycle:
  - busy means a child process is running.
  - queued Slock events must flush only after a terminal child exit or semantic completion.
  - exit code `0` is success; non-zero exits require diagnostic classification before deciding whether to retry, surface an error, or suppress a known harmless CLI quirk.

### 4. Validation & Error Matrix

- CLI not found -> surface the `runtimeCommandDetectionError()` warning and fail the runtime start; do not silently fall back to another runtime.
- no `thread.started.thread_id` on first successful turn -> keep runtime usable for one-shot work, but mark session continuity degraded.
- malformed stdout JSON before any structured event -> treat as text telemetry; after structured events, keep it as raw diagnostic only.
- child exits while messages are queued -> flush the next message exactly once.
- child stalls past configured timeout -> emit liveness warning, then terminate according to daemon stall policy.
- resume fails because session id is invalid/missing -> classify as session-continuity failure and start a new session only if the control-plane policy allows it.
- MCP server config cannot be resolved -> continue without that MCP server only if Slock CLI communication still works; otherwise fail closed.
- conflicting daemon WS activity while an unexpired lease belongs to another daemon -> do not extend the old lease; leave takeover to lease expiry or explicit replacement policy.
- generated Slock wrapper is missing or shadowed by a global CLI during warmup -> fail/degrade with a wrapper/preflight diagnostic; do not report runtime ready as if Slock connectivity was proven.
- TaskRun completion has token usage and a context window but only cache-inclusive totals -> keep `totalTokens` visible, but classify context occupancy from non-cache active tokens; do not raise a context-risk warning from cache reads alone.

### 5. Good/Base/Bad Cases

- Good: a DM event starts `codex exec --json`, captures `thread.started.thread_id`, Codex uses `slock message send`, daemon records usage and final exit, then the next DM resumes the same thread id.
- Base: Codex emits command/tool JSONL and a final answer but no token usage; daemon still records the session id and stream events, with usage omitted.
- Bad: daemon passes the full Slock event body as a command-line argument; other local processes can inspect it through process listings.
- Bad: daemon rewrites `~/.codex/config.toml` to add MCP or developer instructions; concurrent user Codex sessions inherit the wrong agent identity.
- Bad: TaskRun context pressure shows 174% because `cacheReadInputTokens` was added to `knownTokens`; this confuses billing/cache reuse with current context occupancy.
- Bad: a newly started daemon without the correct `daemonId` in WS activity keeps renewing an old daemon lease and prevents the real runtime workspace from taking over.

### 6. Tests Required

- Unit: build first-turn args and resume args, asserting prompt is stdin-only and thread id placement matches `codex exec resume --help`.
- Unit: parse `thread.started`, `item.started`, `item.completed`, `turn.completed`, malformed JSON, and stderr diagnostics.
- Unit: queue behavior sends one child at a time and flushes exactly one queued message after each exit.
- Integration: fake Codex CLI receives generated Slock wrapper in `PATH`, isolated workspace `cwd`, and no proxy secret env vars.
- Integration: resume session id from daemon restart is reused for the next turn.
- Regression: global Codex config files are not created or modified by daemon-managed runtime launch.
- Regression: the generated POSIX wrapper does not contain standalone `export SLOCK_AGENT_PROXY_URL` or `export SLOCK_AGENT_PROXY_TOKEN_FILE` lines, while the import path still parses command-scoped single-quoted assignments.

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
- Trigger: launching the resident ACP runtime from a Daemon that may itself have been installed or started through `npx --package`.
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
- Child environment boundary:
  - `buildCodexRuntimeEnv(options, baseEnv) -> NodeJS.ProcessEnv`
  - `CodexAcpBridgeOptions.env?: NodeJS.ProcessEnv`
  - Outer npm launcher selectors `npm_config_package` and `NPM_CONFIG_PACKAGE` are not child runtime configuration.

### 3. Contracts

- ACP child process is a runtime-session carrier, not a one-turn CLI.
- The daemon may cache one ACP child per live Codex session, then evict idle sessions by TTL/count once product policy is defined.
- `session/update` notifications are runtime telemetry. Translate at least:
  - `agent_message_chunk` -> message delta telemetry.
  - `agent_thought_chunk` -> `thought_delta` -> a runtime `thinking` content block. Diagnostic warning/error text is not thought evidence and must be emitted as `runtime_warning` / `runtime_error` activity instead of being labeled Thinking.
  - `tool_call` -> tool-use telemetry.
  - `tool_call_update` terminal statuses -> tool-result telemetry.
  - `usage_update` -> token/context accounting; preserve `used` and `size` so TaskRun summaries can compute context occupancy when a window is available.
- `session/new` creates a new runtime session; `session/load` restores an existing runtime session. A failed load must be surfaced as a session-continuity error, not silently converted to a new session.
- MCP servers are passed to ACP `session/new` / `session/load`, so session-scoped headers such as Slock/session tokens belong there, not in global Codex config.
- Process cleanup must terminate the process group when launched through wrappers such as `npx`, otherwise the smoke can finish the turn but leave the ACP child alive.
- `buildCodexRuntimeEnv` must remove lowercase and uppercase outer npm package selectors while preserving unrelated npm registry/proxy/cache/TLS settings. The ACP package is selected by explicit child argv, never by an inherited outer launcher option.
- When `CodexAcpBridgeOptions.env` is provided, it is the complete caller-owned child environment. `CodexAcpBridge.start()` must not merge `process.env` back into it, because omission is how the caller revokes launcher-only keys. Only an omitted `options.env` falls back to `process.env` for standalone smoke usage.
- Codex ACP warmup result readiness is explicit: only `type:"result", subtype:"success"` may complete the result gate. Error, cancelled, or structurally incomplete results do not become ready; the separate process-exit event owns the numeric exit code. Successful `session/new` / `session/load` remains an independent positive readiness signal.
- An unexpected ACP process exit and a later ACP bridge/driver close are separate causal observations. The process-exit `runtime_error` owns `status:"exited"`, `phase`, `exitCode`, `signal`, and captured `stderr`; a later driver `runtime_error` owns `source:"driver"`, its own `phase`, and the bridge error such as `ACP connection closed`. Do not mutate the earlier row or require both causes to appear in one `ActivityLog`.

### 4. Validation & Error Matrix

- `codex-acp` command missing -> smoke fails before daemon runtime selection changes.
- ACP initialize fails -> runtime state `failed_start`, no session id.
- `session/new` fails -> no active runtime session; report agent-visible startup error.
- `session/load` fails -> do not create a new session unless an explicit recovery policy allows it.
- prompt returns `stopReason:"cancelled"` -> invocation status `cancelled`.
- child exits while prompt is in flight -> reject the prompt and mark invocation failed, so backend does not remain `agent`/busy forever.
- stop/eviction must kill `npx` process groups on POSIX and direct child processes on Windows.
- Daemon inherited `npm_config_package=<daemon.tgz>` -> remove it before nested `npx -y @zed-industries/codex-acp@...`; do not let the nested launcher select the Daemon tarball again.
- Explicit bridge env omits a key that exists in `process.env` -> the key stays absent in the child; omission is not refilled from the parent.
- ACP emits `result:error` without `exitCode`, followed by child exit `127` -> never report `running`; preserve the later exit code and report the workspace as `exited`.
- Child exit `127`, then bridge emits `ACP connection closed` -> persist two `runtime_error` activities in event order; the process row keeps exit/stderr evidence and the driver row keeps the bridge error.

### 5. Good/Base/Bad Cases

- Good: `@zed-industries/codex-acp@0.16.0` starts through `npx`, creates an ACP session, streams `agent_message_chunk` deltas, emits `usage_update`, returns `stopReason:"end_turn"`, and exits cleanly after `stop()`.
- Good: public daemon runtime `codex` starts a managed ACP child, creates or loads a session, queues prompts while a turn is in flight, maps ACP updates into daemon-compatible `assistant` / `usage` / `result` events, and reports heartbeat workspace state with `runtime:"codex"`, `sessionId`, `pid`, and `status`.
- Good: a Daemon launched from a self-hosted tgz removes its outer package selector, preserves `npm_config_registry`, and the nested npx initializes the explicitly requested ACP package.
- Base: fake ACP server exercises initialize/session/prompt/update/cancel without requiring model credentials.
- Base: the standalone ACP smoke omits `options.env` and intentionally inherits the smoke process environment.
- Bad: use ACP only for prompt but keep Slock/MCP session headers in global `.codex/config.toml`; concurrent sessions can leak identity or lose per-session auth.
- Bad: kill only the `npx` wrapper and leave `codex-acp` running.
- Bad: sanitize a copied env and then spawn with `{ ...process.env, ...sanitizedEnv }`; deleted keys are absent from the second object and therefore reappear from the first.
- Bad: assert `exitCode`, `stderr`, and a later `ACP connection closed` description on the first activity row; those observations have different emitters and timing.

### 6. Tests Required

- Unit/integration: fake ACP child covers initialize, `session/new`, `session/load`, `session/prompt`, `session/update`, and process stop.
- Unit: `buildCodexRuntimeEnv` removes both package-selector casings and preserves an unrelated npm registry setting.
- Process integration: set an outer package selector, provide an explicit child env that omits it, and assert the ACP bridge child observes neither selector.
- Daemon integration: an ACP child exiting `127` before session creation produces `starting -> exited`, never `running`, and emits no running agent heartbeat.
- Daemon integration: the same exit-127 case separately asserts a process-exit `runtime_error` with `status:"exited"`, `phase:"starting"`, `exitCode:127`, and stderr, plus a later `source:"driver"` activity describing `ACP connection closed`.
- Smoke: real `@zed-industries/codex-acp` starts via npx and completes one prompt locally.
- Package smoke: build/extract the Daemon tgz, set that tgz as the outer selector, import the packaged runtime/bridge, and prove real ACP initialize succeeds through nested npx.
- Future runtime integration: daemon heartbeat includes ACP `sessionId`, `pid`, `busy`, queued count, and last event time.
- Future MCP integration: session-scoped Slock MCP headers are visible to the ACP session and not persisted globally.

### 7. Wrong vs Correct

#### Wrong

```text
Treat `codex-acp` as a global singleton for all agents and all channel workspaces.
```

```typescript
// Reintroduces keys deliberately removed by sanitizedEnv.
env: { ...process.env, ...sanitizedEnv }
```

#### Correct

```text
Keep ACP session identity scoped to one daemon-managed agent/workspace runtime, then add TTL/count eviction once reuse is proven.
```

```typescript
// Explicit env is authoritative; fallback only when no env was supplied.
env: { ...(options.env ?? process.env) }
```

#### Wrong

```text
process exit 127 + later ACP close -> rewrite one ActivityLog with both causes
```

#### Correct

```text
process exit -> runtime_error(status=exited, exitCode=127, stderr=...)
ACP bridge close -> runtime_error(source=driver, error="ACP connection closed")
```

## Scenario: Runtime-Specific Stream Events Use A Shared Activity Contract

### 1. Scope / Trigger

- Trigger: changing Claude stream-json, Codex ACP, OpenCode Server/SSE, or Pi
  stream-event normalization that feeds the Agent Activity timeline.
- Activity remains observability telemetry. This translation must not create an
  `EventRecord` or deliver a runtime's own state back as work.

### 2. Signatures

- Translator:
  `translateRuntimeStreamActivity(runtime, event) -> RuntimeStreamActivitySignal[]`.
- Codex source marker: `stream_event.acpUpdate`, for example
  `agent_thought_chunk`, `agent_message_chunk`, `tool_call`, or
  `tool_call_update`.
- OpenCode source marker: `stream_event.opencodeEvent`, for example
  `message.part.delta` or `message.part.updated`.
- Shared Activity kinds stay `runtime_working`, `runtime_thinking`,
  `runtime_output`, `runtime_idle`, `runtime_warning`, and `runtime_error`.

### 3. Contracts

- All providers preserve the established Claude Code observable product
  semantics: accepted inbound work becomes Working; assistant analysis,
  narration, and transcript previews become Thinking; real tool execution
  becomes Output described as `Ran <tool>`; provider completion becomes Idle.
- Every Thinking row includes a bounded, readable `details.thought`. Every
  `Ran <tool>` Output includes a sanitized `details.commandPreview`. Activity
  details remain bounded summaries, never full provider transcripts.
- Codex ACP `agent_thought_chunk` and `agent_message_chunk` are provider wire
  variants of assistant analysis/narration and therefore normalize to the same
  Thinking product state. Neither may synthesize `Generated output`.
- OpenCode records message role by message id. User-authored text parts and
  delivered `[event=...]` envelopes are filtered; assistant text and explicit
  reasoning/thinking parts normalize to Thinking. Generic connection/session
  SSE events are not Activity rows.
- Tool start is deduplicated by tool-call id and becomes the one visible
  `Ran <tool>` Output row. Terminal tool updates remain available for TaskRun
  accounting and provider completion, but do not add `Tool completed` or
  `Tool failed` rows when the Claude baseline does not show them.
- Warning/error diagnostics keep their diagnostic Activity kinds before any
  normal text classification. They must not be mislabeled as Thinking/Output.
- Activity POSTs are serialized per runtime without blocking provider stream
  processing. Working, Thinking, Output, and Idle persist in observed order,
  and the result boundary's Idle row is last for the turn.

### 4. Validation & Error Matrix

| Input | Expected Activity behavior |
| --- | --- |
| Codex thought/message narration | Thinking with bounded `details.thought`; no `Generated output`. |
| OpenCode assistant reasoning/text | Thinking with bounded `details.thought`. |
| OpenCode user text or `[event=...]` envelope | Ignored; never Thinking/Output. |
| Generic OpenCode connect/session event | Ignored; no Activity row. |
| Real tool start, including duplicate start id | One `Ran <tool>` row with sanitized `details.commandPreview`. |
| Terminal tool update | TaskRun/provider telemetry only; no invented second Activity row. |
| Diagnostic-shaped assistant text | Warning/Error; no Thinking/Output row for that text. |
| Provider `result` after a delayed Output POST | Idle persists after the Output and clears per-turn tool dedup state. |

### 5. Good/Base/Bad Cases

- Good: a Codex turn shows Working -> Thinking -> Ran Bash -> Thinking -> Idle,
  matching Claude Code semantics while retaining ACP protocol/source metadata.
- Good: an OpenCode user message part is filtered, assistant reasoning is
  Thinking, a bash part is `Ran bash` with its command, and Idle persists last.
- Base: multiple consecutive narration deltas coalesce into the current
  Thinking state; a later post-tool narration transition may create a new
  Thinking row.
- Bad: map provider assistant text to a generic `Generated output` row with no
  readable preview.
- Bad: expose user input/session events as model activity, persist every text
  delta as a separate row, retain a full transcript, or add a tool-completion
  row absent from the baseline.

### 6. Tests Required

- Unit: assert Codex thought/message chunks both translate to Thinking with
  their exact `acpUpdate` source and no `Generated output` signal.
- Unit: assert OpenCode message-role filtering, reasoning/text normalization,
  real tool start command preview, ignored terminal result, and ignored generic
  SSE events using exact `opencodeEvent` sources.
- Regression: assert Claude plain-text compatibility remains Thinking and user
  transcript text never becomes Activity.
- Daemon integration: fake ACP emits message, thought, tool start/result, and
  result while the fake backend delays Output persistence; assert one readable
  Thinking row, one `Ran <tool>` row with command preview, no generated/terminal
  rows, and Idle last.

### 7. Wrong vs Correct

#### Wrong

```text
Codex/OpenCode assistant text -> Generated output
terminal tool update -> Tool completed
```

#### Correct

```text
accepted inbound message -> Working on message
assistant reasoning/narration -> Thinking + details.thought
real tool execution -> Ran <tool> + details.commandPreview
terminal tool update -> no separate baseline Activity
provider result -> Idle persisted last
```

## Scenario: Daemon-Local Runtime Provider Selection

### 1. Scope / Trigger

- Trigger: users can select a local Claude or Codex provider/profile for a runtime, while provider credentials and launch details must remain local to the daemon machine.
- This is a cross-layer contract: daemon local capability detection -> backend capability display/storage -> `start_runtime` provider selection -> daemon-local runtime launch.

### 2. Signatures

- Daemon CLI:
  - `aaa-daemon start --runtime-provider <providerName>`
- Daemon local runtime command detection:
  - Claude Code command discovery starts with explicit env overrides (`SLOCK_CLAUDE_COMMAND`, `CLAUDE_COMMAND`), then platform-aware PATH/common-location probes for `claude`/`claude.cmd`.
  - Codex command discovery starts with explicit env overrides (`SLOCK_CODEX_COMMAND`, `CODEX_COMMAND`), then platform-aware PATH/common-location probes for `codex`/`codex.cmd`.
  - Detection code must not contain developer-specific absolute paths such as `/Users/<developer>/...`.
  - Detection code must not automatically discover or invoke `$HOME/.claude/cc-switch.ps1`, `ccs-claude`, or other provider-switching scripts as the product launch path.
- Manual provider inventory:
  - env var discovery order: `SLOCK_RUNTIME_PROVIDERS_JSON`, `AAA_DAEMON_RUNTIME_PROVIDERS_JSON`, `RUNTIME_PROVIDERS_JSON`
  - JSON shape: `[{id,name,runtime,model?,command?,commandArgs?}]`
  - `command` and `commandArgs` are daemon-local launch data only for explicit advanced opt-in; they must not be echoed through backend/public heartbeat payloads.
- CC Switch provider inventory:
  - default database discovery order: `SLOCK_CC_SWITCH_DB`, `CC_SWITCH_DB`, `$HOME/.cc-switch/cc-switch.db`
  - query local `providers` rows with `app_type in ('claude', 'codex', 'opencode')`
  - provider rows are parsed into sanitized public runtimes: `app_type='claude'` -> `claude_code`; `app_type='codex'` -> `codex`; `app_type='opencode'` -> `opencode`
  - DB paths, `settings_config`, auth payloads, provider tokens, and local command details remain daemon-local and are never sent to backend/public heartbeat payloads.
- Public/backend payload fields:
  - `Member.config.runtimeProvider?: string`
  - `AgentWorkspace.runtimeProvider?: string` in serialized responses
  - `Computer.detectedRuntimes[]` may include `{type:"claude_code"|"codex", status:"available", provider, runtimeProvider, model, source:"cc-switch"}`
  - `start_runtime.command.config.runtimeProvider?: string`
- Base runtime inventory shape (08-03 task `08-03-runtime-detection-four-runtimes`; verified against `agent/daemon/aaa-daemon/src/runtime/runtime-provider.ts` `detectedRuntimesForInventory()`):
  - `Computer.detectedRuntimes[]` always contains the fixed base list: `claude_code`, `codex`, `opencode`, `goose` each `status:"available" | "not_installed"` decided purely by local CLI detection (`detectClaudeCommand` / `detectCodexCommand` / `detectOpenCodeCommand` / `detectGooseCommand`), plus `pi` always `{type:"pi", status:"available", source:"bundled", version?}` — a missing bundled layout affects launch, not the detected shape.
  - Provider entries (cc-switch / ccs-claude / manual / opencode-config) are optional appended extras (`provider`, `runtimeProvider`, `model`, `source`) for the Provider dropdown. Base detection never depends on ccswitch: a machine without ccswitch still receives the complete base list.
  - `DetectedRuntime.status` includes `not_installed` end-to-end (daemon TS union + backend serialization passthrough). The daemon's own `config.runtime` is not reported as an inventory entry (no "configured claude_code shows only claude_code").
- Product write opt-in (07-31 task `07-31-07-31-daemon-write-and-computer-connect`):
  - `backend/services/daemon_control.py:runtime_start_command()` sets `config["allowWrites"] = True` on every server-managed `start_runtime`/`restart_runtime` envelope; the daemon lands it as `SLOCK_ALLOW_WRITES=1` in the child runtime env and in the generated `.slock`/`aura`/`raft` wrappers.

### 3. Contracts

- Canonical runtime identity is independent from provider and model identity. Public/runtime-family matching uses only `claude_code`, `codex`, `opencode`, `goose`, or `pi` after explicit alias normalization; `runtimeProvider`, `provider`, `runtimeModel`, and `model` are selection/evidence metadata and must never infer or cross-match the runtime family.
- `runtimeProvider` is a provider/profile name, not an API key, shell command, or serialized credential.
- The backend may store and return `runtimeProvider`, but it must not store API keys, CC Switch provider config, generated Claude settings files, command args, or auth headers.
- The daemon owns provider detection and launch resolution. If local CC Switch DB is unavailable, `detectedRuntimes` still includes whichever local runtime commands were detected, and default runtime launch uses those local commands.
- Detected manual and CC Switch providers are reported as sanitized capabilities only: `type`, `status`, `provider`, `runtimeProvider`, `model`, and `source`. Do not include executable paths, CC Switch DB path, provider config JSON, tokens, request headers, provider command, or command args.
- `backend` is a legacy/old display field. Do not infer `runtimeProvider` from `backend` during serialization or runtime start command construction.
- Creating or updating an agent may set `runtimeProvider` explicitly. Old `backend` values remain old data and must not silently become provider selections.
- If a Claude `start_runtime` command includes `runtimeProvider` and omits `runtimeCommand`, the daemon resolves the provider locally and starts the detected Claude Code command with daemon-owned Claude arguments and selected model/provider metadata. It must not invoke `cc-switch.ps1` or `ccs-claude`.
- If a Codex `start_runtime` command includes a CC Switch `runtimeProvider`, the daemon records the selected sanitized provider identity and starts public runtime `codex` using daemon-local command/config resolution. It must not mutate global CC Switch state through provider-switching scripts.
- Exact provider credential isolation must be implemented through daemon-local config generation if the CC Switch DB contains enough data. If not implemented yet, do not pretend that scripts are product behavior; report sanitized provider metadata and fail clearly when launch cannot be made local.
- If a manually configured `runtimeProvider` includes `command` / `commandArgs`, the daemon may use them for local launch resolution, but heartbeat and backend storage still carry only the provider id/name/model/source.
- If `runtimeCommand` is explicitly supplied, it takes precedence over provider resolution for test/custom-launch paths.
- Daemon workspace register/heartbeat payloads for provider-launched runtimes include `runtimeProvider`, but omit `runtimeCommand` and `runtimeModel` unless those were explicitly configured outside provider launch.
- Reconnect/re-register currently re-arms expected-running workspaces that are missing from daemon heartbeat, including last observed `stopped`, `offline`, `exited`, or `crashed` states. A future desired-state controller may narrow this once explicit stop/reset controls exist.
- Base runtime availability and provider inventory are independent signals (08-03). The base `detectedRuntimes` list answers "what can this machine run" from local CLI detection only; provider entries are additive metadata. Never require ccswitch (or any provider source) for the base list to be complete, and never flatten provider entries into the base runtime chips.
- Server-managed `start_runtime`/`restart_runtime` envelopes always carry `config.allowWrites:true` (07-31). This is the backend-side symmetric of the daemon CLI fail-closed rule: product-managed runtimes become writable (`SLOCK_ALLOW_WRITES=1` in child env + gated wrappers), while a standalone daemon CLI without the explicit opt-in still fails write commands with `WRITES_NOT_ALLOWED`. Do not "fix" one side by loosening the other.
- Child-process env authority (08-03 task `08-03-fix-codex-acp-exit-127`): once the ACP bridge receives an explicit child environment, that environment is complete and authoritative — the spawn boundary must never spread `process.env` back into it. Falling back to `process.env` is valid only when no child env is supplied. Nested `npx` launchers must strip the launcher-only package selectors (`npm_config_package` / `NPM_CONFIG_PACKAGE`, lowercase and uppercase) while preserving unrelated npm settings (registry, proxy, cache, certificates).
- ACP readiness is fail-closed: a `result` event may mark warmup complete only with explicit `subtype:"success"`; `subtype:"error"`, `subtype:"cancelled"`, a missing subtype, or a missing numeric exit code must not make the runtime ready. Successful ACP session create/load remains a valid readiness signal.
- Failed-start lifecycle truth: a runtime child that exits non-zero before session readiness must never emit a `running` workspace or agent heartbeat for that startup generation; the final workspace state stays non-running (`exited`) so the backend member goes offline, and later messages must not be represented as delivered to a runtime that no longer exists.
- Bundled Pi contract (07-28 task `07-28-runtime-select-guide`): the daemon reports `{type:"pi", status:"available", source:"bundled", version}` and Pi stays always-selectable as the zero-install fallback. Pi turns run through the backend MiniMax relay so users need no LLM key. Each full agent run/tool loop holds one capacity lease surfaced truthfully as `ready`/`waiting`/`running`/`exhausted`/`failed`; long-lived MiniMax credentials stay backend-only and never reach browser responses, daemon/Pi config, process args, or logs.

### 4. Validation & Error Matrix

- No detected `claude` command -> report Claude default capability as unavailable or omit provider launch, and emit a clear local command detection error rather than a generic `spawn claude ENOENT`.
- No detected `codex` command -> report Codex CLI capability as unavailable or omit provider launch, and emit a clear local command detection error.
- No local CC Switch DB or `sqlite3` available -> report no CC Switch provider capabilities; keep detected default runtime commands usable.
- `runtimeProvider` supplied but not found in local provider inventory -> daemon logs a sanitized warning and does not start that runtime.
- Manual provider JSON is malformed or contains unsupported runtime values -> skip those entries; keep other detection sources usable.
- `runtimeProvider` supplied with `runtimeCommand` -> daemon uses the explicit command and does not try to resolve the provider locally.
- Provider launch exits or crashes -> runtime follows normal runtime exit/crash reporting and restart policy.
- Backend receives `backend` only -> keep it as legacy/display data; do not create `config.runtimeProvider` from it.
- Daemon heartbeat contains provider runtime -> backend persists provider name only; command path/args must remain absent from public serialized workspace payloads.
- A detected/runtime workspace says `runtime:"codex"`, `runtimeProvider:"MiniMax"` -> it is a Codex candidate only; provider/model text containing `Claude`, `OpenCode`, or another runtime name cannot change that family.
- Machine has no ccswitch DB / ccs-claude / manual providers -> base `detectedRuntimes` still lists every base runtime; missing local CLIs report `not_installed`; nothing is dropped.
- Nested `npx` daemon starts a runtime child -> the child env contains no `npm_config_package`/`NPM_CONFIG_PACKAGE` selector; unrelated npm configuration survives.
- Bridge receives an explicit child env that omits a key -> the key stays absent at spawn; no `process.env` merge resurrects it.
- ACP child emits `result` with `subtype:"error"`/`"cancelled"`/missing subtype, or exits non-zero pre-session -> runtime never becomes ready, no `running` heartbeat is emitted, lifecycle reports `exited` with the real exit code.
- Server-managed `start_runtime` envelope lacks `config.allowWrites` -> runtime write commands fail `WRITES_NOT_ALLOWED` (daemon fail-closed semantics unchanged).
- Bundled Pi layout missing on disk -> `pi` still reports `{status:"available", source:"bundled"}`; the actual start fails clearly instead of graying out detection.

### 5. Good/Base/Bad Cases

- Good: `create_agent` receives `{runtimeProvider:"Kimi"}`; backend stores `Member.config.runtimeProvider`; daemon receives `start_runtime.config.runtimeProvider:"Kimi"` and launches the detected Claude Code command locally with selected model/provider metadata, without a switching script.
- Good: `SLOCK_RUNTIME_PROVIDERS_JSON` defines `local-codex-krill`; daemon heartbeat reports `{type:"codex", provider:"Local Codex Krill", runtimeProvider:"local-codex-krill", source:"manual"}` while launch resolution uses the local command privately.
- Good: CC Switch DB contains Codex provider `krill`; daemon heartbeat reports `{type:"codex", provider:"krill", runtimeProvider:"<local-provider-id>", source:"cc-switch"}` without exposing `settings_config`.
- Good: CC Switch DB contains Claude provider `Kimi`; daemon heartbeat reports `{type:"claude_code", provider:"Kimi", runtimeProvider:"<local-provider-id>", source:"cc-switch"}` without exposing `settings_config` or invoking `cc-switch.ps1`.
- Base: no CC Switch on the machine; the daemon reports only detected base runtime capabilities and starts default runtimes with detected local commands when no provider is selected.
- Base: daemon reports `Kimi`, `Zhipu GLM`, and Codex providers such as `krill` in `detectedRuntimes`; UI lists provider names/models but cannot see API keys, DB paths, settings JSON, or launcher arguments.
- Bad: storing `CCS_PROVIDER_DEFAULTS`, provider tokens, or provider command args on the backend.
- Bad: treating `backend:"Claude"` as `runtimeProvider:"Claude"`; that can block default Claude startup when no such CC Switch provider exists.
- Bad: shipping developer-specific paths such as `/Users/lee/...` in daemon discovery code.
- Bad: auto-discovering `$HOME/.claude/cc-switch.ps1` or launching `ccs-claude <provider> <model>` as product behavior.
- Bad: sending executable paths, generated settings paths, or provider DB paths through server APIs.
- Bad: treating MiniMax/provider/model metadata as proof of a Claude, Codex, OpenCode, or Pi runtime. MiniMax is a test provider/model choice, not a runtime contract.
- Bad: treating a missing ccswitch DB as "no runtimes detected" or flattening provider entries into the base runtime chips.
- Good: a ccswitch-free machine reports `claude_code`/`codex`/`opencode`/`goose` (missing ones `not_installed`) plus bundled `pi`; the create-agent runtime list stays fully usable.
- Good: a product `start_runtime` with `allowWrites:true` makes the child see `SLOCK_ALLOW_WRITES=1` and a gated wrapper, while a manual daemon CLI without the flag still fails closed.
- Bad: re-merging `process.env` into an explicit child env at the spawn boundary, resurrecting an omitted `npm_config_package` and redirecting a nested `npx` to the wrong tarball.
- Bad: accepting an ACP `result` without `subtype:"success"` as ready, or emitting `running` heartbeats for a startup generation that already exited non-zero.

### 6. Tests Required

- Backend unit tests:
  - runtime normalizers preserve canonical family identity and do not use provider/model fields to infer it.
  - `runtime_start_command` includes explicit `runtimeProvider` and does not require `runtimeCommand`/`runtimeModel`.
  - `backend` alone does not become `runtimeProvider`.
  - missing expected-running workspaces are re-armed to `pending_start`, but `runtimeDesiredStatus:"stopped"` is not re-armed.
- Daemon unit/integration tests:
  - runtime workspace/provider metadata with misleading names cannot cross-match another canonical runtime family.
  - detect Claude and Codex commands through env/PATH/platform candidates without hardcoded personal paths.
  - prove `$HOME/.claude/cc-switch.ps1` is not an implicit provider detection or launch source.
  - parse CC Switch Claude and Codex provider rows into sanitized public providers.
  - parse manual provider JSON and verify command/args are launch-only, not heartbeat payload fields.
  - selected Claude CC Switch provider resolves to detected Claude command and selected model, not a wrapper script.
  - daemon register/heartbeat reports provider capabilities and provider workspace state without command args.
- Real test:
  - create a marker agent with `runtimeProvider:"Kimi"`.
  - verify browser `/computers` shows the provider and running workspace.
  - verify API state shows `runtimeProvider:"Kimi"`, `runtimeCommand:null`, `runtimeModel:null`.
  - verify `smallkhoj-trace` contains `CC Switch provider: Kimi` and the selected model line.
- Inventory tests (08-03):
  - daemon unit: `detectedRuntimesForInventory()` reports the fixed base list with `available`/`not_installed` from CLI detection alone (ccswitch absent), appends sanitized provider extras when sources exist, and never derives a base entry from `config.runtime`.
  - backend/contract: `not_installed` survives serialization; Computers chips render English brand names with localized state text and do not flatten provider extras into the base chips.
- allowWrites cross-process contract (07-31):
  - backend unit: `runtime_start_command()` envelopes assert `config.allowWrites is True` while preserving existing runtime/provider fields.
  - daemon dynamic-control integration: an `allowWrites:true` payload makes a fake runtime see `SLOCK_ALLOW_WRITES=1`, a gated `.slock` wrapper, and a controlled `message send` reaching the fake upstream; a payload without the field returns `WRITES_NOT_ALLOWED`.
- Child-env authority and fail-closed readiness (08-03-fix-codex-acp-exit-127):
  - bridge/spawn tests: an explicit child env stays authoritative (omitted keys do not reappear from `process.env`); nested-npx codex child resolves the requested ACP package instead of the outer daemon tgz.
  - readiness tests: ACP `result` marks ready only on `subtype:"success"`; error/cancelled/incomplete results and pre-session non-zero exits produce no `running` heartbeat and an `exited` lifecycle with the real exit code.

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

#### Wrong

```javascript
const isClaude = JSON.stringify(workspace).toLowerCase().includes('minimax');
```

#### Correct

```javascript
const isClaude = normalizeRuntimeIdentifier(workspace.runtime) === 'claude_code';
```

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
  - assert WebSocket connection URLs append `daemonId` and the event cursor
  - assert backend WS activity from a conflicting daemon id does not extend an unexpired active lease
  - assert backend WS activity may take over after the previous daemon lease expires
- TaskRun observability tests:
  - assert completion summaries can extract `contextWindow` from `modelUsage.{model}.contextWindow`
  - assert fallback context occupancy excludes `cacheReadInputTokens` while preserving cache reads in `tokenUsage`
  - assert lifecycle reports with `workspaceId` backfill runtime workspace/computer/session fields on the TaskRun
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
- Capability registry: `services.agent_permissions.AGENT_PERMISSION_CAPABILITIES`.
- Runtime gate: `routers.agent_api._require_permission(member, capability)`.

### 3. Contracts

- Public management endpoints require `X-Public-Key`. Explicit `local-dev` flows default the canonical `PUBLIC_API_KEY` source to `sk_public_local`; production must use a non-development value and must never put it in a URL.
- Protected agent operations are explicit default-deny. Only a registry-known capability whose persisted value is boolean `true` allows; missing config, missing/JSON-null permissions, `{}`, absent entries, non-boolean values and unknown future capability names deny.
- New-agent creation persists a complete registry-shaped permission map. An omitted creation field materializes the historical effective known capabilities as explicit `true`; a partial map sets every omitted known capability to `false`; unknown/non-boolean creation values return `400`.
- Data-only runtime seed backfills only legacy agent rows whose permission field is absent or JSON null. Explicit `{}` is intentional deny-all and must never be backfilled. Newly added future capabilities remain denied until explicitly persisted.
- `POST /api/v1/computers/connect-command` request:
  - `name: string`
  - `serverUrl?: string`
- `POST /api/v1/computers/connect-command` response:
  - `connectToken: string` with `sk_connect_` prefix
  - `command: string`
  - `daemonInstall.installCommand: string`
  - `daemonInstall.downloadBaseUrl: string`
  - `expiresAt: iso datetime`
  - Must not include `computerId`, `apiKey`, or any `sk_machine_...` token.
- The command must contain:
  - `smallkhoj-daemon connect`
  - `--token sk_connect_...`
  - `--server ...`
  - It must not include `--agent-id`, `--register-daemon`, or `--runtime` by default and must not reference `@slock-ai/daemon`.
- Product-facing connect/reconnect commands must not contain absolute repository checkout paths such as `/Users/code/project/smallkhoj` or `agent/daemon/aaa-daemon`.
- `daemonInstall.installCommand` must be domain-aware. In production it should point at `https://<public-host>/downloads/smallkhoj-daemon/install.sh` or the configured `DAEMON_DOWNLOAD_BASE_URL`, never an internal Docker hostname or developer localhost URL.
- The packaged daemon CLI must support `smallkhoj-daemon --version`; the version comes from `agent/daemon/aaa-daemon/package.json` package metadata and is the value reported in connect/register/heartbeat payloads.
- Backend compatibility checks use `MINIMUM_DAEMON_VERSION`; daemon connect/register/heartbeat with a version below the configured minimum returns `426 Unsupported daemon version` before mutating computer state or consuming a connect ticket.
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
  - Daemon connect identity resolution is ordered: exact `(server_id, machine_id)` match first; if no machine match exists, a same-server same-name `Computer` may be adopted only when its daemon lease is not active; otherwise create a new row only when neither identity exists.
  - Same-name offline adoption updates the existing row's `machine_id`, daemon metadata, detected runtimes, machine token, active daemon lease, heartbeat, and status before returning the connect response.
  - Member display names are unique per server.
  - Lease fields are `active_daemon_id`, `daemon_lease_expires_at`, and `last_heartbeat_at`.
- Daemon behavior:
  - First startup creates a UUID `machineId` under `~/.slock/aaa-daemon/machine-id` unless `AAA_DAEMON_MACHINE_ID_FILE` or `SLOCK_MACHINE_ID_FILE` overrides it.
  - `SLOCK_CONNECT_TOKEN` is used only for `/daemon/connect`.
  - The returned `machineToken` is kept in memory and used for `/daemon/register`, `/daemon/heartbeat`, and agent-facing calls after a user-created agent exists.
  - The daemon credential should retain the connected `computer.id` and `machineId` from the `/daemon/connect` response when available. Default dynamic runtime cwd generation uses `serverId`, then `computerId` if present, then `machineId` as the computer segment. This keeps two Computer rows on the same physical host from sharing runtime wrapper/token/session files.
  - Without `--workspace`, product CLI runs use `~/.smallkhoj/daemon/workspaces` as the daemon workspace root. `SMALLKHOJ_DAEMON_WORKSPACE_ROOT` overrides the root directly; `SMALLKHOJ_DAEMON_HOME` changes the parent and appends `workspaces`.
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
- Same-name computer with no exact machine match and no active daemon lease -> reuse that computer, update `machine_id`, and issue a fresh machine token.
- Same-name computer with no exact machine match but an unexpired active lease -> `409 Computer already has an active daemon`.
- Duplicate computer name for a different exact machine match -> `409 Computer name <name> already exists`.
- Same `machineId` while its computer has an unexpired active lease -> `409 Computer already has an active daemon`.
- Same `machineId` after lease expiry -> reuse the existing computer and issue a fresh machine token.
- Daemon `register` / `heartbeat` with a different `daemonId` while the stored lease is expired -> accept and replace `active_daemon_id`; stale daemon ids must not block recovery after a process crash.
- Daemon `register` / `heartbeat` with a different `daemonId` while the stored lease is still active -> `409 Computer is leased by another daemon`.
- Duplicate member display name -> `409 Member name <name> already exists`.
- Invalid `computerId` for agent creation -> `400 Invalid computerId`.
- Unknown `computerId` for agent creation -> `404 Computer not found`.
- Missing channel/member identifiers keep their existing `400`/`404` behavior.
- Missing/empty permission map or absent capability -> `403 Permission denied: <capability>`.
- Unknown capability, even if a row stores it as `true` -> `403`.
- Agent creation with an unknown permission or non-boolean value -> `400`; partial known maps are expanded with omitted capabilities set false.

### 5. Good/Base/Bad Cases

- Good: browser generates a connect command; no computer row appears until daemon calls `/daemon/connect`.
- Good: daemon connects with a persistent `machineId`; backend creates/reuses one computer and returns a fresh `sk_machine_...` token.
- Good: daemon lost/regenerated its local `machineId` but reconnects with the same local computer name after the previous lease expired; backend adopts the offline same-name row instead of creating a duplicate or returning a name conflict.
- Good: second daemon for the same online `machineId` is rejected until heartbeat lease expiry.
- Good: `/computers` shows the existing computer detail and reconnect action when a computer exists, not the new-computer connect form.
- Good: an expired, reused, or invalid connect command cannot kill a healthy same-server daemon; it exits before launching when the server-scoped wrapper lock points at a live process.
- Good: user creates an agent later on Members and binds it to the connected computer.
- Good: browser creates a channel, adds the agent by channel id/member id, sends a human message, and verifies an agent-authored response through `/internal/agent-api/send`.
- Good: an agent created with `{sendMessage: true}` persists every other known capability as false and cannot gain a capability merely because code adds a new registry entry later.
- Bad: generating a long-lived machine token from the browser and creating a computer before the daemon has proven it can connect.
- Bad: wrapper startup reads a pid lock, sends `SIGTERM` to that process, and only then attempts `/daemon/connect`; a stale retry with an invalid one-time token can otherwise kill a healthy daemon and fail authentication itself.
- Bad: putting `--agent-id aaaa...` into the default computer connection command, because daemon connect must not auto-create or steal an agent workspace.
- Bad: testing agent replies by posting to public `/api/v1/channels/{channel}/messages` with `sender: agentName`; that proves message rendering, not agent-facing auth/send contracts.
- Bad: `permissions is None -> allow`, truthy/wildcard permission checks, or seed code converting an explicit empty map into allow-all.

### 6. Tests Required

- API tests:
  - `connect-command` does not create a computer.
  - `/daemon/connect` creates a computer after a valid token.
  - Same offline `machineId` reuses the existing computer.
  - Same-name offline computer with a changed `machineId` reuses the existing computer and updates `machine_id`.
  - Same-name active computer with a changed `machineId` returns `409` and does not consume the connect ticket.
  - Same online `machineId` returns `409`.
  - Duplicate computer/member names return `409`.
  - Every registry capability requires explicit boolean true; missing/null/empty/unknown cases deny.
  - Creation rejects unknown/non-boolean values and expands partial maps default-false.
- Real PostgreSQL seed test runs twice and proves missing/null legacy maps are materialized while explicit `{}` remains unchanged.
- Expired or reused connect tokens return `401`/`409`.
- Daemon version below `MINIMUM_DAEMON_VERSION` returns `426` and does not consume the connect ticket.
- Daemon tests:
  - `machineId` is generated once and persists across restarts.
  - `--proxy-port 0` starts on an available port.
  - No `--agent-id` means no workspace payload.
  - Heartbeat renews the lease.
  - packaged `smallkhoj-daemon connect --token ... --server ...` works from outside the repository checkout.
  - packaged `smallkhoj-daemon --version` matches artifact manifest/package metadata.
  - `smallkhoj-daemon` uses server-scoped locks only as a guard: different server URLs can run together, same-server startup exits without killing the existing daemon, and connect/start modes `exec` the foreground daemon process.
- Browser E2E:
  - Generated command includes `SLOCK_CONNECT_TOKEN` and excludes `sk_machine_`.
  - Computer list does not show the pending computer until daemon connect succeeds.
  - Connected computer appears online and the pending command hides.
  - Existing computer detail is selected by default and the new-computer form is hidden unless a pending generated command is being displayed.
  - Duplicate agent name displays the backend `409` error.
  - DM route heading displays decoded `dm:` text, not `dm%3A`.

### 7. Wrong vs Correct

#### Wrong

```bash
npx @slock-ai/daemon@latest --server-url http://localhost:8000 --api-key sk_machine_...
```

#### Correct

```bash
smallkhoj-daemon connect --token sk_connect_... --server http://localhost:8000
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

#### Wrong

```python
if member.config.get("permissions") is None:
    return  # implicit allow
```

#### Correct

```python
permissions = (member.config or {}).get("permissions")
if capability not in AGENT_PERMISSION_CAPABILITIES \
        or not isinstance(permissions, dict) \
        or permissions.get(capability) is not True:
    raise HTTPException(403, f"Permission denied: {capability}")
```

## Scenario: Packaged Daemon Resolves Its Generated Slock CLI

### 1. Scope / Trigger

- Trigger: changing daemon packaging, `smallkhoj-daemon` onboarding commands,
  generated `.slock` wrappers, or the local `slock`/`raft` CLI entrypoint.
- This is a product onboarding contract: the daemon may be started from the repo
  wrapper, an installed binary, or an npm/npx `.bin` shim/symlink, but generated
  runtime wrappers must still execute the package's real CLI file.

### 2. Signatures

- Generated wrappers:
  - POSIX: `.slock/slock`
  - Windows CMD: `.slock/slock.cmd`
  - PowerShell: `.slock/slock.ps1`
- Package bin:
  - `smallkhoj-daemon` -> `dist/cmd/main.js`
  - `slock` -> `dist/slock-cli.js`
  - `raft` may be a compatibility alias when product naming migrates.
- Runtime helper:
  - `defaultSlockCliPath(): string`

### 3. Contracts

- `defaultSlockCliPath()` must resolve to the daemon package's actual
  `dist/slock-cli.js`, not to a path inferred from an npm `.bin` symlink parent
  such as `node_modules/slock-cli.js`.
- When `process.argv[1]` points at an npm/npx `.bin/smallkhoj-daemon` symlink,
  path resolution must follow the symlink to the real `dist/cmd/main.js` before
  deriving the sibling CLI path.
- If the process entrypoint is not a normal file path, for example `node -`,
  wrapper generation must fall back to the module-relative
  `dist/slock-cli.js`.
- Runtime process env may hide raw proxy token variables from Claude. The
  generated wrapper remains the authority for `SLOCK_AGENT_PROXY_URL`,
  `SLOCK_AGENT_PROXY_TOKEN_FILE`, `SLOCK_AGENT_ID`, and related fields.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Repo wrapper starts daemon from local `dist/cmd/main.js` | Generated wrapper calls local `dist/slock-cli.js`. |
| npm/npx `.bin/smallkhoj-daemon` symlink starts daemon | Generated wrapper calls package `@smallkhoj/smallkhoj-daemon/dist/slock-cli.js`. |
| Entry point is not realpath-able, e.g. `node -` smoke | Generated wrapper falls back to module-relative `dist/slock-cli.js`. |
| Generated wrapper points at `node_modules/slock-cli.js` | Regression; agent replies fail with `MODULE_NOT_FOUND`. |
| Bare global `slock` reports `MISSING_TOKEN` inside runtime | Not sufficient evidence of failure by itself; generated `.slock/slock` is the supported reply path. |

### 5. Good/Base/Bad Cases

- Good: a product-generated npx connect command starts the daemon, runtime uses
  `.slock/slock message send`, and the wrapper executes package
  `dist/slock-cli.js`.
- Base: local repo development uses `./smallkhoj-daemon`, which rebuilds local
  `agent/daemon/aaa-daemon/dist` and generates wrappers pointing at that local
  dist.
- Bad: deriving the CLI path from `process.argv[1]` without resolving symlinks;
  macOS/Linux npm `.bin` launchers then generate `node_modules/slock-cli.js`,
  which does not exist.

### 6. Tests Required

- Unit: simulate an npm `.bin/smallkhoj-daemon` symlink and assert
  `defaultSlockCliPath()` resolves to package `dist/slock-cli.js`.
- Unit/smoke: `writeSlockWrapper()` should generate an executable command whose
  CLI target exists and does not contain the root `node_modules/slock-cli.js`
  bad path.
- Package daemon tests must continue to cover repo wrapper, npx-style onboarding
  arguments, and generated wrapper execution through the local proxy.

### 7. Wrong vs Correct

#### Wrong

```typescript
resolve(process.argv[1], "..", "..", "slock-cli.js")
```

This works only when `process.argv[1]` is already the real
`dist/cmd/main.js`; it fails through npm/npx `.bin` symlinks.

#### Correct

```typescript
const entrypoint = realpathSync(process.argv[1])
const candidate = resolve(entrypoint, "..", "..", "slock-cli.js")
```

Verify the candidate exists and fall back to a module-relative CLI path when
the entrypoint is not realpath-able.

## Scenario: Vendor Runtime Capability Boundary and Reliable Wakeup

> Methodology note: this scenario is forward-looking design guidance. Its
> state vocabulary and evidence fields describe a target model, not tables or
> columns that exist today; do not treat this section as a per-line
> code-assertion base.

### 1. Scope / Trigger

- Trigger: changing daemon/runtime delivery, adding a vendor CLI/ACP/app-server adapter, introducing durable queued work, claiming busy/idle semantics, or proposing `wait` / Agent RPC continuation.
- This is a control-boundary rule: SmallKhoj owns a Business Work Item and Dispatch Attempt; it initiates/observes an Adapter Invocation. Provider Session, Provider Turn, tool loop, compaction, and model generation remain provider-owned unless a surface emits explicit evidence.
- Evidence source: task `07-13-agent-runtime-capability-matrix` and its versioned `provider-capability-matrix.md`. Do not generalize one Provider/surface result to another surface.

### 2. Signatures

- Future durable work state vocabulary (not a claim that these tables already exist):
  - `persisted` → `queued` → `submitted` → `adapter_terminal`
  - `delivery_uncertain` is a terminal safety classification, not a retry state.
- Runtime capability fields to preserve per **exact surface/version**:
  - `surface`, `version`, `structuredEvents`, `observableCompletionBoundary`, `inputAcknowledgement`, `busyInputBehavior`, `cancelActiveInvocation`, `sessionUsableAfterCancel`, `steerActiveInvocation`, `providerTurnIds`, `toolCallEvents`, `compactionEvents`, `suspendContinuation`.
- Evidence fields for a probe or future adapter diagnostic:
  - `provider`, `surface`, `executionStatus`, `fixture.beforeDigest`, `fixture.afterDigest`, `providerSessionIds`, `providerTurnIds`, `terminal`, `sideEffectAssessment`, `cleanup`, `uncertainties`.
- Existing daemon driver seam remains `sendUserMessage(text)` / provider-specific prompt operations. A `result`, process exit, or `runtime_idle` activity is an Adapter boundary, not a semantic `handled` acknowledgement.

### 3. Contracts

- **Portable reliable wakeup**: persist actionable work outside model context; queue it while an adapter is busy; at a later observable invocation boundary, submit a complete new/resumed prompt; store Adapter terminal evidence separately from business semantic evidence.
- A durable queue/wakeup hint must be authoritative independently of model attention. `slock message check` is catch-up/context inspection, never the only correctness path for an explicit actionable Work Item.
- `inputAcknowledgement` means only that a transport/protocol accepted an input. `stopReason:end_turn`, `turn.completed`, process exit, or UI idle does not mean the agent understood, replied, changed a task, or completed a side effect.
- Provider session reuse / ACP `loadSession` capability / `--resume` can prove a later reference to context only after direct evidence. It must never be serialized as `suspendContinuation` unless an unfinished business/tool continuation was explicitly restored.
- Active steer, interrupt, and cancellation are provider-specific enhancements. They must have same-surface dynamic evidence, an explicit safety policy, and a durable queue fallback. A successful protocol response cannot be borrowed by Codex exec/ACP, Claude stream-json, Kimi prompt, or OpenCode serve.
- If a Provider process runs user-global hooks, plugin code, or any fixture-external action whose effects cannot be ruled out, classify the attempt as `delivery_uncertain`, stop that Provider case, and do not auto-retry. Do not inspect unrelated global configuration merely to explain the hook.
- Streaming evidence must preserve method/update shape and correlation while redacting model thought/message chunks, prompt content, hook payloads, opaque identifiers, credentials, and home paths. Raw transcript remains under `/tmp` only and is deleted after sanitization.
- Capability claims use these levels: `verified`, `conditional`, `unsupported`, `unverified`, `blocked`. `verified`/`conditional` require dynamic, same-surface evidence; absence from CLI help remains `unverified`. A reproducible explicit protocol rejection may support `unsupported` only for that surface/version.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| New work arrives while a vendor turn is active, but no dynamic active-steer evidence exists | Persist/queue it for a later invocation; do not write a second input based only on model attention. |
| Provider returns prompt/result/end-turn | Record completion evidence, but leave Work Item semantic outcome pending until reply/task/artifact/explicit ack is correlated. |
| Provider session id is available | It may be used as a candidate session reference; do not mark suspend/resume support. |
| Same-turn steer/interrupt response is accepted | Record exact turn/session correlation and constraints; retain durable fallback. |
| User/global hook or unknown external side effect occurs during probe/runtime experiment | Stop the case, classify `delivery_uncertain`, prohibit automatic retry. |
| Static help/schema omits a method | Mark capability `unverified`, not `unsupported`. |
| A model-bearing probe input write fails or times out | Consume the shared provider budget; no refund/retry by changing run id. |
| Streaming protocol emits many thought/message chunks | Persist aggregate counts/update kinds only; never task-local raw text. |

### 5. Good/Base/Bad Cases

- Good: a persisted `@` Work Item waits in a server-owned queue until an adapter becomes available, then is submitted as a complete later prompt; terminal and semantic acknowledgement remain separate.
- Good: a Kimi/OpenCode ACP adapter records `session/update` and `stopReason:end_turn` for serial prompts, but calls busy injection, cancel reuse, compaction, and continuation `unverified` until separately measured.
- Base: an adapter currently has an in-memory pending message array. It can remain a latency optimization, but it is not durable work truth.
- Bad: treating `runtime_idle` or a zero process exit as proof that a `@` was handled.
- Bad: declaring generic active steering because a different provider's protocol exposes `turn/steer`.
- Bad: retaining individual model reasoning chunks in backend logs, task evidence, or activity previews.

### 6. Tests Required

- Unit: capability assessment rejects `verified`/`conditional` claims without dynamic same-surface evidence.
- Unit: busy-input attribution prioritizes adapter queue, provider acknowledgement, same-turn correlation, parallel invocation, then explicit rejection; otherwise returns `unknown`.
- Unit: Adapter terminal and session resume do not produce semantic handled/suspend-continuation booleans.
- Unit: `delivery_uncertain` and external/unknown side-effect risk prohibit automatic retry.
- Unit: provider input ledger is shared across live run IDs and rejects a third model-bearing input.
- Unit: evidence recorder removes `agent_thought_chunk`, `agent_message_chunk`, hook payloads, and credential/home data while retaining aggregate protocol shape.
- Integration/spike: every provider-specific enhancement is run in a disposable fixture with owned-process cleanup and an evidence verifier before production adapter work is proposed.

### 7. Wrong vs Correct

#### Wrong

```text
runtime_idle
  → mark @ message handled
  → delete pending work
```

#### Correct

```text
runtime terminal observed
  → record Adapter Invocation outcome
  → retain/resolve Work Item only with separate semantic evidence
```

#### Wrong

```text
Codex app-server accepted turn/steer
  → enable mid-turn injection for every managed runtime
```

#### Correct

```text
Provider-specific steer evidence
  → opt-in adapter experiment with hook/side-effect policy
  → durable next-invocation queue remains the universal fallback
```

---

## Scenario: Graceful Runtime Cancellation

### 1. Scope / Trigger

- Trigger: cancelling an in-flight runtime turn from any entry point — backend lifecycle `action=cancel`, chat `POST /api/v1/agents/{id}/cancel-turn`, daemon `cancel_turn` control command, ACP `session/cancel` / `$/cancel_request`, Claude Code stream-json stdin interrupt, or stall-watchdog escalation.
- Evidence sources: tasks `08-15-agent-turn-cancel`, `08-15-acp-bridge-new-client-api`, `08-15-chat-cancel-claude`; watchdog ladder verified in `daemon.ts` and documented in `.agents/skills/smallkhoj-add-runtime` (Graceful cancel section).

### 2. Signatures

- Backend workspace path: `POST /api/v1/workspaces/{id}/lifecycle` body `{action:"cancel"}` -> `runtime_control_command()` -> `cancel_turn` control envelope carrying only `agentId` + `workspaceId` (no `config`).
- Backend member path: `POST /api/v1/agents/{memberId}/cancel-turn` -> resolve the agent's active workspace (status `running`/`pending`) -> reuse the same lifecycle cancel core.
- Daemon: `DaemonControlCommand.type === "cancel_turn"`; `cancelRuntimeTurn(agentId: string, workspaceId?: string): boolean`.
- Driver seam: `ManagedRuntimeDriver.requestGracefulCancel?(): boolean`.
- ACP dual channel: `bridge.prompt(sessionId, text, {signal?: AbortSignal})` -> transport-level `$/cancel_request` on abort; `requestGracefulCancel()` = `bridge.cancel()` (agent-domain `session/cancel`) plus per-turn `AbortController.abort()`.
- Claude Code stream-json stdin interrupt frame: `{"type":"control_request","request_id":...,"request":{"subtype":"interrupt"}}` (verified against claude 2.1.201).
- Stall watchdog: `stallCancelSentAt`, grace window `min(30_000, max(stallTimeoutMs, 5_000))` ms, progress marker reset via `markRuntimeProgress()`.

### 3. Contracts

- The `cancel_turn` envelope is minimal — `agentId` + optional `workspaceId`, no config. It is a request, not a state transition.
- Backend `action=cancel` performs zero state mutation: no workspace/agent status change, no runtime-provider availability check (the runtime is already running), computer-online check retained; it enqueues the control command and records one activity (`@handle 回合取消已请求 on <computer>`).
- `cancelRuntimeTurn` guards existence and workspace match only; a boot-configured runtime with no registered `workspaceId` is a per-agent singleton and matches an unscoped command. An idle runtime logs `runtime idle, nothing to cancel`; a runtime without `requestGracefulCancel` (pi/opencode today) logs `runtime does not support graceful cancel` — both are logged no-ops, never errors, never state changes.
- A cancelled turn settles through the existing event path: `stopReason=cancelled` result -> `runtime_idle`. Do not invent a new activity/event kind for cancellation.
- ACP dual channel: agent-domain `session/cancel` is the primary channel; transport `$/cancel_request` (AbortSignal) is the independent second path for agents that ignore `session/cancel`. `$/cancel_request` must not replace `session/cancel`, and its promise still settles on the peer's final response (possibly `RequestCancelled`).
- Claude stream-json: write the interrupt `control_request` to stdin only when busy and stdin is writable. `control_response` frames arriving on stdout must be filtered out of `stream_event` dispatch (record as daemon lines for diagnostics only), or they pollute the activity stream. After an interrupt, the turn's existing `result` path settles normally (`awaitingTurnResult` reset -> queued-message flush).
- `POST /api/v1/agents/{id}/cancel-turn` returns HTTP 409 when the agent has no active workspace (`running`/`pending`) on this server.
- Stall watchdog ladder for a busy runtime past `stallTimeout`: 1) send graceful cancel once (`stallCancelSentAt` set); 2) wait out the grace window `min(30s, max(stallTimeout, 5s))` — a cooperative `cancelled` settlement keeps the session/resume state intact; 3) only then terminate (SIGKILL). Any progress (`markRuntimeProgress`) resets the escalation markers.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| lifecycle `action=cancel` on a running workspace | Enqueue minimal `cancel_turn` envelope + one activity; workspace/agent/computer status unchanged. |
| `cancel_turn` for an idle runtime | Log `runtime idle, nothing to cancel`; no error, no state change. |
| Driver has no `requestGracefulCancel` (pi/opencode) | Log `runtime does not support graceful cancel`; no-op, not an error. |
| `cancel_turn` for unknown agentId or mismatched workspaceId | Log `runtime not running` warning; return false. |
| `POST /agents/{id}/cancel-turn` with no active workspace | HTTP 409. |
| Claude driver idle or stdin not writable | `requestGracefulCancel()` returns false; no frame written. |
| `control_response` frame on Claude stdout | Never dispatched as `stream_event`; kept as daemon log line. |
| Stall after graceful cancel sent | Hold through `cancelGraceMs` before SIGKILL; progress resets `stallCancelSentAt`. |

### 5. Good/Base/Bad Cases

- Good: busy goose/codex-acp turn receives `cancel_turn` -> `session/cancel` + `$/cancel_request` -> prompt settles `stopReason=cancelled` -> `runtime_idle`; session stays resumable.
- Good: chat-page stop button calls `POST /agents/{id}/cancel-turn`, which reuses the lifecycle cancel core with zero state mutation.
- Base: Claude interrupt writes the exact `control_request` frame; the subsequent result event resumes normal idle processing and queue flush.
- Bad: implementing cancel by SIGKILL first — it destroys the session/resume state the graceful ladder exists to preserve.
- Bad: `lifecycle action=cancel` writing a synthetic workspace status such as `cancelling`.
- Bad: emitting a bespoke `turn_cancelled` activity/event type, or letting `control_response` frames reach `stream_event` consumers.

### 6. Tests Required

- Daemon fake-ACP: hanging turn -> `requestGracefulCancel()` -> fake peer records `$/cancel_request` and the turn settles `cancelled`; drivers without the seam report not-cancellable; idle returns false.
- Daemon fake-claude: interrupt frame shape (`type`/`request_id`/`subtype`) asserted on stdin; `control_response` excluded from `stream_event`; busy state cleared by the fake result event.
- Daemon integration: deliver a turn via events -> heartbeat carries `cancel_turn` -> marker settles `cancelled` (boot runtime without workspaceId still matches).
- Backend: lifecycle `action=cancel` enqueues the minimal envelope and mutates no state (pytest); `cancel-turn` without an active workspace returns 409.
- Watchdog: grace window is honored before termination; `markRuntimeProgress` resets escalation.
- Real smoke: cancel mid-way through a long tool call (e.g. `--cancel-after-events`) proves true interruption — delta stream stops and the turn settles within seconds, not just an event count.

### 7. Wrong vs Correct

#### Wrong

```text
cancel_turn -> SIGKILL child now -> workspace=exited -> invent activity kind "turn_cancelled"
lifecycle action=cancel -> workspace.status = "cancelling"
```

#### Correct

```text
cancel_turn -> requestGracefulCancel (session/cancel + $/cancel_request | stdin interrupt)
           -> result stopReason=cancelled -> runtime_idle via the existing event path
lifecycle action=cancel -> enqueue cancel_turn envelope + activity, zero state mutation
```

---

## Scenario: New Runtime Onboarding Contracts

### 1. Scope / Trigger

- Trigger: adding or auditing a new agent runtime (ACP-resident, CLI turn-based, HTTP/SSE server, or bundled JS CLI) across daemon wiring, event contracts, product surfaces, and tests. Also for diagnosing "new runtime cannot create agents / missing from dropdown / wrong activity".
- Source of truth: `.agents/skills/smallkhoj-add-runtime` (distilled from task `08-06-goose-builtin-runtime` plus the 08-15 AGENTS.md prompt migration).

### 2. Signatures

- Shared translator: `src/runtime/acp-event-translator.ts` `translateAcpSessionUpdate()` -> AgentEvent schema, emitted as `{ runtime: '<name>', ...AgentEvent }` on `stream_event`.
- Prompt file seam: `writeAgentInstructionsFile({ workspacePath, systemPrompt })` writes `<workspacePath>/AGENTS.md` with marker-based idempotent merge.
- Frontend registry: `frontend/lib/runtime-options.ts` (`PRIMARY_RUNTIMES`, `RUNTIME_LABELS`, `publicRuntimeValue()`); brand-label tables in `app/(app)/computers/page.tsx` (`runtimeBrandLabel`), `app/(app)/daemon/page.tsx`, and `lib/control-plane.ts` (`runtimeLabel`).
- Backend alias gate: `backend/routers/public_api.py` `_normalize_runtime()`.

### 3. Contracts

- Every new runtime's stream events must flow through the shared `translateAcpSessionUpdate()` and emerge as the unified AgentEvent schema. Pseudo-Anthropic envelopes and private event shapes are forbidden. Any new `stream_event` consumer must handle both `item_*` types and the legacy envelope (`eventType === 'assistant'`) shapes.
- Tool failures must surface as `item_completed` + `status:"failed"` — daemon structured diagnostics read only this. Regex-scanning model text stays reserved for legacy-envelope runtimes and process stderr. If the agent omits toolName on `tool_call_update` (goose-style), the driver must remember `item_started` toolName by `callId` so failures do not degrade to "tool".
- The Slock system prompt is written once into workspace `AGENTS.md` by driver `start()` via `writeAgentInstructionsFile` (marker-idempotent merge that preserves agent-authored additions); each turn sends only the bare event text. Never concatenate the system prompt into every user message — the legacy `buildCodexPrompt` approach rolled ~9k tokens per turn into history, an order of magnitude overpayment measured in practice.
- Product wiring is part of the runtime contract: `PRIMARY_RUNTIMES` + `RUNTIME_LABELS` + `publicRuntimeValue()` and all three brand-label tables must list the new runtime. Missing any one spot makes the runtime invisible (daemon reports `available` but the UI filters it out) and users cannot create agents — goose shipped with exactly this hole.
- Daemon wiring is a checklist of independent failure points, all required: `types.ts` `RuntimeType`; `daemon.ts` `DaemonRuntimeImplementation` union, `normalizeDaemonRuntimeType()` aliases, `start()` boot autostart condition (a separate branch from the factory — missing it means a configured runtime never starts at boot), factory branch, `session`-ready branch, PATH detection (`requiresDetectedRuntimeCommand()` / `runtimeCommandDetectionError()`), `sessionManager.upsert` default command; `cmd/main.ts` CLI flag; `runtime-activity.ts` union + `runtimeProtocol()`; `providers/local-command-provider.ts` + `provider-types.ts` + `runtime-provider.ts` inventory entry; backend `_normalize_runtime()` aliases.
- Test ladder per gate level: translator/driver unit tests -> bridge smoke against the real binary (`npm run smoke:<name>`: initialize -> createSession (codec encode) -> prompt (real streaming + usage) -> loadSession (codec decode)) -> isolated daemon E2E (boot autostart, codec session ids, AgentEvent stream, structured tool failure, per-agent data dirs) -> isolated full-stack E2E -> `./twd` UI acceptance reconciled with `GET /api/v1/activity`.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| New runtime emits a private/pseudo-Anthropic envelope | Reject in review; route through `translateAcpSessionUpdate()` to AgentEvent. |
| Driver appends the system prompt to each user message | Reject; `AGENTS.md` once at `start()`, bare event text per turn. |
| `PRIMARY_RUNTIMES` or any brand-label table misses the new id | Product bug: runtime invisible even though daemon reports it available. |
| Boot autostart condition or factory branch added alone | Configured runtime never starts (or never starts at boot); both sites required. |
| `tool_call_update` lacks toolName | Driver recalls `item_started` toolName by `callId`; diagnostics keep the real tool name. |
| New `stream_event` consumer handles only `item_*` or only legacy envelopes | Reject; both shapes must be handled until legacy runtimes are gone. |
| Smoke "green" with zero usage and error-shaped deltas | Not a pass: an LLM error turn streams the error text as deltas; require real streaming output and usage > 0. |

### 5. Good/Base/Bad Cases

- Good: goose events all arrive as `{runtime:'goose', ...AgentEvent}` through the shared translator; warmup gate, usage accounting, and control-output capture (`item_delta`) work unchanged.
- Base: a native-config runtime keeps its own LLM credentials; the daemon only clears conflicting relay env (`ANTHROPIC_*`...) and sets platform switches.
- Bad: a new driver emitting `assistant`/`user` pseudo-Anthropic frames to reuse an old parser.
- Bad: shipping daemon wiring without `frontend/lib/runtime-options.ts` updates — the runtime exists but no user can create it.
- Bad: counting `item_delta` frames alone as smoke success while the turn is actually an LLM error.

### 6. Tests Required

- Unit: translator tests mirroring `test/acp-event-translator.test.mjs`; driver lifecycle; `runtime-activity.test.mjs` AgentEvent-path assertions.
- Bridge smoke (real binary): initialize (+capability meta) -> createSession (codec encode verified) -> prompt (real streaming, usage > 0) -> loadSession (codec decode verified).
- Isolated daemon E2E (in-process `DaemonCore` + fake backend + isolated HOME): boot autostart, namespaced session ids, AgentEvent stream, structured tool failure, per-agent data directories, concurrent instances with distinct agentIds.
- Full-stack E2E + `./twd`: create-dialog shows and accepts the runtime -> real agent starts -> DM reply arrives via `aura message send` -> activity shows Working/Thinking/Output/Error and Idle with real per-turn tokens, reconciled against `GET /api/v1/activity`.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Per-turn prompt assembly (legacy buildCodexPrompt style, ~9k tokens/turn).
await bridge.prompt(sessionId, `${SYSTEM_PROMPT}\n\n${eventText}`);
// Private envelope to reuse an old parser.
emit('stream_event', { eventType: 'assistant', message: chunk });
```

#### Correct

```typescript
// Once at start(); marker-idempotent merge into workspace AGENTS.md.
await writeAgentInstructionsFile({ workspacePath, systemPrompt });
// Per turn: bare event text; shared translator owns the schema.
await bridge.prompt(sessionId, eventText);
emit('stream_event', { runtime: 'goose', ...translateAcpSessionUpdate(update) });
```

---

## Scenario: TaskRun Status, Templates, And Timestamps

### 1. Scope / Trigger

Use this spec when touching TaskRun status fields, TaskRunTemplate defaults,
or TaskRun lifecycle timestamps. Evidence: tasks `06-25-taskrun-config-templates`
(three-lens design direction) and `06-24-channel-taskrun-model` (tz-aware rule).

### 2. Signatures

```text
TaskRun.status        # single enum column (models/slock.py):
                      # queued|dispatched|running|awaiting_input|completed|failed|cancelled
TaskRunTemplate       # user-editable preset; direct dispatch resolves config from one
```

### 3. Contracts

- Current schema is a SINGLE `status` enum column. The three-lens model from
  06-25 (objective / runtime-session / participant as separate columns,
  e.g. an `objective_status`) is a DESIGN DIRECTION, not implemented — do not
  read or write `objective_status` today; code against the enum above.
- Whatever the lens model evolves into: `completed` must never destroy or
  detach the runtime session — the run stays recoverable and inspectable
  (evidence replay, trace, cursor audit).
- Direct task dispatch resolves its config from a `TaskRunTemplate`; there is
  no freeform fallback — a missing template is a caller error, not a default.
- All TaskRun lifecycle timestamps are timezone-aware. Naive datetimes must
  never be written or compared against aware ones; a naive/aware mix produces
  false "stale" verdicts.

### 4. Validation & Error Matrix

- template id missing/unknown on direct dispatch -> 4xx caller error, no TaskRun row
- naive datetime in a lifecycle field -> reject at write boundary
- unknown status value -> rejected by the column CheckConstraint

### 5. Good/Base/Bad Cases

- Good: run completes; runtime session idles and stays attached; reopening the run replays evidence.
- Base: fresh run from a template; status walks the enum in order.
- Bad: inferring `completed` from runtime exit alone, or tearing down the session on completion.

### 6. Tests Required

- Unit: template resolution failures produce 4xx with no row written.
- Unit: naive-datetime write is rejected at the boundary.
- Integration: completing a run leaves the runtime session alive and the run inspectable.

### 7. Wrong vs Correct

#### Wrong

```python
run.objective_status = "completed"   # column does not exist (AttributeError)
run.done = runtime_exited            # folding lenses into one flag
run.finished_at = datetime.utcnow()  # naive timestamp
```

#### Correct

```python
run.status = "completed"             # the real enum column
run.finished_at = datetime.now(timezone.utc)  # tz-aware
# runtime session stays attached for evidence replay
```
