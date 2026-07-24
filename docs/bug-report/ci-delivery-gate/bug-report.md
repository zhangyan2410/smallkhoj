# Deterministic CI delivery gate is missing

## Bug diagnosis capsule

| Field | Content |
| --- | --- |
| **1. Symptom** | A clean checkout has no committed CI workflow, no canonical frontend `test` or `typecheck` scripts, and no single local command matrix matching release checks. Expected: PR/main CI installs locked dependencies and requires migration/PostgreSQL tests, backend tests/Ruff, frontend tests/lint/typecheck/build, and source/schema hygiene. |
| **2. Evidence** | `.github/workflows/` does not exist. `frontend/package.json` exposes build/e2e/lint but no `test` or `typecheck`. `backend/pyproject.toml` has no Ruff dev dependency/config. PostgreSQL suites skip when explicit disposable URLs are absent. |
| **3. Confirmed root cause** | Delivery commands evolved in docs and local sessions without a committed executable gate. Optional local PostgreSQL fixtures were never promoted into required CI environment wiring. |
| **4. Diagnostic strategy** | Add a source contract test for workflow jobs, PostgreSQL service/env, canonical scripts, non-secret build env, Make targets and lockfile cache keys. Run it RED, implement the workflow/scripts, then execute every command locally in workflow order. |
| **5. Timeout strategy** | Bound each CI job and service health check. If a command cannot run cleanly, keep the gate red and report the exact command; never skip or blanket-ignore it to manufacture green. |
| **6. Warning strategy** | Reject CI that permits PostgreSQL skips, uses real/reusable secrets, accepts a deterministically red Ruff baseline, omits production build env, or has a different command contract from README/Makefile. |
| **7. User-visible correction** | Pull requests and main pushes visibly fail before broken migration, backend, frontend, dependency or production-build changes can be treated as releasable. |
| **8. Acceptance** | The delivery contract RED becomes green, workflow syntax parses, all named commands pass from the current candidate, and clean checkout CI requires every job. |

## Implemented correction

- `scripts/validate_delivery_env.py` is the fail-closed authority for backend,
  frontend and E2E delivery environments. A `disposable` label alone is not
  sufficient: destructive database targets must be loopback, use a disposable
  database-name marker, use the same PostgreSQL server as their admin URL, and
  must not equal the admin database. Browser E2E bases must be credential-free
  loopback candidates. The E2E gate validates the actual `DATABASE_URL` and
  `BETTER_AUTH_DATABASE_URL`, requires both to identify the same loopback
  disposable database, and never treats `E2E_DATABASE_SCOPE=disposable` alone as
  safety evidence.
- Backend installation now runs `uv lock --check` followed by
  `uv sync --dev --locked`; frontend installation remains pinned to Bun and the
  committed lockfile.
- Authenticated CI builds the final frontend Docker image with a BuildKit
  secret, starts that exact standalone image, and exercises `/login` and the
  authenticated integration against it. It no longer substitutes `next start`
  for the production artifact.
- Service-log credential scanning first proves both logs are readable and
  distinguishes `rg`'s match, no-match and scanner-error exits. Missing logs or
  a failed scanner cannot be reported as a clean result.
- Contract evidence: 9 environment-validator tests, 7 delivery contract tests,
  the complete 110-test scripts suite, `uv lock --check`, `git diff --check`,
  actionlint, frontend TypeScript, and Playwright test discovery all pass on the
  candidate.

## Follow-up: executable E2E consumer binding

### Bug diagnosis capsule

| Field | Content |
| --- | --- |
| **1. Symptom** | The documented `bun run e2e` command starts Playwright directly, so it can enumerate and execute the mutating authenticated flow with remote web bases and without either database URL. The CI path also validates a host-side Better Auth database URL but replaces it with a separately hard-coded container URL. Expected: every executable entrypoint fails before Playwright unless the exact values consumed by the backend and frontend are validated disposable loopback targets. |
| **2. Evidence** | `frontend/package.json` invokes raw Playwright; `management-flow.spec.ts` checks only a caller-supplied scope label and selected test inputs. A direct `--list` reproduction with remote bases and absent database URLs exits zero. In CI, `make e2e-authenticated` validates the job-level URL, while the later `docker run` line injects a different `host.docker.internal` URL. |
| **3. Confirmed root cause** | The safety check was composed at the Make target instead of the closest public package entrypoint, and CI duplicated consumer destinations rather than passing validated variables unchanged. The validator itself is fail-closed; its result was not bound to every caller and final consumer. |
| **4. Diagnostic strategy** | Trace the data flow from README/package script through Make, Playwright configuration, CI job variables, and the final frontend container. Add contract tests for the package preflight and exact container env inheritance, plus validator tests for the frontend's internal API and Better Auth public origin. |
| **5. Timeout strategy** | If a package-level Python preflight cannot run consistently from the frontend working directory, stop after one focused attempt and introduce one repository-owned wrapper rather than duplicating the safety rules in TypeScript. |
| **6. Warning strategy** | Reject any fix that still trusts `E2E_DATABASE_SCOPE=disposable` alone, validates a dummy URL instead of the consumed URL, permits remote browser/API bases, or maintains separate unchecked host/container destinations. |
| **7. User-visible correction** | Unsafe direct E2E commands terminate with a clear environment-validation error before browser startup or any remote mutation. |
| **8. Acceptance** | RED contract tests prove the current package/CI wiring bypass; GREEN requires the direct Bun command to invoke the canonical validator first, CI to pass the validated URLs unchanged, validator coverage for actual frontend destinations, and the authenticated local-prod flow to remain green. |

### Five-part bug record

1. **Reporter:** Independent release-gate review on 2026-07-23, followed by a
   main-session source/data-flow confirmation.
2. **Reproduction:** Run the package E2E command with remote `API_BASE` and
   `FRONTEND_BASE`, `E2E_DATABASE_SCOPE=disposable`, and no database URLs. The
   old command reached Playwright discovery successfully. Separately, inspect
   the CI frontend `docker run`: it consumed hard-coded `host.docker.internal`
   API/database URLs rather than the job values that the validator approved.
3. **Root cause:** The canonical validator was only a Make prerequisite. The
   documented package command bypassed Make, while CI copied and translated
   destinations after validation instead of binding the validation result to
   the final consumer.
4. **Fix:** `bun run e2e` now invokes `validate_delivery_env.py e2e` before
   Playwright. The validator additionally binds `INTERNAL_API_BASE_URL` to
   `API_BASE` and `BETTER_AUTH_URL` to `FRONTEND_BASE`. The Linux CI candidate
   uses host networking and inherits the already-validated API and Better Auth
   database URLs unchanged.
5. **Verification:** Three focused RED assertions failed for the intended
   package, workflow, and consumer-binding reasons. The 17-test delivery/env
   suite then passed. The former remote/absent-database `bun run e2e -- --list`
   reproduction now exits before Playwright with `DATABASE_URL is required`.
   The full disposable local-prod authenticated flow passed 1/1 through the new
   double preflight (`make` plus package entrypoint).
