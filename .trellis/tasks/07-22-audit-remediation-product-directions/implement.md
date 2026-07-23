# Product-direction disposition implementation plan

## 0. Evidence freeze

- [ ] Re-read current source and linked task status in the remediation worktree; do not
      infer state from advisor branches or untracked directory names.
- [ ] Create `decisions.md` with the required fields and proposed matrix.
- [ ] Mark all linked user-owned WIP paths read-only for this child unless explicitly
      approved.

## 1. P006 decision and docs

- [ ] Generate a shipped-theme evidence table from `globals.css`, layout, switcher,
      PRODUCT and ink-wash task.
- [ ] Present the exact proposed DESIGN/handoff change and obtain maintainer approval.
- [ ] If approved, rewrite DESIGN to tri-theme truth and archive the handoff with an
      unmistakable `SUPERSEDED` first paragraph; do not change CSS/theme source.
- [ ] Check every token/claim against live source and run Markdown/link/diff validation.
- [ ] If rejected, record the requested product direction and open a separate source +
      design migration task; do not silently rewrite source in this child.

## 2. P007 observer disposition

- [ ] Review the standalone observer task's actual acceptance/evidence status without
      editing its untracked implementation.
- [ ] Record `DEFER_LINKED` unless maintainer explicitly approves a separate integration
      task after standalone acceptance.
- [ ] If accepted, create/link a new Trellis PRD for discovery/auth/CSP/fail-open/UI;
      do not prototype it inside audit remediation.

## 3. P008 Work Item disposition

- [ ] Link capability matrix/core conclusion and confirm its review gate/current status.
- [ ] Record `DEFER_LINKED` as new product capability unless maintainer approves a
      separate feature program.
- [ ] If accepted, create only the follow-on Trellis task skeleton/requirements linkage;
      implementation remains outside this child.

## 4. P009 evidence linkage

- [ ] Link schema child's real PostgreSQL Task delete/tombstone/event proof.
- [ ] Link delivery child's Task/File component, API and `./twd` proof.
- [ ] Mark `SUPERSEDED` only after both owning acceptance sets are complete.

## 5. P010 route decision and implementation

- [ ] Present Option A (recommended `/control/daemon` + temporary redirect) versus
      Option B (retain product `/daemon` + update PRODUCT) with deep-link inventory.
- [ ] Record maintainer decision before source edits.
- [ ] For A, write redirect/nav/deep-link/component tests RED, move the route, add control
      navigation and routing docs, then GREEN all direct/internal links.
- [ ] For B, update PRODUCT/routing docs and test the intentional product-nav placement.
- [ ] Run all themes/accessibility/deep-link/redirect scenarios with delivery's `./twd`
      worktree runtime and retain a rollback path.

## 6. P011 Remotion disposition

- [ ] Inspect git/worktree references read-only for an actual scaffold and missing assets.
- [ ] Ask maintainer to choose abandon, defer, or resume in its own feature worktree.
- [ ] Recommended: record `DEFER_LINKED` and “no committed scaffold” in decisions.
- [ ] Do not delete `.DS_Store`, directory, task or assets until separately authorized;
      if authorized, mutate only the explicitly named owning WIP path.

## 7. Truth synchronization

- [ ] Update audit report, technical report and plan index with exact classification,
      disposition, owner and evidence—not blanket `DONE`.
- [ ] Ensure deferred features do not appear as release blockers or fixed defects.
- [ ] Validate links, Trellis artifacts and `git diff --check`; confirm no unrelated WIP
      appears in diff/status selection.
- [ ] Hand P010 code evidence and P006 doc evidence to integration release.

## STOP conditions

- Stop at every missing maintainer decision; preserve the proposed disposition.
- Stop before touching observer/Remotion/capability WIP owned by other tasks.
- Stop if P010 reveals an external consumer that cannot follow a temporary redirect.
- Stop if P006 source itself is invalid; open a separate frontend defect instead of
  rewriting documentation to normalize broken behavior.
- Stop if a deferred direction is being implemented merely to make the audit table green.
