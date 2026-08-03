# Implementation plan

## 1. Repository and baseline gate

- [ ] Obtain explicit authorization before pushing the unrelated local `main` commits required by the worktree synchronization gate.
- [ ] Confirm `docs/` is clean and `main` is exactly synchronized in both directions with `origin/main`.
- [ ] Create sibling worktree `/Users/code/project/smallkhoj-fix-codex-acp-exit-127` on `feat/fix-codex-acp-exit-127`.
- [ ] Bind the Trellis task to the worktree/branch and run `trellis-before-dev` completely.
- [ ] Record the read-only real-test collector output and candidate identity.
- [ ] Run the Integration Gate contract baseline:
  `rtk node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs`
- [ ] Run the focused pre-change Daemon test baseline and record any unrelated failures.

## 2. RED: reproduce each broken contract

- [ ] Add an environment test showing `buildCodexRuntimeEnv` leaks `npm_config_package` and `NPM_CONFIG_PACKAGE` while preserving a control npm setting.
- [ ] Run the focused test and capture the expected RED caused by the leaked selector.
- [ ] Add a readiness regression proving `result:error` without `exitCode` is rejected and explicit `result:success` is accepted.
- [ ] Run it and capture the expected RED caused by absence-based success inference.
- [ ] Add the smallest practical lifecycle integration using a disposable ACP child that exits `127`; assert no running heartbeat and an exited lifecycle snapshot.
- [ ] Run it and confirm it fails for the false-ready behavior, not because of fixture/setup errors.

## 3. GREEN: minimal root-cause repair

- [ ] Remove only lowercase and uppercase npm package selectors in `buildCodexRuntimeEnv`.
- [ ] Replace the Codex result readiness check with an explicit-success predicate.
- [ ] Do not change the ACP package version, launcher arguments, provider resolution, or backend schema.
- [ ] If and only if lifecycle RED remains after those two changes, add a narrowly scoped exit/offline synchronization in the Daemon and document the evidence.
- [ ] Run each focused regression after its minimal implementation until green.

## 4. Refactor and automated validation

- [ ] Keep any extracted predicate small, named by contract, and shared only where it reduces ambiguity.
- [ ] Run the full `agent/daemon/aaa-daemon` build/test suite.
- [ ] Run relevant backend Daemon-control tests if lifecycle expectations touch backend-owned status mapping.
- [ ] Re-run the Integration Gate contract baseline.
- [ ] Run `trellis-check`, then address all in-scope findings.

## 5. Isolated real/package verification

- [ ] Build a disposable Daemon package/candidate from the task worktree.
- [ ] Recreate the outer `npm_config_package=<daemon-tgz>` condition and start the nested ACP package in isolation.
- [ ] Verify the requested ACP launcher is selected and does not exit `127` from package substitution.
- [ ] Use a unique task marker and store sanitized evidence under this task's `evidence/` directory.
- [ ] Do not restart or replace the shared Daemon without a new explicit authorization.

## 6. Finish

- [ ] Update the runtime integration spec with the child-environment ownership contract if `trellis-update-spec` confirms it is durable project knowledge.
- [ ] Complete the Bug Report five-piece with final RED/GREEN commands and evidence.
- [ ] Commit the task branch with focused Daemon and task/spec changes only.
- [ ] Do not push, deploy, merge, or archive until the corresponding workflow authority/gates are satisfied.

## Risky files and rollback points

- `codex-runtime.ts`: environment changes affect both resident ACP and turn-based Codex launch; focused preservation tests are mandatory.
- `daemon.ts`: readiness changes can suppress legitimate startup; the existing successful ACP integration is the positive control.
- `daemon-runtime.test.mjs`: asynchronous heartbeat assertions must use condition-based waits, not arbitrary sleeps.
- No database migration is allowed. If backend changes become necessary, return to planning before editing them.
