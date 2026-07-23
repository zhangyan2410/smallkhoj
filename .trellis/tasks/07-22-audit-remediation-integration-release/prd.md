# Integrate and verify audit remediation release

## Purpose

This child owns the only release-level claim. It integrates completed remediation
children in dependency order, resolves semantic conflicts, runs one full candidate
against isolated real infrastructure, re-audits every original finding and synchronizes
all truth sources. A union of per-branch passing tests is never release evidence.

## Inputs

- independent verification with 25 plan verdicts and non-plan findings;
- schema-integrity child;
- auth-tenancy child;
- runtime-querying child;
- delivery-ui child;
- architecture-debt child;
- product-directions decisions/evidence;
- advisor branches only as untrusted patch/reference sources.

## Requirements

### I1 — Clean reproducible integration base

1. `main` is synchronized with `origin/main`; audit artifacts are committed separately;
   no unrelated dirty/untracked user WIP is staged or moved.
2. Candidate work happens only in the approved sibling worktree on a `feat/*` branch.
3. Branch, base SHA, child commit sequence, tool/runtime versions and isolated ports /
   database are recorded.
4. Generated/lock/schema artifacts are reproducible from committed inputs.

### I2 — Dependency and conflict discipline

1. Integrate in terminal-contract order: schema → auth → runtime/querying → delivery/UI
   → architecture → approved product-direction code/docs.
2. Database migrations land before code depends on them; compatibility windows are
   tested with old/new writer order where applicable.
3. Conflicts are classified mechanical versus semantic. Semantic conflicts return to
   the owning contract/tests; they are never resolved by selecting the side with more
   existing passing tests.
4. Known conflict zones include plan-005/018 list/thread logic, SSE/runtime/realtime UI,
   public/agent router extractions, auth env/e2e config and audit/design docs.
5. Every conflict resolution has a focused regression and a short decision note.

### I3 — Database release matrix

1. Real isolated PostgreSQL validates:
   - fresh empty database upgrade to head;
   - existing baseline-version database upgrade to head;
   - legacy pre-Alembic schema preflight, baseline-only stamp and upgrade;
   - historical/explicit message sequence values and automatic next value;
   - transition-window old explicit writer plus new implicit writer;
   - template legacy classification/scoped uniqueness;
   - concurrent first-owner registration in independent transactions;
   - Task deletion tombstone/activity/event commit;
   - File deletion/cleanup semantics.
2. Startup cannot mutate schema implicitly or hide a missing migration.
3. Migration failures stop deployment before application rollout; no `stamp head` escape
   hatch is documented.
4. Irreversible steps, preflight queries, expected duration/locks, backup and rollback /
   forward-fix actions are documented.

### I4 — Security and cross-layer contract matrix

1. Public credential/env/transport is consistent across backend, frontend, compose,
   CI, proxy and docs; production known/missing defaults fail closed and URLs contain no
   reusable credential.
2. Permission default-deny, actor alias/impersonation, bootstrap-owner concurrency and
   tenant-template scope receive adversarial direct and route tests.
3. Authenticated automated flows and `./twd` UI use the same account/server model and
   prove foreign/missing scope denial without information disclosure.
4. Logs/evidence contain no secrets or session tokens.

### I5 — Runtime and resource matrix

1. Query budgets and response snapshots pass on integrated public/agent routes.
2. Upload rejection/cleanup spans proxy/parser/application/database/filesystem layers.
3. NOTIFY reconnect/shutdown and per-worker connection budgets are observed under the
   actual candidate configuration.
4. Both SSE surfaces release DB resources before open-stream completion; one frontend
   transport owner remains under reconnect/scope switch.
5. Pagination traverses all eligible data exactly once and every UI consumer exposes or
   consumes further pages.

### I6 — Canonical quality gates

1. `git diff --check`, task/spec/generated/schema validation and clean status selection.
2. Backend migration checks, complete pytest and configured Ruff.
3. Frontend frozen Bun install, complete tests, lint, typecheck and production build
   under documented non-secret CI environment.
4. Authenticated automated management flow against isolated candidate services.
5. Runtime health/trace checks and full required `./twd` evidence.
6. Repeat any concurrency/lifecycle-sensitive test enough times to expose flakiness and
   record repetition count; flaky is failure, not pass-with-note.

### I7 — Original-finding re-audit

1. Re-evaluate every plan 001–023/003a/003b and each non-plan finding against the
   integrated candidate, not old advisor heads.
2. Use the independent verdict vocabulary. A direction item receives an explicit
   disposition, not a fake implementation verdict.
3. Each fixed defect links finding → RED → change → GREEN → full gate → runtime/UI proof
   where applicable.
4. Any residual dependency/risk has owner, severity, release effect and follow-up task.

### I8 — Truth-source synchronization

1. Correct the Chinese report, agent technical report, handoff, plan index, DESIGN,
   migration/deployment/auth/testing docs and relevant Trellis specs to candidate truth.
2. Distinguish current `main`, candidate branch and merged/released state until squash
   merge actually completes.
3. Document exact rollout/rollback and post-deploy health checks.
4. No “all approved/fixed” statement appears before all mandatory evidence is green and
   product decisions are explicitly disposed.

### I9 — Reviewable delivery

1. Commits are coherent and exclude unrelated WIP, secrets, runtime databases/log noise.
2. Trellis quality gate and cross-family/peer review findings are resolved with evidence.
3. Final PR uses normal project workflow, required checks and squash merge only after
   approval. Push/PR/merge remain explicit external actions.

## Acceptance criteria

- [ ] Candidate base/worktree/branch is reproducible and contains no unrelated WIP.
- [ ] Every child acceptance criterion is complete or explicitly excluded by an approved
      product disposition; no confirmed code defect remains deferred without owner.
- [ ] Full real PostgreSQL matrix passes, including historical sequence, legacy adoption,
      owner race, tenant templates and delete transaction semantics.
- [ ] Security matrix passes with no credential in URLs/source/log evidence.
- [ ] Query/resource/NOTIFY/SSE/pagination/realtime integrated contracts pass under the
      actual candidate worker/pool configuration.
- [ ] Backend and frontend CI-equivalent gates pass from clean dependencies/config.
- [ ] `./twd` proves authenticated visible deletion, pagination, loading/error,
      realtime targeting, chat and approved route/theme changes on worktree URLs.
- [ ] All original findings have candidate-grounded verdict/disposition and evidence.
- [ ] Reports/docs/specs accurately describe candidate versus merged release state.
- [ ] Quality gate and reviewer approve a scoped PR-ready diff.

## Stop conditions

- Stop if main/worktree synchronization, isolated DB/ports, or user-WIP separation is
  unproven.
- Stop on any failed/flaky mandatory gate, unresolved P0/P1 defect, migration ambiguity,
  secret exposure or semantic conflict.
- Stop before push/PR/merge without explicit authorization for that external action.
- Stop if a report would need to overstate evidence to call the release complete.
