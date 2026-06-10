# skip workspace heartbeat event records

## Goal

Stop persisting daemon workspace heartbeat activity as `EventRecord(event_type="workspace.heartbeat")` because heartbeat noise does not need to enter the durable event stream.

## Requirements

* Keep daemon heartbeat status updates working.
* Keep `ActivityLog(kind="workspace_heartbeat")` behavior unchanged.
* Do not create `EventRecord` rows for workspace heartbeats.
* Preserve `workspace.registered` and `workspace.updated` event records.

## Acceptance Criteria

* [x] `workspace_heartbeat` is not mapped to an event record type.
* [x] A focused test guards that `workspace_heartbeat` is not event-producing.
* [x] Backend compile/import checks pass.
