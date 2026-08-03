# Create safe SmallKhoj cleanup skill

## Goal

Provide a project-local `$smallkhoj-cleanup` skill that can be invoked manually to audit SmallKhoj development resource usage and, only after an explicit reviewed confirmation, remove a narrow allow-list of stale generated artifacts without disturbing active worktrees, runtimes, source code, databases, Docker resources, or other agents.

## Background

- The user wants an on-demand maintenance capability: invoke it occasionally, inspect what is safe to reclaim, and optionally perform the approved cleanup. Automatic OS scheduling is not part of the initial request.
- A read-only audit on 2026-08-03 found a 10.3 GB unopened `.dev-logs/backend-screen.log`, 41 registered worktrees using about 33.6 GiB in total, about 20 GB reported reclaimable by Docker, and a local Next development process using about 1.7 GB RSS.
- `dev.sh:11-12` defines `.dev-pids/` and `.dev-logs/`; `dev.sh:231-232` truncates the canonical `backend.log` and `frontend.log` on startup. Cleanup must not infer that every file under `.dev-logs/` is inactive.
- `.gitignore` marks `.dev-logs/`, `.dev-pids/`, `.next/`, `.venv/`, and `node_modules/` as local generated state, but generated state may still belong to a running process.
- `docs/multi-agent-development-workflow.md` requires worktree ownership and explicit cleanup after merge. Registered worktrees may contain dirty or active user/agent work and are not disposable merely because they are old.
- `.agents/skills/` is the shared project-local skill layer for Codex, Gemini CLI, and ZCode. `.codex/skills/` is ignored in this repository and is not the source of truth.
- The user approved the project path `.agents/skills/smallkhoj-cleanup/`, manual invocation, dry-run by default, and report-only handling for Docker resources, worktrees, and processes.
- The user explicitly chose inline implementation in the current worktree without creating a feature branch because this task adds project maintenance tooling rather than changing frontend, backend, daemon, database, or deployment behavior. Existing unrelated dirty files remain out of scope and must be preserved.
- The user requires one real cleanup rehearsal before skill implementation so the reusable policy is derived from observed audit, ownership checks, deletion behavior, and before/after reconciliation rather than designed only on paper.
- The user also requested a one-time audit and retirement of obsolete local branches/worktrees whose work is already merged into `main`. This is an operator task performed after the generated-artifact rehearsal; it does not expand the eventual skill's automatic deletion allow-list.
- The completed rehearsal removed one stale log plus seven inactive Turbopack caches. Their logical size was 13,050,252,202 bytes; filesystem availability increased by about 12.22 GiB while `:3000` and `:8000` remained healthy.
- The separate Git pass removed six clean/inactive worktrees and twenty local branches whose tips were ancestors of both local and remote `main`. Remote-tracking refs were unchanged. Dirty, active, detached, ambiguous, unmerged, and local-main-only candidates were retained.

## Requirements

### R0. One-time cleanup rehearsal before implementation

- Pause skill implementation until one operator-reviewed cleanup has completed and been reconciled.
- Build the cleanup plan from fresh evidence rather than prior snapshots.
- Present the exact irreversible target list and expected reclaimed bytes for approval before deletion.
- Revalidate path, type, worktree cleanliness, process ownership, and open-file state immediately before deletion.
- Delete only the approved exact paths; do not expand the target set during execution.
- Record disk space, candidate existence, active local-dev health, and unrelated Git status before and after the cleanup.
- Feed any observed gaps or operational friction back into `prd.md`, `design.md`, and the eventual script tests before implementation begins.

### R0b. One-time merged branch/worktree retirement

- After reconciling the approved generated-artifact cleanup, inventory every registered local worktree and its local branch.
- Retire only a worktree that is clean, has no detected process whose cwd is inside it, and whose branch has no local-only or unpushed work.
- Require strong merge proof for `main`: either the branch tip is an ancestor of `main`, or a merged GitHub PR targets `main` and its recorded head SHA matches the local branch tip, or an equally strong content-equivalence check proves the branch patch is already represented in `main`.
- Do not treat age, branch naming, task completion state, or `git branch --merged` alone as sufficient proof in this squash-merge repository.
- Remove only the exact qualified local worktree and local branch. Do not delete remote branches, force-push, prune Docker, clean dirty worktrees, or discard untracked files.
- Record retained candidates and the specific blocker or missing evidence for each one.

