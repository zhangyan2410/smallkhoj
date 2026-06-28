# Initial release production URL and reverse proxy readiness implementation plan

## Checklist

1. [x] Add frontend tests for API and WebSocket URL derivation.
2. [x] Add backend tests for CORS origin parsing.
3. [x] Implement frontend URL helper and replace direct localhost constants/hook hard-code.
4. [x] Add backend `backend_cors_origins` setting and use it in `main.py`.
5. [x] Add `docker-compose.prod.yml` and `deploy/Caddyfile`.
6. [x] Add deployment runbook.
7. [x] Run targeted frontend/backend tests and lint/type checks where available.
8. [x] Run full backend tests.
9. [ ] Validate and archive task.

## Verification

- `rtk bunx tsx --test test/runtime-url.test.ts test/realtime-events.test.ts test/chat-panel-width-hydration.test.tsx` passed.
- `rtk bun run lint` passed with 16 pre-existing warnings and 0 errors.
- `rtk bun run build` passed.
- `rtk env PYTHONPATH=. uv run pytest` passed with 212 tests.
- `rtk env POSTGRES_PASSWORD=dummy docker compose -f docker-compose.prod.yml config` passed.
- `rtk docker run --rm -i caddy:2 caddy validate --config /dev/stdin --adapter caddyfile < deploy/Caddyfile` passed.

## Operational Note

Docker image pull initially timed out because the active Docker context is Colima and the Colima dockerd had no proxy configured. Host curl through `127.0.0.1:7897` worked, and VM curl through `host.lima.internal:7897` worked. Adding a Colima dockerd systemd drop-in for `HTTP_PROXY`/`HTTPS_PROXY=http://host.lima.internal:7897` fixed the Caddy image pull.
