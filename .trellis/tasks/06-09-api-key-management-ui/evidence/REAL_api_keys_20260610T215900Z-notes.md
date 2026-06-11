# REAL_api_keys_20260610T215900Z

## Scope

Verified human-facing API key inventory, one-time secret creation, and revocation.

## Evidence

* Screenshot: `REAL_api_keys_20260610T215900Z-01-settings-api-keys.png`
* `GET /api/v1/api-keys` showed prefixes, resource types, owners, created time, and revoked state.
* `POST /api/v1/api-keys` created a human key and returned the full `secret` once.
* Follow-up `GET /api/v1/api-keys` returned only `prefix`; `hasSecret:false`.
* The new secret authenticated successfully before revoke: `GET /api/v1/channels` returned `200`.
* `POST /api/v1/api-keys/{id}/revoke` set `revoked:true` and `revokedAt`.
* The same secret returned `401` after revoke.

## Safety

Machine and agent keys are listed by prefix only. Full secrets are never placed in URLs. Revoke controls in Settings require a confirmation checkbox.

## Quality Gates

* `python3 -m py_compile backend/models/slock.py backend/models/seed.py backend/routers/public_api.py`
* `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_daemon_control.py -q`
* `cd frontend && npm run lint`
* `cd frontend && npm run build`
