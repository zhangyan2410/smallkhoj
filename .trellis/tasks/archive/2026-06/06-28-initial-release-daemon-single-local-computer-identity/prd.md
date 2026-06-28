# Initial release daemon single local computer identity hardening

## Goal

Make daemon connect/reconnect safe for the 7-15 release by ensuring one physical local machine maps to one SmallKhoj `Computer` record, even after local daemon state is lost, the daemon process is killed, or a branch/test command generated a new local `machineId`.

The user-facing failure this task addresses is:

```text
Daemon connect failed: 409 {"detail":"Computer name Mac-mini.local already exists"}
```

This happens when the backend has an existing offline `Computer` row for the same local machine name, but the connecting daemon presents a different `machineId`. For the initial release this blocks deployment and multi-machine validation because a normal reconnect can look like a duplicate machine.

## Requirements

- `POST /internal/agent-api/daemon/connect` must still prefer the existing `Computer` by exact `(server_id, machine_id)` when the daemon has a known persisted `machineId`.
- When no `Computer` exists for the submitted `machineId`, the backend may reuse a same-server, same-name `Computer` only if that existing row has no active daemon lease.
- Reusing by same name must update the existing row's `machine_id` to the submitted daemon `machineId` before issuing the new machine token.
- A same-name `Computer` with an active lease must still return `409` and must not be hijacked by a new daemon.
- A name collision with a different active/unknown physical machine must remain visible as a conflict; the fix must not remove uniqueness or blindly create duplicate rows.
- The connect ticket must remain one-time-use. Failed conflicts must not consume the ticket; successful reuse must consume it.
- The UI/onboarding behavior must use reconnect for existing computers where possible and must not encourage creating duplicate local computers when one already exists.
- Tests must cover:
  - existing offline same-name computer with different `machineId` is reused;
  - existing active same-name computer with different `machineId` is rejected;
  - existing same `machineId` behavior remains unchanged;
  - connect ticket reuse semantics remain unchanged.

## Acceptance Criteria

- [x] Backend regression tests reproduce the `Computer name Mac-mini.local already exists` failure and prove the offline same-name row is reused instead.
- [x] Backend regression tests prove active same-name rows cannot be hijacked by a different `machineId`.
- [x] Existing daemon connect tests still pass.
- [x] `/computers` reconnect command remains the preferred path for an existing row.
- [x] The change supports deployed daemon reconnect by public `--server https://...` without introducing localhost assumptions.
- [x] Full backend tests pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
