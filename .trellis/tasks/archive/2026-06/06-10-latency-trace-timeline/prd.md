# latency trace timeline

## Goal

Add lightweight latency tracing for the real-time message delivery path so developers can inspect each step's elapsed time when chat or agent responses feel slow.

## What I already know

* The user wants this as a small feature implemented end to end.
* Existing `smallkhoj-trace` already aggregates backend/frontend logs, daemon logs, daemon sessions, and runtime traces.
* The critical flow spans frontend/public API message creation, backend EventRecord creation, daemon WebSocket delivery, runtime delivery, and agent reply send.

## Requirements

* Emit structured latency trace events with a stable trace id.
* Propagate trace ids from public UI messages into backend event payloads and daemon delivery logs.
* Emit backend timings for message create/send, commit, event push, and total request time.
* Emit daemon/runtime timings for WebSocket receipt, runtime delivery, runtime stdin write, runtime first output, and runtime result.
* Extend `smallkhoj-trace` with a latency view that groups events by trace id and shows relative timings.
* Avoid database schema changes for this small implementation.

## Acceptance Criteria

* [x] `./smallkhoj-trace latency` prints grouped latency timelines when trace events exist.
* [x] Backend message creation and agent send responses include/propagate a trace id.
* [x] Daemon logs include structured trace events for runtime delivery and runtime progress.
* [x] Existing tests or focused syntax/build checks pass for touched backend and daemon code.

## Out of Scope

* Persistent `trace_spans` database table.
* UI dashboard for historical P95/P99.
* External OpenTelemetry/APM integration.

## Technical Notes

* Backend files likely impacted: `backend/routers/public_api.py`, `backend/routers/agent_api.py`, new helper under `backend/services/`.
* Daemon files likely impacted: `agent/daemon/aaa-daemon/src/daemon/daemon.ts`, `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts`.
* Trace CLI impacted: `scripts/smallkhoj-trace.mjs`.
