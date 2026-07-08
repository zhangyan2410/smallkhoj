# runtime lifecycle controls

## Goal

Add product controls and backend support for runtime stop, restart, kill, and status reconciliation.

## Requirements

* Identify current backend/daemon support for lifecycle commands.
* Add UI controls on Computers/Member agent detail where supported.
* Add backend/daemon commands for missing stop/restart/kill paths if needed.
* Reconcile workspace status after command execution.
* Prevent unsafe controls when daemon is offline.
* Show clear stopped/failed/won't receive messages explanations.

## Acceptance Criteria

* [x] Runtime controls are visible with correct enabled/disabled states.
* [x] At least one lifecycle action is verified end-to-end.
* [x] Workspace status updates after action.
* [x] Offline daemon case is handled with a useful message.

## Real Test SOP

Use marker `REAL_runtime_lifecycle_<timestamp>`.

1. Select a running agent workspace.
2. Trigger stop or restart.
3. Verify UI state, API workspace state, and `smallkhoj-trace`.
4. Send a marker message after restart if applicable.
5. Save evidence.

## Context

* Computers task: `.trellis/tasks/06-09-computers-product-detail/prd.md`
* Runtime spec: `.trellis/spec/backend/runtime-slock-integration.md`
