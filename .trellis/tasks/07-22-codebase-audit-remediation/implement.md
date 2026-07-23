# Codebase audit remediation implementation plan

## 0. Start gate

- [ ] Obtain explicit approval to push local `47848e8` and corrected audit artifacts.
- [ ] Correct the two user-facing audit documents to match the independent verdict.
- [ ] Commit/push only audit-related docs/task; preserve unrelated dirty files.
- [ ] Verify `docs/` clean and `main...origin/main` ahead=0/behind=0.
- [ ] Create sibling worktree `../smallkhoj-audit-remediation` on `feat/2026-07-audit-remediation`.
- [ ] Record worktree path/branch on the remediation task and activate only after artifact review.

## 1. Create and review child tasks

- [x] Create children for schema integrity, auth/tenancy, runtime/querying, delivery/UI, architecture debt, product-direction disposition, and integration release.
- [x] Give each implementation child a PRD, design, ordered TDD plan, diagnostic capsules, exact files, commands and STOP conditions.
- [x] Link existing 007/008/011-related Trellis tasks instead of duplicating their scope.
- [x] Validate all task artifacts before code work.

## 2. Wave 1 — Release blockers

- [ ] Schema child: write real PostgreSQL RED tests for 0001→0002 historical seq and transition-window behavior.
- [ ] Implement sequence alignment and legacy Alembic adoption; remove/contain schema dual-authority behavior.
- [ ] Write real PostgreSQL RED route test for Task DELETE activity/event FK failure.
- [ ] Implement tombstone audit semantics and verify successful committed deletion.
- [ ] Run migration matrix, focused backend tests, full backend tests and diff checks.

## 3. Wave 2 — Security boundaries

- [ ] Write direct public-key configuration/transport and permission RED tests.
- [ ] Align backend/frontend/compose env contracts and remove key-in-URL transport.
- [ ] Write viewer display/handle/UUID self-reference and cross-user impersonation matrix; fix without weakening authorization.
- [ ] Reproduce concurrent first-owner registration with independent transactions; implement DB-enforced invariant.
- [ ] Reproduce builtin/legacy/slug/cross-tenant template failures; implement privileged global and tenant-local contracts.
- [ ] Run adversarial focused suite plus full backend/security gates.

## 4. Wave 3 — Runtime, resources, queries, pagination

- [ ] Characterize serializer shapes and query counts; write failing budgets before batching changes.
- [ ] Define upload ingress/memory/disk budgets and cleanup states; add rejection/cleanup tests.
- [ ] Model NOTIFY listener and SSE lifecycle state machines, then write disconnect/reconnect/finalizer RED tests.
- [ ] Remove request-scoped session ownership from every long-lived stream and establish one realtime connection owner.
- [ ] Define total pagination order/cursor schema; add cross-channel, tie, deletion-between-pages, frontend-nextCursor and filter-before-limit tests.
- [ ] Resolve 005/018 semantic conflicts against the terminal design, not by choosing one branch wholesale.
- [ ] Run backend/frontend focused and full gates with query/connection evidence.

## 5. Wave 4 — Delivery and visible UI

- [ ] Establish Ruff baseline or fix violations so configured CI is green by construction.
- [ ] Add non-sensitive production-build CI env and verify frozen Bun install, tests, lint, typecheck and build.
- [ ] Repair e2e authentication/session/server context/key injection; distinguish e2e setup from repo UI acceptance.
- [ ] Complete Task/File deletion, loading/error and targeted-refresh visible flows.
- [ ] Start a worktree-specific runtime with isolated ports and run `./twd` DOM/network/screenshot/marker verification.
- [ ] Align frontend README, AGENTS testing rules and canonical command documentation.

## 6. Wave 5 — Behavior-preserving architecture debt

- [ ] Add/confirm characterization coverage for public/agent routers and channel client behavior.
- [ ] Define ownership cells and stable module interfaces before moving code.
- [ ] Split giant routers/client by cohesive domain without changing API/schema/JSON contracts.
- [ ] Consolidate duplicated Feishu/nested/outcome/serializer helpers where a shared abstraction has at least two stable consumers.
- [ ] Make frontend chat state a single-owner model with projection consumers.
- [ ] Run API snapshots, backend/frontend suites and real UI regressions after each extraction.

## 7. Product-direction decisions

- [ ] Reconcile 006 with current design truth.
- [ ] Link and assess existing session-observer, runtime capability/Work Item and remotion tasks for 007/008/011.
- [ ] Present the smallest unresolved value decision for 010 and any other direction item, with a recommendation and rollback cost.
- [ ] Implement approved directions in their own child/task or record an explicit rejected/deferred disposition.

## 8. Integration release

- [ ] Merge child branches in declared dependency order into one release candidate.
- [ ] Resolve and document every conflict; send semantic conflicts back to the owning child.
- [ ] Run `git diff --check`, migration matrix, full backend tests/Ruff, frontend frozen install/tests/lint/typecheck/build.
- [ ] Run runtime trace/health checks and all required `./twd` scenarios on the integrated candidate.
- [ ] Re-audit every original verdict and non-plan finding against current evidence.
- [ ] Update Chinese report, technical report, plan index, design/migration docs and Trellis specs.
- [ ] Run Trellis quality gate, commit, request review and use the normal PR/squash merge workflow.

## Stop conditions

- Do not start code while the worktree sync gate is unsatisfied.
- Stop a child if its fix needs an unresolved product/value decision.
- Stop database work if a command could target a shared/live database.
- Stop UI verification if CWD/branch/URL does not identify the remediation worktree instance.
- Do not resolve a semantic merge conflict by preserving whichever side has more passing tests.
- Do not mark the parent complete while any confirmed defect lacks direct completion evidence.
