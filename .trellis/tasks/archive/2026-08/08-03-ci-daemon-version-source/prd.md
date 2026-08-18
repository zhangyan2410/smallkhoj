# Derive CI Daemon version from package truth

## Goal

Restore the repository delivery gates without creating another Daemon release-version copy. A Daemon version bump must require changing only `agent/daemon/aaa-daemon/package.json`; CI and version-sensitive regression tests must follow that value automatically.

## Background

- The Daemon package metadata currently reports `0.2.3`.
- `.github/workflows/ci.yml:165-166` duplicates an older release version in `DAEMON_RELEASE_VERSION` and `E2E_DAEMON_VERSION`.
- `scripts/tests/test_delivery_contract.py:104-105` currently requires those duplicated YAML literals, so the contract enforces the drift instead of preventing it.
- `backend/tests/test_daemon_command_generation.py:12,46,70` and `agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs:1934,1988,2010,2058` contain stale current-release expectations.
- The source-hygiene GitHub job runs `make scripts-test` in a clean Python 3.12 environment but does not install the dependencies declared by `agent/daemon/webdriver/requirements.txt`; collection therefore fails at `import requests` before the delivery contracts run.
- GitHub run `30817948692` recorded both failure classes: source-hygiene stopped on missing `requests`, while the backend gate reported two command-generation expectation failures.

## Requirements

### R1 — One release-version authority

- `agent/daemon/aaa-daemon/package.json` is the sole manually maintained current Daemon release version.
- GitHub Actions must read that file after checkout and export the same value to both `DAEMON_RELEASE_VERSION` and `E2E_DAEMON_VERSION` through the job environment.
- The workflow must not assign a semantic-version literal directly to either release-version variable.
- `MINIMUM_DAEMON_VERSION` remains a separate compatibility policy and is not derived from the current package release.

### R2 — Drift-resistant regression expectations

- The delivery contract must reject literal CI assignments and require the package-metadata-to-job-environment wiring.
- Backend command-generation default expectations must derive the release version from package metadata while preserving an independent override test.
- Daemon connect/register payload tests must compare against package metadata rather than a copied current-release literal.
- Generated lockfile metadata may mirror the package version, but handwritten CI, tests, and current-version documentation must not become competing authorities.

### R3 — Clean-runner source gate

- The source-hygiene job must explicitly install the WebDriver test dependency set from `agent/daemon/webdriver/requirements.txt` before `make scripts-test`.
- The delivery contract must require this provisioning step so a future workflow edit cannot silently restore reliance on ambient workstation packages.

### R4 — Evidence and scope

- Use test-first changes: observe focused contract failures for R1 and R3 before changing the workflow, then keep the complete affected suites green.
- Do not change Daemon runtime behavior, backend command generation behavior, minimum-version compatibility policy, deployment state, shared Daemon processes, or databases.
- This task unblocks PR #3 but remains an independent PR and squash merge into `main`.

## Acceptance Criteria

- [x] AC1: A delivery-contract regression test fails if either CI release variable is assigned any semantic-version literal, regardless of the package's current value.
- [x] AC2: CI exports both release variables from `agent/daemon/aaa-daemon/package.json` and the delivery-contract suite proves that wiring.
- [x] AC3: A clean Python runner provisions `agent/daemon/webdriver/requirements.txt` before `make scripts-test`; the complete scripts suite passes without ambient dependencies.
- [x] AC4: Backend default connect/reconnect command tests and Daemon connect/register payload tests derive their expected current version from package metadata and pass.
- [x] AC5: `make scripts-test`, the complete backend CI gate, the complete Daemon suite, the Integration Gate compatibility tests, `make compose-check`, and `git diff --check` pass on the candidate.
- [ ] AC6: The CI-fix PR is reviewed, all required GitHub checks pass, and it is squash-merged to `main` before PR #3 is rebased or merged.

## Out of Scope

- Changing the Daemon release version or minimum supported version.
- Publishing or deploying Daemon artifacts, cloud application images, or production configuration.
- Refactoring the WebDriver dependency model beyond making its existing declared requirements explicit in CI.
- Fixing unrelated historical version examples that intentionally exercise compatibility or arbitrary-version behavior.
