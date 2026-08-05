---
topics: [workflow, git, multi-agent]
doc_kind: note
created: 2026-06-18
updated: 2026-06-19
---

# Multi-Agent Development Workflow

This is the lightweight multi-agent workflow for SmallKhoj. It borrows the useful parts of Clowder's process without copying the full governance stack.

## Core Rule

```text
main = stable integration line
task work = feat branch + sibling worktree
merge = reviewed PR + squash
```

Do not use `main` as a shared scratchpad. Direct edits on `main` are allowed only for tiny docs/config cleanup where the user explicitly asks for an inline change.

## Relationship to Clowder

Clowder is a reference project for this workflow, but its project-specific
skill bundle is not installed or loaded by SmallKhoj. In particular,
SmallKhoj must not import Clowder's Cat Cafe lifecycle, worktree, review, or
merge skills.

SmallKhoj's active rules come from `AGENTS.md`, `.trellis/workflow.md`, and
this document. The local fast path stays inline; sibling worktrees, review,
PRs, and squash merge apply only to the integration cases described here.

## Standard Flow

1. Sync and inspect `main`.

```bash
git status --short
git fetch origin main
git rev-list --count origin/main..main
git rev-list --count main..origin/main
```

`main` should be clean before starting ordinary feature work. If it is ahead, push. If it is behind, pull/rebase. If unrelated dirty files exist, do not mix them into the new task.

2. Create a sibling worktree.

```bash
git worktree add ../smallkhoj-<task-slug> -b feat/<task-slug>
cd ../smallkhoj-<task-slug>
```

Keep worktrees next to the repo, not inside it. Each agent should work in its own worktree.

3. Develop inside that worktree only.

The branch and worktree define the task boundary. Do not patch files in the main worktree by accident.

4. Run branch-local verification.

Backend:

```bash
cd backend
uv sync
uv run pytest
```

Frontend:

```bash
cd frontend
bun install --frozen-lockfile
bun run lint
bun run build
```

Daemon:

```bash
cd agent/daemon/aaa-daemon
npm install
npm test
```

Run the relevant subset during development. Before merge, rerun the affected package checks after rebasing on latest `origin/main`.

5. Real-test product behavior when needed.

Automated tests are not enough for browser-facing, daemon/runtime, channel/task, or control-plane changes. Start the app from the feature worktree, use a unique marker, drive the real browser with the project WebDriver wrapper, and save evidence under the active task:

```bash
./twd --compact tabs
./twd goto --url-match 127.0.0.1:<port> http://127.0.0.1:<port>/
./twd --compact scan --text --url-match 127.0.0.1:<port>
```

For daemon/runtime flows, also cross-check:

```bash
./smallkhoj-trace summary
./smallkhoj-trace summary --json
```

Use `docs/real-test-sop-template.md` for evidence format and `docs/real-runtime-dm-reply-sop.md` for the real runtime DM reply path.

6. Review before merge.

The author should not be the only reviewer for non-trivial changes. At minimum, another agent or the human operator should check the diff, test evidence, and whether the change matches the original product intent.

7. Create a PR and squash merge.

```bash
git push origin feat/<task-slug>
gh pr create --fill
gh pr merge --squash --delete-branch
```

Prefer one clean squash commit per task. Keep `main` history readable.

8. Clean up merged worktrees.

```bash
git worktree remove ../smallkhoj-<task-slug>
git branch -d feat/<task-slug>
git worktree prune
```

## Real-Test Rule

Real testing is tied to the running app instance, not just the branch name. Before recording evidence, write down:

- Worktree path.
- Branch name.
- Frontend URL.
- Backend URL.
- Unique marker.
- Screenshot/snapshot/API/trace evidence path.

If evidence was captured against the wrong port or the wrong worktree, it does not count.
