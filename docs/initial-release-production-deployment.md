# Initial Release Production Deployment

This runbook prepares a low-cost deployment behind one HTTPS domain. It is written for the 7-15 initial release path and keeps secrets out of the repository.

## Deployment Shape

Use Caddy as the only public entrypoint:

```text
https://<domain>/           -> frontend:3000
https://<domain>/api/*      -> backend:8000
https://<domain>/internal/* -> backend:8000
https://<domain>/docs       -> backend:8000
```

The `/internal/*` route is required for daemon WebSocket paths such as `/internal/agent-api/ws`. Caddy's `reverse_proxy` handles WebSocket upgrades.

## Domain And SSL

Do not buy a separate paid SSL certificate for the initial release by default. Caddy can request and renew Let's Encrypt certificates automatically when:

- the domain resolves to the server;
- ports 80 and 443 are reachable from the public internet;
- the Caddy site address is a real domain, not `:80`.

For Tencent Cloud mainland China servers, a public website on a custom domain normally needs ICP filing before normal production use. If ICP is not ready, keep validation on one of these lower-friction paths:

- a Tencent Cloud Hong Kong or overseas instance;
- a temporary tunnel/reverse proxy endpoint;
- an IP-only HTTP test with `SMALLKHOJ_SITE_ADDRESS=:80` for backend/frontend smoke checks only.

Feishu long connection and Jira REST do not require inbound traffic from Feishu to SmallKhoj. The public domain is mainly for users, daemon connect URLs, browser API calls, and operational validation.

## Tencent Cloud CLI

Prefer TencentCloud CLI (`tccli`) for read-only Lighthouse discovery once cloud credentials are available. The browser console is still useful for login and visual confirmation, but CLI output is easier to save as deployment evidence.

Install the CLI outside the repo. On this machine, keep it on the ORICO disk:

```bash
python3 -m venv /Volumes/ORICO/smallkhoj-tools/tccli-venv
env HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897 \
  /Volumes/ORICO/smallkhoj-tools/tccli-venv/bin/python -m pip install -U tccli \
  --trusted-host pypi.org \
  --trusted-host files.pythonhosted.org
```

Configure credentials in the local user profile, not in the repository:

```bash
/Volumes/ORICO/smallkhoj-tools/tccli-venv/bin/tccli configure --profile smallkhoj-release
```

The prompt asks for `SecretId`, `SecretKey`, default region, and output format. Use `json` output. Do not paste those values into tracked files or shell history as inline command arguments.

Useful read-only discovery commands:

```bash
/Volumes/ORICO/smallkhoj-tools/tccli-venv/bin/tccli lighthouse DescribeRegions \
  --profile smallkhoj-release

/Volumes/ORICO/smallkhoj-tools/tccli-venv/bin/tccli lighthouse DescribeInstances \
  --profile smallkhoj-release \
  --region ap-guangzhou \
  --Limit 20
```

`DescribeInstances` returns the instance ID, name, zone, CPU, memory, OS name, platform, private IP, public IP, internet bandwidth, login key IDs, status, created time, and expiration time. Save that output before mutating the server.

If local network access needs the VPN proxy, pass it to individual calls instead of storing it in project files:

```bash
/Volumes/ORICO/smallkhoj-tools/tccli-venv/bin/tccli lighthouse DescribeInstances \
  --profile smallkhoj-release \
  --region ap-guangzhou \
  --https-proxy http://127.0.0.1:7897
```

## Images

The production compose file uses prebuilt backend/frontend images so the nominal 4 vCPU / 4 GB host (3.32 GiB guest-visible RAM) never has to build Next.js or Python dependencies under memory pressure. Caddy is built from `deploy/caddy/` because it is a tiny image layer that bakes in the tracked reverse-proxy config and avoids fragile host file mounts.

The frontend Dockerfile copies Next.js standalone output from `.next/standalone`; keep `frontend/next.config.mjs` configured with `output: "standalone"`. A frontend image build must fail the release gate if `.next/standalone/server.js` is missing after `bun run build`.

For a registry-based deployment, build and push images from a stronger machine or CI:

```bash
export PUBLIC_API_KEY='<generate-outside-repo>'

docker build -t <registry>/smallkhoj-backend:<tag> ./backend
docker build \
  --no-cache \
  --build-arg NEXT_PUBLIC_API_BASE_URL= \
  --build-arg NEXT_PUBLIC_WS_BASE_URL= \
  --build-arg NEXT_PUBLIC_DEPLOYMENT_ENV=production \
  --secret id=public_api_key,env=PUBLIC_API_KEY \
  -t <registry>/smallkhoj-frontend:<tag> ./frontend
docker push <registry>/smallkhoj-backend:<tag>
docker push <registry>/smallkhoj-frontend:<tag>
```

`PUBLIC_API_KEY` is the single deployment input used by the backend verifier and
the frontend build. Production builds accept it only through the BuildKit secret
mount, so the value is not written into the build command, image config, or image
history. It is still a browser-visible public-client credential after compilation,
not an account identity or a substitute for authorization.

The production frontend build must use `--no-cache`. BuildKit intentionally does
not include secret contents in a layer cache key, while Next.js embeds this public
client key into browser assets. Reusing that layer after changing deployments can
retain the previous key and make login, API, and SSE requests fail with
`Invalid API key`. Keep the secret mount for safe transport and disable cache for
this release build; do not replace it with a value-bearing build argument.

For the first Lighthouse test, a registry-free flow is usually simpler: build images locally, save them into one Docker archive, upload the archive over SSH, and run `docker load` on the server:

```bash
export PUBLIC_API_KEY='<generate-outside-repo>'
CAPACITY_REPORT=/absolute/path/to/formal-capacity-report.json

python3 scripts/production_image_transfer.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /opt/smallkhoj \
  --platform linux/amd64 \
  --use-vpn-proxy \
  --capacity-report "$CAPACITY_REPORT" \
  --dry-run

python3 scripts/production_image_transfer.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /opt/smallkhoj \
  --platform linux/amd64 \
  --use-vpn-proxy \
  --capacity-report "$CAPACITY_REPORT"
```

The transfer plan contains only
`--secret id=public_api_key,env=PUBLIC_API_KEY`; `--dry-run --json` must never
contain the value. Keep the same exported value in the server-side `.env.prod`
used to start Compose.

`--capacity-report` is mandatory for every real transfer, including
`--skip-build`. It must point to the accepted schema-v5
`formal-300-500-30-v1` report from the clean, fully tested candidate. The
transfer validator recomputes the raw report instead of trusting its stored
summary, then requires the report's candidate tree to equal the current clean
merge `HEAD^{tree}`. A post-squash merge commit may therefore have a different
SHA from the tested candidate only when both trees are identical. `--dry-run`
prints the command plan only; including the report path there does not validate
or accept the report ahead of the real transfer.

The transfer fails closed before release actions for all of these cases:

- a diagnostic `smoke` report (`NON_FORMAL_CAPACITY_PROFILE`) — smoke verifies
  the harness, not the 300/500/30 capacity target;
- a failed, incomplete, or forged report, including a stored summary that
  disagrees with recomputation (`ACCEPTANCE_SUMMARY_MISMATCH`);
