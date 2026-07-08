# Local Prod Daemon Onboarding Evidence - 2026-06-30

## Target

- Environment: `local-prod`
- Base URL: `http://127.0.0.1:18080`
- Entrypoint: Caddy from `docker-compose.prod.yml`
- Images:
  - `smallkhoj-backend:local-release`
  - `smallkhoj-frontend:local-release`
  - `smallkhoj-caddy:local-release`

## Issues Found And Fixed

1. Backend production image did not include `release-artifacts/smallkhoj-daemon`, so the self-hosted daemon tgz would not be available in production.
   - Fixed by building the backend image from repo root with `backend/Dockerfile`.
   - Fixed by copying `release-artifacts/` to `/app/release-artifacts/`.
   - Added preflight coverage: `repo.backend.daemonArtifacts`.

2. Root Docker context was too large after switching backend build context to repo root.
   - Observed context before ignore: `3.451GB`.
   - Added root `.dockerignore`.
   - Observed context after ignore: `82.66MB`.

3. Frontend production Docker build failed because Better Auth env was not present at build time.
   - Error: `BETTER_AUTH_SECRET is required in production`.
   - Fixed with build-time placeholder auth env in the builder stage only.
   - Added preflight coverage: `repo.frontend.buildAuthEnv`.

4. Caddy did not route `/downloads/smallkhoj-daemon/*` to backend, so the public daemon tgz URL returned `404`.
   - Fixed with `@backend_downloads`.
   - Added preflight coverage: `repo.caddy.daemonDownloadsRoute`.

## Real Validation

- `python3 scripts/post_deploy_smoke.py --base-url http://127.0.0.1:18080 --allow-http --json`
  - Result: `ready=true`, `failures=0`.

- `python3 scripts/initial_release_foundation_gate.py --base-url http://127.0.0.1:18080 --allow-http --json`
  - Result: `ready=true`, `failures=0`, `p0Warnings=0`.

- `GET http://127.0.0.1:18080/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.0.tgz`
  - Result: `200 OK`, `Content-Length: 158566`, through Caddy.

- `npx -y http://127.0.0.1:18080/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.0.tgz --version`
  - Result: `0.2.0`.

- Browser signup on `http://127.0.0.1:18080/login`
  - Created a real local-prod account and personal Server.

- Computers UI on `http://127.0.0.1:18080/computers`
  - Generated exactly one command block.
  - Command shape:
    `npx -y http://127.0.0.1:18080/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.0.tgz --server-url http://127.0.0.1:18080 --api-key sk_connect_<redacted> # 真实生产验证的服务器`
  - Visible Server metadata: `真实生产验证的服务器`.

- Executed the UI-generated command with a temporary `HOME`.
  - Daemon output included:
    - `[Daemon] Starting aaa-daemon v0.2.0...`
    - `[Proxy] Listening on http://127.0.0.1:<port>`
    - `[WS] Connecting to ws://127.0.0.1:18080/internal/agent-api/ws?...`
    - `[Daemon] All modules started.`
    - `[WS] Connected`
    - graceful SIGTERM shutdown
  - Negative checks:
    - no `409`
    - no `Account is not a member`
    - no `connect failed`

- Computers UI after daemon run:
  - Shows `真实生产电脑`.
  - Shows daemon version `0.2.0`.
  - Shows detected runtimes `Claude Code / available` and `Codex / available`.

Screenshot:

- `evidence/local-prod-computer-created-after-caddy-npx.png`

## Cleanup

- Stopped `skh-local-prod` compose stack.
- Removed local-prod volumes.
- Removed temporary env file from `/tmp`.
- Confirmed no Docker containers remained running.

## Cloud Read-Only Check

- Target: `cloud-prod`
- Base URL: `http://124.222.40.40`
- Action: read-only smoke, no deployment and no server mutation.

Result before deploying these fixes:

- `python3 scripts/post_deploy_smoke.py --base-url http://124.222.40.40 --allow-http --json`
  - Result: `ready=false`, `failures=1`.
  - Failing check: `http.daemonPackage`.
  - Details: `/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.0.tgz` returned `404`.

