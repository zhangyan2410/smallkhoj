# Initial release daemon websocket deploy smoke

## Goal

Extend the post-deploy smoke gate so production URL validation proves the daemon WebSocket reverse-proxy path reaches the backend without requiring real daemon credentials.

The previous local production compose smoke proved Caddy can serve frontend, `/api/health`, `/docs`, and `/openapi.json`. The release gate also requires daemon WebSocket routing under `/internal/agent-api/ws`, because deployed daemons must connect through the public server URL.

## Requirements

- Keep the smoke command read-only and no-secret.
- Do not use real machine tokens or connect tokens in post-deploy smoke.
- Probe `/internal/agent-api/ws` with a WebSocket upgrade request and no `Authorization` header.
- Treat an authentication/authorization rejection as success, because it proves the Caddy route reached the daemon endpoint while preserving auth.
- Treat `101 Switching Protocols` without credentials as failure.
- Treat `404`, `502`, TCP/TLS errors, or malformed handshake responses as failure.
- Keep existing frontend, health, docs, and OpenAPI checks unchanged.
- Document the new daemon WebSocket route check in the deployment runbook and backend deploy spec.

## Acceptance Criteria

- [x] `scripts/post_deploy_smoke.py` reports a daemon WebSocket route/auth check.
- [x] Unit tests cover a successful no-auth daemon WebSocket rejection and an unsafe no-auth `101` response.
- [x] Existing post-deploy smoke tests still pass.
- [x] Production deployment docs mention the no-secret daemon WebSocket smoke semantics.
- [x] Local production compose smoke verifies the new check through Caddy.

## Notes

- Existing spec already forbids opening daemon WebSocket in smoke with a real machine token; daemon validation with real credentials belongs to the daemon reconnect/live-run gate.
- This task is PRD-only because it is a contained script/test/docs change.
- Local production compose evidence: `post_deploy_smoke.py --base-url http://127.0.0.1:18080 --allow-http --timeout 10 --json` returned `ready: true`, `failures: 0`, and `ws.daemonAuth` passed with status `403` for `ws://127.0.0.1:18080/internal/agent-api/ws`.
- Validation: deployment script test suite passed with 22 tests.
