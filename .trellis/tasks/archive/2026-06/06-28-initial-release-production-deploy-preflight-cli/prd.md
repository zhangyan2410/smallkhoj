# Initial release production deploy preflight CLI

## Goal

Add a repeatable no-secret production deployment preflight CLI for the 7-15 initial release. The command should catch deployment blockers before spending time on Tencent Cloud Lighthouse or a tunnel: broken compose/Caddy routing, missing frontend standalone output contract, missing required production env, unavailable Docker, inadequate host resources, and occupied public ports.

## Requirements

- Provide a repository-local CLI that can run from the project root without external service credentials.
- Default mode must be safe and offline: inspect tracked files and config contracts only.
- Runtime mode must inspect the current host for Docker availability, memory, disk, and public port readiness without starting production services.
- Env-file mode must parse a deployment `.env` file and report missing required values without printing secret values.
- JSON output must be machine-readable so it can be pasted into release evidence or used by automation.
- Human output must summarize pass/warn/fail checks clearly.
- Failed checks must return a non-zero exit code; warnings alone should not fail the command unless `--strict-warnings` is set.
- The deployment runbook must document when and how to run the preflight.

## Acceptance Criteria

- [x] A new deploy preflight CLI exists under `scripts/`.
- [x] Tests cover passing repo config, missing standalone output contract, missing env values, and warning exit semantics.
- [x] Default preflight passes against the current repository.
- [x] Runtime preflight can run on the current machine and reports Docker/resource/port status.
- [x] Deployment docs include the command sequence for local/CI and server runtime preflight.
- [x] The task is archived and committed.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
