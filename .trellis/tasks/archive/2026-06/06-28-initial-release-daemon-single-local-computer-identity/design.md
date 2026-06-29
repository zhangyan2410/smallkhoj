# Initial release daemon single local computer identity design

## Current Behavior

`connect_daemon()` in `backend/routers/agent_api.py` currently resolves a `Computer` in this order:

1. look up by `(server_id, machine_id)`;
2. independently look up by `(server_id, requested_name)`;
3. if the same-name row is not the same row as the machine-id row, return `409`.

That protects uniqueness, but it fails the release reconnect case where a daemon lost or regenerated local `machineId` while the backend still has an offline `Computer` named `Mac-mini.local`.

## Desired Behavior

Resolve the connect target as:

1. exact `machine_id` match wins;
2. if there is no exact machine match, same-name offline row can be adopted by this connect;
3. same-name active row is still a conflict;
4. a resolved/adopted row with active lease remains a conflict;
5. new row is created only when neither machine id nor reusable same-name row exists.

Adoption means updating the existing row's `machine_id`, host metadata, runtime snapshot, machine token, daemon id, lease, and heartbeat. The unique partial index on `(server_id, machine_id)` remains the database-level guard against accidental duplication.

## Non-Goals

- Do not create multiple `Computer` rows for one local hostname.
- Do not allow an active daemon lease to be taken over without an explicit reconnect/release path.
- Do not infer physical identity from OS alone.
- Do not add a new database table or migration framework.

## Risk

Computer `name` is not a perfect physical identity. The release tradeoff is acceptable only for offline rows because the current product already treats the local machine name as the operator-visible identity. Active rows remain protected by lease checks.
