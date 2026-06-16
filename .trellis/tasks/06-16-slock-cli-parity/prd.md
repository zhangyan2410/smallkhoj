# slock CLI Parity with Raft System Prompt

## Problem

The system prompt (`buildSlockSystemPrompt` in `claude-runtime.ts`) was updated to align with Raft's latest version, which references 25 CLI commands. However, several commands referenced in the prompt are **not implemented** in `slock-cli.ts`. An agent following the prompt will try these commands and get errors.

## Missing Commands

| Command | Status | Priority | Notes |
|---|---|---|---|
| `slock thread unfollow` | ❌ Not implemented | P1 | Prompt references it for stopping thread delivery |
| `slock task unclaim` | ❌ Not implemented | P1 | Prompt references it for releasing task claims |
| `slock reminder snooze` | ❌ Not implemented | P2 | Prompt references it for pushing reminders later |
| `slock reminder log` | ❌ Not implemented | P2 | Prompt references it for reminder event history |
| `slock profile show` | ⚠️ We have `get` not `show` | P2 | Need alias or rename |
| `slock message resolve` | ❌ Not implemented | P3 | Verify message ID exists (Raft-only feature) |
| `slock action prepare` | ❌ Not implemented | P3 | Action card for human commit (Raft-only feature) |

## Commands Already Working

- `slock message check` ✅
- `slock message send` ✅
- `slock message read` ✅
- `slock message search` ✅
- `slock message react` ✅
- `slock server info` ✅
- `slock channel members` ✅
- `slock channel join` ✅
- `slock channel leave` ✅
- `slock thread read` ✅
- `slock thread summary` ✅
- `slock task list` ✅
- `slock task create` ✅
- `slock task claim` ✅
- `slock task update` ✅
- `slock attachment upload` ✅
- `slock attachment view` ✅
- `slock attachment download` ✅
- `slock profile get` ✅ (needs `show` alias)
- `slock profile update` ✅
- `slock reminder schedule` ✅
- `slock reminder create` ✅
- `slock reminder list` ✅
- `slock reminder update` ✅
- `slock reminder cancel` ✅
- `slock reminder delete` ✅
- `slock integration list` ✅
- `slock integration login` ✅

## Acceptance Criteria

- [ ] Each command referenced in `buildSlockSystemPrompt` has a working implementation in `slock-cli.ts`
- [ ] P1 commands (thread unfollow, task unclaim) tested end-to-end
- [ ] `slock profile show` works as alias for `slock profile get`
- [ ] Prompt updated if any command is deliberately excluded

## Key Files

| File | Role |
|---|---|
| `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts` | **System prompt** — `buildSlockSystemPrompt()` (line 49+), the authoritative prompt injected into every runtime via `--append-system-prompt-file`. Updated to 290 lines aligned with Raft. |
| `agent/daemon/aaa-daemon/src/slock-cli.ts` | **CLI implementation** — `parseRequest()` routes all `slock` commands to backend API paths. This is where missing commands need to be added. |
| `~/.slock/agents/48eca882-*/.slock/claude-system-prompt.md` | **Raft reference** — latest upstream prompt (345 lines). Use as the target for prompt parity. Not in repo (external reference). |
