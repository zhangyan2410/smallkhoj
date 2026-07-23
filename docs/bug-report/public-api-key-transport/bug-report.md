# Public API credential configuration and transport

## Bug diagnosis capsule

| Field | Content |
|---|---|
| **1. Symptom** | The backend accepts the repository-known `sk_public_local` value and reads a reusable key from either `X-Public-Key` or `?api_key=`. Development and production compose files independently default `NEXT_PUBLIC_API_KEY` to the same value. The chat WebSocket has no authentication. Expected: one documented credential source, production fail-closed, and no reusable credential in any URL. |
| **2. Evidence** | `backend/routers/public_api.py` defines `PUBLIC_API_KEY = "sk_public_local"` and `verify_public_api_key()` reads a query parameter. `frontend/lib/control-plane.ts`, `frontend/Dockerfile`, `docker-compose.yml`, and `docker-compose.prod.yml` retain the same public default. Advisor commits `91a8189` and `7d4885d` are candidate evidence only: the first warns instead of failing production and the second adds `/api/chat/ws?api_key=...`. |
| **3. Confirmed root cause** | Credential ownership and environment classification are not represented as an executable configuration contract. Multiple layers carry their own fallback and the authentication boundary treats URL query parameters as a supported transport. WebSocket authentication was omitted rather than designed around browser transport constraints. |
| **4. Diagnostic strategy** | Characterize HTTP, bridge, WebSocket, frontend build/runtime and compose paths. Add direct configuration and route tests that assert header/subprotocol transport and inspect request URLs. Compare the chat WebSocket with existing authenticated machine/public routes. Treat advisor hunks as untrusted and reuse only independently proven parts. |
| **5. Timeout strategy** | If a browser-compatible WebSocket subprotocol cannot be proven through the local Caddy path within one focused implementation cycle, stop at the task STOP condition and present header/subprotocol versus short-lived exchange trade-offs; do not reintroduce query credentials. |
| **6. Warning strategy** | Stop if a test passes while a credential still appears in a URL, log, error detail, screenshot, or known default. Three failed transport revisions indicate an architecture decision is needed rather than another compatibility exception. |
| **7. User-visible correction** | Local development may retain an explicitly classified development credential. Production startup/build must reject missing or known-development values. Invalid credentials receive a stable denial without echoing the credential. |
| **8. Acceptance** | RED: configured-key/header-only tests, query rejection, production missing/default preflight failure, empty bridge secret failure even under debug, unauthenticated/wrong-key WebSocket rejection, and URL inspection. GREEN: focused backend/frontend tests plus local-prod Caddy handshake evidence, then full gates. Exact commands and results are appended during TDD. |

## Report

- **Reporter:** Independent re-audit of findings 002 and TEST-02 on 2026-07-23.
- **Reproduction:** Call a protected public route with `?api_key=sk_public_local`, or start production wiring without overriding `NEXT_PUBLIC_API_KEY`; current behavior accepts the URL/default path. Connect to `/api/chat/ws` without authentication; the current handshake succeeds to the application boundary.
- **Root cause:** There is no single environment-aware credential contract and no transport policy shared by HTTP, WebSocket, frontend build/runtime, and compose.
- **Repair direction:** Introduce a canonical backend setting with an explicit local-dev exception, make production preflight fail closed, accept HTTP headers only, authenticate WebSocket through a reviewed non-URL channel, and update all clients/deployment docs together.
- **Verification:** Tests must prove both acceptance of the approved channel and absence/rejection of URL credentials. A static constant assertion or warning is insufficient.

## Browser runtime environment regression capsule

