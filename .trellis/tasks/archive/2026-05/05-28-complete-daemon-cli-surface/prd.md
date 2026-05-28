# Complete aaa-daemon CLI Surface

## Objective

Implement as much of the Slock CLI surface described in `agent/daemon/doc/` as possible for `aaa-daemon`, with tests and safety gates. The known real Claude/Slock runtime at `/Users/lee/.slock/agents/bf38f65a-5257-464e-901f-a2ef5b5f9dde/.slock` has already passed read-only smoke through `server info`; preserve that path for validation.

## Requirements

- Keep chat and Slock operations routed through the generated `slock` CLI and local proxy, not MCP tools.
- Preserve existing implemented commands:
  - `slock server info`
  - `slock message check|read|search|send`
  - `slock channel members`
  - `slock task list`
  - `slock profile get`
  - `slock integration list`
  - `slock reminder list`
- Add missing CLI/proxy support where endpoint shape is known:
  - task claim/update/create
  - channel join/leave
  - reactions
  - attachment download/upload CLI
  - profile update
  - integration login when a clear proxy endpoint can be represented safely
  - reminder create/update/delete
- Add explicit safety gates for write-capable commands. Tests may use fake local servers without the gate, but real runtime execution must require opt-in.
- Extend path rewrite tests and CLI integration tests for every added command.
- Keep read-only smoke read-only.
- Do not print or commit secrets from `.slock` runtimes or token files.

## Validation

- `npm test` in `agent/daemon/aaa-daemon` passes.
- Read-only smoke against `/Users/lee/.slock/agents/bf38f65a-5257-464e-901f-a2ef5b5f9dde/.slock` continues to pass.
- Any real write validation requires an explicit user-approved target and safety environment variables.

## Non-goals

- Do not turn Slock operations into MCP tools.
- Do not bypass upstream Slock authorization.
- Do not leak token contents into logs, tests, commits, or summaries.
