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
  - Frontend command shape: `rtk bun run dev --hostname 0.0.0.0`
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
- Destructive authenticated E2E requires more than
  `E2E_DATABASE_SCOPE=disposable`: its actual `DATABASE_URL` and
  `BETTER_AUTH_DATABASE_URL` must both target loopback, contain an explicit safe
  database-name marker, and identify the same database. The canonical E2E command
  fails before browser startup when this proof is absent.
- The directly documented frontend entrypoint, `cd frontend && bun run e2e`, invokes
  `python3 ../scripts/validate_delivery_env.py e2e` before Playwright; it is not a
  validator bypass. CI runs the frontend container with host networking and passes
  the exact already-validated loopback `INTERNAL_API_BASE_URL` and
  `BETTER_AUTH_DATABASE_URL` values through by variable name. Substituting a Docker
  hostname, a second database, or a container-only URL after validation violates the
  E2E safety contract.
- `cloud-prod` is the current user/product acceptance surface until a formal domain and HTTPS endpoint replace the IP-only URL.
- `dev.sh` is a convenience script for `local-dev` only. It must not be used as release evidence, but it must keep local auth env coherent so browser signup/login works during development.
- `dev.sh` must start backend and frontend with the same `AUTH_BRIDGE_SECRET`. The backend rejects Better Auth bridge calls with `503 Auth bridge secret is not configured` when the backend secret is missing, and with `401 Invalid auth bridge secret` when the frontend-provided secret does not match.
- `dev.sh` derives the backend `PUBLIC_API_KEY` and frontend `NEXT_PUBLIC_API_KEY` from one local-dev source: `${PUBLIC_API_KEY:-sk_public_local}`. A separate `NEXT_PUBLIC_API_KEY` override is not supported by the script.
- `dev.sh` frontend startup must set local Better Auth env:
  - `BETTER_AUTH_SECRET`
  - `BETTER_AUTH_URL`
  - `BETTER_AUTH_DATABASE_URL`
  - `BETTER_AUTH_DATABASE_POOL_SIZE=10`
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
  - `BETTER_AUTH_DATABASE_POOL_SIZE=10`
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
- Client-reachable modules must adapt environment values through explicit static property reads such as `process.env.NEXT_PUBLIC_API_KEY`. Passing the complete `process.env` object to a resolver is not supported: Next.js does not guarantee dynamic property discovery/inlining in client chunks. Keep public and server adapters separate so `INTERNAL_API_BASE_URL` is never added to the public adapter.
- The public-client credential is browser-visible after compilation and is not an account/session identity. HTTP and SSE use `X-Public-Key`; chat WebSocket uses the requested `smallkhoj.public-key.<base64url>` subprotocol and negotiates only `smallkhoj.chat.v1`. Better Auth sessions, the server-to-server auth bridge secret, and agent/machine tokens remain separate principals and transports.
- The current mainland China cloud instance can be used for IP-only HTTP smoke tests. A custom public domain on a mainland instance requires ICP readiness before normal public release.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Evidence says "deployed works" but only `localhost:3000` was tested | Invalid evidence; rerun against `local-prod` or `cloud-prod`. |
| E2E scope says disposable but either actual database URL is remote, unmarked, or points to a different database | Fail closed before running the destructive integration flow. |
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
| Browser throws the production public-key error even though the Next process has local/public env | Inspect the client adapter for dynamic `process.env` passing; restore explicit `process.env.NEXT_PUBLIC_*` reads without weakening fail-closed validation. |
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
- Run the delivery-environment validator tests proving E2E rejects remote,
  unmarked, or backend/Better-Auth-mismatched database targets.
- Run the runtime URL contract test that rejects dynamic `resolve*(process.env)` client calls and requires explicit public env property reads; a successful `next build` alone is not browser-runtime proof.
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

## Scenario: Self-Contained CI Security Scans

### 1. Scope / Trigger

Use this contract when a GitHub Actions job scans build artifacts or service logs for
credentials, tokens, or other release-blocking patterns.

### 2. Signatures

Baseline Ubuntu runner scan commands:

```bash
grep -Fq -- "$literal_value" "${files[@]}"
grep -Eq -- "$extended_regex" "${files[@]}"
```

### 3. Contracts

- Every executable used by a security scan must either be part of the job's declared
  baseline shell environment or be explicitly provisioned in that job before use.
- Literal credentials use fixed-string matching; token families use an explicitly
  reviewed extended regular expression.
- Scanner exit status is fail-closed: `0` means prohibited content matched, `1` means
  no match, and every other status means the scan itself failed.
- All input logs must be proven readable before scanning. A missing log is a gate
  failure, not an empty-log success.
