# Quality Gate Report

Task: `.trellis/tasks/08-03-ci-daemon-version-source/`
Checked: 2026-08-03
Candidate base: `origin/main@b97ea3a3269a3a8e112aee8e51d83d15408275ed`

## Vision coverage

| Operator requirement | Acceptance coverage | Result |
| --- | --- | --- |
| CI Daemon version must not be hardcoded | AC1, AC2 | PASS: both candidate variables are exported from `package.json.version`; literal assignments are rejected by the delivery contract. |
| Fix the blocking CI baseline before merging the Codex ACP repair | AC3-AC6 | PASS for implementation and local gates; the independent PR/review/merge portion of AC6 is the next delivery stage. |
| Do not deploy or disturb the active development runtime | R4 | PASS: no deployment, shared database, Daemon restart, or 3000/8000 process mutation occurred. |

## Functional acceptance

| Requirement | Implementation / assertion | Result |
| --- | --- | --- |
| One candidate-version authority | `.github/workflows/ci.yml` reads `agent/daemon/aaa-daemon/package.json` after checkout and exports both variables through `GITHUB_ENV`. | PASS |
| Fail-closed parsing | The setup step uses an explicit non-zero `sys.exit` for a missing, non-string, or non-stable-semver value; it does not use Python `assert`. | PASS |
| Literal drift prevention | `scripts/tests/test_delivery_contract.py` rejects any semantic-version literal assignment to either CI variable. | PASS |
| Clean-runner dependency declaration | Source hygiene installs `agent/daemon/webdriver/requirements.txt` before `make scripts-test`, with ordering asserted by the delivery contract. | PASS |
| Independent test oracles | Backend default command and Daemon payload tests read package metadata; the configured Backend override remains independent test data. | PASS |
| Generated metadata consistency | `npm install --package-lock-only --ignore-scripts` changed only the two root lockfile version fields to mirror package metadata. | PASS |
| Candidate vs production boundary | Release specs distinguish package-derived CI candidate values from the explicit production selection that must match the actually hosted tgz. | PASS |

## Architecture ownership

Architecture cell: release pipeline / Daemon package distribution
Map delta: none
Why: the change repairs version flow through existing workflow, package, and test boundaries; it introduces no parallel Store, Queue, Router, Adapter, Dispatcher, Binding, or runtime owner.

Cross-layer trace:

```text
agent/daemon/aaa-daemon/package.json.version
  -> authenticated-e2e setup
  -> GITHUB_ENV
  -> DAEMON_RELEASE_VERSION + E2E_DAEMON_VERSION
  -> candidate install / authenticated E2E
```

`MINIMUM_DAEMON_VERSION` remains outside this flow as a compatibility policy.

## Scope and artifact checks

- Dogfood-Your-Slice: exempt; this is internal CI/test infrastructure with no user-visible runtime path.
- Design comparison: no `designs/` directory and no frontend UI change.
- Root media/design artifacts: none in working state or committed branch diff.
- Fallback-layer / feature-truth / hotfix helper scripts: not present in this repository; the task is a normal bugfix, has no Feature ID, and does not add fallback layers.
- Existing frontend lint output contains one warning in untouched `frontend/lib/activity-unread-state.ts`; lint exits successfully with zero errors.

## Fresh verification evidence

| Command | Result |
| --- | --- |
| `make scripts-test` | 172 passed, 1 skipped; WebDriver selection 34 passed; guard Node tests passed. |
| Clean Python venv + declared WebDriver requirements + `make scripts-test` | 172 passed, 1 skipped; proves the scripts gate does not depend on ambient Python packages. |
| `make backend-ci` with disposable PostgreSQL on `127.0.0.1:55433` | Alembic upgrade/check passed; Ruff passed; 527 pytest tests passed. |
| `npm test` in `agent/daemon/aaa-daemon` | TypeScript build passed; 283 tests passed. |
| `make frontend-ci` with disposable PostgreSQL on `127.0.0.1:55433` | 254 tests passed; lint 0 errors/1 unrelated warning; both typechecks and production build passed. |
| Integration Gate Node suite | 39 passed; CLI `--help` contract passed. |
| `make compose-check` | Passed. |
| `git diff --check` | Passed. |
| Ruby YAML parse | `.github/workflows/ci.yml` parsed successfully. |
| Inline candidate parser | Printed the package-derived candidate version successfully. |

`actionlint` is not installed locally (`rtk: No such file or directory`), so GitHub's workflow parser remains the final platform-specific syntax check. The repository delivery contract and an independent YAML parse both pass locally.

The two disposable PostgreSQL runs used the task-specific container `smallkhoj-ci-daemon-version-source-postgres`; it was stopped with `--rm`, port 55433 has no listener, and no shared database was used.

## Gate result

PASS for commit, PR, and remote review. AC6 remains deliberately open until GitHub checks/review pass and the PR is squash-merged into `main`.
