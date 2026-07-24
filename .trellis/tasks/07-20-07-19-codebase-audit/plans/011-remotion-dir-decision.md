# Plan 011 (Direction): Decide on `remotion/` — commit skeleton or remove

## Current remediation disposition (2026-07-24)

- **Disposition**: `DEFER_LINKED`
- **Release scope**: `RELEASE_EXCLUDED`
- **Audit-scope decision**: `REJECT_DESTRUCTIVE_CLEANUP_IN_AUDIT_SCOPE`
- **Safety boundary**: Remotion files/tasks are user-owned WIP. No Remotion file
  or directory is deleted, moved, populated, staged, or otherwise modified by
  this audit remediation.

The plan below is retained as historical advisory context. Its destructive
options are explicitly not authorized by this disposition.

> **Executor instructions**: This is a **decision + cleanup plan**, not a
> build task. The goal is to resolve the contradiction between the empty
> `remotion/` directory and the in-flight Trellis task describing a 6300-
> frame Remotion composition. Read fully, confirm the operator's decision
> in Step 1, then execute the chosen cleanup. Honor the STOP conditions.

## Status

- **Priority**: P3
- **Effort**: S (hours — decision + cleanup)
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction / cleanup
- **Planned at**: commit `47848e8`, 2026-07-19

## Why this matters

`remotion/` is a top-level directory that contains **only a `.DS_Store`**
— no `package.json`, no `src/`, no compositions. But
`.trellis/tasks/07-10-remotion-long-skeleton-phase1/prd.md` describes a
`FullPromoPreview` 6300-frame Remotion composition as in-flight, with
concrete frame boundaries and a stated acceptance criterion
("`npm run dev` shows the composition").

Both the directory and the task folder are **untracked** in git (per
`git status`). Either the work moved off-tree, was abandoned mid-flight,
or `remotion/` is a leftover empty dir from a half-started scaffold.

Empty untracked directories are noise: future contributors and the
improve/impeccable skills trip over them, and the Trellis task's
acceptance criteria cannot be met by the current tree.

## Current state

- `remotion/` — `ls -la` shows only `.DS_Store` (6148 bytes, dated
  Jul 10 17:43). No other files.
- `.trellis/tasks/07-10-remotion-long-skeleton-phase1/prd.md` — describes
  a 7-act 6300-frame composition; references "已采集的真实 UI 截图目录"
  (line 38).
- Both untracked (per `git status`).

## Scope

**In scope**:

- `remotion/` — delete OR populate, per operator decision.
- `.trellis/tasks/07-10-remotion-long-skeleton-phase1/` — keep, archive,
  or update per operator decision.

**Out of scope**:

- Actually building the 6300-frame Remotion composition. If the operator
  chooses "commit the skeleton," that is a separate build task, not this
  plan. This plan only ensures the repo state is internally consistent.

## Steps

### Step 1: Operator decision

Present three options:

**Option A — Abandon**: Remotion is not a current direction. Delete
`remotion/` and the `07-10-remotion-long-skeleton-phase1/` task folder.

**Option B — Defer but clean**: Remotion is still wanted but not now.
Delete the empty `remotion/` directory; keep the task folder but mark it
explicitly as "deferred — no scaffold yet" in its PRD. When work resumes,
recreate `remotion/` per `docs/multi-agent-development-workflow.md`
(sibling worktree + `feat/*` branch).

**Option C — Skeleton exists off-tree**: The scaffold was built in a
worktree (per the multi-agent git flow). Commit it to the main repo now
and link the task to the worktree.

**Verify**: operator picks A, B, or C. Do NOT proceed without a decision.

### Step 2: Execute the chosen option

**If A**:
- `rm -rf remotion/`
- `rm -rf .trellis/tasks/07-10-remotion-long-skeleton-phase1/` OR move to
  `.trellis/tasks/archive/2026-07/07-10-remotion-long-skeleton-phase1/`
  (archive preserves the design rationale for future reference).

**If B**:
- `rm -rf remotion/`
- Prepend to `.trellis/tasks/07-10-remotion-long-skeleton-phase1/prd.md`:
  ```markdown
  > **STATUS: DEFERRED (2026-07-19).** The `remotion/` scaffold was never
  > committed; the directory has been removed to avoid an empty-dir smell.
  > When this task resumes, recreate `remotion/` in a sibling worktree per
  > `docs/multi-agent-development-workflow.md`.
  ```

**If C**:
- Pull the skeleton from the worktree into `remotion/`.
- Confirm `remotion/package.json` and `remotion/src/index.tsx` exist.
- Update the task PRD with the worktree path and the commit SHA that
  introduced the scaffold.

**Verify**:
- For A and B: `ls remotion/` returns "No such file or directory"; `git
  status` shows the deletion (or the rename, if archived).
- For C: `cd remotion && npm run dev` (or the task's stated command)
  shows the `FullPromoPreview` composition per the PRD's acceptance
  criterion.

### Step 3: Confirm `BACKLOG.md` consistency

`BACKLOG.md` is currently nearly empty (no entries). If Remotion was ever
intended as a tracked feature, this plan is the moment to either add it
(Option B or C) or confirm it was never a backlog item (Option A).

**Verify**: `BACKLOG.md` either lists Remotion with the chosen status, or
remains empty with a one-line note that it was considered and deferred.

## Done criteria

- [ ] Operator decision (A/B/C) recorded in `plans/README.md`.
- [ ] `remotion/` either does not exist (A/B) or contains a real scaffold
      with `package.json` (C).
- [ ] `.trellis/tasks/07-10-remotion-long-skeleton-phase1/prd.md` either
      is deleted, archived, marked DEFERRED, or updated with the commit
      SHA — consistent with the chosen option.
- [ ] `git status` no longer shows `remotion/` as an untracked dir with
      only `.DS_Store`.
- [ ] `plans/README.md` status row for plan 011 updated to DONE.

## STOP conditions

- Operator defers the decision — STOP, mark plan BLOCKED. Leave `remotion/`
  as-is (do NOT delete speculatively).
- Option C turns out to be wrong — the skeleton does not exist off-tree,
  or the worktree is stale/lost — fall back to Option B (defer + clean).
- The PRD references assets ("已采集的真实 UI 截图目录") that are also
  missing — report; asset loss may indicate broader abandoned work that
  the operator should know about before this plan closes.

## Maintenance notes

- **Untracked top-level directories should not linger.** If this plan
  resolves to "defer," add a recurring check (or a CI lint) that flags
  top-level dirs containing only `.DS_Store` so the smell does not
  recur.
- **The multi-agent git flow** (`docs/multi-agent-development-workflow.md`)
  is the right home for in-flight scaffolds — worktrees, not the main
  repo's top level.
