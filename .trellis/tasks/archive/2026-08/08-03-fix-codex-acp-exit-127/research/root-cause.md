# Root-cause research: Codex ACP nested npx exit 127

## Confirmed causal chain

1. The packaged Daemon is launched by an outer `npx` process with an npm package selector pointing at the downloaded SmallKhoj Daemon tarball.
2. npm exposes that selector to the Daemon as `npm_config_package`.
3. `startRuntimeForAgent` copies `process.env`; `buildCodexRuntimeEnv` copies it again without removing the selector.
4. `buildCodexRuntimeEnv` initially appeared to be the complete child boundary, but `CodexAcpBridge.start()` merged `process.env` back into the sanitized object. An omitted selector was therefore restored before spawn.
5. `CodexAcpBridge` launches `npx -y @zed-industries/codex-acp@0.16.0` with the restored selector.
6. The nested npx resolves the inherited Daemon tarball instead of the requested ACP package and exits `127` with `No such file or directory` for the ACP package specifier.
7. `CodexAcpRuntimeDriver.runPrompt` emits a `result:error` event without an `exitCode`, because prompt-result failure and the later process-exit event are different contracts.
8. `daemon.ts` treats `exitCode === undefined` as successful warmup and emits running/online updates before handling the real exit event.

## Minimal hypothesis check

The following shape reproduced the failure independently of the UI and backend data volume:

```text
npm_config_package=<smallkhoj-daemon.tgz> npx -y @zed-industries/codex-acp@0.16.0 --version
```

Observed result: exit `127` and the same package-resolution error. Removing only `npm_config_package` made npx resolve the requested package normally.

## Code anchors

- Child environment: `agent/daemon/aaa-daemon/src/runtime/codex-runtime.ts:61`
- Final ACP spawn environment: `agent/daemon/aaa-daemon/src/runtime/codex-acp-bridge.ts:121`
- ACP bridge spawn: `agent/daemon/aaa-daemon/src/runtime/codex-acp-runtime.ts:216`
- ACP error result: `agent/daemon/aaa-daemon/src/runtime/codex-acp-runtime.ts:264`
- False readiness: `agent/daemon/aaa-daemon/src/daemon/daemon.ts:1003`
- Exit lifecycle snapshot: `agent/daemon/aaa-daemon/src/daemon/daemon.ts:1278`
- Backend exited/offline mapping: `backend/routers/agent_api.py:1305`

## Pattern comparison

- Working path: a successful ACP create/load emits a `session` event, and a successful prompt emits `result` with `subtype: success`.
- Broken path: bridge startup failure emits `result` with `subtype: error`, then an exit event with the real code.
- The child environment builder already removes Slock launcher-only credential/proxy variables, establishing the correct ownership pattern for removing another launcher-only variable.
- A spawned-child RED test proved that deleting a key in the builder was insufficient while the bridge treated the provided env as an overlay. Explicit child environments must be authoritative for deletion semantics to survive the final spawn boundary.
- Reference projects did not contain an inherited `npm_config_package` scrub. `agent-platform` avoids this exact nested-npx class by preinstalling `codex-acp`; SmallKhoj retains on-demand npx and therefore needs its own boundary guard.

## Scope decision

Do not upgrade ACP or redesign all heartbeat ordering in this task. Eliminate the reproduced invalid environment inheritance and false-positive readiness, then use the lifecycle regression to determine whether any additional exit synchronization is actually required.
