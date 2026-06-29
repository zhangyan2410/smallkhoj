# Initial release Lighthouse host bootstrap probe

## Goal

Add a repeatable first-host probe for the Tencent Cloud Lighthouse deployment candidate. Before we spend time hand-configuring the server, the command should tell us whether the host is ready for the SmallKhoj production stack or which bootstrap actions are still needed: Docker/Compose, memory/swap, disk, public ports, sudo/package manager, and firewall tooling.

## Requirements

- Provide a repository-local host probe command that can run on Linux Lighthouse, a tunnel host, or local machines without cloud credentials.
- The default mode must be read-only: it must not install packages, create swap, open firewall ports, or start services.
- JSON output must be suitable as release evidence.
- Human output must be readable over SSH.
- The command must classify checks as passed/warning/failed and return a non-zero exit code for failures.
- The command must generate suggested bootstrap commands for common Ubuntu/Debian hosts without executing them.
- The command must not print secrets and must not require `.env.prod`.
- Deployment docs must show where this host probe fits relative to the production deploy preflight.

## Acceptance Criteria

- [x] A new Lighthouse/host probe CLI exists under `scripts/`.
- [x] Tests cover resource classification, Docker/Compose classification, bootstrap command generation, and warning/failed exit semantics.
- [x] The host probe runs on the current machine and emits JSON.
- [x] Deployment docs include the host probe command before env/preflight/start.
- [x] The task is archived and committed.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
