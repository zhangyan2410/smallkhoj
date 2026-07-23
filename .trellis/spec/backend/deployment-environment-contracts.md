# Deployment Environment Contracts

> Runtime, deployment, and validation contracts for local development, local production-shape testing, and the current Tencent Lighthouse deployment.

## Scenario: Deployment Environment Test Entrypoints

### 1. Scope / Trigger

Use this spec whenever work changes or validates any of:

- service startup commands, env wiring, Docker images, Caddy routes, or production compose;
- auth/login/signup flows that depend on deployed frontend/backend env;
- daemon connect commands, Computer registration, runtime WebSocket paths, or public callback URLs;
- evidence for "works", "ready", "deployed", "release gate passed", or "cloud validation passed".

Agents must name the target environment in their evidence. A localhost-only check is never evidence that cloud production works.

### 2. Signatures

Environment names:

- `local-dev`: fast developer loop.
  - Backend URL: `http://127.0.0.1:8000`
  - Frontend URL: `http://127.0.0.1:3000`
  - Backend command shape: `rtk .venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000`
  - Frontend command shape: `rtk pnpm dev --hostname 0.0.0.0`
- `local-prod`: local production-shape gate.
  - Command shape: `docker compose -f docker-compose.prod.yml --env-file <local-prod-env> up -d`
  - Entrypoint: Caddy, same-origin routing, production Docker images, production-like env.
- `cloud-prod`: deployed product validation.
  - Current base URL: `http://124.222.40.40`
  - Current instance: Tencent Lighthouse `lhins-6gznhrts`, region `ap-shanghai`
  - Current host user/key: `ubuntu`, `/Users/lee/.ssh/tengxun-ssh-key.pem`

Release smoke commands:

```bash
python3 scripts/post_deploy_smoke.py --base-url <base-url> --allow-http --json
python3 scripts/initial_release_foundation_gate.py --base-url <base-url> --allow-http --json
```

Current Caddy route signatures:

```text
/api, /api/*              -> backend:8000
/internal, /internal/*    -> backend:8000
/docs, /docs/*            -> backend:8000
/openapi.json             -> backend:8000
/downloads/smallkhoj-daemon, /downloads/smallkhoj-daemon/* -> backend:8000
/*                         -> frontend:3000
```

### 3. Contracts

- `local-dev` is for iteration only. It can prove code starts locally, not that the deployed product works.
- `local-prod` is required before cloud deployment when startup, Docker, Caddy, auth env, daemon URL, or reverse-proxy behavior changes.
- `cloud-prod` is the current user/product acceptance surface until a formal domain and HTTPS endpoint replace the IP-only URL.
- `dev.sh` is a convenience script for `local-dev` only. It must not be used as release evidence, but it must keep local auth env coherent so browser signup/login works during development.
- `dev.sh` must start backend and frontend with the same `AUTH_BRIDGE_SECRET`. The backend rejects Better Auth bridge calls with `503 Auth bridge secret is not configured` when the backend secret is missing, and with `401 Invalid auth bridge secret` when the frontend-provided secret does not match.
- `dev.sh` derives the backend `PUBLIC_API_KEY` and frontend `NEXT_PUBLIC_API_KEY` from one local-dev source: `${PUBLIC_API_KEY:-sk_public_local}`. A separate `NEXT_PUBLIC_API_KEY` override is not supported by the script.
- `dev.sh` frontend startup must set local Better Auth env:
  - `BETTER_AUTH_SECRET`
  - `BETTER_AUTH_URL`
  - `BETTER_AUTH_DATABASE_URL`
  - `AUTH_BRIDGE_SECRET`
  - `INTERNAL_API_BASE_URL`
- Production browser traffic should use same-origin routing. Leave these frontend build/runtime values empty unless the browser must call a split public host:
  - `NEXT_PUBLIC_API_BASE_URL=`
  - `NEXT_PUBLIC_WS_BASE_URL=`
