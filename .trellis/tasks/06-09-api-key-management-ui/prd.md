# api key management ui

## Goal

Add human-facing API key management for machine/agent/admin tokens with safe display, rotation, revocation, and audit visibility.

## Requirements

* Inventory existing API key/token models and endpoints.
* Show token prefixes and metadata, never full stored secrets.
* Support create/rotate/revoke where backend allows.
* Distinguish connect tickets, machine tokens, agent tokens, and human/admin keys.
* Add safety copy and confirmation for destructive actions.

## Acceptance Criteria

* [ ] API key list shows prefixes, type, owner, created/revoked state.
* [ ] New secret is shown only once when created.
* [ ] Revocation/rotation updates backend state.
* [ ] Browser never leaks machine token via URL.

## Real Test SOP

Use marker `REAL_api_keys_<timestamp>`.

1. Create or rotate a marker key if supported.
2. Verify one-time display behavior.
3. Refresh and verify only prefix remains.
4. Revoke key and verify API/DB state.
5. Save evidence.

## Context

* Backend spec: `.trellis/spec/backend/runtime-slock-integration.md`
* Computers onboarding task: `.trellis/tasks/06-09-daemon-packaged-onboarding/prd.md`
