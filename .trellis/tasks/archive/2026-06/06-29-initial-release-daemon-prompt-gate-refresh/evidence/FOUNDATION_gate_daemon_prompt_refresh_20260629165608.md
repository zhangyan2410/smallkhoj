# Foundation gate daemon/prompt refresh evidence

## Command

```bash
rtk python3 scripts/initial_release_foundation_gate.py --base-url http://124.222.40.40 --allow-http --json
```

## Result

- Exit code: `0`
- Target: `http://124.222.40.40`
- `ready`: `true`
- `failures`: `0`
- `blocked`: `0`
- `warnings`: `0`
- `p0Warnings`: `0`

## New Gate Checks

- `daemon.runtimeWorkspaceContract`: passed, `riskId=FR-03`, `priority=P0`
- `daemon.minimumVersionContract`: passed, `riskId=FR-11`, `priority=P1`
- `prompt.workflowStateContract`: passed, `riskId=PROMPT`, `priority=P1`

## Relevant Existing Proof

- `foundation.riskRegister`: passed from archived foundation task risk register.
- `database.backupRestoreDrill`: passed using archived remote restore evidence.
- `server.accountScopeBackendTests`: passed, `17 passed`.
- `daemon.identityBackendTests`: passed, `7 passed`.
- `taskrun.lifecycleBackendTests`: passed, `6 passed`.
- `smoke.ws.daemonAuth`: passed, unauthenticated daemon WebSocket upgrade rejected with `403`.

## Notes

The gate now searches both the active foundation task path and the Trellis archive path for foundation risk-register and backup/restore evidence. This prevents completed foundation evidence from becoming invisible after `task.py archive`.
