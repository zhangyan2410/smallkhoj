# Daemon Wrapper Server Lock

## Reporter

Reported by the operator on 2026-06-23 after `smallkhoj-daemon connect` started runtime processes and then the daemon and runtimes received `SIGTERM`.

## Reproduction

Expected behavior:

- Starting a daemon for the feature backend on `127.0.0.1:8015` does not stop a daemon connected to the main backend on `localhost:8000`.
- Starting a daemon wrapper with an expired, reused, or otherwise invalid connect token does not stop a healthy daemon that is already connected to the same backend.
- When a same-server daemon is already running, the wrapper fails fast and explains which server, PID, and lock file blocked startup.

Actual behavior observed:

- The product-facing `smallkhoj-daemon` wrapper used one global lock file at `~/.smallkhoj/daemon.pid`.
- Starting a new wrapper removed that lock and stopped the recorded PID tree regardless of which backend server it belonged to.
- After the first server-scoped-lock fix, an old invalid connect command could still repeatedly start the wrapper for the same backend, kill the healthy daemon through the same-server lock, and then fail `/daemon/connect` itself.
- The user-visible logs only showed runtime `SIGTERM`, daemon `Received SIGTERM`, and shutdown, without enough context to tell that wrapper singleton cleanup caused the stop.

## Root Cause

There were two related wrapper lifecycle defects.

First, the wrapper's singleton lock was not scoped to the backend server. It treated every local preview, branch worktree, and main backend as the same singleton because all of them wrote to the same default pid file.

Second, the wrapper killed the pid recorded in the same-server lock before validating whether the new wrapper could connect. That made stale retry loops dangerous: an old command with an invalid or already-consumed `sk_connect_...` token could kill the healthy daemon, then fail authentication itself. In the 2026-06-23 repro, `smallkhoj-trace summary --since 10m` showed repeated `/internal/agent-api/daemon/connect` `409 Conflict` attempts while the visible daemon logged `Received SIGTERM`.

## Fix

The `smallkhoj-daemon` wrapper now uses a safer server-scoped guard:

- Default lock directory is `~/.smallkhoj/daemons`.
- `SMALLKHOJ_DAEMON_LOCK` still overrides the exact lock file when an operator needs explicit control.
- `SMALLKHOJ_DAEMON_LOCK_DIR` can override only the default lock directory, which is useful for isolated tests.
- The lock key is a short SHA-256 digest of a normalized server URL.
- `localhost` and `127.0.0.1` on the same port share a lock, so the same backend remains a singleton even if the host spelling changes.
- Different backend ports get different locks, so preview and main daemons do not block each other.
- If the same-server lock points at a live process, the wrapper now exits with a clear "Existing daemon..." message and does not send `SIGTERM`.
- If the same-server lock points at a dead process, the stale lock is removed and startup continues.
- Connect/start modes now `exec` the foreground daemon process instead of backgrounding a child and waiting from a wrapper shell.

The daemon process still receives the original `--server` value; normalization is only for wrapper lock scoping.

## Verification

Automated verification:

```bash
bash -n smallkhoj-daemon
cd agent/daemon/aaa-daemon && rtk node --test test/smallkhoj-daemon-wrapper.test.mjs
cd agent/daemon/aaa-daemon && rtk npm run build
cd agent/daemon/aaa-daemon && rtk npm test
rtk git diff --check
```

Results:

- Shell syntax check passed.
- Targeted wrapper tests passed: 4 tests.
- Daemon TypeScript build passed.
- Daemon runtime targeted tests passed: 14 tests.
- Runtime MCP targeted tests passed: 28 tests.
- Diff whitespace check passed.
- Real wrapper verification passed on main backend: a fresh `smallkhoj-daemon connect` stayed alive beyond the previous 4-5 second failure window, and a second invalid same-server wrapper exited with code 3 without killing the healthy daemon.

Regression coverage includes a fake `npm` and fake `node` wrapper process. It starts two wrappers for different server URLs and verifies they stay alive together, then starts another wrapper for the same backend using `localhost` vs `127.0.0.1` spelling and verifies the new wrapper fails fast while the existing daemon remains alive.

Residual note:

This fix addresses wrapper-level process safety and diagnostics. The broader daemon onboarding work remains open for connect-token lifecycle UX, expired/consumed token errors, full real CLI/browser evidence, and stable product copy around daemon maturity.