### R1. Project-local skill

- Create `.agents/skills/smallkhoj-cleanup/` as a project-owned skill that does not collide with Trellis bundled skills.
- Include a concise `SKILL.md`, generated `agents/openai.yaml`, deterministic scripts, and only directly useful reference material.
- Make the trigger description cover requests such as auditing disk/RAM usage, finding stale SmallKhoj development artifacts, and safely cleaning approved local generated state.

### R2. Invocation model

- Default every invocation to audit-only behavior.
- Treat “periodic” as manual on-demand use in the MVP; do not install cron, launchd, Codex automation, hooks, or background daemons.
- Require a separate apply operation tied to the exact audit plan and an explicit confirmation token before deleting anything.
- The skill instructions must require fresh user authorization before a live apply, even if a prior session authorized a different cleanup.

### R3. Audit coverage

Report, at minimum:

- system memory pressure and swap using available read-only platform tools;
- SmallKhoj-owned development processes using PID, category, worktree/cwd, RSS, CPU, and elapsed time without emitting full command lines or credentials;
- sizes and activity status for `.dev-logs/` and relevant Next/Turbopack caches;
- registered Git worktree path, branch, dirty/clean status, approximate size, and detected active-process ownership;
- Docker `system df` summary when Docker is available;
- a classification of each finding as eligible, blocked, report-only, or normal active state.

Missing optional tools (`lsof`, Docker, memory-pressure utilities) must degrade to a reported limitation, never to a permissive deletion decision.

### R4. Plan/apply safety contract

- Generate a machine-readable plan containing a canonical plan ID, repository identity, creation time, candidate fingerprints, reasons, expected bytes, and blocked/report-only findings.
- Apply only a supplied plan whose confirmation token matches its plan ID.
- Before the first mutation, revalidate every planned candidate: repository boundary, real path, file type, symlink status, stat fingerprint, age/size policy, open-file ownership, and active-worktree ownership.
- If any planned candidate has drifted or cannot be revalidated, fail closed before deleting any candidate.
- Use Python filesystem APIs rather than constructing shell `rm` commands from paths.
- Emit an apply result with deleted, skipped, failed, and reclaimed-byte totals. Never claim bytes were reclaimed for a failed deletion.

### R5. Automatic cleanup allow-list

The MVP may plan and apply only these categories:

1. **Inactive development logs**: regular, non-symlink `*.log` files under a registered SmallKhoj worktree’s `.dev-logs/`, with no process holding the file open, that are either:
   - at least 512 MiB and unchanged for at least 24 hours; or
   - unchanged for at least 14 days.
2. **Inactive Turbopack cache**: `frontend/.next/dev/cache/turbopack` under a registered SmallKhoj worktree, unchanged for at least 24 hours, only when no frontend/Next process is owned by that worktree.

An unavailable ownership/open-file check makes the candidate blocked, not eligible. Deletion must never follow symlinks.

### R6. Permanently report-only categories in the MVP

Audit but never automatically mutate:

- Git worktrees, branches, untracked files, source files, `.git/`, `.trellis/`, and task evidence;
- Docker images, containers, volumes, networks, and build cache;
- running or orphan-looking processes, Screen/tmux sessions, WebDriver instances, ports, or PID files;
- `node_modules/`, `.venv/`, package-manager caches, databases, backups, `.env*`, credentials, `.slock*`, agent workspaces, and cloud hosts;
- the active Next cache for any detected worktree.

### R7. Multi-agent and runtime ownership

