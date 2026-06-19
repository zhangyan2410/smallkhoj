# Daemon Codex Runtime Design Notes

## Boundary

Codex must be added as another daemon-managed runtime behind the existing SmallKhoj/Slock contract:

```text
backend control plane
  -> daemon start_runtime
  -> Codex runtime process in agent workspace
  -> generated .slock wrapper in PATH
  -> local daemon proxy
  -> backend Agent API
```

Do not introduce a backend-spawned agent service, ACP dependency, or direct backend API writes from Codex.

## Reference Workspace

Reference:

```text
/Users/lee/.slock/agents/be8b7e8d-a7c6-48ac-9e71-da8faa799eda/
```

Observed:

- `MEMORY.md` is small and identifies prior Codex runtime usage.
- `.slock/runtime-sessions/codex-019ed992-09a0-7131-ac5d-5fa5630dbfbd.jsonl` stores only a handoff record, not the full transcript.
- `.slock/slock` and `.slock/raft` wrappers may contain credential material; inspect behavior, not raw secrets.

Prompt-reference note:

- No Codex-specific Slock system prompt file was found locally.
- Use `agent/daemon/slock-prompt-backup/claude-system-prompt.md` plus the current `buildSlockSystemPrompt(...)` source as the Slock CLI contract baseline.
- Treat `.slock-kimi-system.md` as an older MCP-oriented contrast only.
- See `research/prompt-reference.md`.

## Runtime Driver Shape

Add a Codex runtime driver parallel to `ClaudeRuntimeDriver`:

- start process in `workspacePath`
- prepend generated wrapper directory to `PATH`
- set Codex-specific env only where needed
- capture session id if Codex exposes it
- track busy/idle state
- queue messages while busy if long-lived mode supports stdin/message injection
- emit runtime activity and trace events compatible with existing frontend/backend surfaces

## Prompt Shape

Codex needs a Slock operating prompt equivalent to Claude's `buildSlockSystemPrompt`, adapted for Codex:

1. Stable prefix:
   - identity as Slock agent
   - communication only through `slock`
   - credential hygiene
   - task/channel/thread rules
   - one command per tool call
2. Session-stable context:
   - agent id
   - server id
   - workspace path
   - runtime type/provider/model
3. Variable tail:
   - current incoming message/event
   - task assignment context
   - short runtime wake reason

Keep stable prefix byte-stable where possible for prompt-cache friendliness.

If an older Codex-specific prompt becomes available, use it to refine wording and Codex-specific invocation guidance, but keep the architectural contract unchanged: Codex communicates through the generated `slock` CLI wrapper and local daemon proxy.

## Codex Invocation Research

Before implementation, verify the installed Codex CLI behavior:

- available non-interactive / exec / resume modes
- whether it supports long-lived session input
- where it stores session/transcript metadata
- whether it exposes JSON/stream events
- how system/developer instructions can be passed
- how to capture token usage or session id

## Minimal MVP

If Codex cannot support long-lived incremental stdin cleanly, MVP may use a constrained per-message invocation, but it must still:

- run inside the agent workspace
- use the generated `slock` wrapper
- reply through `slock message send`
- report clear activity and logs
- document the limitation against Claude's long-lived runtime behavior

## Risks

- Codex CLI flags/session format may differ between desktop/bundled/global installs.
- Per-message invocation may hurt continuity and prompt-cache behavior.
- Raw wrapper files may contain secrets; diagnostics must mask tokens.
- Activity fidelity may be weaker than Claude stream-json initially.
