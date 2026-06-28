# Initial release production URL and reverse proxy readiness

## Goal

Make SmallKhoj deployable behind a production HTTPS domain by removing localhost-only frontend/backend URL assumptions and adding repeatable Caddy/reverse-proxy compose configuration for API and daemon WebSocket paths.

This task prepares the 7-15 initial release for Tencent Cloud Lighthouse, tunnel, or small gateway deployment without requiring a domain decision or cloud credentials in the repository.

## Requirements

- Frontend API URL resolution must support:
  - existing localhost development;
  - same-origin browser deployment through `/api`;
  - server-side Next.js fetches through an internal backend URL such as `http://backend:8000`.
- Frontend WebSocket URL resolution must derive `ws://` or `wss://` from same-origin deployment instead of hard-coding `ws://localhost:8000`.
- Backend CORS must allow configured production origins without opening uncontrolled wildcard credentialed origins by default.
- Provide a production reverse-proxy config that routes:
  - browser pages to frontend;
  - `/api/*` to backend;
  - `/internal/*` to backend for daemon WebSocket and internal agent API paths;
  - WebSocket upgrade paths through the proxy.
- Provide a production compose file suitable for low-memory deployment:
  - database not exposed publicly;
  - backend and frontend internal only;
  - reverse proxy exposes 80/443;
  - Feishu worker can run as an optional service/profile;
  - image names are environment-driven so prebuilt images can be used instead of server-side builds.
- Document deployment env variables and a no-secrets run sequence.

## Acceptance Criteria

- [x] Frontend unit tests cover API base and WebSocket URL derivation for localhost, same-origin HTTPS, and explicit env overrides.
- [x] Backend unit tests cover CORS origin parsing with localhost defaults and configured production origins.
- [x] `docker-compose.prod.yml` and `deploy/Caddyfile` exist and route `/api/*` plus `/internal/*` to backend.
- [x] Runbook documents `INTERNAL_API_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WS_BASE_URL`, `BACKEND_CORS_ORIGINS`, and image/env expectations.
- [x] Targeted backend/frontend checks and full backend tests pass.

## Completion Notes

- Frontend browser calls now default to same-origin relative `/api` while server-side rendering can use `INTERNAL_API_BASE_URL`.
- Public daemon/server URLs are kept separate from internal Docker service URLs so connect commands do not leak `http://backend:8000`.
- Backend CORS keeps localhost defaults and appends explicit configured origins; wildcard credentialed CORS is ignored.
- Caddy routes `/api/*`, `/internal/*`, `/docs`, and `/openapi.json` to backend and routes all other traffic to frontend.
- Production compose exposes only Caddy ports 80/443 and leaves Postgres/backend/frontend internal to the Docker network.

## Out Of Scope

- Logging into Tencent Cloud or changing firewall/DNS.
- Buying SSL certificates.
- Completing ICP filing.
- Running a real deployment on the server.
- Building a full CI/CD pipeline.
