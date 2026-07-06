# brainstorm: visible daemon runtime architecture

## Goal

Build a formal, human-readable architecture layer for the aaa-daemon Claude Code runtime before continuing deeper implementation. The goal is to make the daemon's ideas, message flow, state transitions, and ownership boundaries visible to both AI agents and humans, so implementation does not hide important logic inside scattered code.

## What I already know

* The current prototype proved the runtime path is feasible: daemon spawns Claude Code, injects `.slock` wrapper into `PATH`, and Claude can use `slock` CLI through the local proxy.
* The implementation is still partly a proof-of-concept: `ClaudeRuntimeDriver` starts the process and logs lines, but does not yet parse stream-json or manage gated message delivery.
* The intended Slock communication path is `Claude Code -> slock CLI wrapper -> local proxy -> Slock API`, not MCP tools.
* `mcp-bridge.ts` is intentionally a compatibility bridge with only `runtime_profile_migration_done`.
* `websocket.ts`, `agent-proxy.ts`, `daemon.ts`, `client-handler.ts`, and `attach.ts` each contain partial runtime responsibilities, but the boundaries are not yet easy to understand at a glance.
* The user needs an abstraction that humans can read and organize before code is written.

## Assumptions (temporary)

* The architecture layer should live in the repository, not only in chat.
* The architecture layer should be close enough to code to stay accurate, but not so low-level that it becomes another implementation file.
* Diagrams and state-machine tables will be more useful than prose-only design notes.
* The first useful output should explain the daemon runtime, not every slock CLI command.

## Open Questions

* What form should the visible architecture layer take as the primary source of truth?

## Requirements (evolving)

* Create a durable architecture artifact before major runtime implementation.
* Show runtime components by file/module ownership.
* Show message flow from Slock WebSocket and slock CLI through daemon/proxy/runtime.
* Show Claude stream-json event handling expectations.
* Show state transitions for idle, busy, compacting, tool-running, crashed, and resumed states.
* Separate "current implementation" from "target architecture" so prototype code is not mistaken for complete behavior.
* Link architecture decisions to Trellis specs and tests.

## Acceptance Criteria (evolving)

* [ ] A human can read the artifact and explain what each daemon module owns.
* [ ] A human can trace an incoming message from WS/API to Claude stdin delivery.
* [ ] A human can trace an outgoing `slock message send` through freshness hold and proxy forwarding.
* [ ] The artifact identifies which code files need to change for each runtime capability.
* [ ] The artifact distinguishes implemented, partial, missing, and intentionally-not-needed pieces.
* [ ] The artifact can be updated as part of future code changes.

## Definition of Done (team quality bar)

* Tests added/updated for runtime behavior when code changes.
* Lint / typecheck / CI green for code changes.
* Trellis spec/docs updated when behavior changes.
* Rollout/rollback considered for risky daemon changes.

## Out of Scope (explicit)

* Implementing the full daemon runtime before the architecture layer is agreed.
* Replacing the slock CLI wrapper with MCP tools.
* Rewriting all daemon modules in one large pass.
* Building a UI visualization tool in the first step.
* Maintaining the architecture abstraction in this repo right now; this is deferred to a future Notion agent workflow.

## Deferred TODO

* Later, hand off the visible architecture abstraction to a Notion agent for maintenance.
* Keep this repo task as a reminder only; do not block daemon runtime implementation on these architecture docs.

## Technical Notes

* Relevant target spec: `.trellis/spec/backend/runtime-slock-integration.md`.
* Current runtime process code: `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts`.
* Current daemon orchestrator: `agent/daemon/aaa-daemon/src/daemon/daemon.ts`.
* Current local proxy: `agent/daemon/aaa-daemon/src/proxy/agent-proxy.ts`.
* Current WebSocket manager: `agent/daemon/aaa-daemon/src/websocket.ts`.
* Current JSON-RPC client handler: `agent/daemon/aaa-daemon/src/daemon/client-handler.ts`.
* Current attach bridge: `agent/daemon/aaa-daemon/src/attach/attach.ts`.
* Current compatibility MCP bridge: `agent/daemon/aaa-daemon/src/mcp-bridge.ts` and `agent/daemon/aaa-daemon/src/chat-bridge.ts`.

## Candidate Architecture Artifacts

### Option A: Architecture Map Markdown

One or more Markdown files under `agent/daemon/doc/architecture/`, with Mermaid diagrams, state tables, module ownership, and current-vs-target status.

Strengths:
* Easiest for humans to read and edit.
* Works well with Trellis and code review.
* Low tooling cost.

Weaknesses:
* Can drift unless every runtime change updates it.

### Option B: Code-Near Contracts

Keep architecture in TypeScript-adjacent docs or structured comments next to each runtime module.

Strengths:
* Close to code.
* Easier to keep module ownership accurate.

Weaknesses:
* Harder to see the whole daemon flow in one place.
* Humans may still need to jump between files.

### Option C: Structured Spec Model

Create a machine-readable architecture model, such as YAML/JSON, then generate diagrams/docs from it.

Strengths:
* Can power tests or generated diagrams later.
* Best long-term drift control.

Weaknesses:
* More upfront complexity.
* Slower to iterate while architecture is still moving.

## Recommended MVP

Start with Option A, but keep it structured enough that Option C can grow out of it later:

* `agent/daemon/doc/architecture/runtime-map.md` — module ownership and status matrix.
* `agent/daemon/doc/architecture/message-flow.md` — incoming/outgoing message flows.
* `agent/daemon/doc/architecture/runtime-state-machine.md` — Claude process/session/gated steering states.
* `agent/daemon/doc/architecture/implementation-slices.md` — small build order by capability.

Each file should include:
* Current behavior.
* Target behavior.
* Source files involved.
* Tests that should prove the behavior.
* Open questions.
