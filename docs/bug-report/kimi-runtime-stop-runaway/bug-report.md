# Kimi Runtime Stop Runaway

## Reporter

Reported by the operator on 2026-06-21 after `@kimi` kept consuming tokens and repeated stale WebDriver verification commands even after a lifecycle stop was requested.

## Reproduction

Expected behavior:

- A lifecycle stop for a managed runtime stops the actual model process, not only the wrapper.
- Backend/UI runtime state and the local process table converge to stopped/offline.
- A stopped worker no longer emits tool activity or spends provider tokens.

Actual behavior observed:

- `@kimi` repeated fixed `twd --tab ...` verification attempts after the project had already established that fixed tab ids are stale after navigation/reload.
- Runtime usage grew from roughly 151k to 159k+ input tokens during the repeated loop.
- Backend accepted the stop command and marked the workspace stopped, but the provider child process continued briefly as an orphan after the direct wrapper process was terminated.

## Root Cause

There were two separate failures.

First, the worker session had a context/behavior failure: it kept following the old fixed `--tab` WebDriver pattern instead of the current project contract, which requires precise `--url-match`, for example `./twd --url-match "http://127.0.0.1:3000/chat/all"`.

Second, the platform stop path was incomplete. Managed runtimes launch through wrappers such as `ccs-claude`, `claude`, `codex`, `npx`, or `codex-acp`. Stopping only the direct child can kill the shim while leaving the real provider child alive. That orphaned child can keep producing stream output and spending tokens after the backend already reports the workspace as stopped.

The stall watchdog did not catch this case because the runtime was not idle; it was still producing tool/stream activity.

## Fix

Daemon runtime process management now treats wrapper-based runtimes as process trees:

- POSIX runtimes are spawned in their own process group through `runtimeProcessSpawnOptions()`.
- Lifecycle stop sends `SIGTERM` to the process group, not only the direct child.
- A bounded `SIGKILL` fallback is scheduled if the process group ignores or outlives graceful termination.
- The same helper is used by Claude Code, Codex CLI, and the Codex ACP bridge.
- Backend workspace sync clears stale `pid` values for stopped/offline/exited workspaces so the UI does not show a dead process as still attached.

The repeated fixed `--tab` behavior is not fixed by restarting the same worker. The safe operating rule is to stop the runaway session and, if Kimi is needed again, start a fresh bounded session with the current WebDriver contract in the prompt.

## Verification

Automated verification:

```bash
cd agent/daemon/aaa-daemon && npm run build && node --test test/runtime-mcp.test.mjs
cd backend && .venv/bin/python -m pytest tests/test_daemon_control.py -q
```

Results:

- daemon runtime/MCP tests: 20 passed.
- backend daemon-control tests: 31 passed.
- Regression coverage includes a fake Claude wrapper whose grandchild ignores `SIGTERM`; `ClaudeRuntimeDriver.stop()` still kills the process group via fallback.

Runtime state verification:

- `@kimi` is `offline` with `runtimeDesiredStatus=stopped`.
- The original Kimi identifiers/processes are absent from the process table: `df6c5e8c`, `25a58d26`, `82307`, and `82338`.
- Current computers API shows no active workspace for `local-mac`.

Residual note:

There are unrelated Claude/Codex processes on the machine. They do not match the Kimi agent/workspace identifiers from this incident and were not killed.
