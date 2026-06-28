# Initial release production URL and reverse proxy readiness design

## Boundary

This task makes the existing app deployment-compatible. It does not deploy to Tencent Cloud or make the final domain/provider decision.

It owns:

- frontend URL derivation for browser, server-side fetch, and WebSocket;
- backend CORS origin settings;
- production reverse-proxy and compose files;
- release deployment runbook.

It does not own:

- cloud login or firewall changes;
- DNS/ICP completion;
- real Feishu/Jira credentials;
- daemon identity bug fixes.

## Frontend URL Strategy

- `NEXT_PUBLIC_API_BASE_URL`:
  - optional public override;
  - when empty in browser, use same-origin relative URLs.
- `INTERNAL_API_BASE_URL`:
  - server-only internal URL for Next.js server-side fetches;
  - default remains `http://localhost:8000` for local dev.
- `NEXT_PUBLIC_WS_BASE_URL`:
  - optional public WebSocket override;
  - when empty in browser, derive from `window.location.origin`, converting `https` to `wss` and `http` to `ws`;
  - fallback to localhost for non-browser tests/dev.

## Backend CORS Strategy

Add `backend_cors_origins` as a comma-separated setting. Keep localhost defaults. Only append explicit configured origins. Do not use wildcard credentialed CORS.

## Reverse Proxy

Use Caddy because it can automate HTTPS and handles WebSocket upgrades through `reverse_proxy`.

Routes:

```text
/api/*      -> backend:8000
/internal/* -> backend:8000
/*          -> frontend:3000
```

The daemon public URL can be `https://domain` and its WebSocket path remains `/internal/agent-api/ws`.

## Compose Shape

`docker-compose.prod.yml` should:

- use image env vars rather than mandatory server-side builds;
- keep Postgres, backend, and frontend on internal Docker network;
- expose only Caddy ports 80/443 publicly;
- include `feishu-worker` behind a `feishu-worker` profile.

## Validation

Use unit tests for URL/CORS derivation and syntax/grep checks for compose/proxy files. Real TLS/DNS validation stays for the deployment turn.
