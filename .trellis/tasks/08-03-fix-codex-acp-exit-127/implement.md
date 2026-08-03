# Implementation plan

## 1. Repository and baseline gate

- [x] Obtain explicit authorization before pushing the unrelated local `main` commits required by the worktree synchronization gate.
- [x] Confirm `docs/` is clean and `main` is exactly synchronized in both directions with `origin/main`.
- [x] Create sibling worktree `/Users/code/project/smallkhoj-fix-codex-acp-exit-127` on `feat/fix-codex-acp-exit-127`.
- [x] Bind the Trellis task to the worktree/branch and run `trellis-before-dev` completely.
- [x] Record the read-only real-test collector output and candidate identity.
- [x] Run the Integration Gate contract baseline:
  `rtk node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs`
- [x] Run the focused pre-change Daemon test baseline and record any unrelated failures.

## 2. RED: reproduce each broken contract

- [x] Add an environment test showing `buildCodexRuntimeEnv` leaks `npm_config_package` and `NPM_CONFIG_PACKAGE` while preserving a control npm setting.
- [x] Run the focused test and capture the expected RED caused by the leaked selector.
- [x] Add a process-boundary test showing `CodexAcpBridge` refills a selector omitted from its explicit env.
- [x] Run it and capture the expected RED caused by parent-env rehydration.
- [x] Add a readiness/lifecycle regression proving `result:error` without `exitCode` is rejected.
- [x] Run it and confirm it fails with `starting -> running -> exited`, not because of fixture/setup errors.

## 3. GREEN: minimal root-cause repair

- [x] Remove only lowercase and uppercase npm package selectors in `buildCodexRuntimeEnv`.
- [x] Treat an explicit ACP bridge env as authoritative instead of refilling it from `process.env`.
- [x] Replace the Codex result readiness check with an explicit-success predicate.
- [x] Do not change the ACP package version, launcher arguments, provider resolution, or backend schema.
- [x] Confirm the lifecycle regression turns green without an additional exit/offline synchronization patch.
- [x] Run each focused regression after its minimal implementation until green.

## 4. Refactor and automated validation

- [x] Keep the readiness change inline because no reusable predicate is needed.
- [x] Run the full `agent/daemon/aaa-daemon` build/test suite; the final run passed 284/286 and both failures were reproduced unchanged on `main@b97ea3a` (`0.2.2` fixture vs package `0.2.3`).
- [x] Run relevant backend Daemon-control tests (`54/54`).
- [x] Re-run the Integration Gate contract baseline (`39/39`).
- [x] Run `trellis-check`, then address all in-scope findings.

## 5. Isolated real/package verification

- [x] Build a disposable Daemon `0.2.3` tgz from the task worktree.
- [x] Extract the tgz, install its production dependencies in `/tmp`, and recreate the outer `npm_config_package=<daemon-tgz>` condition using the packaged `dist`.
- [x] Verify real `@zed-industries/codex-acp@0.16.0` initializes with a child PID instead of exiting `127` from package substitution.
- [x] Store sanitized evidence under this task's `evidence/` directory.
- [x] Do not restart or replace the shared Daemon without a new explicit authorization.

## 6. Finish

- [x] Update the runtime integration spec with the child-environment ownership contract.
- [x] Complete the Bug Report five-piece with final RED/GREEN commands and evidence.
- [x] Commit the task branch with focused Daemon and task/spec changes only.
- [x] Do not push, deploy, merge, or archive until the corresponding workflow authority/gates are satisfied.

## Risky files and rollback points

- `codex-runtime.ts`: environment changes affect both resident ACP and turn-based Codex launch; focused preservation tests are mandatory.
- `daemon.ts`: readiness changes can suppress legitimate startup; the existing successful ACP integration is the positive control.
- `daemon-runtime.test.mjs`: asynchronous heartbeat assertions must use condition-based waits, not arbitrary sleeps.
- No database migration is allowed. If backend changes become necessary, return to planning before editing them.
