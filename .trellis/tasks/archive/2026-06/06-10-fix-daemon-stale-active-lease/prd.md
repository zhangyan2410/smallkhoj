# fix daemon stale active lease

## Goal

Prevent stale active daemon leases after a local daemon exits so reconnects do not fail with `409 Computer already has an active daemon`, and the Computers page reflects offline/stopped status promptly.

## Requirements

* Add a backend daemon shutdown lifecycle endpoint authenticated by the machine token.
* On shutdown, only release the lease for the reporting daemon id.
* Mark the computer offline, clear active daemon id, expire the lease, and mark runtime workspaces stopped/offline.
* Make aaa-daemon call shutdown during graceful stop before exiting.
* Keep hard-kill behavior bounded by existing lease expiry fallback.

## Acceptance Criteria

* [x] Graceful daemon stop calls backend shutdown.
* [x] Backend shutdown releases active daemon state and workspace/agent status.
* [x] Existing register/heartbeat/connect behavior remains intact.
* [x] Focused backend and daemon checks pass.

## Technical Notes

* Backend lifecycle code: `backend/routers/agent_api.py`.
* Daemon lifecycle code: `agent/daemon/aaa-daemon/src/daemon/daemon.ts`.
