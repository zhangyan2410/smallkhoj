---
name: trellis-check
description: "Scope-aware SmallKhoj verification. Local fast path runs one focused regression target once; comprehensive lint/typecheck/tests/cross-layer checks are reserved for explicit integration/release or high-risk changes."
---

# Scope-Aware Code Quality Check

Verify recently written code in proportion to risk without duplicating gates.

## Step 0: Select One Mode

### Local fast path (default)

Use when the change is contained and does not touch database migrations/destructive data, auth/security, deployment/release, a public contract, or broad cross-layer architecture.

- No task artifact, worktree, branch, PR, remote review, GitHub CI, E2E, or full-suite requirement.
- Select the single smallest command that exercises the changed behavior.
- A bug-fix RED/GREEN cycle may run the same focused target before and after the edit.
- After GREEN, do not run broader or duplicate checks unless the relevant code changes again.

### Full lane

Use only when the user explicitly requests integration/release/PR/CI validation or a high-risk boundary above applies. Full lane follows every applicable step below.

---

## Step 1: Identify What Changed

```bash
git diff --name-only HEAD
git status
```

## Step 2: Read Task Artifacts and Applicable Specs

Local fast path: read only the directly applicable spec/guideline; no task is required.

Full lane: read the current task artifacts in order:

- `prd.md`
- `design.md` if present
- `implement.md` if present

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

For each changed package/layer, read the spec index and follow its **Quality Check** section:

```bash
cat .trellis/spec/<package>/<layer>/index.md
```

Read the specific guideline files referenced — the index is a pointer, not the goal.

## Step 3: Run Project Checks

Local fast path: run one focused test, type-check, lint target, or contract command chosen for the changed behavior. Do not automatically combine all four categories.

Full lane: run the applicable project lint, type-check, and test commands. E2E and GitHub CI remain explicit integration/release gates rather than automatic additions.

## Step 4: Review Against Checklist

### Code Quality

- [ ] Linter passes?
- [ ] Type checker passes (if applicable)?
- [ ] Tests pass?
- [ ] No debug logging left in?
- [ ] No suppressed warnings or type-safety bypasses?

### Test Coverage

- [ ] New function → unit test added?
- [ ] Bug fix → regression test added?
- [ ] Changed behavior → existing tests updated?

### Spec Sync

- [ ] Does `.trellis/spec/` need updates? (new patterns, conventions, lessons learned)

> "If I fixed a bug or discovered something non-obvious, should I document it so future me won't hit the same issue?" → If YES, update the relevant spec doc.

## Step 5: Cross-Layer Dimensions (if applicable)

Skip this step for the local fast path or any change confined to a single layer.

### A. Data Flow (changes touch 3+ layers)

- [ ] Read flow traces correctly: Storage → Service → API → UI
- [ ] Write flow traces correctly: UI → API → Service → Storage
- [ ] Types/schemas correctly passed between layers?
- [ ] Errors properly propagated to caller?

### B. Code Reuse (modifying constants, creating utilities)

- [ ] Searched for existing similar code before creating new?
  ```bash
  grep -r "pattern" src/
  ```
- [ ] If 2+ places define same value → extracted to shared constant?
- [ ] After batch modification, all occurrences updated?

### C. Import/Dependency (creating new files)

- [ ] Correct import paths (relative vs absolute)?
- [ ] No circular dependencies?

### D. Same-Layer Consistency

- [ ] Other places using the same concept are consistent?

---

## Step 6: Report and Fix

Report violations found and fix them directly. Re-run only the failed/relevant focused target after a fix. Do not rerun already-green checks when relevant code has not changed. Run the comprehensive set only in full-lane work.
