---
name: smallkhoj-cleanup
description: >
  Audit SmallKhoj local development disk and memory usage, then prepare or apply a fail-closed cleanup plan for stale unopened development logs and inactive Turbopack caches. Use when local SmallKhoj development feels heavy, disk/RAM usage needs inspection, old worktrees or Docker resources need a safe report, or the user asks for an on-demand project cleanup. Not for changing application code, stopping processes, pruning Docker, deleting Git worktrees/branches, touching databases/dependencies/credentials/cloud resources, or installing a scheduler. Apply can irreversibly delete only exact allow-listed generated artifacts after the user reviews the current plan and explicitly confirms its plan ID. Output: audit evidence, an exact expiring plan, and—only after approval—reconciled apply results.
---

# SmallKhoj Cleanup

Audit first. Treat every uncertain ownership signal as a blocker. Never expand the script's deletion allow-list during a run.

## Workflow

1. Read [references/cleanup-policy.md](references/cleanup-policy.md) before interpreting candidates or considering apply.
2. Run an audit from a registered SmallKhoj worktree:

   ```bash
   rtk python3 .agents/skills/smallkhoj-cleanup/scripts/cleanup.py audit \
     --repo . \
     --plan-out /tmp/smallkhoj-cleanup-plan.json \
     --json
   ```

3. Report that the audit changed no cleanup targets. Summarize:
   - system memory pressure/swap and filesystem availability;
   - SmallKhoj-owned processes without full command lines or environments;
   - worktree size/dirty/active state and Docker's read-only summary;
   - every eligible, blocked, report-only, active, and normal artifact;
   - collector limitations and the exact plan ID.
4. Show the exact candidate paths, categories, reasons, and expected bytes. Obtain fresh user approval for this candidate list and this plan ID. A previous approval, an earlier plan, or merely invoking the skill is not apply authorization.
5. Only after that approval, apply the saved plan with its exact ID:

   ```bash
   rtk python3 .agents/skills/smallkhoj-cleanup/scripts/cleanup.py apply \
     --repo . \
     --plan /tmp/smallkhoj-cleanup-plan.json \
     --confirm <exact-plan-id> \
     --json
   ```

6. Report deleted, failed, skipped, expected-byte, and deleted-candidate-byte totals. Recheck relevant service health only when it was part of the user's cleanup request.

If apply rejects drift, expiry, ownership, openness, or repository identity, stop. Run a fresh audit and obtain new approval; never silently regenerate and apply.

## Hard boundaries

- Keep Git worktrees/branches, Docker, processes, ports, Screen/tmux, PID files, databases, dependencies, credentials, agent workspaces, and cloud resources report-only.
- Never stop/restart services, kill processes, run Docker prune, alter Git state, inspect secrets, or delete untracked/source/task evidence.
- Delete only regular non-symlink `.dev-logs/*.log` files and exact inactive `frontend/.next/dev/cache/turbopack` roots admitted by the policy.
- Require a matching, untampered, unexpired plan; revalidate every candidate before the first mutation.
- Exercise live-project validation in audit mode only. Test apply with temporary fixtures.
- Keep this capability manual/on-demand. Do not install cron, launchd, hooks, automations, or background daemons.

## Common mistakes

- Do not call an old cache stale from its directory mtime alone; the script uses the newest descendant mtime.
- Do not equate `du` or logical candidate bytes with filesystem free-space delta; APFS clones/compression and concurrent writes differ.
- Do not treat missing `lsof`, failed Git status, an old branch name, or a merged-looking task as deletion proof.
- Do not paste process command lines into reports; arguments may contain connection credentials.
- Do not turn a Git/worktree finding into a manual deletion inside this skill. Perform a separate, explicitly authorized merge audit.
