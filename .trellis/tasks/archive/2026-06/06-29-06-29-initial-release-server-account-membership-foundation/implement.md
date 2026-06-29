# Implementation plan

## Phase 1: Backend membership foundation

1. Add `server_memberships` and `server_invites` tables in models/seed migration path.
2. Add service helpers:
   - resolve account from session;
   - list memberships;
   - resolve active Server for account;
   - require role;
   - create/join invite.
3. Backfill memberships for existing accounts.
4. Keep `Account.server_id/member_id` as compatibility mirror.

## Phase 2: API migration

1. Add server APIs: list/create/current/join/invite.
2. Replace authenticated public `_get_server()` usage with active-Server resolution.
3. Keep daemon/machine auth paths scoped by ticket/token Server.
4. Add tests for cross-Server isolation.

## Phase 3: Product UI

1. Add onboarding branch after login:
   - create Server;
   - join Server;
   - select Server.
2. Add compact Server context/switcher in app shell.
3. Gate Computer connect and Agent creation behind owner/admin role.
4. Keep channel/chat UI server-scoped.

## Phase 4: Capacity and safety gates

1. Add page-size/limit checks where missing for messages/events.
2. Add file upload size guard if missing.
3. Add operational runbook entries for DB backup, log retention, and Docker cleanup.
4. Re-run deployed smoke and resource snapshot after enabling real multi-user chat.

## Validation

- Backend unit tests:
  - account creates first Server;
  - account joins existing Server through invite;
  - active Server cannot be selected without membership;
  - channel/message routes are scoped to active Server;
  - private channel access is denied to non-members;
  - Computer connect command is created under selected Server;
  - Agent creation is scoped to selected Server.
- Frontend `./twd` evidence:
  - login -> create Server -> enter channel;
  - invite/join path;
  - Server context visible in shell;
  - Computer/Agent creation inside selected Server.
- Deployment:
  - `post_deploy_smoke.py` still green;
  - resource snapshot after a small multi-user chat run.
