# SmallKhoj cleanup policy

## Scope and identity

- Start from the requested local Git worktree and discover scope only through `git worktree list --porcelain` for its Git common directory.
- Require SmallKhoj project markers, a registered requested worktree, and a stable repository root/common-dir/HEAD/branch identity.
- Never scan arbitrary sibling directories, user home directories, cloud URLs, databases, or secret stores.
- Treat a plan as valid for at most one hour. A different repository identity, changed HEAD, expired plan, modified plan body, or mismatched confirmation ID invalidates it.

## Finding states

| State | Meaning | May apply delete it? |
| --- | --- | --- |
| `eligible` | Allow-listed and every current safety check passed | Only through the exact confirmed plan |
| `blocked` | Allow-listed shape but type, path, age, ownership, tool, or fingerprint evidence is insufficient | No |
| `report_only` | Intentionally outside the automatic mutation boundary | No |
| `active` | Owned/open/live development state | No |
| `normal` | Expected generated state below cleanup thresholds | No |

Missing optional tools or inconclusive output always narrows eligibility. It never makes a candidate safer.

## Automatic deletion allow-list

### Inactive development logs

Admit only an exact regular, non-symlink `*.log` file directly under a registered worktree's `.dev-logs/` when exact-path `lsof` proves no opener.

A closed log becomes eligible when either condition is true:

```text
size >= 512 MiB and unchanged >= 24 hours
OR
unchanged >= 14 days
```

Worktree dirtiness does not by itself block an exact log: ignored runtime output has independent path/type/opener/fingerprint checks. An open log is `active`; an unavailable opener check is `blocked`; a recent log is `normal`.

### Inactive Turbopack caches

Admit only the exact directory:

```text
<registered-worktree>/frontend/.next/dev/cache/turbopack
```

Require all of the following:

- the worktree is clean;
- process-cwd collection is available;
- no frontend/Next process belongs to that worktree, including ownership inherited through process ancestry;
- recursive `lsof` proves no open file below the cache;
- the root and every descendant are ordinary directories/files, never symlinks or special files;
- the newest root-or-descendant mtime is at least 24 hours old.

An active cache is `active`; a dirty-worktree cache is `report_only`; a recent inactive cache is `normal`; missing ownership/opener/type evidence makes it `blocked`.

## Permanently report-only in the MVP

- Git worktrees, branches, detached heads, remotes, untracked/source files, `.git/`, `.trellis/`, and task evidence.
- Docker images, containers, volumes, networks, layers, and build cache.
- Processes, ports, Screen/tmux/WebDriver sessions, PID files, and service lifecycle commands.
- `node_modules/`, `.venv/`, package-manager caches, databases, backups, `.env*`, credentials, `.slock*`, agent workspaces, and cloud hosts.
- Every active Next cache and all `.next` content outside the exact Turbopack path.

Do not convert a report-only item into an ad-hoc shell deletion. Expand policy only through a separately reviewed skill change.

## Plan and apply integrity

Audit creates canonical JSON containing:

- schema version and creation/expiry timestamps;
- repository identity;
- exact eligible candidates and compact non-eligible findings;
- per-candidate worktree, category, reasons, bytes, and stat/tree fingerprint;
- a SHA-256 plan ID over the canonical body excluding the ID field.

Apply must, in order:

1. Parse and validate the plan schema and canonical ID.
2. Require `--confirm` to equal that exact ID.
3. Require the current repository identity to match.
4. Recollect registered worktrees, dirty state, process ownership, and opener evidence.
5. Reclassify and fingerprint every candidate before deleting any candidate.
6. Abort the whole preflight if any candidate drifted or lost eligibility.
7. Delete logs with Python unlink and caches with a non-symlink recursive remover.
8. Stop after an unexpected deletion failure and report successful, failed, and skipped items accurately.

Never construct `rm`, Git cleanup, Docker prune, or process-signal commands from plan paths.

## Fingerprints and byte accounting

File fingerprints include type, device, inode, logical size, nanosecond mtime, and allocated blocks. Directory fingerprints include the root stat plus a deterministic hash of descendant relative paths/types/device/inode/sizes/mtimes, entry count, newest descendant mtime, logical bytes, and allocated blocks. Traversal never follows symlinks.

`expectedBytes` and `reclaimedBytes` describe logical bytes of planned and successfully deleted candidates. They are not a promise of equal `df` change. APFS clone/compression behavior and unrelated concurrent writes make filesystem free-space change reconciliation evidence only.

## Collector interpretation

- On the supported macOS host, `lsof` exit 1 with empty stdout and stderr means no opener/cwd owner was found. Any other inconclusive combination blocks deletion.
- Process output may contain PID, PPID, executable basename/category, cwd/worktree, RSS, CPU, and elapsed time. Never collect or emit full arguments or environments.
- Docker collection is limited to `docker system df` and remains report-only.
- Memory collection is read-only (`vm_stat`, `sysctl vm.swapusage`, `memory_pressure -Q`, or `/proc/meminfo`).
- Worktree size is approximate. Dirty state, active ownership, or missing status evidence prevents automatic cache cleanup.

## Rehearsal lessons

The 2026-08-03 rehearsal removed one unopened 10.3 GB log and seven clean inactive cache roots after all-before-any validation. The eight artifacts totaled 13,050,252,202 logical bytes; free space increased by about 12.22 GiB, and ports 3000/8000 remained healthy.

A separate merge audit then removed six clean/inactive worktrees and twenty non-forced local branches with tips already in both local and remote `main`. Remote refs were unchanged. Nominal worktree size and actual APFS free-space increase differed materially. This separate operation is evidence for keeping all Git mutations outside this skill.
