# Foundation risk register

Status values: `not-started`, `pass`, `warn`, `fail`, `blocked`.

| ID | Priority | Risk | Symptom | Gate / Evidence | Related Task | Status |
| --- | --- | --- | --- | --- | --- | --- |
| FR-01 | P0 | Account/Server scope is not real | User sees or mutates another Server's channels, Computers, Agents, tasks, or integrations | Membership + active-Server tests; private channel access tests; `foundation.riskRegister` currently only proves tracking coverage | `06-29-06-29-initial-release-server-account-membership-foundation` | warn |
| FR-02 | P0 | Product daemon command depends on source checkout | External user cannot connect a Computer without `/Users/code/project/smallkhoj` | `initial_release_foundation_gate.py` `daemon.commandShape`; evidence `evidence/FOUNDATION_gate_20260629095157.md` | `06-29-06-29-initial-release-daemon-distribution-versioning` | fail |
| FR-03 | P0 | Duplicate Computer identity | Same physical machine creates multiple Computers or connect fails with stale offline record | Reconnect/offline/lease test on deployed backend | `06-28-initial-release-daemon-single-local-computer-identity` | warn |
| FR-04 | P0 | Daemon WebSocket production route broken | Computer connects but cannot receive control events | `initial_release_foundation_gate.py` `smoke.ws.daemonAuth`; evidence `evidence/FOUNDATION_gate_20260629095157.md` | `06-28-initial-release-daemon-websocket-deploy-smoke` | pass |
| FR-05 | P0 | TaskRun accepted but not executable/observable | Work item appears queued forever or fails without evidence | Local API-created TaskRun delivered to daemon/runtime; UI/API evidence visible | `06-25-taskrun-config-templates` / initial release parent | blocked |
| FR-06 | P0 | Deployment only works from local dev assumptions | Public URL uses localhost API/WS, CORS fails, Caddy misses WS upgrade | `initial_release_foundation_gate.py` repo preflight + public smoke; evidence `evidence/FOUNDATION_gate_20260629095157.md` | production deployment tasks | pass |
| FR-07 | P0 | No backup/restore confidence | Bad deploy or DB issue loses release data | Postgres backup and restore drill into clean DB/staging | missing child task | blocked |
| FR-08 | P0 | Secrets/config leak or partial prod env | Real secrets printed, committed, or app starts with placeholders | env template validation + no-secret update script + git scan; runner currently requires an explicit env file before coverage counts | production env validation tasks | blocked |
| FR-09 | P1 | Server capacity hidden until live use | Idle smoke passes, but memory/disk/CPU fails during runtime/chat activity | resource snapshot after foundation activity | lighthouse resource baseline | warn |
| FR-10 | P1 | Disk fills from logs/uploads/evidence/cache | App degrades or Postgres/Docker fails due to 40GB disk pressure | upload limits, retention docs, Docker cleanup, disk check | missing child task | not-started |
| FR-11 | P1 | Daemon version skew | Old daemon connects but protocol behavior is incompatible | daemon version/minimum compatibility gate | daemon distribution task | not-started |
| FR-12 | P1 | Runtime target selection wrong | Work executes on wrong Computer/agent or multiple runtimes | two-daemon or simulated-machine target selection test | initial release multi-machine validation | not-started |
| FR-13 | P1 | Restart/reconnect duplicates work | daemon restart replays or loses event cursor incorrectly | restart daemon during queued/running work and inspect events | daemon connect maturity / TaskRun | not-started |
| FR-14 | P1 | Operator cannot diagnose failures | UI shows raw/empty failure state and trace is not findable | forced failure with visible reason + `smallkhoj-trace` evidence | runtime/evidence tasks | not-started |
| FR-15 | P2 | Native install polish missing | User has to run a script rather than a signed installer | accepted warning for first release if artifact is versioned/checksummed | daemon distribution task | not-started |

## Current Release Decision

Not ready. First coherent gate run on 2026-06-29 produced 1 failed P0 risk and 4 blocked P0 risks.

- Failed: FR-02.
- Blocked / no executable gate wired yet: FR-03, FR-05, FR-07, FR-08.
- Passing evidence exists for a narrow slice of FR-04 and FR-06.
- FR-01 is only partially covered by the risk-register existence check; real account/server access tests remain required.

## Minimum Recommended P0 Blockers

The initial release should block on FR-01 through FR-08 unless the user explicitly accepts a narrower release definition.
