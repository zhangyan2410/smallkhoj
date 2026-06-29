# Initial release Lighthouse resource baseline

## Goal

Record a no-secret runtime resource baseline for the deployed Tencent Cloud Lighthouse core stack before enabling Feishu/Jira worker traffic.

## Requirements

- Capture a no-secret resource baseline for the deployed Tencent Cloud Lighthouse host while the core stack is running.
- Record enough evidence to decide whether the current 4 vCPU / 4 GB Lighthouse instance is still suitable as the initial-release control-plane host before enabling Feishu/Jira worker traffic.
- Do not start local daemon/runtime, Feishu worker, model processes, or any new load generator.
- Do not print or store production env values, Feishu/Jira credentials, Tencent Cloud credentials, or daemon tokens.
- Update the deployment runbook with the observed CPU, memory, swap, disk, Docker image/cache, and container memory baseline.
- Make the conclusion explicit: whether the baseline proves only idle/core-stack suitability or also proves worker/live scenario readiness.

## Acceptance Criteria

- [x] SSH resource snapshot records uptime/load, memory/swap, disk, container stats, Docker disk usage, and top memory processes.
- [x] Public smoke still reports `ready=true`, `failures=0`, and `warnings=0` after evidence collection.
- [x] Deployment documentation records the baseline values and the decision boundary for the next validation step.
- [x] The worktree is committed with no real secrets or generated env files.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