- Production frontend env must include:
  - `INTERNAL_API_BASE_URL=http://backend:8000`
  - `NEXT_PUBLIC_DEPLOYMENT_ENV=production`
  - `NEXT_PUBLIC_API_KEY` bridged by Compose from the canonical deployment `PUBLIC_API_KEY`
  - `BETTER_AUTH_SECRET`
  - `BETTER_AUTH_URL`
  - `BETTER_AUTH_DATABASE_URL`
  - `AUTH_BRIDGE_SECRET`
- Frontend Docker builds must also provide build-time Better Auth placeholders before `bun run build`, because Next production build loads `/api/auth/[...all]` while collecting page data. These build-time values must not be real production secrets; real values are supplied by runtime compose env.
- Production backend env must include:
  - `DATABASE_URL`
  - `PUBLIC_API_KEY`; missing values and the known `sk_public_local` development value are startup errors when `DEBUG=false`
  - `AUTH_BRIDGE_SECRET`
  - `BACKEND_CORS_ORIGINS` when using a domain or split origin
  - `MINIMUM_DAEMON_VERSION` when daemon upgrade gating is enabled
  - `DAEMON_RELEASE_VERSION` for the self-hosted Daemon package advertised by onboarding and reconnect commands
- Daemon onboarding commands shown to users must be a single npx command, not a split install/connect workflow:
  - Default self-hosted shape: `npx -y --package <public-base-url>/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-<version>.tgz aura --server-url <public-base-url> --api-key <sk_connect_or_sk_machine_token> # <server-name>`
  - Optional npm-registry shape after publishing: `npx -y --package @smallkhoj/smallkhoj-daemon@latest aura --server-url <public-base-url> --api-key <sk_connect_or_sk_machine_token> # <server-name>`
  - `--server-url` must come from the public browser origin or configured public API base, never from the internal Docker/backend URL.
  - `--api-key` is the one-time `sk_connect_...` ticket for first connect or `sk_machine_...` token for reconnect.
  - The shell comment is required as a human-visible Server identifier. Sanitize it to a single line; it must not affect execution.
  - `DAEMON_NPX_PACKAGE` may override the default hosted tgz URL for staging or npm-registry release, but the default must work without npm account/auth by serving the tgz from `/downloads/smallkhoj-daemon/`.
  - The daemon package name must match the npx executable convention: package `@smallkhoj/smallkhoj-daemon`, product bin `aura`, with `smallkhoj-daemon` retained as a compatibility alias.
