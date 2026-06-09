# auth multi server account

## Goal

Productize authentication, account identity, and server selection so SmallKhoj can move beyond dev-auth toward real product usage.

## Requirements

* Define account/session model and relation to Server.
* Add login/logout UX and current-account display.
* Add server selection or default server behavior.
* Preserve dev-auth path for local development if needed.
* Protect browser-facing routes consistently.
* Define migration/seed behavior for existing data.

## Acceptance Criteria

* [ ] User can log in/out or dev-auth is explicitly scoped.
* [ ] Current account/server are visible in the app shell.
* [ ] API calls use consistent auth/session headers.
* [ ] Multi-server behavior is specified even if first implementation supports one server.

## Real Test SOP

Use marker `REAL_auth_<timestamp>`.

1. Open app logged out and verify redirect/login state.
2. Log in or dev-auth as marker user.
3. Create marker resource and verify server/account ownership.
4. Save browser/API/DB evidence.

## Context

* Existing task: `.trellis/tasks/06-08-dev-auth-human-member/prd.md`
* Frontend quality: `.trellis/spec/frontend/quality-guidelines.md`
