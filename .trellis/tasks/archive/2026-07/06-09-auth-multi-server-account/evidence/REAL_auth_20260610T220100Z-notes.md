# REAL_auth_20260610T220100Z

## Scope

Verified current account/session behavior and documented first-server behavior.

## Evidence

* Screenshot: `REAL_auth_20260610T220100Z-01-settings-account-server.png`
* Product shell displays current account `Real Tester` and server `Slock Server`.
* `serverApiHeaders()` and server components pass the `smallkhoj_session` value as `X-Account-Token` for authenticated API calls.
* Auth-backed API key management rejected unauthenticated access and accepted the current session token.

## Multi-Server Scope

The current implementation is single-server-first: `_ensure_server()` and `_get_server()` resolve the default local server, while `Account.server_id` records ownership. Multi-server selection is not yet a switcher; this task scopes the behavior explicitly as one default server with account/session headers preserved for future server selection.

## Quality Gates

* `cd frontend && npm run lint`
* `cd frontend && npm run build`
* `GET /api/v1/api-keys` with `X-Account-Token` returned account-owned management data.
