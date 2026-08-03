# Fix Codex ACP nested npx exit 127

## Goal

Make a Codex Agent launched by the packaged SmallKhoj Daemon start reliably when the Daemon itself was invoked through `npx`, and ensure a failed ACP startup is never exposed as a ready/online runtime.

## Background

- The reported `Computer -> Member` failure was reproduced against the native development stack. `:3000` and `:8000` remained HTTP healthy; the failing component was the member's Codex ACP child runtime.
- The active packaged Daemon was version `0.2.3`. Its outer launcher inherited `npm_config_package=<smallkhoj-daemon.tgz>`, then attempted to start Codex ACP with `npx -y @zed-industries/codex-acp@0.16.0`.
- `buildCodexRuntimeEnv` currently clones the complete parent environment. The nested `npx` therefore interpreted the outer `npm_config_package` value, downloaded the Daemon tarball again, and failed with exit code `127` and `No such file or directory` for the requested ACP package.
- A minimal shell reproduction with the inherited variable produced the same exit code and error. Removing only that variable allowed `npx` to resolve the requested ACP package normally.
- The ACP driver emitted `type: result, subtype: error` before the child exit. The Daemon readiness handler treated a missing `exitCode` as success, briefly issuing `running/online` heartbeats before the authoritative `exit(127)`. This explains the observed `workspace=exited` plus `member=online` mismatch and the later `Runtime delivery skipped because target runtime is not running` message.
- The existing backend workspace upsert already maps `stopped`, `offline`, and `exited` workspaces to an offline member. The defect is the false running transition emitted before failed startup, not missing status mapping in the backend.

## Requirements

### R1. Nested launcher environment isolation

- Codex runtime children must not inherit the outer npx package-selection control variable in lowercase or uppercase form (`npm_config_package` / `NPM_CONFIG_PACKAGE`).
- Preserve unrelated npm settings such as registry, proxy, cache, and certificate configuration; this is a targeted collision fix, not a broad `npm_config_*` purge.
- Preserve all existing Slock wrapper, provider, PATH, model, and custom command behavior.

### R2. Fail-closed Codex ACP readiness

- A Codex ACP `result` event may mark warmup complete only when it explicitly reports `subtype: success`.
- `subtype: error`, `subtype: cancelled`, a missing subtype, or a missing numeric exit code must not make the runtime ready.
- Successful ACP session creation/loading remains a valid readiness signal under the existing contract.

### R3. Failed-start lifecycle truth

- When the ACP child exits non-zero before session readiness, the Daemon must retain the real exit code in its exit trace/lifecycle report.
- The failed runtime must never emit a `running` workspace or agent heartbeat for that startup generation.
- The final reported workspace state must be non-running (`exited` for unexpected exit), allowing the existing backend contract to leave the member offline.
- A message arriving after the failed startup must not be represented as delivered to a runtime that no longer exists.

### R4. Compatibility and scope control

- Keep `@zed-industries/codex-acp@0.16.0` in this repair. Upgrading to the replacement ACP package is a separate compatibility task.
- Preserve Windows `npx.cmd`, configured runtime commands/arguments, session resume, and successful ACP startup behavior.
- Do not change frontend navigation, database schema, Docker, release configuration, provider credentials, or the shared running Daemon as part of the code change.

### R5. Regression evidence

- Follow Red-Green-Refactor: first add a focused test that fails because the package selector leaks, then a focused test that fails because an ACP error result is accepted as ready.
- Add or extend a Daemon lifecycle regression proving a pre-session non-zero ACP exit produces no running heartbeat and does produce an exited lifecycle state.
- Run the focused Daemon build/tests plus the project Integration Gate contract baseline before and after the implementation.
- Validate the packaged/nested-npx path only in an isolated candidate. Replacing or restarting the shared Daemon requires separate explicit user authorization.

## Acceptance Criteria

- [ ] AC1 — A Codex child environment created from a parent containing lowercase and uppercase package selectors contains neither selector while preserving unrelated npm configuration. (R1)
- [ ] AC2 — Codex ACP readiness accepts an explicit successful result/session and rejects error, cancelled, or structurally incomplete result events. (R2)
- [ ] AC3 — A pre-session ACP process exit with code `127` is traced/reported as failed, never produces a running heartbeat, and leaves the lifecycle payload in `exited`/offline truth. (R3)
- [ ] AC4 — Existing successful ACP session, prompt, usage, Windows launcher, custom command, and resume tests remain green. (R4)
- [ ] AC5 — Focused Daemon tests, TypeScript build, and Integration Gate contract tests pass from the task worktree. (R5)
- [ ] AC6 — An isolated packaged/nested-npx verification starts ACP without the outer Daemon tgz overriding the requested ACP package; no shared service, protected database, or cloud environment is mutated. (R5)

## Out of Scope

- Migrating from the deprecated `@zed-industries/codex-acp` package.
- Deploying a new Daemon artifact, pushing `main`, or restarting PID `95217`.
- General ordering/versioning for every possible concurrent runtime heartbeat beyond the reproduced false-readiness path.
- Investigating unrelated Next development latency, Turbopack cache behavior, or resource cleanup.

## Planning Status

No unresolved product decision blocks implementation. The user explicitly asked to begin the repair and create this Trellis task. The implementation must still satisfy the Git/worktree synchronization gate before source edits.
