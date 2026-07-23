# Audit remediation integration and release implementation plan

## 0. Hard start gate

- [ ] Obtain explicit authorization for required push/synchronization actions.
- [ ] Correct and commit only audit/remediation artifacts; preserve unrelated WIP.
- [ ] Push local approved commit(s), then prove `main...origin/main` ahead=0/behind=0.
- [ ] Prove docs/status clean enough for worktree rule without deleting/moving user files.
- [ ] Create `../smallkhoj-audit-remediation` on
      `feat/2026-07-audit-remediation`; record metadata and activate reviewed first child.
- [ ] Create release manifest/evidence matrix with base SHA and tool versions.

## 1. Integrate schema child

- [ ] Complete schema diagnostic capsules and RED/GREEN work in declared TDD order.
- [ ] Run fresh/versioned/legacy PostgreSQL migration matrix, historical/transition seq,
      Task/File delete and no-startup-DDL checks.
- [ ] Review migration locks/duration/reversibility and exact baseline-only adoption docs.
- [ ] Record schema revision/commit/evidence; do not proceed on unknown legacy fingerprint.

## 2. Integrate auth/tenancy child

- [ ] Apply DB invariant migrations after schema foundation.
- [ ] Run credential transport/env, permission, actor alias, two-session owner race and
      template tenant/legacy/slug matrices.
- [ ] Run full backend/auth gates and scan source/log/test artifacts for credentials.
- [ ] Record canonical authenticated fixture contract for downstream runtime/delivery.

## 3. Integrate runtime/querying child

- [ ] Reproduce/query-budget REDs on integrated routers and preserve JSON snapshots.
- [ ] Resolve 005/018 with combined query ceiling + filter-before-limit + full traversal.
- [ ] Run upload cleanup, real NOTIFY reconnect/budget and open-stream ASGI finalizer tests.
- [ ] Integrate frontend cursor consumption and single realtime owner; prove targeted
      invalidation and no duplicate EventSource.
- [ ] Record actual worker/pool/listener/subscription counts and shutdown evidence.

## 4. Integrate delivery/UI child

- [ ] Establish green Ruff baseline and non-secret build/CI contract.
- [ ] Apply verified Bun cleanup and code-splitting/boundary changes without stale docs.
- [ ] Repair authenticated isolated automated flow and negative server/auth cases.
- [ ] Integrate Task/File deletion/loading/error/realtime UI with component/accessibility
      tests before real runtime evidence.
- [ ] Re-run all CI-equivalent commands from clean dependency state.

## 5. Integrate architecture child

- [ ] Freeze OpenAPI/JSON/event/chat behavior after functional changes.
- [ ] Extract routers/helpers/client/state owner in small independently green commits.
- [ ] After every extraction run focused/full gates and refresh CodeGraph.
- [ ] Complete DEP-01 ADR/boundary checks and confirm no import cycles/side effects.
- [ ] Do not merge a behavior change disguised as file movement.

## 6. Apply approved product dispositions

- [ ] Record final 006–011 decisions and owners.
- [ ] Apply approved tri-theme DESIGN/handoff truth reconciliation.
- [ ] Link deferred observer/Work Item/Remotion tasks without touching user WIP.
- [ ] Close P009 only from owning database/UI evidence.
- [ ] If approved, integrate `/control/daemon` route/nav/redirect/docs tests; otherwise
      synchronize PRODUCT truth with the recorded alternative.

## 7. Full database and security matrix

- [ ] Recreate isolated PostgreSQL from scratch; execute fresh upgrade and all postchecks.
- [ ] Recreate baseline and legacy fixtures; execute adoption/upgrade and data invariants.
- [ ] Repeat sequence transition, owner race, template scope and delete transaction tests.
- [ ] Run complete backend pytest/Ruff/migration/schema gates.
- [ ] Run auth/tenant adversarial suite and credential leak scans.

## 8. Full frontend and automated-flow matrix

- [ ] From clean state run frozen Bun install, complete tests, lint, typecheck and build.
- [ ] Run authenticated automated management flow against candidate services and DB.
- [ ] Verify pagination, delete error rollback, loading/error, reconnect/scope switch and
      approved routing behavior at component/integration level.
- [ ] Confirm lockfile/package/readme/CI commands are identical.

## 9. Runtime and `./twd` matrix

- [ ] Start isolated candidate PostgreSQL/backend/daemon/frontend on recorded ports.
- [ ] Verify branch/commit/CWD/URL/tab identity before interaction.
- [ ] Use `rtk ./smallkhoj-trace` for startup, migration, auth, DB connection, NOTIFY,
      SSE, delete-event and shutdown timelines.
- [ ] Use `rtk ./twd` for authenticated landing, >50-row/cross-channel pagination,
      Task/File deletion success/failure, loading/error/retry, one SSE + targeted task
      refresh, chat state flows, themes and approved `/control` route.
- [ ] Capture replayable DOM/network/marker/screenshots and repeat from a fresh namespace.
- [ ] Shut down and prove bounded resource cleanup/no leaked test services.

## 10. Re-audit and truth sources

- [ ] Fill evidence matrix for plans 001–023/003a/003b and all non-plan findings against
      the single candidate SHA.
- [ ] Assign exact verdict or direction disposition; list residual owner/severity/effect.
- [ ] Correct Chinese report, technical report, handoff, plan README, DESIGN, migration,
      deployment, auth/testing docs and relevant Trellis specs.
- [ ] State “candidate verified”, not merged/released, until those events actually occur.
- [ ] Validate every evidence/doc link and remove no historical evidence silently.

## 11. Quality gate and review

- [ ] Run `rtk proxy git diff --check`, generated/schema/task/spec checks and clean scoped
      status review.
- [ ] Re-run canonical backend/frontend gates after final docs/conflict edits.
- [ ] Run Trellis quality gate and resolve every finding with evidence.
- [ ] Request peer review with PRD/design/diff/tests/runtime evidence; resolve feedback.
- [ ] Confirm commit set contains no unrelated WIP, secrets, runtime DB/log artifacts.

## 12. PR and release handoff

- [ ] With explicit authorization, push feature branch and create reviewable PR.
- [ ] Require CI/reviewer approval; use project squash-merge workflow only after green.
- [ ] After merge, record main merge SHA and update only permitted post-merge truth.
- [ ] Provide deployment preflight/rollout/postcheck/rollback handoff and do not claim
      deployed health unless deployment was separately authorized and observed.

## STOP conditions

- Stop on dirty-base/user-WIP overlap, wrong worktree/DB/URL or missing authorization.
- Stop on migration ambiguity, secret exposure, P0/P1 RED, flaky required test, semantic
  conflict or unreviewed product decision.
- Stop if any layer's evidence is being substituted by an inappropriate lower/higher
  layer (for example unit test for FK, screenshot for finalizer, old branch for candidate).
- Stop before PR/merge/deploy actions beyond the authority explicitly granted.