- Secrets and provider credentials must live outside the repository, usually in the server-side env file used by `docker compose --env-file`.
- The deployed public-client credential has one operator input, `PUBLIC_API_KEY`. Backend runtime reads it directly; frontend production builds receive it only through `--secret id=public_api_key,env=PUBLIC_API_KEY`; Compose bridges it to `NEXT_PUBLIC_API_KEY` for the frontend container. Do not put it in build args, CLI plan JSON, URLs, logs, screenshots, or error details.
- `NEXT_PUBLIC_*` values are compiled into the browser bundle. Rotating `PUBLIC_API_KEY` therefore requires rebuilding the frontend image and restarting backend/frontend with the same value; changing only container runtime env leaves an old browser bundle.
- The public-client credential is browser-visible after compilation and is not an account/session identity. HTTP and SSE use `X-Public-Key`; chat WebSocket uses the requested `smallkhoj.public-key.<base64url>` subprotocol and negotiates only `smallkhoj.chat.v1`. Better Auth sessions, the server-to-server auth bridge secret, and agent/machine tokens remain separate principals and transports.
- The current mainland China cloud instance can be used for IP-only HTTP smoke tests. A custom public domain on a mainland instance requires ICP readiness before normal public release.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Evidence says "deployed works" but only `localhost:3000` was tested | Invalid evidence; rerun against `local-prod` or `cloud-prod`. |
| `GET <cloud-base>/api/health` fails | Deployment blocker. Do not claim cloud readiness. |
| `GET <cloud-base>/docs` fails | Backend/Caddy routing blocker. |
| `GET <cloud-base>/downloads/smallkhoj-daemon/<daemon-package>.tgz` fails | Daemon onboarding deployment blocker. |
| `GET <cloud-base>/login` fails or does not render the deployed login page | Frontend/Caddy routing blocker. |
| `WS /internal/agent-api/ws` is unreachable through Caddy | Daemon/runtime deployment blocker. |
| Frontend build or boot fails because Better Auth env is missing | Env contract failure; fix env before testing UI behavior. |
| Frontend Docker build fails with `BETTER_AUTH_SECRET is required in production` | Dockerfile build-stage env contract failure; add build-time placeholders and keep real secrets in runtime env. |
| `dev.sh status` disagrees with manually started session processes | Treat `dev.sh` as stale for that evidence; inspect real ports/processes/logs. |
| Login/signup on `localhost:3000` shows `Auth bridge secret is not configured` | Backend was started without `AUTH_BRIDGE_SECRET`; restart local-dev with coherent backend/frontend auth env. |
| Login/signup on `localhost:3000` shows `Invalid auth bridge secret` | Backend and frontend have mismatched `AUTH_BRIDGE_SECRET` values. |
| `NEXT_PUBLIC_API_BASE_URL` points at localhost in a production image | Production image is invalid; rebuild with same-origin empty value or the real public host. |
| Production frontend build has no `PUBLIC_API_KEY` BuildKit secret | Build fails before emitting an image and does not echo a credential. |
| Production frontend build is given `NEXT_PUBLIC_API_KEY` only as a build arg | Invalid production invocation; build args are accepted only for explicit `local-dev`. |
| Chat WebSocket URL contains `api_key` or another reusable credential | Authentication contract violation; reject the URL path and use the reviewed subprotocol transport. |
| Computer UI shows separate install and connect commands | Product bug; show only the single npx onboarding command. |
| Generated daemon command starts with `smallkhoj-daemon connect` or a source-checkout path | Product bug; command is not production-installable. |
| Default generated command points at `@smallkhoj/smallkhoj-daemon@latest` before npm publishing | Release blocker; leave `DAEMON_NPX_PACKAGE` empty so the command uses the self-hosted tgz URL. |
| `DAEMON_NPX_PACKAGE` is set to a registry package and `npm view <package>` returns 404 | Release blocker for that override; unset the env or publish the package. |
| `GET <base>/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-<version>.tgz` fails | Release blocker; regenerate/upload daemon artifacts. |
| `npm pack --dry-run --json` includes `.slock`, `.slock-runtimes`, `test/`, local workspaces, or source-checkout artifacts | Release blocker; fix the daemon package `files` allow-list before publishing. |
| `npx -y ./<daemon-package>.tgz --version` cannot determine an executable | Package/bin naming bug; align package unscoped name with the `smallkhoj-daemon` bin. |

### 5. Good/Base/Bad Cases

- Good: "Validated `cloud-prod` at `http://124.222.40.40`: `/api/health`, `/docs`, `/login`, and smoke command passed."
- Good: "Validated `local-prod` with `docker-compose.prod.yml` after changing Caddy/auth env."
- Base: "Validated `local-dev` for frontend layout only; cloud validation still pending."
- Bad: "Opened `http://localhost:3000/login`, therefore production deploy is ready."
- Bad: "Changed daemon WebSocket route and skipped Caddy/cloud smoke."
- Bad: "Built frontend with `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000` and uploaded it to cloud."

### 6. Tests Required

For deployment/proxy/auth changes:

