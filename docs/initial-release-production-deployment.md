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

The production compose file uses prebuilt backend/frontend images so a 2-core/2GB server does not have to build Next.js or Python dependencies under memory pressure. Caddy is built from `deploy/caddy/` because it is a tiny image layer that bakes in the tracked reverse-proxy config and avoids fragile host file mounts.

The frontend Dockerfile copies Next.js standalone output from `.next/standalone`; keep `frontend/next.config.mjs` configured with `output: "standalone"`. A frontend image build must fail the release gate if `.next/standalone/server.js` is missing after `bun run build`.

For a registry-based deployment, build and push images from a stronger machine or CI:

```bash
docker build -t <registry>/smallkhoj-backend:<tag> ./backend
docker build \
  --build-arg NEXT_PUBLIC_API_BASE_URL= \
  --build-arg NEXT_PUBLIC_WS_BASE_URL= \
  --build-arg NEXT_PUBLIC_API_KEY=sk_public_local \
  -t <registry>/smallkhoj-frontend:<tag> ./frontend
docker push <registry>/smallkhoj-backend:<tag>
docker push <registry>/smallkhoj-frontend:<tag>
```

For the first Lighthouse test, a registry-free flow is usually simpler: build images locally, save them into one Docker archive, upload the archive over SSH, and run `docker load` on the server:

```bash
python3 scripts/production_image_transfer.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /opt/smallkhoj \
  --platform linux/amd64 \
  --use-vpn-proxy \
  --dry-run

python3 scripts/production_image_transfer.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /opt/smallkhoj \
  --platform linux/amd64 \
  --use-vpn-proxy
```

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
  --use-vpn-proxy
```

This loads these default tags on the server:

```bash
SMALLKHOJ_BACKEND_IMAGE=smallkhoj-backend:local-release
SMALLKHOJ_FRONTEND_IMAGE=smallkhoj-frontend:local-release
SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:local-release
```

If you already built those images locally, add `--skip-build` to only save, upload, and load the archive.

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

## Environment

Set deployment env outside the repo, for example in a server-side `.env.prod` file that is not committed.

Required operational values:

```bash
SMALLKHOJ_SITE_ADDRESS=smallkhoj.example.com
SMALLKHOJ_BACKEND_IMAGE=<registry>/smallkhoj-backend:<tag>
SMALLKHOJ_FRONTEND_IMAGE=<registry>/smallkhoj-frontend:<tag>
SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:latest
POSTGRES_PASSWORD=<set-outside-repo>
BACKEND_CORS_ORIGINS=https://smallkhoj.example.com
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
NEXT_PUBLIC_API_KEY=sk_public_local
```

`INTERNAL_API_BASE_URL` is for server-side Next.js fetches inside Docker. It must not be used in daemon connect commands or browser-visible links. The frontend derives public URLs from the request host or browser origin when public overrides are empty.

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
Shape: 4 vCPU / 4 GB RAM / 40 GB SSD / 3 Mbps / 300 GB monthly traffic
SSH user: ubuntu
SSH key: /Users/lee/.ssh/tengxun-ssh-key.pem
Remote probe dir: /home/ubuntu/smallkhoj-deploy
```

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
- Current no-network live-run preflight fails at `workerConfig` with `LIVE_RUN_PREFLIGHT_WORKER_CONFIG_INCOMPLETE`, listing `FEISHU_WORKER_CONNECTOR_ID`, `FEISHU_WORKER_JIRA_CONNECTOR_ID`, `FEISHU_WORKER_CREATOR_ID`, `FEISHU_WORKER_APP_ID`, and `FEISHU_WORKER_APP_SECRET`. This is expected before integration bootstrap and runtime env are configured.
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

On a 2 vCPU / 2 GB Lighthouse host, missing or small swap should be treated as a deployment warning to fix before repeated live-run testing. Heavy image builds should still happen off-host.

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

The updater creates `.env.prod.bak`, refuses unknown keys, and prints only key names with `<set>`, `<empty>`, or `<unchanged>` markers.

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
BACKEND_CORS_ORIGINS=http://127.0.0.1:18080
EOF
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
  --build-arg HTTP_PROXY=http://host.docker.internal:7897 \
  --build-arg HTTPS_PROXY=http://host.docker.internal:7897 \
  --build-arg http_proxy=http://host.docker.internal:7897 \
  --build-arg https_proxy=http://host.docker.internal:7897 \
  --build-arg NEXT_PUBLIC_API_BASE_URL= \
  --build-arg NEXT_PUBLIC_WS_BASE_URL= \
  --build-arg NEXT_PUBLIC_API_KEY=sk_public_local \
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

## Failure Modes

- `curl https://domain/api/health` fails but `/` works: check Caddy `/api/*` routing and backend container logs.
- `ws.daemonAuth` fails with `POST_DEPLOY_SMOKE_DAEMON_WS_UNEXPECTED_STATUS`: check Caddy `/internal/*` routing and backend container logs. `401` or `403` is expected for this no-token smoke; `101` is unsafe because the daemon WebSocket accepted an unauthenticated upgrade.
- Remote startup fails but the reason is unclear: run `scripts/remote_deploy_evidence.py` and inspect the JSON labels `host-probe`, `runtime-preflight`, `compose-ps`, and `compose-logs-core`.
- Daemon command contains `http://backend:8000`: frontend is leaking internal URL into public command generation; set `NEXT_PUBLIC_API_BASE_URL=https://domain` or check forwarded headers through Caddy.
- Browser WebSocket uses `ws://` on HTTPS page: check `NEXT_PUBLIC_WS_BASE_URL`; empty same-origin should derive `wss://`.
- Caddy cannot issue a certificate: check DNS A record, firewall ports 80/443, and ICP/provider restrictions.
- Server runs out of memory during deploy: do not build images on the server; pull prebuilt backend/frontend images or use `scripts/production_image_transfer.py` to load locally built images.
