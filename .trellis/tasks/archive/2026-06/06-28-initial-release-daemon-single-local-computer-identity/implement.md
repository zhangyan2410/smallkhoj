# Initial release daemon single local computer identity implementation plan

## Checklist

1. [x] Add backend regression tests for offline same-name adoption and active same-name rejection.
2. [x] Inspect existing daemon connect tests and helper patterns.
3. [x] Update `connect_daemon()` resolution logic without weakening active lease protection.
4. [x] Run targeted backend tests for daemon connect/control.
5. [x] Run full backend tests.
6. [x] Review `/computers` reconnect command path for public URL compatibility.
7. [x] Update task verification notes and archive.

## Implementation Notes

- Backend `connect_daemon()` now resolves in this order: exact `(server_id, machine_id)` match, same-server same-name offline adoption, new row creation. A same-name or same-machine row with an active lease still returns `409 "Computer already has an active daemon"`.
- Adoption updates the existing `Computer.machine_id`, daemon metadata, detected runtimes, machine token, lease, heartbeat, and status. The connect ticket is consumed only after successful connect.
- `/computers` now defaults to the first existing computer detail when no `computer` query is selected.
- `/computers` hides the new computer connect form once any computer identity exists, unless there is a pending generated command cookie to display. Existing rows use the reconnect command path.

## Verification

- `rtk env PYTHONPATH=. uv run pytest tests/test_daemon_control.py -k 'same_name_computer_when_machine_id_changed'` -> 2 passed.
- `rtk env PYTHONPATH=. uv run pytest tests/test_daemon_control.py` -> 44 passed.
- `rtk env PYTHONPATH=. uv run pytest` -> 214 passed.
- `rtk bunx tsx --test test/computer-navigation.test.ts` -> 3 passed.
- `rtk bun run lint` -> passed with 15 existing warnings and no errors.
- `rtk bun run build` -> passed.
- `rtk git diff --check` -> passed.

## Browser Evidence

- Evidence path: `.trellis/tasks/06-28-initial-release-daemon-single-local-computer-identity/evidence/computers-existing-identity-reconnect-authenticated-final.png`.
- `./twd eval` on authenticated `/computers` returned:
  - `hasComputersTitle: true`
  - `hasConnectNew: false`
  - `hasGenerateConnect: false`
  - `hasComputerId: true`
  - `hasMachineId: true`
- Local note: the existing `localhost:8000` backend returned `500` for auth during evidence collection, so the current worktree backend was validated on `127.0.0.1:8017` with the frontend pointed at `INTERNAL_API_BASE_URL=http://127.0.0.1:8017`.
