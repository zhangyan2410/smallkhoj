# Design: package-derived Daemon version in CI

## Boundary and source of truth

The only manually edited current-release value is:

```text
agent/daemon/aaa-daemon/package.json.version
```

The CI data flow is:

```text
package.json.version
  -> authenticated-e2e setup step
  -> GITHUB_ENV
  -> DAEMON_RELEASE_VERSION + E2E_DAEMON_VERSION
  -> backend candidate + delivery validator + authenticated E2E
```

`MINIMUM_DAEMON_VERSION` is deliberately outside this flow. It controls protocol admission compatibility, whereas the package version selects the recommended release artifact.

## Workflow contract

The authenticated E2E job will no longer declare release-version literals in its static `env` mapping. After checkout and Python setup, one fail-closed step will parse `agent/daemon/aaa-daemon/package.json`, validate that `version` is a non-empty semantic-version string, and append identical `DAEMON_RELEASE_VERSION` and `E2E_DAEMON_VERSION` entries to `$GITHUB_ENV`.

The repository contract test will verify both halves of this boundary:

1. no semantic-version literal is assigned to either CI variable; and
2. the workflow reads the canonical package path and exports both names through `$GITHUB_ENV`.

This prevents a future version bump from requiring a workflow edit and also prevents a synchronized but duplicated version change from satisfying the test.

## Test expectation boundaries

- Python backend tests read the root Daemon package metadata directly for default command expectations. They still use a deliberately different configured version in the override test so the test does not merely restate the default.
- Node Daemon integration tests read `../package.json` relative to the test module and compare emitted connect/register payloads with that value. They do not import the production `DAEMON_VERSION` constant as the oracle, because expected and actual should not share the same implementation variable.
- Compatibility examples such as `MINIMUM_DAEMON_VERSION=0.2.0` remain literals when the number is test data rather than the current release authority.
- `package-lock.json` is generated package-manager metadata. Its root package version should be synchronized separately when package metadata is changed, but CI does not consume it as the release authority.

## Clean-runner dependency boundary

`make scripts-test` intentionally includes the project WebDriver selection tests. Those modules import the three dependencies already declared in `agent/daemon/webdriver/requirements.txt`. The source-hygiene job will install that declared file before invoking the Make target. No production dependency or alternate duplicate requirements list is introduced.

The delivery contract will require the exact requirements-file provisioning step before `make scripts-test`, preventing local ambient packages from masking the clean-runner requirement again.

## Compatibility, rollout, and rollback

- Runtime and API behavior remain unchanged; only CI setup and test oracles change.
- The CI repair is isolated in its own branch and PR. It must land before PR #3 so that PR #3 can rebase onto a truthful green baseline.
- Rollback is a normal PR revert: restore the prior workflow/test files. No data migration, service restart, artifact publication, or cloud action is involved.

## Trade-offs

- A short inline Python setup block in the workflow avoids introducing a repository utility used only by GitHub Actions. The contract test owns its required semantics.
- Installing the existing WebDriver requirements adds a small source-job setup cost, but it makes the job's import environment explicit and matches the documented WebDriver installation contract.
