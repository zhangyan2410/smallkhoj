# slock CLI Parity with Raft System Prompt

## Problem

The system prompt (`buildSlockSystemPrompt` in `claude-runtime.ts`) was updated to align with Raft's latest version, which references 25 CLI commands. However, several commands referenced in the prompt are **not implemented** in `slock-cli.ts`. An agent following the prompt will try these commands and get errors.

## Goal

Make the managed runtime prompt truthful: every command it tells an agent to use should either work through the generated `slock` CLI/local proxy/backend path, or be removed from the prompt until the backend product surface exists.

## Confirmed Facts

- `slock-cli.ts` currently implements command routing in `parseRequest()` and enforces write safety before local proxy calls.
- `thread.unfollow` already exists in the daemon JSON-RPC handler and backend agent API (`POST /threads/unfollow`), but the CLI has no `slock thread unfollow` parser branch.
- `task.unclaim` exists as a protocol constant and the backend has `POST /tasks/{task_id}/unclaim`, but the daemon JSON-RPC handler and CLI parser do not route it yet.
- `profile show` can be a CLI alias for the existing `profile get` route.
- `reminder snooze` can likely map to the existing reminder update behavior by sending `delaySeconds`, but the daemon JSON-RPC method list and handler do not have an explicit snooze command.
- `reminder log` is not represented by a backend agent API endpoint today, but reminder lifecycle writes already include `ActivityLog.details.reminderId`, so a read-only log endpoint can be backed by existing data.
- `message resolve` appears in Raft prompts as an exact message-id proof command. The backend already has `_resolve_message_ref()`, so this can be exposed safely as a read-only agent API/CLI command.
- `action prepare` appears to be a Raft-only action-card workflow. The proxy has a stale-looking `/prepare-action` rewrite, but no backend action-card model or endpoint was found.
- CLI routing tests already exist in `agent/daemon/aaa-daemon/test/slock-cli.test.mjs` and `agent/daemon/aaa-daemon/test/slock-cli-coverage.test.mjs`.

## Missing Commands

| Command | Status | Priority | Notes |
|---|---|---|---|
| `slock thread unfollow` | ❌ Not implemented | P1 | Prompt references it for stopping thread delivery |
| `slock task unclaim` | ❌ Not implemented | P1 | Prompt references it for releasing task claims |
| `slock reminder snooze` | ❌ Not implemented | P2 | Prompt references it for pushing reminders later |
| `slock reminder log` | ❌ Not implemented | P2 | Prompt references it for reminder event history |
| `slock profile show` | ⚠️ We have `get` not `show` | P2 | Need alias or rename |
| `slock message resolve` | ❌ Not implemented | P2 | Verify message ID exists exactly and print canonical row |
| `slock action prepare` | ⏸ Deferred | P3 | Action-card workflow needs product design beyond CLI parity |

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
- [ ] `slock message resolve` works as exact message proof for visible messages
- [ ] `slock reminder log` works as read-only reminder lifecycle history
- [ ] `slock action prepare` is removed from or kept out of the runtime prompt until action cards are designed
- [ ] Daemon JSON-RPC method routing stays in parity with CLI routes where a `DaemonMethods.*` constant exists
- [ ] Write-capable commands continue to require `SLOCK_ALLOW_WRITES=1` or `AAA_DAEMON_ALLOW_WRITES=1`
- [ ] CLI usage text lists every supported prompt command and excludes deliberately deferred commands

## Key Files

| File | Role |
|---|---|
| `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts` | **System prompt** — `buildSlockSystemPrompt()` (line 49+), the authoritative prompt injected into every runtime via `--append-system-prompt-file`. Updated to 290 lines aligned with Raft. |
| `agent/daemon/aaa-daemon/src/slock-cli.ts` | **CLI implementation** — `parseRequest()` routes all `slock` commands to backend API paths. This is where missing commands need to be added. |
| `~/.slock/agents/48eca882-*/.slock/claude-system-prompt.md` | **Raft reference** — latest upstream prompt (345 lines). Use as the target for prompt parity. Not in repo (external reference). |

## Scope Decision

Implement `slock message resolve` in this task because it is a focused read-only proof command and the backend already has message reference resolution. Defer `slock action prepare` because it requires action-card product semantics, frontend UX, execution permissions, and audit behavior beyond CLI parity.
