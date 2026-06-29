# Initial release production deploy preflight CLI design

## CLI Shape

Command:

```bash
rtk python3 scripts/initial_release_deploy_preflight.py [--env-file .env.prod] [--runtime] [--json] [--strict-warnings]
```

Default mode performs offline repository checks. `--runtime` adds host checks that are useful on Tencent Cloud Lighthouse or a local deployment machine. `--env-file` adds env readiness checks without exposing secret values.

## Check Groups

### Repository Config

- `docker-compose.prod.yml` exists.
- Services `db`, `backend`, `frontend`, `caddy`, and `feishu-worker` are declared.
- Caddy publishes `80:80` and `443:443`.
- Backend exposes `8000`; frontend exposes `3000`.
- Feishu worker uses the `feishu-worker` profile.
- `deploy/Caddyfile` routes `/api/*`, `/internal/*`, `/docs`, and `/openapi.json` to `backend:8000`, and defaults to `frontend:3000`.
- `frontend/next.config.mjs` contains `output: "standalone"`.
- `frontend/Dockerfile` copies `/app/.next/standalone` and starts `server.js`.

### Env File

Required for production env-file mode:

- `SMALLKHOJ_SITE_ADDRESS`
- `SMALLKHOJ_BACKEND_IMAGE`
- `SMALLKHOJ_FRONTEND_IMAGE`
- `POSTGRES_PASSWORD`
- `BACKEND_CORS_ORIGINS`

Warn when:

- site address is `:80`, `localhost`, or `http://...` in a deployment env;
- `BACKEND_CORS_ORIGINS` does not include the HTTPS site origin;
- `NEXT_PUBLIC_API_BASE_URL` or `NEXT_PUBLIC_WS_BASE_URL` is set for same-origin deployment.

### Runtime Host

- `docker` command exists.
- Docker daemon responds to `docker info`.
- `docker compose version` responds.
- memory is at least 1.5 GiB, warning below 2 GiB.
- disk free space on the repo filesystem is at least 8 GiB, warning below 12 GiB.
- ports 80 and 443 appear available on the current host.

## Result Contract

Each check returns:

```json
{
  "name": "repo.compose.services",
  "status": "passed|warning|failed",
  "reasonCode": "DEPLOY_PREFLIGHT_READY",
  "reason": "Human-readable summary.",
  "details": {}
}
```

Top-level JSON:

```json
{
  "ready": true,
  "warnings": 1,
  "failures": 0,
  "checks": []
}
```

Exit codes:

- `0`: no failures, or warnings only without `--strict-warnings`.
- `1`: at least one failed check.
- `2`: warnings exist and `--strict-warnings` is set.

## Non-Goals

- Do not contact Tencent Cloud APIs.
- Do not validate real Feishu/Jira credentials.
- Do not start production containers.
- Do not print secret values from `.env` files.
