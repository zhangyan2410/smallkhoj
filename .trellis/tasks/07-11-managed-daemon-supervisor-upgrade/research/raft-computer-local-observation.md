# Raft Computer Local Observation

Observed on macOS arm64 on 2026-07-11. This is comparative product evidence,
not a requirement to copy Raft internals exactly.

## Process shape

The managed Computer used a detached service process with parent PID 1 and a
per-server runner child:

```text
raft-computer __service
└── raft-computer __run <server-id>
```

The service exposed a local Unix socket and persisted service/runner PID,
version, connection, and upgrade state beneath its local application state
directory. Agent runtimes were managed below the runner.

## Product/CLI shape

Observed CLI capabilities included:

- setup/start/stop/restart/status/doctor/logs;
- release channel `latest`, `alpha`, or `pinned:<semver>`;
- upgrade dry-run, target version, and rollback;
- managed macOS/Linux Computer path, while Windows remained a transitional
  terminal daemon path.

## Upgrade evidence

Local upgrade records showed successful web-triggered updates across multiple
versions. Runner state records showed graceful exit followed by restart. A
previous binary was retained for rollback.

One important failure mode was also observed: installed CLI and runner versions
had advanced while the detached service was still executing an older binary.
The CLI warned about service-version skew and recommended service restart.

## Lessons for SmallKhoj

- Model installed, supervisor, runner, desired, and backend-observed versions
  separately.
- Do not assume replacing a binary means every process now runs that version.
- A process being upgraded needs an external restart authority: OS service
  manager or narrow updater helper.
- Persist upgrade state and report it to the web control plane.
- Keep foreground mode as a diagnostic path, not the normal product lifecycle.
- Treat Windows terminal operation as a transition, not the target design.
