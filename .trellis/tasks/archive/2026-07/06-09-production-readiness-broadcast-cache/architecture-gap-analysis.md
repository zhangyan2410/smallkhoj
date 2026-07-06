# Production Readiness Broadcast/Cache Gap Analysis

## Current Single-Process Assumptions

* `DaemonControlHub` stores WebSocket peers in process memory.
* Runtime lifecycle commands delivered through `daemon_control_hub.push()` only reach daemons connected to the same backend process.
* `push_latest_events_for_server()` can only push to WebSocket peers visible in the current process.
* Event durability is handled by `event_records`, but live fanout and control command delivery are process-local.

## Required Production Shape

* Keep `event_records` as the durable source of truth.
* Add Redis pub/sub, Postgres `LISTEN/NOTIFY`, or equivalent broadcast for:
  * daemon control commands
  * event fanout invalidation
  * activity/task/message notification wakeups
* Add a small cache/coordination layer for connected computer presence:
  * key: `server:{serverId}:computer:{computerId}:connections`
  * TTL refreshed by heartbeat/WebSocket presence
  * local process still keeps actual socket handles
* On write:
  * commit DB rows first
  * publish `{serverId, computerId?, eventSeq?, command?}`
  * every process decides whether it owns a matching socket and pushes if so

## Testable Multi-Instance Behavior

Simulated test plan:

1. Start backend A on `8000`, backend B on `8001`, same database.
2. Connect daemon WebSocket to backend A.
3. Send message/task/lifecycle command to backend B.
4. Verify backend B writes durable rows and publishes broadcast.
5. Verify backend A receives broadcast and pushes to daemon.
6. Kill Redis/broadcast and verify local single-process dev still works with direct in-process hub.

## Local Development

Default local development remains simple:

* no Redis required
* `DaemonControlHub` remains the in-process implementation
* broadcast backend is opt-in through environment configuration

## Rollout

* Phase 1: introduce broadcast interface with in-memory implementation.
* Phase 2: add Redis implementation behind env flag.
* Phase 3: multi-instance smoke in CI using two uvicorn ports and one Redis.
* Rollback: disable Redis env flag; durable DB rows remain valid and polling/heartbeat paths continue to work.

## Evidence

This task specifies the required backend changes rather than implementing Redis in the product-maturity pass. The behavior is testable with the six-step simulated multi-instance plan above.