- `python3 scripts/initial_release_foundation_gate.py --base-url http://124.222.40.40 --allow-http --json`
  - Result: `ready=false`.
  - Risk failed: `FR-06`.
  - Failing check: `smoke.http.daemonPackage`.

This means cloud currently has the older deployment shape. The local-prod fix must be deployed before cloud-prod daemon onboarding can be considered verified.

## Cloud Deployment And Real Validation

- Target: `cloud-prod`
- Base URL: `http://124.222.40.40`
- Host: Tencent Lighthouse `x86_64`
- Compose project: `smallkhoj-prod`
- Compose path: `/home/ubuntu/smallkhoj-deploy/smallkhoj-deploy/docker-compose.prod.yml`

Deployment notes:

- Local `linux/amd64` frontend build failed under Apple Silicon QEMU with `SIGKILL` during Next TypeScript/build.
- Remote server is native `x86_64`, so frontend image was built on the server from a synced source tree.
- Backend and Caddy images were loaded from a local amd64 image archive stored under `/Volumes/ORICO/smallkhoj-deploy/`.
- The remote `.env.prod` was missing newly required auth env keys; missing keys were added with generated secret values without printing the values.
- Temporary remote source/archive were removed after deployment, and Docker image/build cache was pruned.

Deployed image ids:

- `smallkhoj-backend:local-release` -> `sha256:a61284efea69...`
- `smallkhoj-frontend:local-release` -> `sha256:00b62d9a895...`
- `smallkhoj-caddy:local-release` -> `sha256:98a013c5cbbc...`

Cloud validation after deployment:

- `python3 scripts/post_deploy_smoke.py --base-url http://124.222.40.40 --allow-http --json`
  - Result: `ready=true`, `failures=0`.
  - `http.daemonPackage`: `200`, `bytesRead=158566`, `contentType=application/x-tar`.

- `python3 scripts/initial_release_foundation_gate.py --base-url http://124.222.40.40 --allow-http --json`
  - Result: `ready=true`, `failures=0`, `p0Warnings=0`.
  - `FR-06`: passed, including `smoke.http.daemonPackage`.

- `npx -y http://124.222.40.40/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.0.tgz --version`
  - Result: `0.2.0`.

- Browser UI on `http://124.222.40.40/computers`
  - Generated exactly one reconnect command block.
  - Command shape:
    `npx -y http://124.222.40.40/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.0.tgz --server-url http://124.222.40.40 --api-key sk_connect_<redacted> # Slock Server`
  - Visible Server metadata: `Slock Server`.

- Executed the cloud UI-generated command with a temporary `HOME`.
  - Daemon output included:
    - `[Daemon] Starting aaa-daemon v0.2.0...`
    - `[Proxy] Listening on http://127.0.0.1:<port>`
    - `[WS] Connecting to ws://124.222.40.40/internal/agent-api/ws?...`
    - `[Daemon] All modules started.`
    - `[WS] Connected`
    - graceful SIGTERM shutdown
  - Negative checks:
    - no `409`
    - no `Account is not a member`
    - no `connect failed`

- Cloud backend logs confirmed:
  - `GET /downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.0.tgz`
  - `POST /internal/agent-api/daemon/connect` -> `200`
  - `POST /internal/agent-api/daemon/register` -> `200`
  - `WebSocket /internal/agent-api/ws?daemonId=...`
  - `POST /internal/agent-api/daemon/shutdown` -> `200`

- Computers UI after daemon run:
  - Shows `Mac-mini.local`.
  - Shows daemon version `0.2.0`.
  - Shows detected runtimes.
  - Shows the Computer updated after the real cloud npx run.

Screenshot:

- `evidence/cloud-prod-computer-after-real-npx.png`

## Remaining Product Risk

Running a reconnect command under a different `HOME` can rebind an offline Computer to a new local machine identity. Current backend tests intentionally allow this for offline same-name reconnect and reject it for active conflicts. This is now verified behavior, but it should be treated as a product/security decision for the daemon identity hardening task.
