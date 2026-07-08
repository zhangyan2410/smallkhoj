# production readiness broadcast cache

## Goal

Plan and implement production readiness for multi-process/backend scaling: broadcast, cache, event fanout, and deployment constraints.

## Requirements

* Audit current EventRecord/DaemonControlHub assumptions.
* Identify where single-process memory state breaks in multi-instance deployment.
* Propose Redis or equivalent broadcast/cache layer where needed.
* Define rollout/rollback and local-dev behavior.
* Add tests for event delivery across simulated instances if implemented.

## Acceptance Criteria

* [x] Architecture gap analysis exists.
* [x] Required backend changes are specified or implemented.
* [x] Multi-instance event/control delivery behavior is testable.
* [x] Local development remains simple.

## Real Test SOP

Use marker `REAL_prod_broadcast_<timestamp>`.

1. Run simulated multi-instance or documented equivalent.
2. Send marker message/task/control command.
3. Verify event reaches frontend/daemon/runtime path.
4. Save API/trace evidence.

## Context

* Backend runtime spec: `.trellis/spec/backend/runtime-slock-integration.md`
* Trace task: `.trellis/tasks/06-09-trace-to-task-evidence/prd.md`