- Discover cleanup scope from the requested repository plus `git worktree list --porcelain`; do not scan arbitrary sibling directories.
- Treat any dirty worktree as user-owned: never remove the worktree or its Next cache automatically. An exact unopened `.dev-logs/*.log` candidate may still be eligible because it is ignored runtime output and its file-level ownership is independently proven.
- Treat any worktree with an identified active process as active.
- Do not stop/restart services, kill processes, modify ports, touch PostgreSQL, or run Docker prune.
- Do not print secrets found in process arguments, environment files, or Docker configuration.
- Implement directly in the current worktree as requested, touching only `.agents/skills/smallkhoj-cleanup/` and this task directory. Do not stage, commit, revert, reformat, or otherwise modify unrelated dirty files.

### R8. Output and usability

- Support readable terminal output and `--json` output.
- Show totals by category, the exact reason each candidate is eligible or blocked, expected versus actual reclaimed bytes, and a clear statement when no changes were made.
- Provide commands in `SKILL.md` that use the project’s `rtk` prefix convention while keeping the Python script independently executable.
- Keep the skill entry concise; put the detailed deletion policy in one directly linked reference file.

### R9. Verification

- Test the deterministic script with temporary fixtures before any live-project audit.
- Cover dry-run non-mutation, threshold boundaries, symlink/path escape rejection, active/open candidate blocking, dirty-worktree report-only behavior, plan tampering, plan drift, confirmation mismatch, all-before-any preflight, JSON output, and command-line redaction.
- Run the official `skill-creator` validator on the completed skill.
- After the separately approved R0 rehearsal, run the implemented skill against this repository only in dry-run mode; do not use the unfinished or newly implemented script to perform another live cleanup during skill validation.

## Acceptance Criteria

- [x] AC0 — A fresh, exact, user-approved one-time cleanup completes before implementation; expected and actual reclaimed state are reconciled and no unapproved target changes. (R0)
- [x] AC0b — Local worktrees/branches retired in the one-time pass are clean, inactive, and strongly proven merged into `main`; ambiguous, dirty, active, local-only, and remote state is retained and reported. (R0b)
- [x] AC1 — `$smallkhoj-cleanup` exists under `.agents/skills/smallkhoj-cleanup/`, passes `quick_validate.py`, and includes aligned `agents/openai.yaml` metadata. (R1)
- [x] AC2 — The default command produces an audit/plan and makes no filesystem, process, Git, Docker, database, or cloud mutation. (R2, R3)
- [x] AC3 — Apply requires both the exact plan and matching confirmation token; tampered, stale, escaped, symlinked, open, active, or otherwise unverifiable candidates are rejected before any deletion. (R4, R5, R7)
- [x] AC4 — Only eligible inactive logs and inactive Turbopack caches can be deleted; Docker, worktrees, processes, dependencies, databases, credentials, and active caches remain report-only. (R5, R6)
- [x] AC5 — Human and JSON reports distinguish eligible, blocked, report-only, and active/normal findings, redact command lines, and reconcile expected/actual bytes. (R3, R8)
- [x] AC6 — Automated tests cover all destructive boundaries, including all-before-any preflight, and pass without touching live project artifacts. (R9)
- [x] AC7 — A live-project dry-run identifies the known large stale log when it still meets policy, reports current active Next state as protected, and performs zero deletions. (R3, R5, R9)
- [x] AC8 — The implementation stays confined to the new skill and this task’s planning/context files; the pre-existing dirty worktree is byte-for-byte unaffected outside those paths. (R7)

## Out of Scope

- Installing or updating a cron job, launchd service, Codex automation, Trellis hook, or other recurring scheduler.
- Automatically pruning Docker resources, removing worktrees/branches, killing processes, rotating active logs, or changing `dev.sh`.
- Deleting remote branches during the one-time local branch/worktree retirement pass.
- Cleaning cloud production, databases, user home directories, or unrelated repositories.
- Solving the upstream Turbopack cache corruption bug; this skill only audits and safely removes an inactive generated cache.
- Adding a production image Git-SHA label or changing release tooling.
- Expanding the one-time rehearsal beyond the exact approved stale log/cache paths while it is running.

## Planning Status

No unresolved product question blocks implementation. The approved MVP is manual, dry-run-first, project-local, and deliberately conservative; any expansion of the automatic deletion allow-list requires a new review of this PRD.
