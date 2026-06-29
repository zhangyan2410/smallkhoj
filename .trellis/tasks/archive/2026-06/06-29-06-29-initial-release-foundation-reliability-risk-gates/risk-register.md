# Foundation risk register

Status values: `not-started`, `pass`, `warn`, `fail`, `blocked`.

| ID | Priority | Risk | Symptom | Gate / Evidence | Related Task | Status |
| --- | --- | --- | --- | --- | --- | --- |
| FR-01 | P0 | Account/Server scope is not real | User sees or mutates another Server's channels, Computers, Agents, tasks, or integrations | `initial_release_foundation_gate.py` `server.accountScopeBackendTests`; evidence `evidence/FOUNDATION_gate_20260629103659.md` | `06-29-06-29-initial-release-server-account-membership-foundation` | pass |
| FR-02 | P0 | Product daemon command depends on source checkout | External user cannot connect a Computer without `/Users/code/project/smallkhoj` | `initial_release_foundation_gate.py` `daemon.commandShape` + `daemon.distributionArtifact`; evidence `evidence/FOUNDATION_gate_20260629100145.md` | `06-29-06-29-initial-release-daemon-distribution-versioning` | pass |
| FR-03 | P0 | Duplicate Computer identity | Same physical machine creates multiple Computers or connect fails with stale offline record | `initial_release_foundation_gate.py` `daemon.identityBackendTests`; evidence `evidence/FOUNDATION_gate_20260629100629.md` | `06-28-initial-release-daemon-single-local-computer-identity` | pass |
| FR-04 | P0 | Daemon WebSocket production route broken | Computer connects but cannot receive control events | `initial_release_foundation_gate.py` `smoke.ws.daemonAuth`; evidence `evidence/FOUNDATION_gate_20260629095157.md` | `06-28-initial-release-daemon-websocket-deploy-smoke` | pass |
| FR-05 | P0 | TaskRun accepted but not executable/observable | Work item appears queued forever or fails without evidence | `initial_release_foundation_gate.py` `taskrun.lifecycleBackendTests`; evidence `evidence/FOUNDATION_gate_20260629100946.md` | `06-25-taskrun-config-templates` / initial release parent | pass |
| FR-06 | P0 | Deployment only works from local dev assumptions | Public URL uses localhost API/WS, CORS fails, Caddy misses WS upgrade | `initial_release_foundation_gate.py` repo preflight + public smoke; evidence `evidence/FOUNDATION_gate_20260629095157.md` | production deployment tasks | pass |
| FR-07 | P0 | No backup/restore confidence | Bad deploy or DB issue loses release data | Real remote Postgres backup/restore drill evidence `evidence/postgres_backup_restore_drill_20260629.json`; latest gate evidence `evidence/FOUNDATION_gate_20260629104833.md` | production recovery / deployment operations | pass |
| FR-08 | P0 | Secrets/config leak or partial prod env | Real secrets printed, committed, or app starts with placeholders | `initial_release_foundation_gate.py` static no-secret guardrails; evidence `evidence/FOUNDATION_gate_20260629095636.md` | production env validation tasks | pass |
| FR-09 | P1 | Server capacity hidden until live use | Idle smoke passes, but memory/disk/CPU fails during runtime/chat activity | resource snapshot after foundation activity | lighthouse resource baseline | warn |
| FR-10 | P1 | Disk fills from logs/uploads/evidence/cache | App degrades or Postgres/Docker fails due to 40GB disk pressure | accepted warning for first release; follow-up retention/disk check under `06-09-database-observation-sop` / production readiness | database observation / production readiness tasks | warn |
| FR-11 | P1 | Daemon version skew | Old daemon connects but protocol behavior is incompatible | Backend `MINIMUM_DAEMON_VERSION` returns 426 on connect/register/heartbeat before state mutation; daemon distribution evidence records version `0.2.0` | `06-29-06-29-initial-release-daemon-distribution-versioning` | pass |
| FR-12 | P1 | Runtime target selection wrong | Work executes on wrong Computer/agent or multiple runtimes | accepted warning for first release; follow-up two-daemon or simulated-machine target selection test | `06-09-runtime-lifecycle-controls` / initial release multi-machine validation | warn |
| FR-13 | P1 | Restart/reconnect duplicates work | daemon restart replays or loses event cursor incorrectly | accepted warning for first release; follow-up restart-during-work event cursor drill | `06-23-daemon-connect-maturity-and-onboarding` / TaskRun tasks | warn |
| FR-14 | P1 | Operator cannot diagnose failures | UI shows raw/empty failure state and trace is not findable | accepted warning for first release; follow-up forced-failure UI + `smallkhoj-trace` evidence | `06-09-agent-activity-diagnostics` / runtime evidence tasks | warn |
| FR-15 | P2 | Native install polish missing | User has to run a script rather than a signed installer | accepted warning for first release because the artifact is versioned/checksummed and native signing is not required for the controlled initial release | daemon distribution task | warn |

## Current Release Decision

P0 foundation ready. Latest executable gate run on 2026-06-29 is recorded in `evidence/FOUNDATION_gate_20260629162132.md` and produced 0 failed checks, 0 blocked checks, 0 runner warnings, and `ready=true`.

- Passing evidence exists for FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, and FR-08.
- FR-07 was upgraded from dry-run warning to pass after a real remote Postgres backup/restore drill restored into `smallkhoj_restore_drill_foundation_20260629`, verified `SELECT 1`, and dropped the restore database afterward.
- FR-11 was upgraded from accepted warning to pass after daemon distribution/versioning added a shared daemon version source and backend minimum-version enforcement.
- P1/P2 risks FR-09, FR-10, FR-12, FR-13, FR-14, and FR-15 remain visible as accepted first-release warnings or follow-up tasks. They do not block the P0 foundation gate, but they should be revisited as soon as real usage starts.

## Minimum Recommended P0 Blockers

The initial release should block on FR-01 through FR-08 unless the user explicitly accepts a narrower release definition. All current P0 blockers pass.

## Accepted Non-P0 Warnings

- FR-09 capacity: accepted for the first release because the current target is a small control-plane/demo workload, not broad team load. Escalate if CPU, memory, or response time degrades during realistic daemon/chat activity.
- FR-10 storage/log retention: accepted for the first release because deployment and restore evidence exist, but disk growth limits still need a retention/cleanup task before broader rollout. Escalate if Docker, Postgres, uploads, traces, or evidence files start growing without an operator cleanup path.
- FR-12 runtime target selection: accepted for the first release because TaskRun lifecycle evidence exists, but multi-computer target isolation still needs a two-daemon drill. Escalate before inviting multiple real machines into the same Server.
- FR-13 restart/event cursor: accepted for the first release because identity/lease tests pass, but restart-during-work replay/loss behavior needs a dedicated drill. Escalate before using long-running tasks as critical evidence.
- FR-14 diagnostics: accepted for the first release because backend evidence is visible and `smallkhoj-trace` exists, but forced-failure UI/operator states need a focused test. Escalate before asking non-developers to diagnose runtime failures themselves.
- FR-15 native installer polish: accepted as P2 because a versioned artifact path is enough for the first controlled release; signed/native install polish can follow after the daemon protocol stabilizes.