- Workflow contract tests must reject unprovisioned scanner dependencies; they must
  not merely assert the text of a command unavailable on the target runner.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Literal or token pattern matches a service log | Fail the job and identify the credential class without printing its value. |
| Scanner returns `1` for every required check | Pass the credential-log scan. |
| Scanner executable is absent | Contract failure; provision it or use a baseline command before merging. |
| Scanner returns a status greater than `1` | Fail the job with the label and status; do not treat it as no match. |
| A required log is absent or unreadable | Fail before scanning. |

### 5. Good/Base/Bad Cases

- Good: use stock GNU grep with `-Fq` for literal secrets and `-Eq` for the reviewed
  token pattern while preserving all three exit-status classes.
- Base: explicitly install and version-pin a non-baseline scanner in the same job,
  then assert that provisioning in the workflow contract.
- Bad: call a convenient local tool such as `rg` without installing it because a
  developer machine happens to provide it.

### 6. Tests Required

- The delivery workflow contract asserts the exact fixed-string and ERE scan shapes.
- The contract rejects the known unprovisioned `rg --quiet` form.
- The authenticated disposable integration job runs the scan on GitHub's target
  runner after both backend and frontend logs are captured.
- A matched credential, no-match status, unreadable log, and scanner error must retain
  their distinct fail/pass behavior.

### 7. Wrong vs Correct

#### Wrong

```bash
# The job never installs ripgrep.
rg --quiet --fixed-strings -- "$AUTH_BRIDGE_SECRET" "$service_log"
```

#### Correct

