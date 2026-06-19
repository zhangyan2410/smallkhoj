# Prompt Reference Findings

## Summary

No Codex-specific Slock system prompt file was found in the checked local locations.

Checked:

- `/Users/lee/.slock/agents/be8b7e8d-a7c6-48ac-9e71-da8faa799eda/`
- `/Users/lee/.slock/agents/`
- `/Users/code/project/smallkhoj/`
- `/Users/code/project/`
- Trellis memory search for `Codex system prompt`, `codex prompt`, `codex-system-prompt`, and `.slock-codex-system`

The reference Codex workspace contains:

- `MEMORY.md`
- `.slock/runtime-sessions/codex-019ed992-09a0-7131-ac5d-5fa5630dbfbd.jsonl`

The runtime session JSONL only records a daemon-created handoff and says the native runtime transcript was not found on this machine. It is useful as evidence of session identity shape, not as a prompt source.

## Available Prompt References

Use these as implementation references:

- `/Users/code/project/smallkhoj/agent/daemon/slock-prompt-backup/claude-system-prompt.md`
  - Best current reference for the Slock CLI operating contract.
  - Adapt this for Codex.
- `/Users/code/project/smallkhoj/agent/daemon/slock-prompt-backup/.slock-kimi-system.md`
  - Older MCP-tools-oriented contrast.
  - Do not use it as the target architecture because SmallKhoj's daemon runtime should communicate through the generated `slock` CLI wrapper.
- `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts`
  - Current source of `buildSlockSystemPrompt(...)`.
  - Inspect this during implementation because it may be newer than the backup file.

## Trellis Memory Findings

Trellis memory found a Codex session from 2026-06-18 that contained a dispatch-style context block:

- identity line such as `Identity: codex (@codex, model=gpt-5.5)`
- routing / handoff rules
- message history delta

That block appears to be Cat Cafe / external orchestration context delivered as user-message content. It is not a daemon Slock system prompt. It is still useful for understanding how Codex receives injected context from an external controller.

## Implementation Guidance

If the user later provides the older Codex system prompt file, treat it as the primary Codex-specific prompt reference and compare it against the Claude Slock prompt backup.

Until then:

- build the Codex prompt from the Slock CLI contract, not from the Cat Cafe dispatch prompt
- preserve a byte-stable prefix for cache friendliness
- append runtime/session-specific details after the stable operating contract
- avoid embedding credentials or wrapper internals in logs or prompt-reference docs
