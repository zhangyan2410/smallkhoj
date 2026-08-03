# Design: Codex ACP nested npx startup isolation

## Problem statement

A process-local launch option used by the outer `npx` invocation crosses an ownership boundary into a second `npx` invocation. The nested launcher then selects the wrong package. The startup error is compounded by a readiness predicate that treats absent error metadata as success.

## Current data flow

```text
outer npx --package=<daemon.tgz>
  -> SmallKhoj Daemon process.env (npm_config_package=<daemon.tgz>)
  -> startRuntimeForAgent copies process.env into baseEnv
  -> buildCodexRuntimeEnv clones baseEnv
  -> CodexAcpBridge spawns npx -y @zed-industries/codex-acp@0.16.0
  -> nested npx selects <daemon.tgz> from inherited config
  -> ACP bridge closes / child exits 127
  -> ACP result:error has no exitCode
  -> Daemon incorrectly marks runtime ready/running
  -> asynchronous running and exited updates race
```

## Proposed boundaries

### 1. Sanitize the child environment at the runtime boundary

`buildCodexRuntimeEnv` is the single environment builder used immediately before Codex CLI/ACP child spawn. Remove only:

- `npm_config_package`
- `NPM_CONFIG_PACKAGE`

The requested ACP package remains explicit in `resolveCodexAcpLaunchCommand().args`, so the inherited package selector has no legitimate authority in the child. Other npm settings remain available for private registries, proxies, caches, and TLS.

This is preferable to changing the generated outer launch command: external users may invoke the Daemon through npm/npx in several supported ways, while the child boundary is centralized and testable.

### 2. Make readiness semantic, not absence-based

For Codex ACP result events, readiness requires both:

```text
event.type === "result"
event.subtype === "success"
```

Do not infer success from a missing `exitCode`. ACP prompt-result events and process-exit events are separate contracts; the latter owns the numeric exit code. Session creation/loading remains an independent positive readiness signal.

The implementation may extract a small pure predicate if that makes the negative matrix directly testable. It must not add an artificial exit code to an ACP error event when the bridge has not yet supplied one.

### 3. Preserve lifecycle ownership

The existing driver `exit` event remains the source of truth for process termination. `startRuntimeForAgent` already sets `runtime.status = exited`, snapshots that runtime in the Daemon lifecycle heartbeat, and only then removes it from the runtime map.

The primary status fix is to prevent the false running write. A direct stopped/offline heartbeat may be added only if the new lifecycle regression demonstrates that the existing exit snapshot cannot converge the backend; no backend status-precedence redesign is planned in this task.

## Compatibility

- Default package and command arguments are unchanged.
- Windows continues to resolve `npx.cmd`.
- Custom non-npx commands receive the same runtime environment except for the two outer-launch selector keys, which are explicitly not child-runtime configuration.
- No API schema, database migration, frontend contract, or persisted runtime record shape changes.
- Packaged Daemons need to be rebuilt/reinstalled to receive the fix; local source tests cannot prove a currently running `0.2.3` instance has changed.

## Test design

1. Environment unit regression:
   - seed both selector casings plus an unrelated npm registry variable;
   - assert selectors are absent and registry remains.
2. Readiness negative matrix:
   - error, cancelled, and missing subtype do not pass;
   - explicit success does pass.
3. Daemon lifecycle regression:
   - launch a disposable fake ACP command that exits `127` before session creation;
   - capture Daemon lifecycle and agent-heartbeat requests;
   - assert no running state was sent for the failed generation and an exited state with the real code appears in trace/log evidence.
4. Existing successful ACP integration remains the positive end-to-end control.
5. Isolated packaging verification recreates the outer-selector environment without using the shared Daemon or protected database.

## Operational safety and rollback

- Development occurs in a sibling worktree after `main` is synchronized with `origin/main`.
- The shared PID `95217`, native `:3000/:8000`, SSH-owned `:38190/:38191`, host PostgreSQL `:5432`, and cloud environment are read-only for this task unless the user grants additional authority.
- Rollback is a normal revert of the Daemon commit; there is no data migration or persisted format change.
