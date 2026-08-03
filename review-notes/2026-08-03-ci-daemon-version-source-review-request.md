# Review Request: Derive CI Daemon version from package truth

Review-Target-ID: ci-daemon-version-source
Branch: feat/ci-daemon-version-source

## What

Remove copied current Daemon versions from GitHub Actions and version-sensitive test fixtures. Authenticated CI now validates `agent/daemon/aaa-daemon/package.json.version` and exports it to both release variables through `GITHUB_ENV`. Source hygiene also installs the WebDriver requirements it imports on a clean runner.

## Why

The old delivery contract enforced stale YAML literals, while Backend and Daemon tests copied other stale values. Updating those copies to a new literal would preserve the defect. The repair makes one package metadata edit propagate through the candidate pipeline without coupling the independent minimum-compatible-version policy.

## Original Requirements

> CI 的版本不能写死。
> 当前候选版本必须从 Daemon `package.json` 派生；修复后通过 PR 合入 `main`。

- Source: operator messages captured in `.trellis/tasks/08-03-ci-daemon-version-source/prd.md` and `task.json`.
- Please judge whether the diff prevents a future package bump from requiring synchronized handwritten CI/test edits.

## Tradeoff

The workflow uses one short inline Python parser instead of a new repository utility used only by GitHub Actions. The parser is explicit and fail-closed. Production `DAEMON_RELEASE_VERSION` is not auto-updated from an unpublished source candidate; deployment must continue selecting an actually hosted artifact.

## Architecture Ownership

Architecture cell: release pipeline / Daemon package distribution
Map delta: none
Why: this repairs wiring and test oracles inside existing owners; it creates no new state, transport, queue, adapter, or runtime boundary.

Please verify that the diff matches `Map delta: none` and that candidate-version derivation does not accidentally derive `MINIMUM_DAEMON_VERSION` or production deployment state.

## Open Questions

### Technical OQ

- Does the workflow fail closed for invalid package metadata while keeping the two exported values identical?
- Does the delivery contract reject literal assignments without confusing compatibility literals or arbitrary override test data with current-release authority?
- Is the candidate-versus-published-production boundary explicit enough to prevent an unpublished source bump from being advertised?

### Value OQ

None.

## Next Action

Review the full `origin/main...HEAD` diff and report any P0/P1/P2 findings, including inline comments. Confirm the reviewed HEAD SHA when passing.

## Review Sandbox

- Path: `/tmp/cat-cafe-review/ci-daemon-version-source/codex`
- Start command: no runtime start is required; use a detached read-only checkout and the validation commands below.
- Ports: none. If Backend database tests are repeated, use a task-specific disposable loopback PostgreSQL port rather than shared 5432.

## Self-check Evidence

### Spec compliance

- Report: `.trellis/tasks/08-03-ci-daemon-version-source/quality-report.md`
- Planning: `.trellis/tasks/08-03-ci-daemon-version-source/{prd,design,implement}.md`
- Updated contracts: `.trellis/spec/backend/{release-pipeline,deployment-environment-contracts}.md`
- Architecture map delta is `none`; root artifact guard and `git diff --check` pass.

### Test results

```text
make scripts-test
  172 passed, 1 skipped
  repeated from a fresh Python venv containing only declared WebDriver requirements

make backend-ci  # task-specific disposable PostgreSQL
  Alembic upgrade/check PASS; Ruff PASS; pytest 527 passed

cd agent/daemon/aaa-daemon && npm test
  TypeScript build PASS; 283 passed

make frontend-ci  # full merge-matrix parity
  254 passed; lint 0 errors; typechecks/build PASS

node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs
  39 passed

make compose-check
git diff --check
  PASS
```

### Related documents

- Bug report: `docs/bug-report/ci-daemon-version-source/bug-report.md`
- Feature ID: N/A; this is an independent CI bugfix that must land before the Codex ACP repair PR.