- a stale capacity report whose tested tree differs from the current merge
  tree, even if its old run passed.

After the archive is uploaded and loaded successfully, the command writes
`<output-archive>.release-evidence.json` by default and emits the same
machine-readable evidence as its final JSON event. The evidence binds tested
candidate HEAD/tree, current merge HEAD/tree, capacity-report path and SHA-256,
every inspected image ID/revision label/platform, and archive path and SHA-256.
Use `--release-evidence /absolute/path/release-evidence.json` to select another
location. Preserve this small JSON file with the capacity report and archive;
it contains hashes and artifact paths, not deployment secret values.

Choose `--platform` after confirming the Lighthouse host architecture with the host probe or console. Apple Silicon local Docker builds default to `linux/arm64`; those images must not be reused on a `linux/amd64` Lighthouse host. If the host is ARM, use `--platform linux/arm64`; if it is x86_64, use `--platform linux/amd64`.

`--remote-dir` is the server directory used by SSH/SCP. If you want the local archive to stay on the ORICO disk instead of the system disk, set only `--output-archive` to a `/Volumes/ORICO/...` path:

```bash
python3 scripts/production_image_transfer.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /opt/smallkhoj \
  --output-archive /Volumes/ORICO/smallkhoj-deploy/smallkhoj-production-images-amd64.tar \
  --platform linux/amd64 \
  --use-vpn-proxy \
  --capacity-report "$CAPACITY_REPORT" \
  --release-evidence /Volumes/ORICO/smallkhoj-deploy/smallkhoj-production-images-amd64.release-evidence.json
```

This loads these default tags on the server:

```bash
SMALLKHOJ_BACKEND_IMAGE=smallkhoj-backend:local-release
SMALLKHOJ_FRONTEND_IMAGE=smallkhoj-frontend:local-release
SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:local-release
```

If you already built those images locally, add `--skip-build` to only save,
upload, and load the archive. The formal `--capacity-report` remains mandatory,
and the three existing image IDs, revision labels, and platforms are still
inspected and recorded before transfer.

If Docker Hub or package downloads time out on the local network, run Docker builds through the local VPN proxy. From the host, the proxy is `127.0.0.1:7897`; from inside Docker build containers, use `host.docker.internal:7897`. The image transfer script's `--use-vpn-proxy` flag adds these build args automatically:

```bash
docker build \
  --build-arg HTTP_PROXY=http://host.docker.internal:7897 \
  --build-arg HTTPS_PROXY=http://host.docker.internal:7897 \
  --build-arg http_proxy=http://host.docker.internal:7897 \
  --build-arg https_proxy=http://host.docker.internal:7897 \
  -t <registry>/smallkhoj-backend:<tag> ./backend
```

For the recommended same-origin deployment, leave `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_WS_BASE_URL` empty at build time. Browser calls will use `/api`, and WebSocket calls will derive `wss://<domain>/api/chat/ws`.

Only set `NEXT_PUBLIC_API_BASE_URL` or `NEXT_PUBLIC_WS_BASE_URL` when the browser must call a different public host. Because these are `NEXT_PUBLIC_*` values, they must be present when the frontend image is built, not only when the container starts.

### Apple Silicon cross-arch build pitfalls (linux/amd64 target)

Building `--platform linux/amd64` frontend images on an Apple Silicon host
(`aarch64`) has two failure modes that the `--platform` guidance above does not
cover. Both were hit during the 2026-07-31 deploy and must be handled together:

