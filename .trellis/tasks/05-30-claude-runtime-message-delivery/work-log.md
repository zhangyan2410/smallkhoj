# Claude Runtime Daemon Work Log

Date: 2026-05-30 to 2026-05-31

This note records what was built during the four-hour daemon runtime session. It is written for a human reader first: the goal is to make the code path visible before someone has to read every file.

## Starting Point

The daemon had already proved that a Claude Code process could be launched and could reach Slock through a generated `slock` wrapper. That proof was useful, but several parts were still temporary or incomplete:

- Claude Code was spawned, but stdout was mostly treated as raw lines.
- The daemon did not formally write stream-json user messages to Claude stdin.
- WebSocket and proxy inbox events were not consistently delivered into the Claude runtime.
- Freshness checks existed as an idea, but stale sends were not reliably held.
- Session resume, crash recovery, trace events, and stall recovery were not explicit runtime concepts.
- `attach.ts` sent JSON-RPC to the wrong HTTP surface.
- `client-handler.ts` had incomplete method forwarding and used the wrong local bearer auth.
- MCP needed to remain a compatibility bridge, not become the chat/task transport.

## Main Decision

We kept the Slock communication path aligned with the real runtime model:

```text
Claude Code
  -> generated .slock/slock wrapper on PATH
  -> slock CLI
  -> aaa local AgentProxy with sap_* bearer token
  -> Slock agent API or imported managed Slock proxy
```

MCP remains intentionally narrow. It exposes only the compatibility no-op tool, while chat, task, channel, reminder, profile, integration, attachment, and knowledge traffic flows through the CLI/proxy path.

## Runtime Process Work

File: `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts`

Added a formal `ClaudeRuntimeDriver` stream-json layer:

- Builds Claude args with permission bypass flags:
  - `--allow-dangerously-skip-permissions`
  - `--dangerously-skip-permissions`
  - `--permission-mode bypassPermissions`
  - `--input-format stream-json`
  - `--output-format stream-json`
  - `--disallowed-tools EnterPlanMode,ExitPlanMode,ScheduleWakeup,CronCreate,CronList,CronDelete`
  - `--append-system-prompt-file .slock/claude-system-prompt.md`
- Writes `.slock/claude-system-prompt.md` before starting Claude.
- Injects runtime env vars such as `SLOCK_HOME`, `SLOCK_AGENT_ID`, `SLOCK_AGENT_LAUNCH_ID`, and wrapper-first `PATH`.
- Strips sensitive proxy env vars from the Claude child process environment.
- Parses stdout JSONL into structured `ClaudeStreamEvent` records.
- Captures `session_id` from system/session-init events.
- Supports `--resume <sessionId>` via `runtimeResumeSessionId`.
- Writes stdin user messages in Claude stream-json input shape.
- Queues messages while Claude is busy.
- Tracks busy state through assistant `tool_use`, user `tool_result`, compacting events, and `result` turn boundaries.
- Emits events for raw lines, parsed stream events, parse errors, session capture, message sends, errors, and exits.
- Added non-intentional termination for stall recovery with `killUnresponsive()`.

## Daemon Orchestration Work

File: `agent/daemon/aaa-daemon/src/daemon/daemon.ts`

Turned daemon runtime management into a real lifecycle:

- Stores wrapper metadata after generating `.slock` wrappers.
- Starts Claude through a dedicated `startClaudeRuntime()` path.
- Registers runtime event listeners for:
  - raw lines
  - stream events
  - session capture
  - message sends
  - exits
  - errors
- Records captured Claude sessions in `SessionManager`.
- Emits structured `runtime_trace` events for start, stream events, session, message send, exit, error, restart scheduling, and stall detection.
- Routes proxy `message_received` events into runtime delivery.
- Routes WebSocket message events into the same runtime delivery path.
- Normalizes incoming Slock messages into a visible text envelope:
  - `target=...`
  - `msg=...`
  - `time=...`
  - `sender=...`
  - `type=...`
- Adds optional one-shot crash restart with session resume.
- Adds optional stall watchdog via `--runtime-stall-timeout-ms`.
- Clears restart and stall timers on daemon stop.

Supporting file: `agent/daemon/aaa-daemon/src/daemon/session-manager.ts`

- Added `upsert()` so external Claude session ids can be represented directly instead of inventing only daemon-local session ids.

## WebSocket Work

File: `agent/daemon/aaa-daemon/src/websocket.ts`

Filled in the message coordination pieces:

- Parses raw Slock events and JSON-RPC notifications.
- Recognizes `message_received`, `message`, and `daemon/message.received` shapes.
- Emits normalized daemon message events.
- Sends ack payloads with `message_id`, `seq`, and timestamp when possible.
- Sends activity payloads on connect and heartbeat.
- Stops heartbeat cleanly on disconnect.

This gives the daemon a live path:

```text
WebSocket message
  -> parseWebSocketPayload()
  -> DaemonCore event handler
  -> AgentProxy inbox buffer
  -> ClaudeRuntimeDriver.sendUserMessage()
```

## Proxy And Inbox Work

File: `agent/daemon/aaa-daemon/src/proxy/agent-proxy.ts`

Expanded the local proxy from pure request forwarding into the coordination point between CLI, inbox, and daemon JSON-RPC:

- Tracks `lastSeenSeq` and `readUpToSeq`.
- Adds `recordIncomingMessage()` for WS/SSE/proxy events.
- Adds `markReadUpTo()` so message checks and history reads can acknowledge context.
- Buffers `/internal/agent-api/events`, `/history`, and `/send` responses.
- Parses SSE `text/event-stream` frames from `/events`.
- Adds freshness hold before upstream send:
  - If pending message events have seq greater than `seenUpToSeq`, the proxy returns HTTP 409.
  - Response shape: `{state:"held",reason:"pending_messages",seenUpToSeq,pendingCount,pending}`.
  - Upstream `/send` is not called when a hold occurs.
