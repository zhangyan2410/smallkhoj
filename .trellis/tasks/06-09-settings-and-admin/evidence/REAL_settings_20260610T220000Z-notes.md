# REAL_settings_20260610T220000Z

## Scope

Verified Settings/Admin route with account/server, runtime defaults, API key management, safety controls, and admin links.

## Evidence

* Screenshot: `REAL_settings_20260610T220000Z-01-settings-admin.png`
* WebDriver assertions:
  * account visible: `Real Tester`
  * server visible: `Slock Server`
  * API Keys section visible
  * revoke confirmation visible
  * Daemon Onboarding link visible
* Persisted setting path: API key create/revoke persists to `api_keys` and survives list refresh.

## Quality Gates

* `cd frontend && npm run lint`
* `cd frontend && npm run build`
* backend API key create/list/revoke smoke passed against the local API.
