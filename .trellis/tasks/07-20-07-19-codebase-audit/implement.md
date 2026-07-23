# Independent audit verification plan

## 1. Inventory and provenance

- [ ] Record current `main`, dirty state, worktrees, advisor branch heads, and reachability.
- [ ] Read both Chinese reports, the technical report, plan index, all 001–023 plan files, `DESIGN.md`, and migration workflow artifacts from the branch that actually owns them.
- [ ] Build the initial plan/status/dependency inventory and flag contradictions before trusting any `DONE` claim.

## 2. Reconstruct findings

- [ ] Use CodeGraph before broad source discovery; then open the exact base-commit files/lines cited by each plan.
- [ ] Classify each original finding: true, partially true, evidence insufficient, false positive, or drifted.
- [ ] Record rejected findings and duplicate/overlapping plans explicitly.

## 3. Review each implementation

- [ ] Compare each plan's required steps and scope boundaries with its commit range and diff.
- [ ] Inspect all new/modified tests for meaningful assertions and exercised paths.
- [ ] Run focused verification for each branch and record exact commands/results.
- [ ] Deep-review security and cross-layer plans before lower-risk documentation/tooling plans.

## 4. Integration verification

- [ ] Reproduce the full merge in a disposable worktree from `47848e8`, following declared dependencies.
- [ ] Record every actual merge conflict and its resolution; reject undocumented semantic improvisation.
- [ ] Run backend full tests/lint and frontend test/typecheck/lint/build gates supported by the integrated candidate.
- [ ] Verify migrations on an isolated database if available; never use the shared live database.

## 5. Fill critical evidence gaps

- [ ] For any high-risk contract not proven by existing tests, add the smallest test in the disposable audit branch using Red-Green evidence.
- [ ] Re-run the focused and full affected gates after each test addition.
- [ ] Keep production-code fixes out of this audit; convert confirmed defects to a follow-up Trellis implementation task/plan.

## 6. Documentation and final verdict

- [ ] Compare all status claims and paths across reports, task files, branch contents, `DESIGN.md`, and migration docs.
- [ ] Produce a complete matrix with finding truth, implementation status, evidence, verdict, dependency, and residual risk.
- [ ] List merge blockers, security holes, weak tests, plan drift, false positives, missing fixes, and exact next actions.
- [ ] Run the Trellis quality gate for the audit artifacts before declaring completion.

## Validation commands

Exact commands are selected per branch after inspecting its package scripts. At minimum:

```bash
rtk git status --short --branch
rtk git branch --contains <head>
rtk git diff --stat 47848e8..<head>
rtk git diff --check 47848e8..<head>
```

The integration candidate must run the repository-supported backend and frontend gates introduced/confirmed by plan 019. Browser verification uses `./twd` only if a plan changes visible UI behavior; Playwright is not a repository UI-verification substitute.

## Stop conditions

- Stop a merge step if conflict resolution requires a product or architecture decision.
- Do not run migrations against the shared development database.
- Do not kill processes or database connections.
- Do not modify, stage, commit, or clean the user's current main worktree.
