# Initial release local production compose smoke

## Goal

Prove that the production Docker Compose stack can be built, started, and smoked locally before uploading the release bundle to Tencent Cloud Lighthouse.

This task specifically de-risks the current deployment stream: the release already has a production compose file, Caddy reverse proxy, preflight scripts, post-deploy smoke script, and no-secret bundle. The missing proof is that the actual production stack can run end-to-end outside the dev servers.

Network access for external registries must go through the local VPN proxy. Host commands use `127.0.0.1:7897`; Docker build containers use `host.docker.internal:7897`.

## Requirements

- Keep production defaults unchanged: public deployments still bind Caddy to host ports `80` and `443` by default.
- Allow local smoke runs to override host ports so the test does not require privileged ports or conflict with local services.
- Keep Caddy's container ports and route contract stable: frontend on `frontend:3000`, backend API/internal/docs on `backend:8000`.
- Build or run images through the VPN proxy when network access is needed.
- Run the production compose stack with a temporary no-secret env file and local-only host ports.
- Smoke the local stack through the same post-deploy smoke script used for a real host.
- Tear down containers and volumes after validation.
- Do not commit real deployment secrets or generated local env files.

## Acceptance Criteria

- [x] `docker-compose.prod.yml` supports local host-port overrides while defaulting to `80:80` and `443:443`.
- [x] Deployment preflight accepts the port-override compose contract and still verifies the Caddy/backend/frontend deployment markers.
- [x] Deployment docs explain local production compose smoke and the required VPN proxy variables.
- [x] Script tests cover the updated preflight contract.
- [x] A local production compose smoke run either passes, or fails with a concrete blocker and captured command evidence.

## Notes

- Direct Docker Hub access timed out locally, while `HTTPS_PROXY=http://127.0.0.1:7897 curl -I https://registry-1.docker.io/v2/` returned the expected registry authentication response.
- The first implementation slice is small enough to remain PRD-only.
- Local production smoke passed on `http://127.0.0.1:18080` after building `smallkhoj-backend:local-smoke`, `smallkhoj-frontend:local-smoke`, and `smallkhoj-caddy:local-smoke`.
- Smoke evidence: `post_deploy_smoke.py` reported `ready: true`, `failures: 0`, with frontend root, `/api/health`, `/docs`, and `/openapi.json` all passed through Caddy.
- When running immediately after `docker compose up -d`, a TCP check can race Caddy startup; a short wait before `post_deploy_smoke.py` avoids false negatives.
- Docker Desktop bind mounts in this environment showed stale/incorrect file views for Caddy config paths, so production Caddy now bakes `deploy/caddy/Caddyfile` into a tiny Caddy image instead of relying on a Caddyfile bind mount.
