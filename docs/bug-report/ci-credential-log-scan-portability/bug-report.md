# CI credential log scan portability

## Bug diagnosis capsule

| Field | Evidence |
| --- | --- |
| Phenomenon | PR #2 GitHub Actions run `30521553081` completed the authenticated management integration, then failed in `Reject credential leakage in service logs` with `rg: command not found` and status `127`. The job should fail only for a credential match or a real scan error. |
| Evidence | Job `90803243215` passed candidate installation, database migration, frontend image build, service readiness, authenticated management integration, and log capture. `.github/workflows/ci.yml` invoked `rg` twice but did not install it. |
| Root cause | The workflow assumed ripgrep was part of the `ubuntu-latest` runner contract. The job provisions Python, uv, Bun, Docker, and Chromium, but not ripgrep. The delivery contract test asserted the `rg` invocation instead of asserting a self-contained scanner contract. |
| Diagnostic strategy | Trace the failing shell status back from `handle_scan_status`, compare the job setup steps with its command dependencies, and inspect the workflow contract test for the same assumption. |
| Timeout strategy | If the focused contract did not reproduce the dependency or replacing the scanner changed status semantics, stop after one attempt and extract the scan block into a separately executable shell fixture. |
| Warning strategy | Any loss of exact-value checks, token-pattern checks, or the distinction between grep status `1` (no match) and statuses `>1` (error) invalidates the fix. |
| User-visible correction | None. This repairs delivery infrastructure only; Integration Gate runtime and UI behavior are unchanged. |
| Acceptance | Focused contract Red→Green, full script tests, canonical local CI, final-SHA independent review, and GitHub Actions green. |

## Reporter

GitHub Actions reported the failure after PR #2 was pushed. The operator required all
failed gates to be investigated and repaired rather than ignored.

## Reproduction

1. Run the `authenticated-e2e` job from `.github/workflows/ci.yml` on a runner without
   ripgrep.
2. Let the authenticated flow and log capture finish.
3. Observe the credential scan shell step exit `127` at its first `rg` command.

Expected: readable service logs are scanned; no match succeeds, a match fails as a
leak, and scanner errors fail closed.

Actual: the scan never executes because its command is unavailable.

## Root-cause analysis

`scan_exact` and `scan_pattern` correctly preserve the scanner's exit status while
temporarily disabling `errexit`, but they selected an executable the job never
provisioned. The regression escaped locally because
`scripts/tests/test_delivery_contract.py` required the same `rg` text rather than
checking that the workflow uses a baseline command.

## Fix

Use GNU grep, which is part of the GitHub-hosted Ubuntu shell environment already
required by this Bash workflow:

- `grep -Fq` for literal secret values;
- `grep -Eq` for the existing extended token pattern.

Keep `handle_scan_status` unchanged, preserving `0 = match/leak`, `1 = no match`, and
`>1 = scanner error`. Explicitly installing ripgrep was rejected because it adds a
network/package-manager dependency to a security check that needs only baseline grep
semantics.

## Verification

- The focused workflow contract must fail against the original `rg` implementation
  and pass with the grep implementation.
- The complete `scripts/tests` suite and canonical local CI must pass.
- PR #2 GitHub Actions must rerun successfully on the final SHA.
