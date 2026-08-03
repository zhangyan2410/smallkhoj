# Implementation plan: safe SmallKhoj cleanup skill

## Preconditions

- [x] Obtain user review of `prd.md`, `design.md`, and this plan before `task.py start`.
- [x] Load `trellis-before-dev` and `tdd` before writing implementation code.
- [x] Honor the user’s explicit no-branch decision: implement inline in the current worktree without creating or switching branches.
- [x] Capture the current dirty-file inventory before implementation and treat every path outside `.agents/skills/smallkhoj-cleanup/` and `.trellis/tasks/08-03-smallkhoj-cleanup-skill/` as read-only.
- [x] Do not stage, commit, revert, format, or clean unrelated user files.

## Phase 0 — one-time reference cleanup

- [x] Refresh disk availability, `.dev-logs` sizes, Turbopack cache inventory, worktree dirty state, process cwd ownership, Docker report, and local-dev status.
- [x] Identify the current exact proposed target set: one ignored/unopened 10.3 GB stale log plus seven clean, inactive, unopened historical-worktree Turbopack caches totaling about 2.56 GiB.
- [x] Obtain user approval for the exact immutable generated-artifact target list; keep the active main cache, dirty-worktree caches, Docker resources, worktrees, processes, databases, and dependencies untouched during this deletion step.
- [x] Immediately revalidate every approved target’s stat/type, worktree state, process ownership, and open-file state.
- [x] Delete only the approved exact paths.
- [x] Verify each target is absent, compare filesystem availability before/after, confirm `:3000`/`:8000` remain healthy, and compare unrelated Git status with the baseline.
- [x] Separately inventory all registered worktrees/local branches after artifact reconciliation, including cleanliness, process-cwd ownership, local/upstream divergence, tip SHA, and strong merge evidence against `main`.
- [x] Retire only exact clean/inactive local worktrees and branches proven merged by ancestry, matching merged-PR head SHA, or equivalent content proof; retain and report every ambiguous/local-only candidate and leave all remotes unchanged.
- [x] Record actual reclaimed state and update the policy/test plan with rehearsal lessons before Phase A.

## Phase A — initialize the project-local skill

- [x] Confirm `.agents/skills/smallkhoj-cleanup/` does not already exist in the implementation worktree.
- [x] Run the required `skill-creator` initializer rather than hand-building the skeleton:

  ```bash
  rtk python3 /Users/lee/.codex/skills/.system/skill-creator/scripts/init_skill.py \
    smallkhoj-cleanup \
    --path .agents/skills \
    --resources scripts,references \
    --interface 'display_name=SmallKhoj Cleanup' \
    --interface 'short_description=Audit and safely clean SmallKhoj dev artifacts' \
    --interface 'default_prompt=Use $smallkhoj-cleanup to audit this project and prepare a safe cleanup plan.'
  ```

- [x] Remove every initializer placeholder that is not part of the approved structure.
- [x] Verify `agents/openai.yaml` contains only the approved interface fields and matches the final `SKILL.md`.

## Phase B — build the safety boundary with TDD

- [x] Add failing temporary-fixture tests for repository identity and registered-worktree scope.
- [x] Add failing tests for regular-file checks, symlink/path escape rejection, log thresholds, and exact Turbopack suffix matching.
- [x] Add failing tests for active/open ownership blocking and missing-tool fail-closed behavior.
- [x] Add failing tests proving Docker, worktrees, processes, dependencies, databases, active caches, and dirty-worktree caches are report-only while exact unopened log candidates remain independently classifiable.
- [x] Add failing tests for canonical plan ID generation, tampering, confirmation mismatch, stat drift, ownership drift, duplicate candidates, and all-before-any preflight.
- [x] Add failing tests for JSON schema, human summary, zero-mutation audit, accurate apply totals, process-command redaction, and macOS memory-counter filtering.
- [x] Implement only enough Python standard-library code in `scripts/cleanup.py` to make each group green before moving to the next.
- [x] Refactor collectors, policy/classification, plan integrity, apply preflight, deletion, and rendering into testable functions after the tests pass.

## Phase C — write skill instructions and policy reference

- [x] Replace generated `SKILL.md` with concise imperative instructions covering:
  - trigger/use cases;
  - mandatory audit-first workflow;
  - explicit current-turn approval before apply;
  - live commands using `rtk`;
  - report format and blocker behavior;
  - prohibition on expanding the allow-list ad hoc.
- [x] Write `references/cleanup-policy.md` with the complete allow-list, report-only categories, thresholds, reason codes, and interpretation guidance.
- [x] Keep policy details in the reference rather than duplicating them in `SKILL.md`.
- [x] Confirm the initializer-generated `agents/openai.yaml` still matches the final interface meaning; regeneration was unnecessary.

## Phase D — deterministic verification

- [x] Run the complete temporary-fixture test suite on Python 3.13 and the project Python 3.11:

  ```bash
  rtk env PYTHONDONTWRITEBYTECODE=1 python3 \
    .agents/skills/smallkhoj-cleanup/scripts/test_cleanup.py
  rtk env PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python \
    .agents/skills/smallkhoj-cleanup/scripts/test_cleanup.py
  ```