- Run frontend lint and build with the required Better Auth env values.
- Run `scripts/post_deploy_smoke.py` against the actual target base URL.
- Run `scripts/initial_release_foundation_gate.py` for release-level gates.
- Verify `/api/health`, `/docs`, `/login`, and daemon WebSocket routing on the chosen environment.
- Use `./twd` for browser-facing product evidence, not raw Playwright, when verifying repository UI behavior.
- For daemon onboarding changes:
  - backend command generation test asserts the single npx shape and no source-checkout launcher path;
  - daemon CLI test proves `--server-url` + `--api-key` can connect/register;
  - `npm pack --dry-run --json` proves the package contains only publishable files;
  - `npx -y ./<daemon-package>.tgz --version` proves the packaged bin is resolvable;
  - `npx -y <base>/downloads/smallkhoj-daemon/<daemon-package>.tgz --version` proves the hosted tgz is resolvable;
  - executing a UI-generated command must show backend evidence for tgz download, daemon connect, daemon register, WebSocket accept, and shutdown/disconnect;
  - `./twd` evidence proves the Computers UI shows only one command block and no install/connect split labels.

For cloud deploy evidence:

- Record target environment, base URL, host, image tags, archive path, and whether the run used a VPN proxy.
- Record the exact smoke command and health output.
- If testing IP-only HTTP, explicitly say it is not HTTPS/domain/ICP validation.

### 7. Wrong vs Correct

#### Wrong

```text
I started backend and frontend locally, opened http://localhost:3000/login, so the release deployment is ready.
```

#### Correct

```text
I validated local-dev only. For release readiness, next run local-prod or cloud-prod smoke against http://124.222.40.40 and record the target environment.
```

#### Wrong

```text
Show curl install, install command, and connect command together so advanced users can choose.
```

#### Correct

```text
Show one copyable onboarding command: npx -y --package <public-base-url>/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-<version>.tgz aura --server-url <public-base-url> --api-key <token> # <server-name>.
```

## Scenario: Compatible Daemon Package Rollout

### 1. Scope / Trigger

Use this when a Daemon package changes its executable, packaging contents, or version while a cloud server may still have connected clients running an earlier compatible version.

### 2. Signatures

```text
MINIMUM_DAEMON_VERSION=0.2.0
DAEMON_RELEASE_VERSION=0.2.1

npx -y --package <base>/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.1.tgz aura --server-url <base> --api-key <token>
```

### 3. Contracts

- `MINIMUM_DAEMON_VERSION` is an admission gate for Daemon connect, register, and heartbeat requests; it is not the package URL version.
- `DAEMON_RELEASE_VERSION` selects the generated self-hosted package URL for onboarding and reconnect commands.
- A release package at `DAEMON_RELEASE_VERSION` must be regenerated from the matching source and copied into the backend image's `release-artifacts/smallkhoj-daemon/` directory.
- The package manifest must expose the `aura` bin. Existing `smallkhoj-daemon` bins may remain for command compatibility.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| `DAEMON_RELEASE_VERSION` is newer than `MINIMUM_DAEMON_VERSION` | New onboarding commands use the new package while compatible older clients continue to register and heartbeat. |
| Backend advertises `aura` but its bundled tgz has no `aura` bin | Release blocker; regenerate the package before building the backend image. |
| `MINIMUM_DAEMON_VERSION` is raised only to advertise a new package | Compatibility regression; revert the gate and configure `DAEMON_RELEASE_VERSION` separately. |
| Hosted `0.2.1` tgz is absent after deployment | Daemon onboarding blocker; do not claim release readiness. |

### 5. Good/Base/Bad Cases

- Good: keep `MINIMUM_DAEMON_VERSION=0.2.0`, publish a tested `0.2.1` package, and confirm the generated command downloads and runs `aura`.
- Base: intentionally raise both values only when the new package requires an incompatible protocol change and an upgrade window is communicated.
- Bad: overwrite a `0.2.0` artifact at the same URL or raise the minimum version merely to change the command alias.

### 6. Tests Required

- Backend command-generation tests assert that a release version newer than the minimum produces the new hosted tgz URL.
- Daemon package tests assert that package metadata and register/connect payloads use the released version and expose `aura`.
- Smoke tests request the exact released tgz from `/downloads/smallkhoj-daemon/` after deployment.

### 7. Wrong vs Correct

#### Wrong

```text
MINIMUM_DAEMON_VERSION=0.2.1  # Required only because the new package is 0.2.1
```