- Adds knowledge path rewriting under `/internal/agent-api/knowledge...`.
- Adds local daemon JSON-RPC endpoint:
  - `POST /internal/daemon/jsonrpc`
  - This endpoint is separate from authenticated Slock agent API traffic.

This prevents the agent from sending a stale reply when new context has arrived but has not been read yet.

## Attach And JSON-RPC Work

File: `agent/daemon/aaa-daemon/src/attach/attach.ts`

Fixed the attach transport:

- Before: attach posted JSON-RPC directly to the proxy root, which is the wrong surface.
- After: attach posts each parsed JSON-RPC line to `/internal/daemon/jsonrpc`.
- Stdout is kept as JSON-RPC frames only.
- Attach status logs go to stderr.
- Invalid input lines return JSON-RPC parse errors.

This makes attach behave like a daemon control client instead of accidentally pretending to be the Slock CLI.

## Client Handler Work

Files:

- `agent/daemon/aaa-daemon/src/daemon/client-handler.ts`
- `agent/daemon/aaa-daemon/src/protocol/methods.ts`

Completed method forwarding and fixed local proxy auth:

- Uses the registered local `sap_*` proxy token for calls into `AgentProxy`.
- No longer uses the proxy URL as a bearer token.
- Expanded daemon method constants and routing for:
  - message send/check/read/search/react
  - task list/create/claim/update
  - channel members/join/leave
  - thread unfollow
  - profile get/update
  - integration list/login
  - reminder list/create/schedule/update/cancel/delete
  - attachment view/download/upload
  - knowledge list/get/search
- `daemon/message.check` marks buffered events as read.
- `daemon/message.send` sends `seenUpToSeq` from `readUpToSeq`, so freshness hold has the right semantics.

## CLI And Config Surface

Files:

- `agent/daemon/aaa-daemon/src/cmd/main.ts`
- `agent/daemon/aaa-daemon/src/types.ts`

Added runtime config fields and CLI options:

- `--runtime-resume-session-id <id>`
- `--runtime-restart-on-crash`
- `--runtime-stall-timeout-ms <ms>`

These options keep restart/stall behavior explicit instead of silently changing default daemon behavior.

## Wrapper And Prompt Work

Files:

- `agent/daemon/aaa-daemon/src/runtime/slock-wrapper.ts`
- `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts`

Kept the generated wrapper model aligned with Slock:

- `.slock/slock`
- `.slock/slock.cmd`
- `.slock/slock.ps1`
- token file under `~/.slock/agent-proxy-tokens/{agentId}/{launchId}.token`
- wrapper-first `PATH`
- `SLOCK_HOME` set to workspace `.slock`
- prompt injection via file, not inline prompt args

## Tests Added Or Extended

Files:

- `agent/daemon/aaa-daemon/test/runtime-mcp.test.mjs`
- `agent/daemon/aaa-daemon/test/slock-cli.test.mjs`
- `agent/daemon/aaa-daemon/test/proxy-wrapper.test.mjs`
- `agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs`

Coverage added:

- Claude stream-json parsing and user-message building.
- Captured session id included in later stdin messages.
- Resume session id used before the first init event arrives.
- Busy runtime queues messages and flushes at `result`.
- WebSocket payload parsing, ack payloads, and activity payloads.
- Daemon message normalization for runtime delivery.
- Proxy freshness hold blocks stale sends.
- Message check marks pending messages read before send.
- SSE `/events` frames are parsed into inbox events.
- Attach `postDaemonRpc()` hits `/internal/daemon/jsonrpc`.
- Client handler forwards extended daemon methods with local bearer auth.
- Knowledge path rewrite and forwarding.
- Fake daemon runtime still starts Claude with wrapper-first PATH and prompt file args.

Final verification:

```text
npm test
33 tests passed
```

Also verified:

```text
git diff --check
passed
```

## Spec And Trellis Updates

Files:

- `.trellis/tasks/05-30-claude-runtime-message-delivery/prd.md`
- `.trellis/spec/backend/runtime-slock-integration.md`

Recorded the executable contracts for:

- Claude stream-json stdin/stdout.
- Runtime env and args.
- WebSocket ack/activity behavior.
- Proxy freshness hold and SSE event buffering.
- Attach JSON-RPC endpoint.
- Client-handler forwarding.
- Session resume, runtime traces, crash restart, and stall watchdog.
- MCP remaining compatibility-only.

## Deferred Architecture Visibility Task

Commit `c7cd8a8` records a separate Trellis task:

```text
.trellis/tasks/05-30-visible-daemon-runtime-architecture/
```

That task is intentionally deferred. The idea is to later let a Notion agent maintain a human-readable architecture abstraction, rather than hiding all logic in code or asking this coding session to become the long-term documentation owner.

## Commits

- `0fb86ba fix: complete claude daemon runtime gaps`
- `c7cd8a8 docs: record deferred daemon architecture task`

## Current Caveats

- The final validation uses local tests and fake runtime/server paths. Real live Slock/Claude operation should still be smoke-tested carefully before treating it as production-ready.
- Stall recovery is optional and disabled unless `--runtime-stall-timeout-ms` is provided.
- Crash restart is optional and one-shot unless `--runtime-restart-on-crash` is provided.
- MCP is deliberately not expanded into chat/task tools.
- Local uncommitted files after the session were intentionally not included:
  - `.claude/settings.local.json`
  - `.codex/config.toml`
  - `agent/daemon/.DS_Store`

