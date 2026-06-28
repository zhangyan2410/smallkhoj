# Initial release post-deploy smoke CLI design

## CLI Shape

```bash
rtk python3 scripts/post_deploy_smoke.py --base-url https://smallkhoj.example.com [--json] [--allow-http] [--timeout 8]
```

## Checks

- `url.scheme`: HTTPS expected unless `--allow-http`.
- `dns.resolve`: resolve host to at least one address.
- `tcp.connect`: connect to host/port.
- `http.frontend`: `GET /` returns 2xx/3xx and HTML-ish content.
- `http.health`: `GET /api/health` returns 2xx JSON.
- `http.docs`: `GET /docs` returns 2xx/3xx.
- `http.openapi`: `GET /openapi.json` returns 2xx JSON with OpenAPI-like keys.

## Result Contract

Reuse the check result shape from deploy preflight:

```json
{
  "name": "http.health",
  "status": "passed|warning|failed",
  "reasonCode": "POST_DEPLOY_SMOKE_READY",
  "reason": "Human-readable reason.",
  "details": {}
}
```

Top-level:

```json
{
  "ready": true,
  "warnings": 0,
  "failures": 0,
  "baseUrl": "https://smallkhoj.example.com",
  "checks": []
}
```

Exit codes:

- `0`: no failures.
- `1`: failures.
- `2`: warnings when `--strict-warnings`.

## Non-Goals

- Do not authenticate into the app.
- Do not validate Feishu/Jira credentials.
- Do not open WebSocket sessions that require machine tokens.
- Do not start or stop Docker services.