#### Correct

```text
MINIMUM_DAEMON_VERSION=0.2.0  # Compatibility gate
DAEMON_RELEASE_VERSION=0.2.1 # Recommended package
```

## Scenario: Direct Image Archive Cloud Deployment

### 1. Scope / Trigger

Use this when deploying to the first Tencent Lighthouse host without a container registry or CI image push. This is the current cloud deployment path.

### 2. Signatures

Script:

```bash
python3 scripts/production_image_transfer.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file /Users/lee/.ssh/tengxun-ssh-key.pem \
  --remote-dir /opt/smallkhoj \
  --output-archive /Volumes/ORICO/smallkhoj-deploy/smallkhoj-production-images-amd64.tar \
  --platform linux/amd64 \
  --use-vpn-proxy
```

Default image tags loaded on the server:

```text
smallkhoj-backend:local-release
smallkhoj-frontend:local-release
smallkhoj-caddy:local-release
```

Default local archive path if not overridden:

```text
/tmp/smallkhoj-production-images.tar
```

### 3. Contracts

- Current cloud deploy is registry-free image archive transfer: local build -> `docker save` -> SSH/SCP upload -> remote `docker load` -> remote `docker compose`.
- Prefer an ORICO path for large local archives to avoid system disk pressure.
- Choose `--platform` from the actual server architecture. The current Lighthouse Docker image target has been validated as `linux/amd64` unless a new host probe says otherwise.
- `--use-vpn-proxy` passes Docker build proxy args for `http://host.docker.internal:7897`.
- Server env files and secrets are never baked into the image archive and never committed.
- Before a real `production_image_transfer.py` build, export `PUBLIC_API_KEY` in the caller environment and place the same value in the server-side `.env.prod`. The frontend step uses `--secret id=public_api_key,env=PUBLIC_API_KEY`; dry-run/JSON command plans contain only that reference and never the value.
- After loading images, the server compose env must reference the loaded `local-release` tags or explicit registry tags.
- A successful upload/load is not enough. Always run post-deploy smoke against the public base URL.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Local archive is built on Apple Silicon without `--platform` and server is x86_64 | Invalid deploy artifact; rebuild for `linux/amd64`. |
| Archive is created under `/tmp` and system disk pressure is a concern | Use `--output-archive /Volumes/ORICO/...`. |
| `docker load` succeeds but compose still uses old image tags | Fix `.env.prod` image tag values before starting services. |
| `docker compose up -d` succeeds but smoke fails | Treat as failed deployment; inspect Caddy/backend/frontend logs. |
| Proxy/network downloads time out during build | Re-run with `--use-vpn-proxy` or explicit proxy args. |

### 5. Good/Base/Bad Cases

- Good: dry-run the transfer plan, build/upload/load images, start compose, then run cloud smoke.
- Good: store the local Docker archive on `/Volumes/ORICO/...` for large release artifacts.
- Base: use `--skip-build` only when the exact required image tags already exist locally.
- Bad: build `linux/arm64` images locally and load them onto an x86_64 Lighthouse host.
- Bad: paste Tencent credentials, SSH private keys, or env secrets into tracked files.

### 6. Tests Required

- `python3 scripts/production_image_transfer.py ... --dry-run` before a new deployment shape.
- `docker image ls` locally or remotely to confirm expected tags.
- Remote `docker compose --env-file .env.prod -f docker-compose.prod.yml ps` after startup.
- `python3 scripts/post_deploy_smoke.py --base-url <cloud-url> --allow-http --json`.
- Release-level: `python3 scripts/initial_release_foundation_gate.py --base-url <cloud-url> --allow-http --json`.

### 7. Wrong vs Correct

#### Wrong

```text
scp repo to the server, run ad hoc build commands there, and call it deployment evidence.
```

#### Correct

```text
Use production_image_transfer.py to produce explicit image tags, upload/load the archive, run docker-compose.prod.yml, and smoke the public base URL.
```
