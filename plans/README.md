# Critical audit-remediation release plans

Generated on 2026-07-24 with the `improve` and `writing-plans` workflows. These
files are execution instructions for a zero-context agent. They do not claim
that the current candidate is committed, merged, deployed, or capacity-proven.

The only permitted order is:

```text
isolated local branch
→ final local gates and exact candidate commit A
→ clean A images and local production-shape UI
→ independent P1/P2 disposition
→ target-shaped formal capacity as the final A-tree gate
→ PR and squash merge B
→ prove tree(A) == tree(B) and B == origin/main
→ build linux/amd64 release artifacts from B
→ fresh local production-shape smoke of the exact B image IDs
→ stop Plan 001 with cloud deployment pending
→ create and cold-review a separate B-bound production runbook
→ only then: first cloud access, backup/lock/deploy/new-version verification
```

The existing cloud deployment runs older code. No executor may access, test,
benchmark, change, or use it as evidence before the merge phase explicitly
allows cloud work.

## Execution order and status

| Plan | Title | Priority | Effort | Depends on | Status |
|---|---|---:|---:|---|---|
| [001](001-release-critical-bugs-and-hundreds-concurrency.md) | Merge critical fixes, prove the local hundreds-connection envelope, and build B artifacts | P1 | L, about 4–7 hours elapsed when green, plus CI/review queue | none | TODO |

Status values are `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED`, or `REJECTED`.
Because formal capacity requires a clean immutable tree, update this index only
before candidate A is committed. After A exists, keep execution status in
repo-external evidence or the PR; do not dirty A merely to change this table.

## Exact staging manifest

Plan 001 owns [001-release-candidate-paths.txt](001-release-candidate-paths.txt).
It is an exact 145-entry literal Git pathspec allowlist: the current 142-path
remediation core plus the three files under `plans/`. The 145-entry manifest
and the separately pinned 142-path core-tree hash are independent invariants;
neither count may be substituted for the other. The executor must compare live
status to the manifest and use `git add --pathspec-from-file`; `git add .`,
directory-wide staging, and staging from the unrelated main worktree are
forbidden.

## Dependency notes

- The full automated gate, local runtime/UI gate, reviewer disposition, and
  formal capacity report must all describe one final candidate tree A.
- Formal capacity is the last tree-bound gate. Any later source, test, spec,
  evidence, or documentation commit invalidates the report and requires a new
  candidate, new images, and a complete formal rerun.
- A squash merge may produce a different commit B only when its complete Git
  tree equals A. A different tree is an unconditional release stop.
- Plan 001 produces handoff-ready B artifacts but authorizes no cloud request or
  mutation. Running-image identity, backup/lock, failure freeze and target-bound
  post-deploy checks belong to the separately reviewed production runbook made
  after B exists.

## Findings considered and deliberately excluded

- Plans 006, 007, 008, 010, and 011 remain `RELEASE_EXCLUDED` under their
  recorded dispositions; Plan 009 is superseded by the schema and delivery
  terminal contract. They are not missing release work.
- Router extraction, `ChannelClient` decomposition, chat-state-owner
  consolidation, observer integration, Durable Work Item, and `/control/*`
  redesign are useful future work but not worth delaying this critical-fix
  release.
- Plan 001 uses explicit machine gates for merged-main provenance and local
  target-runner identity. Remote running-image identity and production recovery
  are deferred to the post-merge production runbook; no automatic rollback is
  pre-authorized here.
- `actionlint` and `gitleaks` are not installed locally, and
  `scripts/check-fallback-layers.mjs` does not exist. Record them as
  unavailable; never rewrite that as a green result. GitHub PR checks remain a
  required release gate.

## Unrelated work that must remain untouched

The primary worktree `/Users/code/project/smallkhoj` currently contains
user/other-task WIP under `MEMORY.md` and `session-observer/`. Plan 001 neither
reads nor stages those paths. The release uses the remediation worktree and,
after merge, a fresh detached release worktree.