1. **`Next.js build worker exited with signal SIGILL`** — the default Docker
   driver (colima's embedded buildkit) runs the amd64 build through QEMU
   userspace emulation, and Next.js's V8/worker build crashes under emulation.
   The fix is a separate `docker-container` buildx builder, which runs buildkit
   in its own container and handles cross-arch through binfmt more stably:

   ```bash
   # buildkitd config pointing Docker Hub at a reachable mirror
   cat > /tmp/buildkitd.toml <<'EOF'
   [registry."docker.io"]
     mirrors = ["docker.m.daocloud.io", "dockerproxy.net"]
   EOF

   docker buildx create --name amd64builder --driver docker-container \
     --config /tmp/buildkitd.toml --driver-opt network=host --use
   docker buildx inspect amd64builder --bootstrap

   docker buildx build --builder amd64builder --platform linux/amd64 --no-cache \
     --secret id=public_api_key,env=PUBLIC_API_KEY --load \
     -t smallkhoj-frontend:local-release -f frontend/Dockerfile frontend
   ```

2. **DNS / registry resolution inside the builder container** — the
   `docker-container` builder has its own network namespace and does NOT inherit
   the colima daemon's `registry-mirrors` or proxy. Without configuration it
   fails with `lookup docker.m.daocloud.io ... i/o timeout` or
   `dial tcp auth.docker.io ... connection refused`. Two things must be set on
   the builder itself: a `--config buildkitd.toml` with `[registry."docker.io"]`
   mirrors, and `--driver-opt network=host` so the builder reuses the VM's DNS
   and VPN proxy. Do not rely on `~/.docker/config.json` `proxies` — that only
   affects buildx's standalone builders, not colima's embedded buildkit, and the
   `docker-container` driver needs the explicit `--config`/`--driver-opt`.

The backend image (Python only, no Next.js) builds fine under the colima
embedded buildkit with `--platform linux/amd64` once the daemon's
`/etc/docker/daemon.json` has `registry-mirrors`; it does not need the separate
buildx builder. Only the frontend needs the docker-container builder.

## Environment

Set deployment env outside the repo, for example in a server-side `.env.prod` file that is not committed.

Required operational values:

```bash
SMALLKHOJ_SITE_ADDRESS=smallkhoj.example.com
SMALLKHOJ_BACKEND_IMAGE=<registry>/smallkhoj-backend:<tag>
SMALLKHOJ_FRONTEND_IMAGE=<registry>/smallkhoj-frontend:<tag>
SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:latest
POSTGRES_PASSWORD=<set-outside-repo>
DATABASE_POOL_SIZE=5
DATABASE_MAX_OVERFLOW=10
BETTER_AUTH_DATABASE_POOL_SIZE=10
BACKEND_WORKERS=1
POSTGRES_MAX_CONNECTIONS=100
POSTGRES_CONNECTION_HEADROOM=5
NOTIFY_PUBLISHER_POOL_SIZE=2
NOTIFY_CONNECT_TIMEOUT_SECONDS=3
NOTIFY_OPERATION_TIMEOUT_SECONDS=3
NOTIFY_RECONNECT_INITIAL_SECONDS=0.25
NOTIFY_RECONNECT_MAX_SECONDS=5
NOTIFY_SHUTDOWN_TIMEOUT_SECONDS=5
NOTIFY_PUBLISH_ATTEMPTS=2
PUBLIC_API_KEY=<generate-outside-repo>
AUTH_BRIDGE_SECRET=<generate-outside-repo>
BETTER_AUTH_SECRET=<generate-outside-repo>
BETTER_AUTH_URL=https://smallkhoj.example.com
BACKEND_CORS_ORIGINS=https://smallkhoj.example.com
UPLOAD_MAX_BYTES=52428800
UPLOAD_READ_CHUNK_BYTES=65536
UPLOAD_CLEANUP_TIMEOUT_SECONDS=5
SMALLKHOJ_UPLOAD_REQUEST_BODY_MAX=55MB
```

When using `production_image_transfer.py`, replace the image values with the local-release tags loaded on the server:

```bash
SMALLKHOJ_BACKEND_IMAGE=smallkhoj-backend:local-release
SMALLKHOJ_FRONTEND_IMAGE=smallkhoj-frontend:local-release
SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:local-release
```

Frontend URL values:

```bash
INTERNAL_API_BASE_URL=http://backend:8000
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_WS_BASE_URL=
```

`INTERNAL_API_BASE_URL` is for server-side Next.js fetches inside Docker. It must not be used in daemon connect commands or browser-visible links. The frontend derives public URLs from the request host or browser origin when public overrides are empty.

PostgreSQL connection capacity is an explicit deployment budget, not a
per-process estimate:

```text
backend_per_process = DATABASE_POOL_SIZE + DATABASE_MAX_OVERFLOW
                    + NOTIFY_PUBLISHER_POOL_SIZE + 1 listener
backend             = backend_per_process * BACKEND_WORKERS
frontend            = BETTER_AUTH_DATABASE_POOL_SIZE
feishu_worker       = DATABASE_POOL_SIZE + DATABASE_MAX_OVERFLOW
required            = backend + frontend + feishu_worker
                    + POSTGRES_CONNECTION_HEADROOM
```

With the defaults this is `(5 + 10 + 2 + 1) * 1 + 10 + (5 + 10) + 5 = 48`
required connections against `POSTGRES_MAX_CONNECTIONS=100`. Three backend
workers require `18 * 3 + 10 + 15 + 5 = 84`. The worker reserve is retained
even when the optional Compose profile is currently disabled, so enabling the
existing worker cannot consume an unbudgeted pool. Better Auth owns one
process-global pool with explicit max 10; the worker receives the same explicit
SQLAlchemy pool settings as backend. Backend settings fail closed at startup
when the complete deployment requirement exceeds the configured PostgreSQL
capacity, and Compose passes the same `POSTGRES_MAX_CONNECTIONS` to the database server.
Publisher and listener connections are visible in `pg_stat_activity` as
`smallkhoj-notify-publisher` and `smallkhoj-notify-listener`. Publisher
operations, reconnect backoff, and shutdown are bounded by the `NOTIFY_*`
timeouts; a failed wake-up is logged as degraded instead of silently falling
back to an unbudgeted one-shot connection.

Do not add a separate `NEXT_PUBLIC_API_KEY` value to `.env.prod`.
`docker-compose.prod.yml` bridges the canonical `PUBLIC_API_KEY` into the
frontend runtime environment, while the image build consumes the same variable
through `--secret id=public_api_key,env=PUBLIC_API_KEY`. Because Next.js embeds
`NEXT_PUBLIC_*` values at build time, changing only the running container's env
does not rotate an already-built browser bundle: rebuild the frontend image and
restart backend/frontend with the same value. Missing values and the known
`sk_public_local` development value fail closed in production.

Public HTTP and SSE requests send the public-client credential in
`X-Public-Key`. Chat WebSocket clients send it in the
`smallkhoj.public-key.<base64url>` requested subprotocol and negotiate only the
fixed `smallkhoj.chat.v1` application protocol. Do not put the credential in a
URL, query string, build plan, log, screenshot, or error message.

Upload limits are deliberately layered rather than described as one
"streaming limit":

| Boundary | Default | Meaning |
|---|---:|---|
| Caddy request body | `55MB` total request | Rejects oversized multipart requests at ingress before proxying. The allowance is larger than the file cap because multipart headers and boundaries consume bytes too. |
| Starlette `UploadFile` spool | `1 MiB` current framework default | Multipart parsing happens before route code. Small parts may remain in memory; larger parts spool to parser-owned temporary disk. This is not configured by `UPLOAD_MAX_BYTES`. |
| Application file cap | `50 MiB` | Public files, agent attachments, and avatars are read in `64 KiB` chunks into a local staging file. The application never joins the allowed payload into one bytes object. |
| Durable local storage | one completed file | A same-directory `.uploading` file is atomically promoted only after validation and DB flush. Read/write/flush/commit/cancellation failures rollback and remove staging/final residue. |

`SMALLKHOJ_UPLOAD_REQUEST_BODY_MAX` is a Caddy size string and limits the
whole request. `UPLOAD_MAX_BYTES` and `UPLOAD_READ_CHUNK_BYTES` are integer
byte counts consumed by the backend. Keep the proxy allowance above the
application file cap; setting it below valid multipart overhead will reject
otherwise valid uploads at ingress.

Integration/runtime values, when enabled:

```bash
JIRA_EMAIL=<set-outside-repo>
JIRA_API_TOKEN=<set-outside-repo>
FEISHU_REPLY_BASE_URL=https://open.feishu.cn
FEISHU_REPLY_ACCESS_TOKEN=<set-outside-repo>
FEISHU_WORKER_CONNECTOR_ID=<bootstrap-output>
FEISHU_WORKER_JIRA_CONNECTOR_ID=<bootstrap-output>
FEISHU_WORKER_CREATOR_ID=<bootstrap-output>
FEISHU_WORKER_BOT_OPEN_ID=<bot-open-id>
FEISHU_WORKER_BOT_NAME=SmallKhoj
FEISHU_WORKER_APP_ID=<app-id>
FEISHU_WORKER_APP_SECRET=<set-outside-repo>
```

## Host Probe

Current Tencent Cloud Lighthouse target for the initial-release deployment probe:

```text
InstanceId: lhins-6gznhrts
Region: ap-shanghai
Public IPv4: 124.222.40.40
Private IPv4: 10.0.0.15
Image: Ubuntu22.04-Docker26 / Ubuntu Server 22.04 LTS 64bit
Nominal SKU: 4 vCPU / 4 GB RAM / 40 GB SSD / 3 Mbps / 300 GB monthly traffic
Guest architecture / CPU: x86_64 / 4 vCPU
Guest-visible RAM: 3,564,584,960 bytes = 3.3198 GiB (report as 3.32 GiB)
Swap: 3 GiB (record separately; not steady-state RAM)
PostgreSQL max_connections: 100
SSH user: ubuntu
SSH key: /Users/lee/.ssh/tengxun-ssh-key.pem
Remote probe dir: /home/ubuntu/smallkhoj-deploy
```

The nominal SKU is **4 vCPU / 4 GB**, not 2 vCPU / 2 GB. Capacity planning
must use the guest-visible `3.32 GiB` RAM figure and must not add swap to the
steady-state memory budget.

> **Old-deployment evidence boundary (2026-07-24):** the provisioning, smoke,
> browser, daemon and resource observations below were captured from older
> deployed images. The audit-remediation candidate on
> `feat/2026-07-audit-remediation` is local only and has not been merged or
> deployed. Do not test or benchmark the old cloud deployment as proof for that
> candidate. Finish local focused/UI validation, make precise commits, rebuild
> and pass capacity/full gates from the clean candidate SHA, merge by PR/squash,
> build and deploy new `linux/amd64` images, and only then validate cloud-prod.

Provisioning notes captured on 2026-06-29:

- Tencent Lighthouse firewall allows TCP 22, 80, and 443, plus ICMP ping.
- SSH access is verified with the local key at `/Users/lee/.ssh/tengxun-ssh-key.pem` using the `ubuntu` user. Keep the key out of the repository and at `0600` permissions.
- Docker 26.1.3 and Docker Compose v2.27.1 are present from the selected Docker base image.
- The `ubuntu` user is in the `docker` group for non-root compose operations.
- A persistent 3 GiB `/swapfile` is configured in `/etc/fstab`.
- `lighthouse_ssh_deploy_probe.py` passed host probe and repo preflight with zero failures and zero warnings when run against the remote probe dir above.
- An IP-only `.env.prod` exists on the host for HTTP smoke testing with `SMALLKHOJ_SITE_ADDRESS=:80`, same-origin frontend API/WS settings, and local-release image tags.
- Core images are available on the host as `smallkhoj-backend:local-release`, `smallkhoj-frontend:local-release`, and `smallkhoj-caddy:local-release`. Backend and Caddy were built as `linux/amd64` locally and loaded on the host; frontend was built natively on the host after local QEMU `linux/amd64` build hit SIGKILL during `next build`.
- `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d db backend frontend caddy` started the core stack successfully.
- `post_deploy_smoke.py --base-url http://124.222.40.40 --allow-http --json` passed with zero failures and zero warnings. Browser evidence via `./twd` shows the deployed login page at `http://124.222.40.40/login`.
- The instance is in a Chinese mainland region. Domain-based public release still needs ICP filing readiness; IP-only HTTP and outbound Feishu/Jira validation can proceed before a formal domain is ready.

Historical core-stack resource baseline captured on 2026-06-29 (old images):

- Evidence file: `.trellis/tasks/archive/2026-06/06-29-06-29-initial-release-lighthouse-resource-baseline/evidence/lighthouse-resource-baseline-2026-06-29.json` after the task is archived.
- Host uptime/load during sampling: about 1 hour 40 minutes uptime, load average `0.00, 0.00, 0.00`.
- Host memory: `3.3 GiB` total, about `662 MiB` used, `2.4 GiB` available.
- Swap: `3.0 GiB` configured, about `3.0 MiB` used.
- Disk: `40 GiB` root volume, `13 GiB` used, `26 GiB` available, `33%` used.
- Container memory at idle/light smoke: backend `107.5 MiB`, frontend `124.7 MiB`, Postgres `41.16 MiB`, Caddy `13.98 MiB`.
- Container CPU at idle/light smoke: backend about `0.25%`, frontend about `0.04%`, Postgres about `0.02%`, Caddy `0.00%`.
- Docker disk usage: images `2.025 GB` with `972.3 MB` reclaimable, build cache `874.1 MB` reclaimable, volumes `50.22 MB`.
- Top memory processes are frontend `bun run server.js` around `166 MiB` RSS, `dockerd` around `138 MiB` RSS, and backend `uvicorn` around `114 MiB` RSS.
- `remote_deploy_evidence.py` returns non-zero on the already-running host because host/runtime preflight report ports 80 and 443 as in-use. For a deployed stack this means Caddy is bound to public ports, not that resource collection failed.
- Historical decision: the 4 vCPU / 4 GB Lighthouse instance was suitable for that old control-plane core stack and no-secret integration preparation. This baseline does not prove the audit-remediation candidate, Feishu long-connection worker, Jira live write-back, daemon TaskRun execution, or concurrent scenario capacity. Repeat resource and capacity evidence only after the merged candidate is deployed.

Daemon remote validation captured on 2026-06-29:

- The first remote connect command registered one local Computer for `Mac-mini.local` with ID `2f539a6a-8b90-43f2-a16d-caafae9daff4`, `machineIdPresent=true`, and an active daemon lease.
- After the daemon was stopped, the Computer list stayed at `count=1` and transitioned to `status=offline`; no duplicate Computer was created.
- The reconnect command for the existing Computer ID started the local `./smallkhoj-daemon` against `http://124.222.40.40` and restored the same Computer to `status=online`. The list still returned `count=1`, the same Computer ID, `machineIdPresent=true`, and `workspaceCount=0`.
- Local daemon logs during reconnect included `Daemon register synced to http://124.222.40.40`, `WS event: connected`, and repeated `Daemon heartbeat synced to http://124.222.40.40`.
- After clean shutdown and lease expiry, the Computer returned to `status=offline` with `count=1`. The API still exposed an `activeDaemonId` value on the offline record; this is not a duplicate-registration bug, but it should be cleaned up or normalized in the Computer status API before relying on that field for UI decisions.

Live-run foundation data captured on 2026-06-29:

- The deployed database has server ID `3893c518-c8f8-43ba-af0d-54a7773bbb6d`.
- The public API created validation channel `#initial-release-validation` with ID `d9d533f2-ccf7-450a-af7f-b27618c7faa9`.
- The channel creator is human member `release-operator` with ID `d1a19ae7-e1f1-4245-ac51-84c60e12b7e9`.
- The backend image was rebuilt as `linux/amd64`, uploaded from `/Volumes/ORICO/smallkhoj-deploy/smallkhoj-backend-amd64-autostart.tar`, loaded on the Lighthouse host, and the backend service was force-recreated.
- The deployed backend now supports creating release assignees with `autoStart=false` or `startRuntime=false` when you need to register the member/workspace before intentionally starting the runtime.
- The release assignee `release-runtime-agent` was created with ID `b03d52dc-b863-4e0a-953b-9b0231f325bc`, workspace ID `35d0da28-0b64-4eb6-9359-767559664b18`, runtime `codex`, provider display name `krill`, runtime provider `8220f087-56d0-43e8-af3e-303ef2c2d845`, `runtimeDesiredStatus=stopped`, workspace `status=stopped`, and `pid=null`.
- Local process inspection after creation found no `aaa-daemon`, `smallkhoj-daemon`, managed `claude`, or managed `codex` runtime process. `post_deploy_smoke.py --base-url http://124.222.40.40 --allow-http --json` still passed with zero failures and zero warnings after backend restart and assignee creation.
- A later backend image was rebuilt as `linux/amd64`, uploaded from `/Volumes/ORICO/smallkhoj-deploy/smallkhoj-backend-amd64-preflight-missing.tar`, loaded on the Lighthouse host, and the backend service was force-recreated. This deployed the live-run preflight improvement that reports all missing worker runtime settings together.
- Container-side bootstrap and live-run preflight CLIs must be executed through `uv run python -m ...` inside the backend container. Direct `python -m ...` does not load the image's Python dependencies.
- Current no-network live-run preflight fails at `workerConfig` with `LIVE_RUN_PREFLIGHT_WORKER_CONFIG_INCOMPLETE`, listing `FEISHU_WORKER_CONNECTOR_ID`, `FEISHU_WORKER_JIRA_CONNECTOR_ID`, `FEISHU_WORKER_CREATOR_ID`, `FEISHU_WORKER_APP_ID`, `FEISHU_WORKER_APP_SECRET`, `FEISHU_REPLY_ACCESS_TOKEN`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`. This is expected before integration bootstrap and runtime env are configured.
- `scripts/update_prod_env_from_stdin.py` was copied to the current Lighthouse deploy directory and smoke-tested with non-secret `FEISHU_WORKER_ENABLED=false`. The command created `.env.prod.bak`, printed only `<unchanged>`, and left core `post_deploy_smoke.py --base-url http://124.222.40.40 --allow-http --json` green.

Before installing or starting anything on Tencent Cloud Lighthouse, create the no-secret deployment bundle on your local machine:

```bash
python3 scripts/make_deployment_bundle.py --output /tmp/smallkhoj-deploy-bundle.tar.gz
```

Upload and unpack the bundle on the server:

```bash
tar -xzf smallkhoj-deploy-bundle.tar.gz
cd smallkhoj-deploy
```

Then run the read-only host probe:

```bash
python3 scripts/lighthouse_host_probe.py --json
```

The bundle includes `docker-compose.prod.yml`, `deploy/caddy/Dockerfile`, `deploy/caddy/Caddyfile`, this runbook, `manifest.json`, and the deployment probe/preflight/smoke scripts. It does not include `.env.prod` or secrets. The host probe reports OS/package-manager access, sudo availability, CPU, memory, swap, disk, Docker, Docker Compose, ports 80/443, and firewall tooling. It may print suggested bootstrap commands for Ubuntu/Debian Docker install, swapfile creation, and UFW port rules, but it does not execute them.

On the current nominal 4 vCPU / 4 GB Lighthouse host, use the guest-visible
`3.32 GiB` RAM value for capacity calculations. Missing or small swap is a
deployment warning, but the configured 3 GiB swap is emergency headroom only
and does not increase the steady-state memory budget. Heavy image builds should
still happen off-host.

You can also run the no-secret SSH probe runner from the local machine. Start with `--dry-run` so the exact upload and remote commands are visible before execution:

```bash
python3 scripts/lighthouse_ssh_deploy_probe.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /opt/smallkhoj \
  --dry-run
```

Without `--compose-up`, the SSH runner only creates a local bundle, uploads it, unpacks it, runs `lighthouse_host_probe.py --json`, and runs repo/config preflight. It does not upload `.env.prod`, create secrets, start production containers, or contact Feishu/Jira/LLM providers.

When `.env.prod` already exists on the server under the unpacked bundle directory, add runtime preflight:

```bash
python3 scripts/lighthouse_ssh_deploy_probe.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /opt/smallkhoj \
  --remote-env-file .env.prod \
  --runtime-preflight
```

Only after env preflight is clean, make startup explicit:

```bash
python3 scripts/lighthouse_ssh_deploy_probe.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /opt/smallkhoj \
  --remote-env-file .env.prod \
  --runtime-preflight \
  --compose-up \
  --public-base-url http://<server-ip> \
  --allow-http
```

If backend/frontend/Caddy images were loaded with `production_image_transfer.py`, add `--use-loaded-images` so the SSH runner pulls only the database image and does not try to pull local app tags or rebuild Caddy on the small server:

```bash
python3 scripts/lighthouse_ssh_deploy_probe.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /opt/smallkhoj \
  --remote-env-file .env.prod \
  --runtime-preflight \
  --compose-up \
  --use-loaded-images \
  --public-base-url http://<server-ip> \
  --allow-http
```

If a remote probe or compose startup fails, collect no-secret evidence from the local machine:

```bash
python3 scripts/remote_deploy_evidence.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /opt/smallkhoj \
  --remote-env-file .env.prod \
  --public-base-url http://<server-ip> \
  --allow-http \
  --output /tmp/smallkhoj-remote-deploy-evidence.json
```

The evidence collector records host probe, deploy preflight, compose service/ps/log output, Docker disk usage, memory/disk snapshots, and optional public smoke output. It does not print `.env.prod` or run `printenv`.

## Preflight

Create the server-side env file from the no-secret template, then edit it on the server. The template intentionally contains placeholder values; preflight fails until required placeholders are replaced:

```bash
python3 scripts/create_prod_env_template.py --output .env.prod
vim .env.prod
```

If `.env.prod` already exists, the template command refuses to overwrite it unless `--force` is provided.

When updating the existing server env file with Feishu/Jira runtime values, do not put secrets in SSH command arguments. Put the patch file outside the repository, then pipe it over stdin:

```bash
python3 scripts/validate_release_worker_env.py --json /Volumes/ORICO/smallkhoj-secrets/release-worker.env
```

```bash
ssh -i ~/.ssh/<key> ubuntu@<server-ip> \
  'cd /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy && python3 scripts/update_prod_env_from_stdin.py --env-file .env.prod --json' \
  < /Volumes/ORICO/smallkhoj-secrets/release-worker.env
```

`release-worker.env` should contain only the keys you want to update, for example:

```bash
FEISHU_WORKER_ENABLED=true
FEISHU_WORKER_CONNECTOR_ID=<bootstrap-output>
FEISHU_WORKER_JIRA_CONNECTOR_ID=<bootstrap-output>
FEISHU_WORKER_CREATOR_ID=<release-operator-or-creator-member-id>
FEISHU_WORKER_APP_ID=<cli_app_id>
FEISHU_WORKER_APP_SECRET=<set-outside-repo>
FEISHU_WORKER_BOT_OPEN_ID=<ou_bot_open_id>
FEISHU_REPLY_ACCESS_TOKEN=<set-outside-repo>
JIRA_EMAIL=<jira-email>
JIRA_API_TOKEN=<set-outside-repo>
```

The validator refuses unknown or malformed keys, treats empty/placeholder required values as missing, and prints only key names plus readiness metadata. The updater creates `.env.prod.bak`, refuses unknown keys, and prints only key names with `<set>`, `<empty>`, or `<unchanged>` markers.

After `release-worker.env` is filled, prefer the guarded rollout CLI instead of hand-running each SSH command. Start with a dry-run plan:

```bash
python3 scripts/release_worker_rollout.py \
  --dry-run \
  --json \
  --host 124.222.40.40 \
  --user ubuntu \
  --identity-file /Users/lee/.ssh/tengxun-ssh-key.pem \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --bundle-prefix smallkhoj-deploy \
  --env-file /Volumes/ORICO/smallkhoj-secrets/release-worker.env \
  --feishu-chat-id <chat-id> \
  --feishu-chat-type group \
  --command jira_analysis
```

When the plan is correct, apply the env update, restart only the backend, and run live-run preflight:

```bash
python3 scripts/release_worker_rollout.py \
  --apply \
  --json \
  --host 124.222.40.40 \
  --user ubuntu \
  --identity-file /Users/lee/.ssh/tengxun-ssh-key.pem \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --bundle-prefix smallkhoj-deploy \
  --env-file /Volumes/ORICO/smallkhoj-secrets/release-worker.env \
  --feishu-chat-id <chat-id> \
  --feishu-chat-type group \
  --command jira_analysis
```

Only add `--start-worker` after the same command has produced a successful live-run preflight. The CLI rejects `--start-worker` without `--apply`; worker startup is intentionally behind the preflight gate.

External values to collect before running integration bootstrap:

- `FEISHU_WORKER_APP_ID` and `FEISHU_WORKER_APP_SECRET`: in the Feishu Open Platform app detail page, use the app credentials section under credentials/basic information. Feishu's long-connection event client also requires the app ID and app secret.
- `FEISHU_WORKER_BOT_OPEN_ID`: use Feishu's documented Open ID lookup path, such as API Explorer/OpenAPI lookup, for the bot/application identity used by the app.
- `--feishu-chat-id`: use the Feishu group ID / `chat_id` lookup path. Feishu documents that `chat_id` can be obtained from group creation responses, group list APIs, API Explorer, or supported client group settings.
- `JIRA_EMAIL` and `JIRA_API_TOKEN`: use a Jira Cloud account email and an Atlassian API token for Basic auth. Prefer a service account with the minimum Jira project permissions needed for issue read/comment/write-back.
- `--jira-site-url`: use the Jira Cloud site origin, for example `https://your-team.atlassian.net`.

Reference docs:

- Feishu long connection: `https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case?lang=zh-CN`
- Feishu Open ID: `https://open.feishu.cn/document/platform-overveiw/basic-concepts/user-identity-introduction/open-id`
- Feishu group/chat ID: `https://open.feishu.cn/document/server-docs/group/chat/chat-id-description?lang=zh-CN`
- Jira REST Basic auth: `https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/`
- Atlassian API token management: `https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/`

Run the repository/config preflight before building or pulling images:

```bash
python3 scripts/initial_release_deploy_preflight.py --json
```

Run the env-file preflight before starting the production compose stack. The command does not print secret values:

```bash
python3 scripts/initial_release_deploy_preflight.py --env-file .env.prod --json
```

Run the runtime preflight on the deployment host, including Tencent Cloud Lighthouse, before binding Caddy to public ports:

```bash
python3 scripts/initial_release_deploy_preflight.py --env-file .env.prod --runtime --json
```

The runtime preflight checks Docker, Docker Compose, memory, disk, and whether ports 80/443 already appear occupied. It does not contact Tencent Cloud, Feishu, Jira, LLM providers, or start production containers.

## Local Production Smoke

Before uploading a release bundle to Tencent Cloud Lighthouse, run the production stack locally with temporary ports and no real secrets. This validates the same Compose/Caddy/backend/frontend path without binding privileged ports or using the dev servers.

Create a temporary env file outside the repo:

```bash
cat >/tmp/smallkhoj-prod-smoke.env <<'EOF'
SMALLKHOJ_SITE_ADDRESS=:80
SMALLKHOJ_HTTP_PORT=18080
SMALLKHOJ_HTTPS_PORT=18443
SMALLKHOJ_BACKEND_IMAGE=smallkhoj-backend:local-smoke
SMALLKHOJ_FRONTEND_IMAGE=smallkhoj-frontend:local-smoke
SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:local-smoke
POSTGRES_PASSWORD=local-smoke-password
PUBLIC_API_KEY=sk_local_prod_smoke_public_key
AUTH_BRIDGE_SECRET=sk_local_prod_smoke_auth_bridge_secret_min_32_chars
BETTER_AUTH_SECRET=sk_local_prod_smoke_better_auth_secret_min_32_chars
BETTER_AUTH_URL=http://127.0.0.1:18080
BETTER_AUTH_DATABASE_POOL_SIZE=10
BACKEND_CORS_ORIGINS=http://127.0.0.1:18080
UPLOAD_MAX_BYTES=52428800
UPLOAD_READ_CHUNK_BYTES=65536
UPLOAD_CLEANUP_TIMEOUT_SECONDS=5
SMALLKHOJ_UPLOAD_REQUEST_BODY_MAX=55MB
EOF
```

Export that temporary env file before the frontend build so BuildKit can read
the same `PUBLIC_API_KEY` that Compose will pass to the backend:

```bash
set -a
. /tmp/smallkhoj-prod-smoke.env
set +a
```

Build local images. Use the VPN proxy build args when network pulls or dependency installs time out:

```bash
docker build \
  --build-arg HTTP_PROXY=http://host.docker.internal:7897 \
  --build-arg HTTPS_PROXY=http://host.docker.internal:7897 \
  --build-arg http_proxy=http://host.docker.internal:7897 \
  --build-arg https_proxy=http://host.docker.internal:7897 \
  -t smallkhoj-backend:local-smoke ./backend

docker build \
  --no-cache \
  --build-arg HTTP_PROXY=http://host.docker.internal:7897 \
  --build-arg HTTPS_PROXY=http://host.docker.internal:7897 \
  --build-arg http_proxy=http://host.docker.internal:7897 \
  --build-arg https_proxy=http://host.docker.internal:7897 \
  --build-arg NEXT_PUBLIC_API_BASE_URL= \
  --build-arg NEXT_PUBLIC_WS_BASE_URL= \
  --build-arg NEXT_PUBLIC_DEPLOYMENT_ENV=production \
  --secret id=public_api_key,env=PUBLIC_API_KEY \
  -t smallkhoj-frontend:local-smoke ./frontend

docker build -t smallkhoj-caddy:local-smoke ./deploy/caddy
```

Start and smoke the stack:

```bash
docker compose --env-file /tmp/smallkhoj-prod-smoke.env -f docker-compose.prod.yml up -d db backend frontend caddy
sleep 3
python3 scripts/post_deploy_smoke.py --base-url http://127.0.0.1:18080 --allow-http --json
docker compose --env-file /tmp/smallkhoj-prod-smoke.env -f docker-compose.prod.yml down -v
```

## Start

Pull and start the core web stack when using registry-hosted backend/frontend images:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull db backend frontend
docker compose --env-file .env.prod -f docker-compose.prod.yml build caddy
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d db backend frontend caddy
```

When using locally loaded app images from `production_image_transfer.py`, pull only Postgres and then start the stack:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull db
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d db backend frontend caddy
```

After the integration bootstrap and preflight pass, start the Feishu long-connection worker:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml --profile feishu-worker up -d feishu-worker
```

## Verify

Run the post-deploy smoke from a machine outside the Docker network:

```bash
python3 scripts/post_deploy_smoke.py --base-url https://smallkhoj.example.com --json
```

The smoke includes a no-secret daemon WebSocket route check. It sends an unauthenticated WebSocket upgrade to `/internal/agent-api/ws` and expects an auth rejection, which proves Caddy reached the backend route without using a real machine token.

For IP-only HTTP smoke tests before DNS/ICP/HTTPS is ready, make the weaker transport explicit:

```bash
python3 scripts/post_deploy_smoke.py --base-url http://<server-ip> --allow-http --json
```

Fallback manual checks:

```bash
curl -I https://smallkhoj.example.com/
curl https://smallkhoj.example.com/api/health
curl -I https://smallkhoj.example.com/docs
curl https://smallkhoj.example.com/openapi.json
```

## Daemon Distribution

Build a versioned daemon artifact from the release checkout:

```bash
python3 scripts/build_daemon_distribution.py \
  --output-dir ./release-artifacts/smallkhoj-daemon \
  --platform darwin-arm64 \
  --json
```

Upload every generated file in `release-artifacts/smallkhoj-daemon/` to the same public base path, for example:

```text
https://smallkhoj.example.com/downloads/smallkhoj-daemon/
```

The directory must contain:

```text
install.sh
smallkhoj-daemon-v<version>-darwin-arm64.tar.gz
smallkhoj-daemon-v<version>-darwin-arm64.tar.gz.sha256
smallkhoj-daemon-v<version>-darwin-arm64.tar.gz.manifest.json
```

Set backend deployment variables so generated onboarding metadata is public-domain aware:

```bash
MINIMUM_DAEMON_VERSION=0.2.0
DAEMON_DOWNLOAD_BASE_URL=https://smallkhoj.example.com/downloads/smallkhoj-daemon
```

Install on a Mac mini or other supported macOS arm64 machine without a repository checkout:

```bash
curl -fsSL https://smallkhoj.example.com/downloads/smallkhoj-daemon/install.sh \
  | SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL=https://smallkhoj.example.com/downloads/smallkhoj-daemon bash

export PATH="$HOME/.smallkhoj/bin:$PATH"
smallkhoj-daemon --version
```

Connect with a one-time ticket from the product UI/API:

```bash
smallkhoj-daemon connect --token <connect-token> --server https://smallkhoj.example.com
```

When `--workspace` is omitted, the installed daemon stores managed runtime workspaces under `~/.smallkhoj/daemon/workspaces/.slock-runtimes/<serverId>/<computerId-or-machineId>/<workspaceId>`. Use `SMALLKHOJ_DAEMON_WORKSPACE_ROOT` only when intentionally placing those runtime files on another disk.

Reconnect uses the same installed CLI and a fresh one-time reconnect ticket:

```bash
smallkhoj-daemon connect --token <reconnect-token> --server https://smallkhoj.example.com
```

Upgrade by uploading a newly built versioned artifact and rerunning the install command. The installer replaces the `~/.smallkhoj/bin/smallkhoj-daemon` launcher to point at the new version under `~/.smallkhoj/daemon/versions/`. Restart any running daemon after upgrade so register/heartbeat reports the new version.

Rollback by republishing or retaining the previous artifact directory, rerunning its `install.sh`, then restarting the daemon. Keep at least the previous known-good daemon artifact and checksum until the release is accepted.

Troubleshooting:

- `SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL is required`: run the install command exactly as shown above or export that variable before `bash install.sh`.
- checksum verification fails: re-upload the `.tar.gz` and `.sha256`/manifest from the same build output; do not mix files from different builds.
- `smallkhoj-daemon: command not found`: add `~/.smallkhoj/bin` to `PATH` or run `~/.smallkhoj/bin/smallkhoj-daemon`.
- connect returns `426 Unsupported daemon version`: install the current artifact or lower `MINIMUM_DAEMON_VERSION` only as an explicit release rollback decision.
- connect returns `409 Computer already has an active daemon`: stop the existing daemon or wait for its backend lease to expire before reconnecting.
- two connected Computers appear on the same host: verify their heartbeat workspace `cwd` values differ by the `<computerId-or-machineId>` path segment before starting live runtimes.
- WebSocket fails after connect: verify Caddy routes `/internal/*` and run `python3 scripts/post_deploy_smoke.py --base-url https://smallkhoj.example.com --json`.

Then validate daemon URL shape with the public server URL:

```bash
smallkhoj-daemon connect --token <connect-token> --server https://smallkhoj.example.com
```

The daemon must derive WebSocket paths under:

```text
wss://smallkhoj.example.com/internal/agent-api/ws
```

## Integration Sequence

After the web stack is reachable, run the existing integration sequence against the deployment database:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T backend \
  uv run python -m integration_bootstrap_cli \
  --server-id <server_uuid> \
  --channel-id <channel_uuid> \
  --creator-id <human_member_uuid> \
  --assignee-id <agent_member_uuid> \
  --feishu-chat-id <oc_or_ou_chat_id> \
  --feishu-chat-type group \
  --feishu-app-id <cli_app_id> \
  --feishu-bot-open-id <ou_bot_open_id> \
  --feishu-bot-name SmallKhoj \
  --jira-site-url https://your-team.atlassian.net

docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T backend \
  uv run python -m live_run_preflight_cli \
  --feishu-chat-id <oc_or_ou_chat_id> \
  --feishu-chat-type group \
  --command jira_analysis
```

For the current Lighthouse validation database, the known non-secret IDs are:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T backend \
  uv run python -m integration_bootstrap_cli \
  --server-id 3893c518-c8f8-43ba-af0d-54a7773bbb6d \
  --channel-id d9d533f2-ccf7-450a-af7f-b27618c7faa9 \
  --creator-id d1a19ae7-e1f1-4245-ac51-84c60e12b7e9 \
  --assignee-id b03d52dc-b863-4e0a-953b-9b0231f325bc \
  --feishu-chat-id <oc_or_ou_chat_id> \
  --feishu-chat-type group \
  --feishu-app-id <cli_app_id> \
  --feishu-bot-open-id <ou_bot_open_id> \
  --feishu-bot-name SmallKhoj \
  --jira-site-url https://your-team.atlassian.net
```

Only start `feishu-worker` after preflight reports `ready: true`.

## Registry-free Manual Deploy: Deviations And Gotchas

The `production_image_transfer.py` flow above is the supported path: it validates
a formal capacity report, writes release evidence, inspects image IDs/platforms,
and refuses a dirty tree. A **manual** `docker build` → `docker save` → `scp` →
`docker load` → `compose up` flow is sometimes used to move fast, but every guard
it skips is a footgun. The list below was collected from a 2026-07-31 deploy that
bypassed the tool; follow the supported path when you can, and when you cannot,
check each item manually.

### Deviations from the supported flow (and how to compensate)

- **Build with a `docker-container` buildx builder on Apple Silicon, not the
  colima embedded buildkit.** The embedded buildkit emulates `linux/amd64`
  through QEMU and the Next.js production build crashes with
  `SIGILL` (`build worker exited with signal SIGILL`). Create a
  `docker-container` builder with a `buildkitd.toml` registry-mirror and
  `--driver-opt network=host` (see the "Apple Silicon cross-arch build pitfalls"
  section). The backend image (Python only) builds fine under the embedded
  buildkit once `/etc/docker/daemon.json` has `registry-mirrors`; only the
  frontend needs the separate builder.
- **Do NOT hand-edit `Dockerfile` to point `FROM` at a mirror.** When the
  embedded buildkit cannot reach Docker Hub, fix the daemon's
  `registry-mirrors` or switch builders; never rewrite `FROM python:3.12-slim`
  to a mirror URL. A temp-edit Dockerfile is easy to forget and silently
  diverges production images from the tracked Dockerfile contract.
- **Prefer the `legacy_schema_preflight.py` adopt helper over a hand-rolled
  `alembic stamp`.** When starting a new backend image against a database that
  predates Alembic, `backend/scripts/legacy_schema_preflight.py` fingerprints
  the current schema against the 0001 baseline and tells you exactly which
  post-baseline objects are missing. Stamping by guess skips it and leaves the
  schema/version inconsistent (see the `messages.seq` gotcha under "Adopting a
  pre-existing database" below). `alembic stamp` writes only the version row;
  it never applies or verifies the migration DDL.
- **Manual transfer loses release evidence.** `production_image_transfer.py`
  writes `<archive>.release-evidence.json` binding tested HEAD/tree, image IDs,
  archive hash, and capacity report. A manual `docker save | gzip` produces
  none. At minimum record by hand: source HEAD (`git rev-parse HEAD`), each
  image ID (`docker inspect --format '{{.Id}}'`), the archive SHA-256, and the
  pre/post Alembic revision — or you cannot answer "what exactly is running".

### Gotchas hit during the 2026-07-31 deploy

- **`.env.prod` must contain `PUBLIC_API_KEY`, not only `NEXT_PUBLIC_API_KEY`.**
  New backend builds (`config.py` since `5749828`) reject the
  `sk_public_local` development value when `DEBUG=false` and require the env
  var to be present. An older `.env.prod` that only had `NEXT_PUBLIC_API_KEY`
  fails with `PUBLIC_API_KEY must be configured when DEBUG=false`. Compose then
  bridges that single `PUBLIC_API_KEY` to the frontend; do not maintain two
  separate values.
- **`docker compose --env-file .env.prod -f docker-compose.prod.yml ...` order
  matters.** `--env-file` must accompany `-f`; running `compose -f <file>
  config` alone reports `required variable ... is missing` even when the env
  file has it, because variable interpolation only happens against the env
  file you pass. Always validate with the exact `--env-file ... -f ...` pair
  you will deploy with.
- **`docker load` of an image whose tag already exists renames the old image to
  `<none>:<none>`.** The previous image is not lost (you can still reference it
  by ID), but the tag is silently reassigned. Before any deploy, tag the
  currently-running image as `smallkhoj-<svc>:rollback-pre-<reason>-<UTC>` so a
  partial failure can retag back; do not rely on remembering the old image ID.
- **A partial-service rollback must keep `PUBLIC_API_KEY` consistent.** Rolling
  back only the frontend image to a build that baked an older key, while
  backend `.env.prod` moved to a new key, makes every authenticated request
  return 401 `Invalid API key` and hangs server-component route changes. See the
  Failure Modes entry "Page navigation hangs (~15s) after a partial frontend
  rollback" for diagnosis.

## Failure Modes

- `curl https://domain/api/health` fails but `/` works: check Caddy `/api/*` routing and backend container logs.
- `ws.daemonAuth` fails with `POST_DEPLOY_SMOKE_DAEMON_WS_UNEXPECTED_STATUS`: check Caddy `/internal/*` routing and backend container logs. `401` or `403` is expected for this no-token smoke; `101` is unsafe because the daemon WebSocket accepted an unauthenticated upgrade.
- Remote startup fails but the reason is unclear: run `scripts/remote_deploy_evidence.py` and inspect the JSON labels `host-probe`, `runtime-preflight`, `compose-ps`, and `compose-logs-core`.
- Daemon command contains `http://backend:8000`: frontend is leaking internal URL into public command generation; set `NEXT_PUBLIC_API_BASE_URL=https://domain` or check forwarded headers through Caddy.
- Browser WebSocket uses `ws://` on HTTPS page: check `NEXT_PUBLIC_WS_BASE_URL`; empty same-origin should derive `wss://`.
- Caddy cannot issue a certificate: check DNS A record, firewall ports 80/443, and ICP/provider restrictions.
- Server runs out of memory during deploy: do not build images on the server; pull prebuilt backend/frontend images or use `scripts/production_image_transfer.py` to load locally built images.
- **Page navigation hangs (~15s) after a partial frontend rollback**: the rolled-back frontend image baked an older `NEXT_PUBLIC_API_KEY` while backend `.env.prod` already moved to a new `PUBLIC_API_KEY`. Every authenticated API call returns 401 `Invalid API key`, so server-component route changes (`requireCurrentAccount`) retry/redirect and the UI freezes. This is a credential-mismatch symptom, not a code performance regression — diagnose with `curl /api/v1/auth/me` (returns 401 fast) before profiling the frontend. A partial rollback is only safe when the rolled-back image's baked key equals the current backend key; otherwise roll both back together. Same root cause as the `Invalid API key` note in Environment, but the user-visible failure mode is a hang, so it is easy to misread as a Next.js / bundle problem.

### Adopting a pre-existing database (alembic stamp + owner guard)

When a backend image from commit `5749828` or later first starts against a
database that predates Alembic management, startup fails with three distinct,
cascading errors. Each is a deliberate safety guard, not a bug; resolve them in
this order (hit during the 2026-07-31 deploy):

1. **`relation "servers" already exists` / `DuplicateTableError`** — the
   database has tables but no `alembic_version` row, so `alembic upgrade head`
   replays the baseline `CREATE TABLE`. First inspect which migration-introduced
   tables/columns already exist (`llm_run_leases`, `task_run_templates.server_id`),
   then `alembic stamp <last-applied-revision>` to the highest revision whose
   schema is already present, and let `upgrade head` apply only the missing
   ones. Do not stamp past a revision whose DDL has not actually been applied
   (e.g. stamping to `0004` when `task_run_templates.server_id` is missing leaves
   the schema/version inconsistent and the next startup still fails). If a
   later table was created out of band, drop it before re-running `upgrade head`
   so the migration owns its creation.

   **`alembic stamp` only writes the version row; it does NOT execute or verify
   the migration DDL.** Column-level transforms are easy to miss when adopting
   a pre-managed database: `messages.seq` was made `GENERATED ALWAYS AS
   IDENTITY` by revisions 0002/0003, but an unmanaged legacy DB keeps the old
   plain `NOT NULL` column. After stamping past those revisions, the app INSERTs
   without a `seq` value (expecting the identity to fill it), hits
   `NotNullViolationError: null value in column "seq"`, and every message send
   fails. Always spot-check identity/default-bearing columns
   (`information_schema.columns.is_identity`) after stamping; if a stamped
   revision's DDL is actually missing, apply it by hand (`ALTER TABLE ...
   ADD GENERATED ... AS IDENTITY; SELECT setval(...)`) so the schema matches the
   stamped version before restarting.

2. **`LEGACY_MEMBERSHIP_MULTIPLE_ACTIVE_OWNERS`** — `models/seed.py` refuses to
   guess which account to demote when a server has more than one active owner.
   Inspect `server_memberships` (`role='owner' AND status='active'`), keep the
   one true owner (typically the oldest human account), and
   `UPDATE ... SET role='member'` for the rest before restarting.

3. **`PUBLIC_API_KEY must not use the repository-known development value when
   DEBUG=false`** — `backend/config.py` and `frontend/runtime-url.ts` reject
   `sk_public_local` in production. Generate a real key, set both
   `PUBLIC_API_KEY` and `NEXT_PUBLIC_API_KEY` in `.env.prod` to the same value,
   and rebuild the frontend image with that key as the BuildKit secret (the
   running frontend baked the old key into browser assets). Rotating the key
   invalidates connect tickets and machine tokens signed under the old key, so
   do it during a window when no Computers need to stay connected.
