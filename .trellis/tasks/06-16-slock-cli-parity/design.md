# Design: slock CLI Parity with Runtime Prompt

## Scope

This task aligns three surfaces:

1. Runtime prompt command list in `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts`
2. CLI parser and write-safety behavior in `agent/daemon/aaa-daemon/src/slock-cli.ts`
3. Local daemon/proxy/backend routes used by those CLI commands

The primary rule is prompt truthfulness: the managed Claude runtime must not be instructed to call commands that fail at the CLI usage layer.

## Command Mapping

| Prompt command | Planned behavior |
|---|---|
| `slock thread unfollow --target "#general:00000000"` | CLI parses `--target`, `--thread-id`, `--id`, or positional id and posts `{threadId}` to `/internal/agent/{agentId}/threads/unfollow`. Existing AgentProxy rewrites this to `/internal/agent-api/threads/unfollow`. Write safety resource should be the thread target/id. |
| `slock task unclaim --id <taskId>` | CLI posts to `/internal/agent/{agentId}/tasks/{taskId}/unclaim`. Daemon JSON-RPC should route `DaemonMethods.TaskUnclaim` to the same endpoint. Write safety resource should be the task id. |
| `slock profile show [--handle @name]` | CLI alias for the existing `profile get` branch. Prompt and usage should consistently say `show`, while `get` remains backward-compatible. |
| `slock reminder snooze --id <id> --delay-seconds <n>` | CLI alias around reminder update semantics, sending `{delaySeconds}` to `/internal/agent/{agentId}/reminders/{id}`. Accept `--in` as an alias to match `reminder update`. Add daemon method/routing only if a corresponding method constant is added. |
| `slock reminder log --id <id>` | Add a read-only backend route that returns `ActivityLog` entries whose details contain the reminder id; CLI maps to `GET /reminders/{id}/log`. |
| `slock message resolve <id>` | Add a read-only backend route that resolves UUID or short id, verifies visibility, and returns the serialized canonical message row. CLI maps to `GET /messages/{id}/resolve`. |
| `slock action prepare` | Deferred. Do not add to runtime prompt until action-card semantics, UI, execution identity, and audit behavior are designed. |

## Boundaries

- CLI commands always call the local daemon proxy, not the public backend directly.
- AgentProxy path rewriting owns conversion from `/internal/agent/{agentId}/...` to `/internal/agent-api/...`.
- Backend agent API owns permission checks, task transition rules, thread follow state, and reminder persistence.
- Message resolve must enforce visibility before returning a message.
- Reminder log must only return reminders owned by the current agent.
- Runtime prompt text must match the CLI usage surface after implementation.

## Compatibility

- Existing commands remain backward-compatible:
  - `profile get` still works after `profile show` is added.
  - `reminder update --id ... --in ...` remains supported after `reminder snooze` is added.
  - `task update --status todo` can still unclaim by status, but `task unclaim` becomes the prompt-supported command.
- Write-capable commands keep the existing `SLOCK_ALLOW_WRITES=1` / `AAA_DAEMON_ALLOW_WRITES=1` gate.

## Trade-offs

- Implementing P1/P2 backed by existing concepts is low risk and improves prompt correctness quickly.
- Implementing `message resolve` is low risk because it exposes existing message resolution as a read-only endpoint with visibility checks.
- Deferring `action prepare` keeps this task scoped; the stale proxy rewrite can remain inert until action cards are designed.
- `reminder log` should read existing activity rows instead of faking lifecycle history from current reminder state.

## Rollback

- CLI changes are localized to command parsing and usage text.
- Daemon routing changes are localized to `client-handler.ts` and protocol method constants if needed.
- Prompt changes are localized to `buildSlockSystemPrompt`.
- Tests should fail fast if a prompt-listed command lacks a CLI route.