- [x] Run the official skill validator (the system Python lacks PyYAML, so use the existing project environment without installing anything):

  ```bash
  rtk backend/.venv/bin/python \
    /Users/lee/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
    .agents/skills/smallkhoj-cleanup
  ```

- [x] Check syntax/help without mutation:

  ```bash
  rtk python3 .agents/skills/smallkhoj-cleanup/scripts/cleanup.py --help
  rtk python3 .agents/skills/smallkhoj-cleanup/scripts/cleanup.py audit --help
  rtk python3 .agents/skills/smallkhoj-cleanup/scripts/cleanup.py apply --help
  ```

- [x] Run a real repository audit only, saving the plan outside the repository:

  ```bash
  rtk python3 .agents/skills/smallkhoj-cleanup/scripts/cleanup.py audit \
    --repo . \
    --plan-out /tmp/smallkhoj-cleanup-plan.json \
    --json
  ```

- [x] Verify the live audit performs zero cleanup mutations, protects the active Next worktree/cache, redacts commands/credentials, and treats the rehearsed large log as absent while classifying remaining logs from current evidence.
- [x] Do not run live `apply`; exercise apply only through temporary fixtures.

## Phase E — project quality gate

- [x] Load and run `trellis-check` for spec compliance, script quality, tests, generated metadata consistency, and unrelated-change protection.
- [x] Inspect the owned paths and confirm no implementation edit was made outside `.agents/skills/smallkhoj-cleanup/` and this task directory.
- [x] Compare the final dirty-file inventory with the captured baseline and account for every newly changed path.
- [x] Run the PRD convergence pass and preserve every requirement/acceptance mapping.
- [x] Record validation commands and results below as the task-local Trellis validation record.
- [x] Keep completed-skill live apply and any recurring automation outside this run; either requires a separate current authorization.

## Execution and validation record — 2026-08-03

### One-time cleanup

- Deleted exactly one approved unopened stale log and seven approved inactive Turbopack cache roots: 13,050,252,202 logical bytes.
- Filesystem availability increased from 21,727,272 KiB to 34,543,896 KiB during artifact cleanup (about 12.22 GiB); all eight paths were absent and `:3000`/`:8000` remained HTTP 200.
- Audited all local branches/worktrees after refreshing `origin/main`. Removed six clean, inactive worktrees and twenty local branches using non-forced Git deletion; remote-tracking refs remained byte-identical.
- Worktrees decreased 41 → 35 and local branches 57 → 37. The Git pass increased filesystem availability by about 3.36 GiB; total session increase was about 15.59 GiB.
- Retained every dirty, active, detached, ambiguous, unmerged, and local-main-only candidate. Local `main` remains 11 commits ahead of `origin/main`; nothing was pushed.

### Skill verification

- TDD RED observed for missing implementation, then for duplicate-plan paths and macOS cumulative `vm_stat` counters; both safety/reporting defects were fixed with regression tests.
- `rtk env PYTHONDONTWRITEBYTECODE=1 python3 .../test_cleanup.py` → 24/24 pass on Python 3.13.
- `rtk env PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python .../test_cleanup.py` → 24/24 pass on Python 3.11.
- Ruff check and format check → pass.
- Official `skill-creator` `quick_validate.py` through the existing backend environment → `Skill is valid!` (system Python lacks PyYAML; no dependency was installed).
- CLI global/audit/apply help → exit 0.
- Final live-project audit → exit 0 in about 16 seconds, no limitations, 14 remaining old-log candidates totaling 4,777,914 bytes, zero apply, and byte-identical full Git status before/after.
- Live output contained no full command/environment fields or tested credential markers. Current active Next state remained protected.
- Integration Gate compatibility suite → 39/39 pass; `run.mjs --help` → exit 0.
- Frontend `/` and backend `/docs` remained HTTP 200 after the destructive rehearsal and Git cleanup.
- No live plan was applied during skill validation; temporary plan and Python bytecode artifacts were removed afterward.

### Quality-gate scope

- No frontend/backend/daemon/runtime/database/deployment behavior changed, so no UI design, `.pen`, browser, live Gate, API/DB, trace, or cloud deployment claim applies.
- Dogfood was mandatory because this is a user-invoked skill; the real audit found and corrected the `vm_stat` reporting bug before delivery.
- The skill is project-specific evidence/safety tooling, passes the skill value gate, keeps `SKILL.md` at 59 lines, and moves detailed policy to one directly linked reference.

## Rollback points

- Before task activation: remove only the newly created planning task if the user cancels; do not touch unrelated task directories.
- During skill initialization: delete only the new `.agents/skills/smallkhoj-cleanup/` directory if initialization must be retried.
- During implementation: change or remove only files newly owned by this task; never use broad Git restore/reset/clean operations in the shared dirty worktree.
- During verification: temporary fixtures and `/tmp/smallkhoj-cleanup-plan.json` may be removed; no live generated artifacts are cleanup targets during implementation.
- After a failed live dry-run: preserve the report, fix discovery/classification, and repeat audit. Never “test” by applying to the real project.
