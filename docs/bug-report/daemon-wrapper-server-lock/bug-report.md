# Daemon Wrapper Server Lock

## Reporter

Reported by the operator on 2026-06-23 after `smallkhoj-daemon connect` started runtime processes and then the daemon and runtimes received `SIGTERM`.

## Reproduction

Expected behavior:

- Starting a daemon for the feature backend on `127.0.0.1:8015` does not stop a daemon connected to the main backend on `localhost:8000`.
- Restarting a daemon for the same backend replaces only that backend's previous wrapper.
- When a wrapper intentionally stops an older wrapper, the log explains which server and lock file caused the stop.

Actual behavior observed:

- The product-facing `smallkhoj-daemon` wrapper used one global lock file at `~/.smallkhoj/daemon.pid`.
- Starting a new wrapper removed that lock and stopped the recorded PID tree regardless of which backend server it belonged to.
- The user-visible logs only showed runtime `SIGTERM`, daemon `Received SIGTERM`, and shutdown, without enough context to tell that wrapper singleton cleanup caused the stop.

## Root Cause

The wrapper's singleton lock was not scoped to the backend server. It treated every local preview, branch worktree, and main backend as the same singleton because all of them wrote to the same default pid file.

This interacted badly with branch-specific preview ports. A token generated from the feature backend on `127.0.0.1:8015` and a daemon command pointed at `localhost:8000` already caused a separate invalid-token failure. After the frontend command was fixed to preserve the current API base, the wrapper still had a lifecycle bug: starting another daemon for a different server could kill the currently running wrapper and its runtime children.

## Fix

The `smallkhoj-daemon` wrapper now scopes its default lock file by the selected server URL:

- Default lock directory is `~/.smallkhoj/daemons`.
- `SMALLKHOJ_DAEMON_LOCK` still overrides the exact lock file when an operator needs explicit control.
- `SMALLKHOJ_DAEMON_LOCK_DIR` can override only the default lock directory, which is useful for isolated tests.
- The lock key is a short SHA-256 digest of a normalized server URL.
- `localhost` and `127.0.0.1` on the same port share a lock, so the same backend remains a singleton even if the host spelling changes.
- Different backend ports get different locks, so preview and main daemons no longer kill each other.
- The singleton cleanup log now includes the server URL, old PID, and lock file path.

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
- Targeted wrapper tests passed: 3 tests.
- Daemon TypeScript build passed.
- Full daemon test suite passed: 144 passed, 0 failed.
- Diff whitespace check passed.

Regression coverage includes a fake `npm` and fake `node` wrapper process. It starts two wrappers for different server URLs and verifies they stay alive together, then starts a replacement wrapper for the same backend using `localhost` vs `127.0.0.1` spelling and verifies only that backend's old wrapper is stopped.

Residual note:

This fix addresses wrapper-level process replacement and diagnostics. The broader daemon onboarding work remains open for connect-token lifecycle UX, expired/consumed token errors, full real CLI/browser evidence, and stable product copy around daemon maturity.
