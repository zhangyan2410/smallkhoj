# agent permissions ui and sync

## Goal

Productize agent permissions so humans can view/edit what an agent may do, and agents/runtimes receive the configured policy.

## Requirements

* Render permission groups in the member detail Permissions tab.
* Provide safe edit controls for boolean/scoped permissions.
* Persist permission config through backend member config/profile APIs.
* Sync permission config into daemon/runtime startup or heartbeat payload where backend supports it.
* Clearly document that server-side enforcement may be a later task if not currently implemented.

## Acceptance Criteria

* [x] Agent permissions are visible and editable.
* [x] Refresh preserves edited permission config.
* [x] Runtime/daemon-facing config includes the updated permissions or backend follow-up is created.
* [x] UI communicates enforcement status honestly.

## Real Test SOP

Use marker `REAL_permissions_<timestamp>`.

1. Select an agent.
2. Toggle a permission with marker note if supported.
3. Verify `/api/v1/members` state.
4. Cross-check daemon/runtime config path if affected.
5. Save evidence.

## Context

* Members task: `.trellis/tasks/06-09-members-agent-profile-tabs/prd.md`
* Runtime spec: `.trellis/spec/backend/runtime-slock-integration.md`
