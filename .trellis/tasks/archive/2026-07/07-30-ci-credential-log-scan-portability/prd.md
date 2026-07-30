# Make credential log scan self-contained

## Goal

Restore PR #2's GitHub Actions gate by making the authenticated E2E credential-log
scan runnable on a stock `ubuntu-latest` runner, without weakening secret-leak
detection or changing Integration Gate product behavior.

## Background

- GitHub Actions run `30521553081`, job `90803243215`, completed the authenticated
  management integration and failed only in `Reject credential leakage in service
  logs` with `rg: command not found` (status 127).
- `.github/workflows/ci.yml` calls `rg` in `scan_exact` and `scan_pattern`, but the
  authenticated E2E job neither installs ripgrep nor uses an action that guarantees it.
- `scripts/tests/test_delivery_contract.py` currently treats the unprovisioned `rg`
  invocation as part of the expected workflow, so local contract tests do not catch
  the runner dependency gap.

## Requirements

- Preserve exact-value scans for the ephemeral public key, auth bridge secret, and
  Better Auth secret.
- Preserve the ERE scan for minted session/connect/machine tokens.
- Preserve fail-closed exit semantics: match means credential leakage; no match is
  success; scanner errors remain failures with their original non-1 status.
- Use a scanner available in the stock GitHub-hosted Ubuntu shell environment, or
  explicitly provision any non-baseline scanner before use.
- Add a regression contract that rejects the previous unprovisioned `rg` dependency.
- Keep root-level user artifacts and unrelated Trellis work untouched.

## Acceptance Criteria

- [x] The focused delivery contract test demonstrates Red against the old workflow
  and Green after the workflow repair.
- [x] Exact and regex credential scans remain present and fail closed.
- [x] The full `scripts/tests` unittest suite passes.
- [x] The canonical local CI gate passes on the final commit.
- [x] An independent agent reviews and explicitly approves the CI delta on the final
  SHA.
- [x] PR #2 GitHub Actions passes on the final behavioral SHA. Two standard cloud
  review triggers received no acknowledgement after their five-minute windows, so
  the documented unavailable-reviewer fallback uses the independent full review plus
  exact-SHA CI-delta approval; no remote P0/P1/P2 findings exist.

## Out of Scope

- Changes to Integration Gate runtime, CLI, daemon control, or frontend behavior.
- Broad CI toolchain refactors or runner image pinning.
- Any modification or cleanup of `MEMORY.md`, `session-observer/`, or unrelated
  active Trellis tasks.
