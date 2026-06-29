# Server/account membership foundation validation

Date: 2026-06-29

## Scope

This validation records the current release-critical Server/account foundation after the Better Auth/server-switcher work landed.

The initial release does not implement the full invite acceptance flow. It does prove real browser accounts, default Server provisioning, create-second-Server testing, active Server switching, and selected-Server API scoping.

## Evidence sources

- Backend tests: `backend/tests/test_server_account_membership.py`
- Frontend request-scope tests: `frontend/test/control-plane-server-scope.test.ts`
- Better Auth/server-switcher evidence: `.trellis/tasks/06-29-initial-release-better-auth-server-switcher/evidence/two-account-server-computer-validation.md`
- Daemon distribution/Computer workspace evidence: `.trellis/tasks/archive/2026-06/06-29-06-29-initial-release-daemon-distribution-versioning/evidence/daemon-distribution-validation.md`

## Validation commands

```bash
rtk .venv/bin/python -m pytest tests/test_server_account_membership.py tests/test_daemon_control.py tests/test_daemon_command_generation.py -q
rtk npx tsx --test frontend/test/control-plane-server-scope.test.ts frontend/test/computer-navigation.test.ts
rtk python3 scripts/initial_release_deploy_preflight.py --root . --json
```

Latest results in this session:

- Backend daemon/server membership scope tests: 67 passed.
- Frontend active Server/computer navigation tests: 6 passed.
- Deployment preflight: ready=true, 13 checks passed, 0 failures, 0 warnings.

## Covered release foundation

- `server_memberships` and `server_invites` are declared and created by startup seed DDL.
- Existing accounts are backfilled from `accounts.server_id` / `accounts.member_id`.
- Better Auth bridge creates or reuses one personal Server, owner membership, and human member per user.
- `/api/v1/auth/me` serialization includes all active memberships needed by the switcher.
- A logged-in user can create a second Server through product UI and switch active Server state.
- Frontend request helpers attach `X-Server-Id` from active Server cookie or explicit server-side caller input.
- Authenticated public routes under this task resolve active Server context instead of selecting the first/default Server.
- Private channel access denies non-members.
- Computer connect commands and Agent creation are scoped to the selected Server and require owner/admin where release-critical.
- Daemon connect/register remains scoped by connect ticket or machine token Server.

## Deferred follow-up

Full invite acceptance is intentionally deferred. The schema has `server_invites`, but the initial release path does not need a complete invite admin/join UX to validate the Feishu/Jira product loop. A follow-up should add:

- create invite endpoint and UI;
- accept invite/join endpoint and UI;
- optional channel assignment;
- expiry/revocation;
- audit events and tests;
- integration with later GitHub login and WeChat scan login providers.