```bash
grep -Fq -- "$AUTH_BRIDGE_SECRET" "$service_log"
scan_status=$?
# 0 = leak, 1 = clean, >1 = scanner failure
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
  --capacity-report /absolute/path/to/formal-capacity-report.json \
  --release-evidence /Volumes/ORICO/smallkhoj-deploy/smallkhoj-production-images-amd64.release-evidence.json \
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
- Production image build contexts must be a clean Git candidate: staged, unstaged, and untracked files are all release blockers. The revision written to `org.opencontainers.image.revision` must equal the checked-out `HEAD`; an operator-supplied revision is validation input, not permission to relabel a different filesystem snapshot.
- `--skip-build` may save existing images only after backend, frontend, and Caddy image labels are inspected locally and all equal the same clean candidate `HEAD`. Missing or mismatched labels are release blockers.
- A cloud-release build performed after squash merge must consume the accepted formal
  capacity report and require the current merge commit tree to equal the tested
  candidate tree. The image revision label remains the merge commit SHA; preserve the
  tested-tree -> merge-SHA mapping in release evidence.
- Every real transfer, including `--skip-build`, requires `--capacity-report`.
  Diagnostic smoke, failed/incomplete evidence, a recomputation/summary mismatch, and
  a stale report whose candidate tree differs from current `HEAD^{tree}` are release
  blockers. Dry-run examples also include the flag so copied runbook commands retain
  the mandatory input.
- Release consumers must recompute schema-v5 capacity failures from the full raw
  report and require the stored `acceptance` object to equal that result exactly.
  Trusting a mutable `acceptance.passed=true` summary without reevaluation is a
  release-blocking validation bug.
- A successful transfer must atomically persist and emit schema-versioned JSON release
  evidence. It binds the tested candidate HEAD/tree, current merge HEAD/tree, formal
  profile plus capacity-report path/hash, inspected image tag/ID/revision/platform,
  and the saved archive path/hash. The default evidence path is
  `<output-archive>.release-evidence.json`; it must contain no secret values.
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
| Capacity report is smoke, failed/forged, or stale for a different tree | Block before build/upload; do not reinterpret diagnostic or old evidence as release acceptance. |
| Tested candidate SHA differs from the squash-merge SHA but both Git trees match | Accept the mapping, label images with the merge SHA, and record both identities in release evidence. |
| Release evidence cannot be persisted after transfer | Treat the transfer as incomplete release evidence and do not claim release completion. |

### 5. Good/Base/Bad Cases

- Good: dry-run the transfer plan, build/upload/load images, start compose, then run cloud smoke.
- Good: store the local Docker archive on `/Volumes/ORICO/...` for large release artifacts.
- Base: use `--skip-build` only when the exact required image tags already exist locally.
- Bad: build `linux/arm64` images locally and load them onto an x86_64 Lighthouse host.
- Bad: paste Tencent credentials, SSH private keys, or env secrets into tracked files.

### 6. Tests Required

- `python3 scripts/production_image_transfer.py ... --capacity-report <accepted-formal-report.json> --dry-run` before a new deployment shape.
- Preserve and validate `<output-archive>.release-evidence.json` after a successful
  real transfer; its report/archive hashes, image identities and tested-tree ->
  merge-SHA mapping are the machine-readable release provenance.
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

## Scenario: Formal Local Capacity Evidence

### 1. Scope / Trigger

Use this contract whenever a report is presented as proof that the release candidate
supports hundreds of connected users on the current nominal 4 vCPU / 4 GB deployment
shape. A short harness smoke is useful diagnostic evidence, but is not formal capacity
acceptance.

### 2. Signatures

Formal profile identifier:

```text
formal-300-500-30-v1
```

Formal report schema:

```text
schemaVersion=5
```

Diagnostic profile identifier:

```text
smoke
```

Candidate identity label:

```text
org.opencontainers.image.revision=<40-character-clean-candidate-HEAD>
```

### 3. Contracts

- `acceptance.passed=true` is reserved for `formal-300-500-30-v1`. A `smoke`
  report must carry an explicit non-formal failure/disposition and must never be
  described as formal capacity acceptance.
- The formal profile is non-downgradable. It requires at least 300 steady SSE
  connections, 500 peak SSE connections, 30 active users, 1,800 seconds of active
  workload, 590 seconds before the spike ramp, 60 seconds at peak, and 60 seconds of
  cleanup observation. Active cycles and resource samples are no slower than five
  seconds; the steady ramp is no longer than 60 seconds and the spike ramp is no
  longer than 10 seconds.
- Formal latency limits are no weaker than 2,000 ms SSE-ready p95, 500 ms read p95,
  1,000 ms write p95, and 2,000 ms event-delivery p95. PostgreSQL headroom is at
  least five connections and cleanup delta is at most two connections.
- The formal environment is bound to the complete deployment-wide PostgreSQL
  connection budget, not only backend workers and NOTIFY publisher connections:
  - `DATABASE_POOL_SIZE=5`;
  - `DATABASE_MAX_OVERFLOW=10`;
  - `NOTIFY_PUBLISHER_POOL_SIZE=2` plus exactly one listener connection per backend
    worker;
  - `BACKEND_WORKERS=1`, producing `18` backend connections;
  - `BETTER_AUTH_DATABASE_POOL_SIZE=10` for the process-singleton frontend pool;
  - a `15`-connection reserve for one Feishu worker using the same `5 + 10` pool;
  - `POSTGRES_CONNECTION_HEADROOM=5`;
  - total required budget `18 + 10 + 15 + 5 = 48` within PostgreSQL
    `max_connections=100`.
- Schema-v5 reports must record every base and derived connection-budget field.
  The evaluator independently recomputes `backendPerProcess`, `backendTotal`, the
  Feishu reserve and `required`, then requires the formal values above exactly. It
  must reject synchronized substitutions that preserve the total while shifting
  capacity between pool, overflow, frontend or headroom.
- Targeted runtime evidence must read the six budget inputs plus
  `POSTGRES_MAX_CONNECTIONS` from the backend container and the Better Auth pool
  size from the frontend container. Backend env capacity, frontend env capacity,
  `SHOW max_connections`, report configuration and the raw listener history must
  agree before formal acceptance.
- The v1 formal topology has exactly one frontend container/process and zero
  `feishu-worker` containers. The `15` Feishu term is an unexercised conservative
  reserve, not evidence that worker load or worker CPU/memory was tested. The probe
  fails before fixtures if any scoped Feishu worker container exists. Enabling or
  scaling that service, adding frontend replicas, or using Node cluster/workers
  requires explicit instance multipliers, resource sampling and a new/reviewed
  capacity profile; a process-local `globalThis` singleton does not cross those
  boundaries.
- Formal evidence is local-only and cannot be relabeled as cloud evidence. It must
  retain `mode=local-only`, a loopback API target, an explicitly disposable loopback
  database name/scope, the scoped Compose project, required service list, and the
  canonical limitations list. Cloud health remains pending until the newly deployed
  version is tested.
- The target resource envelope is fixed to four vCPUs and 3,564,584,960 guest-visible
  bytes. Across db/backend/frontend/Caddy, every raw sample must remain at or below
  2,673,438,720 aggregate memory bytes and 320 aggregate CPU-percent points. This
  intentionally leaves host headroom and gives no capacity credit for swap.
- Candidate provenance is sampled before and after the run and must be identical and
  clean, and includes both commit SHA and Git tree SHA. Backend, frontend, and Caddy
  OCI revision labels must all equal that candidate `HEAD`.
- Every valid raw resource sample, from baseline through cleanup, must observe exactly
  one `smallkhoj-notify-listener` owner per backend worker. A historical peak is not
  continuity evidence. Publisher connections may vary, but may never exceed
  `workers * NOTIFY_PUBLISHER_POOL_SIZE`.
- Raw PostgreSQL/database/container histories are authoritative: cumulative database
  counters are monotonic, the baseline has zero deadlocks and zero container restarts,
  container identity/image/restart/OOM/running state remains valid for every sample,
  phase/timing coverage is complete, and all summaries are exactly recomputable from
  the raw samples.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| A 5/8/3 short run is labeled formal or reports acceptance passed | Reject with `FORMAL_CAPACITY_PROFILE_INVALID` or `NON_FORMAL_CAPACITY_PROFILE`. |
| Formal report omits threshold evidence or relaxes a p95/headroom limit | Reject with `FORMAL_CAPACITY_PROFILE_INVALID`. |
| Formal report expects PostgreSQL max connections other than 100 | Reject with `FORMAL_CAPACITY_PROFILE_INVALID`. |
| Connection-budget evidence is missing, arithmetically inconsistent, not exactly the reviewed 48-connection allocation, or disagrees with backend/frontend runtime env | Reject with `POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID`; a formal-value substitution also invalidates the formal profile. |
| The scoped formal project contains any Feishu worker container or omits the zero-worker topology evidence | Reject before load or with `DEPLOYMENT_SHAPE_EVIDENCE_INVALID`; the v1 report does not cover worker runtime load. |
| Baseline sees the listener but any later raw phase sample loses it | Reject with `POSTGRES_NOTIFY_LISTENER_OWNERS_UNEXPECTED`. |
| Any raw sample exceeds the 4-vCPU / 3.32-GiB target resource budget | Reject with `TARGET_RESOURCE_ENVELOPE_EXCEEDED`. |
| Local report is relabeled as cloud/production or its limitations are removed | Reject with `LOCAL_EVIDENCE_BOUNDARY_INVALID`. |
| Clean candidate SHA and any application image revision label differ | Reject with `CONTAINER_IMAGE_REVISION_MISMATCH`. |
| Candidate changes during the run | Reject with `CANDIDATE_CHANGED_DURING_RUN`. |
| Post-squash merge tree differs from the formally tested candidate tree | Block image transfer and rebuild/retest the correct candidate. |
| A stored report claims acceptance but recomputation finds failures, or its stored failure list differs from recomputation | Reject with the recomputed failure codes plus `ACCEPTANCE_SUMMARY_MISMATCH`; production image transfer must not continue. |
| Raw histories and derived summaries disagree | Reject the affected summary and the report. |

### 5. Good/Base/Bad Cases

- Good: a clean candidate runs the complete 300/500/30 profile for 30 minutes and
  every raw invariant plus threshold passes.
- Base: a clearly labeled 5/8/3 smoke validates Docker/query/report wiring while
  retaining `acceptance.passed=false`; formal capacity remains pending.
- Bad: lower every internally related count, recompute summaries, and claim the
  self-consistent short report proves the release capacity target.

### 6. Tests Required

- Regression tests mutate a passing report into a self-consistent 1/2/1 profile and
  require rejection.
- Regression tests remove listener owners after baseline, recompute PostgreSQL
  summaries, and require rejection.
- Regression tests remove or weaken threshold/profile/PostgreSQL evidence and require
  rejection.
- Regression tests mutate every derived connection-budget field, use non-integer
  listener evidence, synchronize a `5/10 -> 4/11` pool split, synchronize a
  `Better Auth 10 / headroom 5 -> 9 / 6` split, and synchronize
  `max_connections=100 -> 101`; every formally relabeled report remains rejected.
- Runtime-inspection tests prove the backend command reads only the seven reviewed
  integer budget/capacity variables and the frontend command reads only
  `BETTER_AUTH_DATABASE_POOL_SIZE`; neither inspection may dump the container env.
- Deployment-shape tests require zero scoped Feishu worker containers and reject
  missing, non-integer or nonzero optional-service evidence.
- Regression tests relabel local evidence as cloud evidence and exceed the target
  resource envelope, then require rejection.
- Production-transfer tests require accepted report tree equality after squash and
  reject a different merge tree. They must also prove the transfer validator
  recomputes the complete report instead of trusting a forged passing summary.
- A short fresh local-prod smoke validates real Docker inspection and targeted runtime
  evidence before the committed formal run.
- The final formal run uses fresh disposable volumes and preserves the machine-readable
  report before scoped `docker compose down -v --remove-orphans` cleanup.

### 7. Wrong vs Correct

#### Wrong

```text
The clean 5/8/3 smoke passed, therefore the 300/500 release capacity gate passed.
```

#### Correct

```text
The 5/8/3 smoke validated the harness only. Formal capacity remains pending until the
clean candidate completes formal-300-500-30-v1.
```
