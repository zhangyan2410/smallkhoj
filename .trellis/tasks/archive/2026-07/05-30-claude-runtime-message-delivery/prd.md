# implement: Claude runtime message delivery

## Goal

Turn the current daemon proof-of-concept into a more formal Claude Code runtime daemon. The work should close the missing runtime gaps in small, testable slices: stream-json communication, daemon-originated message delivery, WebSocket/inbox coordination, proxy freshness hold, crash/session basics, and explicit specs/tests.

## What I already know

* Claude Code is launched with `--input-format stream-json` and `--output-format stream-json`.
* Current `ClaudeRuntimeDriver` starts Claude and emits raw stdout/stderr lines only.
* Current daemon can spawn Claude, but does not write to stdin or interpret output events.
* Slock communication remains CLI-wrapper based; MCP tools are not the message path.
* The architecture documentation task is deferred to a future Notion agent workflow.
* The user's goal for today is to close the daemon missing pieces, not only the first stream-json slice.

## Requirements

* Parse Claude stdout JSON lines into structured runtime events while preserving raw-line logging for diagnostics.
* Capture `session_id` from Claude system init events when present.
* Write user messages to Claude stdin with the stream-json input shape:
  `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]},"session_id":"..."}`
* Provide a runtime message queue that can accept messages while Claude is busy.
* Treat `result` events as turn boundaries where queued messages can be flushed.
* Track outstanding tool-use/tool-result activity enough to avoid flushing in the middle of a tool call.
* Emit typed events so daemon-level code can later add richer WS/inbox integration.
* Route WebSocket/message events into the runtime message queue.
* Keep a unified inbox/event buffer for WS and proxy `/events` consumption.
* Add proxy freshness hold so sends are blocked when unseen messages are pending.
* Add minimal crash/session/trace hooks that make later resume/recovery work explicit.
* Provide a local daemon JSON-RPC endpoint for attach/client-handler traffic.
* Keep MCP as a compatibility bridge only; do not move chat/task traffic into MCP tools.

## Acceptance Criteria

* [x] Unit tests cover parsing system init, assistant tool_use, user tool_result, and result turn-end events.
* [x] Unit tests cover `sendUserMessage()` JSONL stdin shape.
* [x] Runtime driver captures session id and includes it on later queued messages.
* [x] Queued messages flush immediately when idle and defer while busy.
* [x] WebSocket/message events reach `ClaudeRuntimeDriver.sendUserMessage()`.
* [x] Freshness hold prevents stale sends and surfaces pending messages.
* [x] Existing daemon runtime tests still pass.
* [x] Attach forwards JSON-RPC lines to the daemon JSON-RPC endpoint without polluting stdout.
* [x] Client handler forwards task, channel, profile, attachment, integration, reminder, and knowledge methods through the local proxy with bearer auth.
* [x] Runtime session resume, trace, crash restart, and optional stall watchdog hooks exist.

## Definition of Done

* `npm test` passes in `agent/daemon/aaa-daemon`.
* Runtime behavior is documented in `.trellis/spec/backend/runtime-slock-integration.md` if the contract changes.
* No unrelated local config changes are included.

## Verification Notes

* 2026-05-30: `npm test` in `agent/daemon/aaa-daemon` passed 33/33 tests after the daemon/runtime/proxy/client-handler/attach changes.

## Out of Scope

* Replacing the slock CLI path with MCP tools.
* Building the Notion-maintained architecture abstraction in this repo today.
* Large UI/tooling work unrelated to daemon runtime correctness.

## Technical Notes

* Primary file: `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts`.
* Daemon wiring file: `agent/daemon/aaa-daemon/src/daemon/daemon.ts`.
* Existing tests to extend: `agent/daemon/aaa-daemon/test/runtime-mcp.test.mjs` and `agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs`.
* Relevant spec: `.trellis/spec/backend/runtime-slock-integration.md`.
