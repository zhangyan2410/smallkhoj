# Implementation plan

## 1. Establish baselines

- [x] Record repository/worktree/branch and dirty state.
- [x] Run the Integration Gate compatibility tests and help contract.
- [x] Run `make scripts-test` and preserve the current expected version-drift failure.
- [x] Run the focused backend command-generation tests and the complete Daemon suite to preserve their current expected failures.

## 2. RED — encode the intended contracts

- [x] Replace the delivery test's requirement for YAML version literals with assertions that reject literal assignments and require package-derived `$GITHUB_ENV` exports.
- [x] Add a delivery assertion that the source-hygiene job installs `agent/daemon/webdriver/requirements.txt` before `make scripts-test`.
- [x] Run the focused delivery tests and confirm they fail for the intended missing dynamic export and dependency-provisioning reasons.

## 3. GREEN — repair the workflow

- [x] Add the WebDriver requirements installation step to source-hygiene.
- [x] Remove static `DAEMON_RELEASE_VERSION` and `E2E_DAEMON_VERSION` values from authenticated E2E.
- [x] Add a fail-closed package-version export step that writes both variables to `$GITHUB_ENV`.
- [x] Re-run focused delivery tests until green without weakening the new assertions.

## 4. Remove stale test oracles

- [x] Read package metadata in `backend/tests/test_daemon_command_generation.py` and use it only for default current-release expectations.
- [x] Keep the configured-version override test independent from the package default.
- [x] Read package metadata in `agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs` and use it for emitted connect/register version expectations.
- [x] Run focused backend and Daemon tests, then their complete affected suites.

## 5. Quality and release gates

- [x] Run `make scripts-test`.
- [x] Run `make backend-ci` with the required disposable PostgreSQL environment.
- [x] Run `npm test` in `agent/daemon/aaa-daemon`.
- [x] Re-run Integration Gate compatibility tests and help.
- [x] Run `make compose-check` and `git diff --check`.
- [x] Search the touched handwritten files for remaining current-release literals and inspect each match by semantics.
- [x] Update the release/deployment specs so they name `package.json` as the current-version authority rather than documenting a stale current value.

## 6. Delivery

- [ ] Commit the clean candidate, push `feat/ci-daemon-version-source`, and open an independent PR.
- [ ] Obtain remote review and all required GitHub checks; fix findings without bypasses.
- [ ] Squash merge with `--match-head-commit`, verify candidate-tree/main-tree equality, and sync local `main`.
- [ ] Rebase PR #3 onto the merged CI baseline, rerun its gates/review, then squash merge it.
- [ ] Remove only the two worktrees and local/remote branches proven merged.

## Rollback points

- Before workflow GREEN: revert only test-contract edits if the design proves invalid.
- Before CI PR merge: amend or replace the candidate through normal commits; do not bypass a red gate.
- After squash merge: use a normal revert PR if the CI change regresses clean-runner behavior. No deployment rollback is applicable.
