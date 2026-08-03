# Bug report: packaged Daemon cannot start nested Codex ACP

## Bug diagnosis capsule

| Field | Content |
| --- | --- |
| 1. Symptom | Switching from the Computer surface to the affected Member exposed a runtime that appeared online but did not reply. The Daemon repeatedly logged ACP closure and exit `127`; later message delivery was skipped because the target runtime was not running. Expected: the Codex ACP resident runtime starts and the member becomes online only after valid readiness. |
| 2. Evidence | Native frontend/backend remained HTTP 200. The packaged Daemon `0.2.3` listened on `127.0.0.1:55862`. Five starts failed with the same nested-npx error. A sanitized minimal reproduction using inherited `npm_config_package=<daemon-tgz>` returned `127`; removing that variable selected the ACP package correctly. |
| 3. Confirmed root cause | The outer npx package selector leaked through `buildCodexRuntimeEnv`, then `CodexAcpBridge` refilled the deleted key by merging `process.env` before spawn. The readiness handler also treated an ACP `result:error` lacking `exitCode` as success, producing an invalid running transition before the real exit. |
| 4. Diagnostic strategy | Trace UI -> backend health -> Daemon control plane -> workspace lifecycle -> ACP child stderr; reproduce the suspected environment boundary with one variable; compare success/error ACP event shapes and backend status mapping. |
| 5. Timeout strategy | If focused environment and readiness regressions do not explain the captured `127` flow within one TDD cycle, stop implementation and return to trace-level investigation instead of adding heartbeat or frontend changes. |
| 6. Warning strategy | Any need to change the ACP package version, database schema, frontend state, or more than one independent heartbeat ordering rule indicates scope drift. Three failed repair attempts require architecture review. |
| 7. User-visible correction | Failed ACP startup remains visibly offline/exited instead of briefly online, while a correctly configured packaged Daemon can start Codex and receive messages. |
| 8. Acceptance | RED/GREEN tests cover selector removal and explicit-success readiness; a disposable process exits `127` without a running heartbeat; successful ACP tests and an isolated packaged nested-npx check pass. |

## 1. Reporter

Reported by the project operator during manual use of the native development UI on 2026-08-03. The issue was intermittent from the UI perspective but deterministic at the ACP launch boundary.

## 2. Reproduction

1. Launch the packaged SmallKhoj Daemon via its downloaded npm tarball.
2. Start a Codex workspace using the default ACP launcher.
3. The Daemon launches nested `npx -y @zed-industries/codex-acp@0.16.0`.
4. Observe that the child resolves the outer Daemon package selector and exits `127` instead of starting ACP.
5. Observe a transient ready/running report followed by `exited`, and a subsequent message being skipped.

Expected: nested npx honors the explicit ACP package argument; failed startup never becomes ready.

Actual: the inherited outer selector wins, ACP exits, and readiness briefly lies.

### Runtime preflight snapshot

```text
PORT=55862
PID=95217
START_TIME=Mon Aug 3 18:25:06 2026
HEAD=5e39aa3 chore(task): archive 08-03-smallkhoj-cleanup-skill
TARGET_COMMIT=not-created-yet (pre-fix planning snapshot)
PROCESS_AFTER_TARGET=not-applicable
LOG_EVIDENCE=Daemon control API reachable; trace captured repeated ACP exit 127 and skipped delivery
```

This snapshot identifies the observed runtime only; it does not claim the packaged process contains the current repository HEAD.

## 3. Root-cause analysis

- Frontend and backend availability ruled out a page-data-volume bottleneck as the direct failure.
- The ACP stderr and exit code localized the break between the Daemon and ACP child.
- Environment tracing showed the outer npx selector crossing into the child.
- A one-variable reproduction confirmed causality.
- A spawned-child RED proved the final bridge merge restored keys deliberately omitted from the sanitized environment.
- Code inspection showed the second defect: `exitCode === undefined || exitCode === 0` treated an error result without process-exit metadata as success.
- Backend inspection confirmed `exited` already maps to member `offline`; the contradictory member state was produced by the invalid earlier running update.

## 4. Repair

Remove the outer package-selection variable at the Codex child boundary, make an explicitly supplied bridge env authoritative, and require explicit ACP result success for readiness. Preserve unrelated npm settings and the existing ACP package/version. Use the existing exit event as process-lifecycle truth; the regression turned green without a backend change.

Rejected alternatives:

- Upgrade ACP now: changes compatibility without addressing unsafe environment inheritance.
- Clear every npm variable: would break legitimate registry/proxy configuration.
- Patch only the generated outer command: misses other supported npx invocation paths.
- Force member offline in the frontend: hides server/runtime truth instead of repairing it.

## 5. Verification

Completed evidence:

- Environment RED: selector remained `/tmp/smallkhoj-daemon.tgz`; GREEN: both selector casings absent while `npm_config_registry` remained.
- Bridge RED: child observed `/tmp/outer-smallkhoj-daemon.tgz`; GREEN: explicit-env child observed neither selector.
- Lifecycle RED: workspace states were `starting, running, exited`; GREEN: `starting, exited`, no running agent heartbeat, exit code `127` retained.
- TypeScript build passed; focused ACP and lifecycle tests passed; Integration Gate contracts passed `39/39`; backend Daemon-control tests passed `54/54`.
- The final full Daemon suite passed `284/286` and exited 1 only for two pre-existing package-version fixture assertions (`0.2.2` expected vs `0.2.3` actual); both were reproduced on unmodified `main@b97ea3a`, and no task-related regression failed.
- A worktree-built `@smallkhoj/smallkhoj-daemon@0.2.3` tgz was extracted in `/tmp`; its packaged `dist` removed the outer tgz selector and initialized real `@zed-industries/codex-acp@0.16.0` with a child PID.
- PID `95217`, native ports, protected host PostgreSQL, Docker/SSH stacks, and cloud deployment were not changed.

Sanitized command/result details are stored in the task evidence file.
