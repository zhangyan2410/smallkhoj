# Initial release foundation reliability and risk gates

## Goal

Define the non-Feishu/Jira foundation plan and validation gates that prove SmallKhoj's server, daemon, runtime, channel, deployment, capacity, and recovery layers are usable before the initial release.

This task is intentionally separate from Feishu/Jira integration. Feishu and Jira prove external workflow value; this task proves the lower layers can safely carry that value: account/server boundaries, channels/messages, Computers, daemon distribution, daemon WebSocket, Agent/runtime execution, TaskRun evidence, production deployment, storage, backups, and operational recovery.

The release should not be declared ready just because one happy-path integration demo works. It should be ready only when foundational risks have been made visible, tested, and either fixed or explicitly accepted.

## Confirmed Facts

- The initial release parent task already includes deployment, Computer identity, daemon WebSocket, TaskRun, and production URL requirements.
- `scripts/post_deploy_smoke.py` checks public URL reachability, frontend/backend route shape, API health, and daemon WebSocket auth routing.
- `scripts/initial_release_deploy_preflight.py`, `scripts/lighthouse_host_probe.py`, `scripts/lighthouse_ssh_deploy_probe.py`, `scripts/make_deployment_bundle.py`, `scripts/remote_deploy_evidence.py`, and `scripts/release_worker_rollout.py` already provide pieces of a release validation toolchain.
- `docs/initial-release-production-deployment.md` records remote deployment, Caddy, production image transfer, smoke, daemon WebSocket, resource baseline, and troubleshooting evidence.
- Current Tencent Cloud baseline is suitable for a small control-plane workload, but it does not prove real TaskRun/daemon concurrency, file/log growth, backup/restore, or long-lived WebSocket stability.
- A new server/account membership foundation task exists because the current default-server behavior is not enough for multi-human Server usage.
- A new daemon distribution/versioning task exists because current daemon connect commands still depend on a developer repository checkout.
- Feishu/Jira live integration is blocked on external secrets; foundation validation should continue without waiting for those credentials.

## Requirements

- Define a foundation readiness target that can be used as a release goal independent of Feishu/Jira credentials.
- Maintain a risk register that lists each lower-layer risk, the likely symptom, the validation method, the owner task, and the release decision.
- Convert foundational assumptions into executable gates wherever possible.
- Cover at least these foundation areas:
  - Server/account/membership and active-Server scoping;
  - channel/message visibility, write path, and private-channel access;
  - Computer identity, duplicate prevention, reconnect, offline status, and lease behavior;
  - downloadable/versioned daemon installation and upgrade path;
  - daemon WebSocket routing, heartbeat, reconnect, event cursor, and failure diagnostics;
  - Agent/runtime workspace lifecycle and target runtime selection;
  - Task/TaskRun creation, assignment, status transitions, evidence, and failure reporting;
  - deployment repeatability, production URL behavior, CORS/API/WS routing, and Caddy proxying;
  - capacity envelope for the current Tencent Cloud host;
  - storage growth, uploads, logs/evidence retention, Docker cache cleanup, and disk pressure;
  - database backup and restore drill;
  - secret/config guardrails and no-secret logging;
  - observability through `smallkhoj-trace`, deployment evidence, UI operator states, and logs;
  - rollback/recovery when a release candidate fails.
- Treat each gate as pass/fail/warn/blocked. Warns must record why they are acceptable for the initial release.
- Prefer real runtime and deployed-server validation over mocked-only tests for daemon, WebSocket, TaskRun, and deployment behavior.
- Keep external integrations out of the critical path for this task. Use local/manual/API-triggered work items where needed to exercise TaskRun and daemon execution.
- Record every validation run with enough evidence to avoid "it worked once on my machine" ambiguity.
- Do not require broad frontend redesign or MCP/skill marketplace work for this foundation target.
- Do not run model inference or heavy builds on the Tencent Cloud server as part of foundation validation unless explicitly measuring capacity risk.

## Acceptance Criteria

- [x] A foundation risk register exists and is linked from the initial release parent task.
- [ ] Each P0/P1 foundation risk has one of: passing validation evidence, a tracked fix task, or an explicit release-blocking decision.
- [x] A repeatable foundation gate command or checklist can be run before release candidate review.
- [ ] Server/account membership tests prove one account can own/join a Server and cannot access another Server's private resources.
- [ ] Channel/message tests prove public/private channel visibility and write access behavior.
- [x] Computer identity tests prove reconnect does not create duplicate Computers for the same physical machine.
- [ ] Packaged daemon validation proves a user can connect from outside the repository checkout path.
- [ ] Daemon WebSocket validation proves public deployment routes `/internal/agent-api/ws` correctly and rejects unauthenticated upgrades.
- [ ] Daemon reconnect validation proves heartbeat, lease, offline transition, and event cursor behavior after restart.
- [ ] Agent/runtime validation proves selected work goes to the intended Computer/runtime and non-target runtimes stay idle.
- [ ] TaskRun validation proves queued/running/failed/complete states and evidence are visible to an operator.
- [ ] Deployment validation proves backend, frontend, Postgres, Caddy, API, browser, and daemon URL shapes work under the chosen public URL strategy.
- [ ] Capacity validation records resource usage during realistic foundation activity, not only idle smoke.
- [ ] Backup/restore validation proves the database can be restored into a clean environment or records a release-blocking gap.
- [ ] Storage/log retention validation proves large logs/evidence/uploads cannot silently fill the disk, or records a tracked release blocker.
- [ ] Config/secrets validation proves `.env` templates, production env updates, and scripts do not print or commit secrets.
- [ ] Recovery validation records how to restart services, roll back a bad deployment, and collect evidence after failure.
- [ ] The task explicitly states which risks remain accepted for the first release and why.

## Out Of Scope

- Feishu long-connection behavior and Jira REST write-back correctness. Those remain in their integration tasks.
- Full production SRE automation, autoscaling, paid monitoring, or multi-region deployment.
- Native signed/notarized daemon installers beyond the first versioned download/install path.
- Large-team load testing. This task validates a small initial team control-plane envelope.
- Full security audit. This task covers release-critical config/secrets/access-boundary checks, not a complete AppSec program.

## Open Question

- What is the minimum foundation gate that you want to block the 07-15 initial release? Recommended answer: block on Server/account scoping, packaged daemon connect, daemon WebSocket/reconnect, TaskRun evidence, deploy smoke, backup/restore, and no-secret config; treat broader load testing and polished installers as warnings/follow-up unless real usage exposes them.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