| Field | Content |
|---|---|
| **1. Symptom** | The real `/tasks` page renders the Next global error boundary with `NEXT_PUBLIC_API_KEY must be configured with a non-development value for production builds`, even though the frontend process was started with `NODE_ENV=development`, `NEXT_PUBLIC_DEPLOYMENT_ENV=local-dev`, and `NEXT_PUBLIC_API_KEY=sk_public_local`. Expected: the guarded local-development page loads with the configured public credential while production remains fail-closed. |
| **2. Evidence** | Dedicated runtime: frontend `127.0.0.1:3000`, PID `44990`, started `2026-07-23 15:46:56 +08:00`, worktree HEAD `397db8c`. `./twd` reached the authenticated `/tasks` tab and a React error-fiber inspection returned the exact `resolvePublicApiKey` exception. `frontend/lib/control-plane.ts` passed the complete `process.env` object to all runtime URL/key resolvers instead of reading `NEXT_PUBLIC_*` properties explicitly. |
| **3. Confirmed root cause** | Next.js only guarantees client-bundle substitution for statically referenced `process.env.NEXT_PUBLIC_*` properties. Passing the dynamic `process.env` object prevents those public values from being inlined into the browser chunk, so the resolver sees an empty/production-like environment and correctly triggers its fail-closed branch. The credential policy is correct; its client environment adapter is not. |
| **4. Diagnostic strategy** | Preserve the fail-closed resolver unchanged. Add a source-level bundler-boundary contract requiring explicit `process.env.NEXT_PUBLIC_*` reads, then split public and server runtime environment adapters so `INTERNAL_API_BASE_URL` does not enter the browser adapter. Re-run focused tests and verify the rebuilt real page through `./twd`. |
| **5. Timeout strategy** | If explicit property reads do not restore the browser page in one implementation cycle, inspect the emitted client chunk for substituted values and stop before weakening credential validation or adding a browser fallback. |
| **6. Warning strategy** | Any fix that accepts a missing production key, embeds `INTERNAL_API_BASE_URL` in the public adapter, or restores a reusable credential in a URL is invalid. A second runtime failure returns the investigation to emitted-bundle evidence rather than accumulating compatibility branches. |
| **7. User-visible correction** | Authenticated local-development pages load normally; production builds and startup still reject missing or repository-known development credentials. |
| **8. Acceptance** | RED: the control-plane bundler-boundary test fails while resolvers receive `process.env` dynamically. GREEN: focused frontend tests, TypeScript, ESLint, and guarded `./twd` evidence show `/tasks` outside the global error boundary with the expected API connectivity. |

## Candidate patch disposition

- `91a8189`: reuse the settings indirection concept; reject its repository-known production default and warning-only startup behavior.
- `da78bcb`: core fail-closed bridge change is directionally correct; replace/augment fake request tests with route-boundary coverage.
- `7d4885d`: reject because it moves the reusable credential into the WebSocket query string.

## TDD evidence

### RED

Before implementation:

```bash
cd backend
uv run pytest -q tests/test_auth_tenancy_contracts.py
```

Result: `12 failed, 2 passed`. Intended failures covered query-string key
acceptance, missing/default production configuration, the debug auth-bridge
bypass, permission-less access, non-admin member PATCH, and unauthenticated or
query-authenticated chat WebSocket handshakes.

The production image-transfer tests also showed the old plan placing
`NEXT_PUBLIC_API_KEY=sk_public_local` on the Docker command line, while the
generated `.env.prod` template had no canonical `PUBLIC_API_KEY`.

### GREEN

```bash
cd backend
uv run pytest -q \
  tests/test_auth_tenancy_contracts.py \
  tests/test_public_memory_routes.py
# 35 passed in 1.01s

cd ..
PYTHONPATH=. backend/.venv/bin/pytest -q \
  scripts/tests/test_frontend_dockerfile_auth.py \
  scripts/tests/test_production_image_transfer.py \
  scripts/tests/test_create_prod_env_template.py \
  scripts/tests/test_update_prod_env_from_stdin.py
# 16 passed in 0.02s
```

Real BuildKit evidence used `NEXT_PUBLIC_DEPLOYMENT_ENV=production`:

- no `public_api_key` secret: exit 1 with only
  `PUBLIC_API_KEY BuildKit secret is required for production builds`;
- `--secret id=public_api_key,env=PUBLIC_API_KEY`: image build exit 0;
- final image config and history contained no configured test value.

Production-like local-prod evidence used fresh PostgreSQL, current backend/frontend
images, and Caddy at `http://127.0.0.1:18081`:

```text
/api/health = 200
/docs       = 200
/login      = 200
credential_in_url=false
missing_key=denied status=403
wrong_key=denied status=403
correct_key=accepted selected=smallkhoj.chat.v1
```

Backend startup ran all revisions through `0004_template_tenancy`. Its handshake
logs contained only `/api/chat/ws`, denial status, and accepted/closed state; neither
the requested credential protocol nor the credential value was logged.

### Browser runtime environment adapter RED/GREEN

The real Next dev page reproduced the adapter regression at `/tasks` even with
the expected local env. The source contract then failed for the intended reason:

```text
13 passed, 1 failed
failure: resolvePublicApiBase(process.env, ...) / resolvePublicApiKey(process.env)
```

`control-plane.ts` now constructs an explicit `PUBLIC_RUNTIME_ENV` using static
`process.env.NEXT_PUBLIC_*` property reads and a separate server adapter for
`INTERNAL_API_BASE_URL`. Chat WebSocket and computer-connect public URL
resolution reuse the public adapter. Production validation remains fail-closed.

```text
runtime URL focused tests: 14 passed
frontend full suite: 164 passed
lint + TypeScript: passed
production Next build: 13 static pages, exit 0
```

Guarded `./twd` reopened tab `1617512415` at
`http://127.0.0.1:3000/tasks`; the page rendered the task workspace with no
global error or credential exception. A production-like non-default key runtime
then rendered the same page and the 205-item pagination proof.
