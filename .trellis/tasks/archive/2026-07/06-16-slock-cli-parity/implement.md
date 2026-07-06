# Implementation Plan

## Status

- Implemented and verified in the daemon/CLI/backend parity pass.
- `message resolve` is in scope and exposed in the runtime prompt.
- `action prepare` remains deferred and is intentionally absent from the runtime prompt.

## Checklist

1. Update task context
   - Keep PRD/design/implement artifacts current.
   - Add relevant backend specs to `implement.jsonl` and `check.jsonl`.

2. Add CLI parser parity
   - Update `printUsage()` to include supported prompt commands.
   - Add `thread unfollow` parser branch.
   - Add `task unclaim` parser branch.
   - Add `profile show` alias without removing `profile get`.
   - Add `reminder snooze` alias around reminder update semantics.
   - Add `reminder log` as a read-only command.
   - Add `message resolve` as a read-only exact proof command.
   - Keep `action prepare` deferred and out of runtime prompt text.

3. Add daemon JSON-RPC parity where needed
   - Route `DaemonMethods.TaskUnclaim` in `ClientHandler.handleRequest`.
   - Add daemon methods/routing for message resolve, reminder snooze, and reminder log where needed.
   - Extend missing-identifier validation for new route shapes.

4. Reconcile prompt text
   - Ensure every command listed in `buildSlockSystemPrompt()` is either implemented or removed.
   - Keep examples aligned with actual flags (`--id`, `--thread-id`, `--target`, `--delay-seconds`).

5. Add tests
   - Extend `agent/daemon/aaa-daemon/test/slock-cli.test.mjs` for successful route mapping.
   - Extend `agent/daemon/aaa-daemon/test/slock-cli-coverage.test.mjs` for validation/error branches.
   - Add daemon client-handler route tests if an existing pattern is present; otherwise cover via CLI/proxy integration tests.
   - Add or update a prompt parity test so future prompt edits cannot introduce unsupported commands silently.

6. Validate
   - `cd agent/daemon/aaa-daemon && npm run build`
   - `cd agent/daemon/aaa-daemon && node --test test/slock-cli.test.mjs test/slock-cli-coverage.test.mjs`
   - Broader daemon test run if daemon routing changes are non-trivial: `cd agent/daemon/aaa-daemon && npm test`
   - Backend tests only if backend endpoints are added or changed.

## Risk Points

- `task unclaim` must respect backend transition rules and must not let an agent unclaim another member's task.
- `thread unfollow` prompt examples use thread targets, while backend currently expects a resolvable message/thread id in `threadId`; implementation must either pass the target through a route that resolves it or adjust prompt examples to accepted identifiers.
- `message resolve` must not leak messages outside the agent's visible channels.
- `reminder log` should not leak another agent's reminder lifecycle.
- `action prepare` is deliberately deferred despite an existing proxy rewrite.
- The current repo has large Trellis update changes pending; keep product code diffs isolated from Trellis template update diffs when reviewing.

## Ready-to-Start Criteria

- User has decided `message resolve` is in scope and `action prepare` is deferred.
- `prd.md`, `design.md`, and `implement.md` reflect that decision.
- Context files validate with `python ./.trellis/scripts/task.py validate 06-16-slock-cli-parity`.
