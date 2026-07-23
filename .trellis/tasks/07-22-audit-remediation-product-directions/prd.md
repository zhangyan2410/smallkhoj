# Resolve audit product-direction items

## Purpose

Plans 006–011 mix one real correctness defect (009), one documentation truth defect
(006), and four product/roadmap choices (007, 008, 010, 011). This child prevents the
audit from mislabeling an unchosen feature as a broken fix. It records an explicit,
reviewable disposition for every item and delegates implementation to the correct
existing or new Trellis task.

This child does not modify the user's unrelated/untracked `session-observer/`, Remotion
task or capability-matrix work. Any such mutation requires explicit scope approval and
the owning task/worktree.

## Disposition vocabulary

- `ACCEPT_AND_IMPLEMENT`: approved direction with an owning implementation task.
- `ACCEPT_DOC_TRUTH`: shipped behavior is accepted; authoritative docs are reconciled.
- `DEFER_LINKED`: valuable direction deferred to a named task and not a release defect.
- `REJECT`: direction intentionally declined with rationale.
- `SUPERSEDED`: another terminal contract/task fully owns the item.
- `BLOCKED_DECISION`: smallest remaining maintainer choice is unresolved.

`DONE` is forbidden for an implementation without direct evidence.

## Requirements by plan

### P006 — Design-system truth

1. Compare actual `globals.css`, layout/theme switcher, ink-wash Trellis decision,
   `DESIGN.md`, PRODUCT and the frontend optimization handoff.
2. Obtain maintainer approval that the shipped water/dark/shuimo tri-theme system is
   the product direction. Recommended disposition: `ACCEPT_DOC_TRUTH`.
3. If approved, rewrite DESIGN from actual tokens and archive the stale handoff with a
   first-screen `SUPERSEDED` notice; correct overstatements such as “core surfaces are
   identical” where individual theme tokens differ.
4. Source styling is unchanged unless the evidence reveals a separate real defect.

### P007 — Session observer integration

1. Link `.trellis/tasks/07-16-session-observability-console/` and verify its standalone
   acceptance evidence/status before treating the observer as an integration target.
2. Preserve the hard standalone boundary: observer essential operation cannot depend
   on SmallKhoj backend/auth/database.
3. Recommended disposition for this remediation release: `DEFER_LINKED`. Finish/review
   the standalone observer first; create a separate integration PRD only if product
   navigation value is approved.
4. Do not add a hard-coded loopback iframe or unauthenticated reverse proxy as a quick
   audit checkbox. Discovery, absence, sandbox/CSP, auth and fail-open behavior need a
   reviewed contract.

### P008 — Durable Work Item / dispatch queue

1. Link `.trellis/tasks/07-13-agent-runtime-capability-matrix/` and its evidence-backed
   reliable-wakeup boundary.
2. Classify Work Item/DispatchAttempt as a new high-risk product capability, not a
   regression in current code. Recommended disposition: `DEFER_LINKED` to a separate
   feature/design task after the capability-matrix review gate.
3. If accepted later, schema, API, scheduler, retry/idempotency,
   `delivery_uncertain`, provider capability and operational UI must be designed
   together; this audit remediation must not partially implement them.

### P009 — Task/File deletion

1. Disposition is `SUPERSEDED` by schema-integrity (real PostgreSQL delete/tombstone /
   dedicated events) and delivery/UI (authorized visible controls/evidence).
2. This child tracks links and final evidence only; it does not duplicate source edits.
3. The advisor fake-session implementation is explicitly rejected as completion proof.

### P010 — Control/product route boundary

1. Record whether `/daemon` is an operator/control surface or top-level product surface.
2. Recommended disposition: `ACCEPT_AND_IMPLEMENT` Option A—move it to
   `/control/daemon`, keep a temporary non-permanent compatibility redirect, create a
   control navigation boundary and remove accidental product-nav coupling without
   making the surface undiscoverable.
3. Before implementation, inventory internal/external/deep links and auth expectations.
4. If maintainer instead chooses `/daemon` as product, update PRODUCT/routing contracts
   and explain where future observer/diagnostic control surfaces belong.

### P011 — Remotion directory/task

1. Treat the existing Remotion PRD and directory as user-owned WIP; do not delete,
   archive or populate either speculatively.
2. Determine whether a real scaffold exists in another worktree/commit and whether the
   promotional-video direction remains funded.
3. Recommended disposition: `DEFER_LINKED` plus explicit “no scaffold committed” status
   in the owning task; remove only meaningless untracked `.DS_Store`/empty directory
   after explicit approval. If a real scaffold exists, it proceeds in its own feature
   worktree and quality gate.

## Decision record requirements

For each item record:

| Field | Meaning |
|---|---|
| evidence | current source/task/runtime facts |
| classification | defect, doc drift, debt or new capability |
| options | smallest mutually exclusive product choices |
| recommendation | reason, value, risk and rollback cost |
| decision/owner/date | explicit human decision and owning Trellis task |
| release effect | blocker, dependency, or excluded/deferred |
| completion proof | exact docs/tests/runtime evidence if implemented |

## Acceptance criteria

- [ ] Plans 006–011 each have one explicit disposition with evidence, owner and release
      effect; no `TODO`/`DONE` ambiguity remains.
- [ ] Maintainer explicitly approves or rejects the tri-theme doc truth and `/daemon`
      route boundary before their implementation.
- [ ] P006 authoritative docs match shipped values and clearly archive stale direction
      if `ACCEPT_DOC_TRUTH` is approved.
- [ ] P007/P008/P011 link existing tasks and remain outside remediation completion when
      deferred; their untracked/user-owned files are untouched without approval.
- [ ] P009 closes only when real PostgreSQL route tests and `./twd` Task/File flows from
      owning children are green.
- [ ] P010 has redirect/deep-link/nav/docs/UI evidence if implemented, or PRODUCT truth
      is explicitly updated if rejected.
- [ ] Audit report and plan index use the disposition vocabulary and do not call deferred
      product capabilities defects or completed fixes.

## Stop conditions

- Stop before editing DESIGN, route structure, session observer, capability runtime or
  Remotion artifacts without the required decision and owning task.
- Stop if a linked task's current worktree/ownership is unclear; preserve it as WIP.
- Stop if an option expands into L-sized feature work; split/activate the linked task.
- Do not let a deferred product direction prevent closing independently verified real
  defects; record it honestly as excluded/deferred.
