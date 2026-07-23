# Independent audit verification design

## Authority and boundaries

The current repository state is authoritative. The existing reports, plan status rows, executor notes, and reviewer approvals are hypotheses to verify. Review work runs against:

1. base `47848e8` / current `main` for original-finding truth;
2. each `advisor/*` branch for plan-to-implementation correctness;
3. a disposable integration worktree for merge interactions and full gates.

The user's dirty main worktree is read-only for this review. No merge, commit, push, deployment, or database mutation is part of the audit.

## Evidence model

Each plan receives one evidence record:

```text
finding evidence
  -> plan contract and dependencies
  -> actual commits and diff
  -> focused tests / static checks / runtime probe
  -> integration interaction
  -> verdict and residual risk
```

Passing tests are supporting evidence only after the assertions and exercised code paths are inspected. Documentation claims never substitute for current code or command output.

## Verification layers

### Layer A: provenance and drift

- Confirm every recorded commit exists and determine whether it is reachable from current `main`.
- Compare plan scope to actual changed files and commits.
- Detect stale report paths, contradictory status claims, uncommitted branch changes, and missing artifacts.

### Layer B: per-plan correctness

- Reconstruct the original defect from base code.
- Inspect the fix at the relevant branch head.
- Read added/changed tests for contract strength and gaming resistance.
- Run the smallest relevant gate, then the branch-level gate when justified.

### Layer C: high-risk adversarial review

- Authorization and tenant isolation: 002, 012, 013, 014.
- Database schema and concurrency: 003b, 004, 016, 017.
- Resource limits and query behavior: 005, 015, 018.
- Delivery/build correctness: 019–023 and direction implementations 006/009.

### Layer D: integration

Create or reuse a disposable integration worktree based on `47848e8`, reproduce merges in dependency order, resolve only documented mechanical conflicts, and run full backend/frontend gates. Any non-mechanical conflict changes the verdict to `REVISE` until separately designed.

## Necessary-test policy

Write a test only when an acceptance-critical behavior cannot be proven by existing coverage or safe read-only probes. A new test must:

- target one named contract;
- demonstrate the pre-fix failure or missing coverage against the relevant base/incomplete state;
- pass against the reviewed fix;
- avoid changing production code;
- live in an isolated audit worktree until the user separately authorizes integration.

## Verdict semantics

- `APPROVE`: independently proven correct in scope and integration-safe.
- `APPROVE WITH DEPENDENCY`: correct only when named prerequisite/order is enforced.
- `REVISE`: finding is real, but implementation or evidence is incomplete/incorrect.
- `REJECT`: plan premise or implementation is materially wrong or unsafe.
- `NOT IMPLEMENTED`: plan exists but no accepted implementation is present.
- `SUPERSEDED`: another verified change makes the plan obsolete; evidence names it.

## Rollback and operational safety

Audit-created integration worktrees and test-only branches are disposable. No command may migrate the user's live development database or terminate processes/connections. Database verification uses scratch databases/containers or existing non-mutating evidence; if unavailable, the verdict remains conditional rather than mutating shared state.
