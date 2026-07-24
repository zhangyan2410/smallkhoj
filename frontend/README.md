# SmallKhoj frontend

The frontend is a Next.js App Router application. Bun is the only supported
package manager; `frontend/bun.lock` is the dependency truth used by local
development, CI and the production Docker build.

## Install and run

```bash
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:3000`. The standard Next development server is the normal
product frontend. `server.ts` remains a compatibility/custom-server entrypoint
for its explicit WebSocket use cases:

```bash
bun run server:dev
```

Do not generate npm, Yarn or pnpm lockfiles. Dependency changes use `bun add`,
`bun remove` and a reviewed `bun.lock` update.

## Canonical checks

```bash
bun install --frozen-lockfile
bun run test
bun run lint
bun run typecheck
bun run typecheck:e2e
bun run build
test -f .next/standalone/server.js
```

Production builds require the non-secret test/runtime shape documented in
`../docs/initial-release-production-deployment.md`, including Better Auth,
bridge and public-client environment values. CI supplies ephemeral values only.

## Automated flow versus UI acceptance

`bun run e2e` runs the committed Playwright integration flow from `../e2e/`.
It intentionally has no localhost, credential, daemon-version or database-scope
fallback. Start isolated candidates, provide the explicit `API_BASE`,
`FRONTEND_BASE`, `E2E_PUBLIC_API_KEY`, `E2E_RUN_NAMESPACE`,
`E2E_DATABASE_SCOPE=disposable`, `DATABASE_URL`, `BETTER_AUTH_DATABASE_URL`,
`INTERNAL_API_BASE_URL`, `BETTER_AUTH_URL`, and reviewed daemon-version
environment, then run `make e2e-authenticated` from the repository root. Both
database URLs must identify the same loopback database and its name must contain
an explicit disposable marker; the frontend's internal API and Better Auth URLs
must identify the same loopback candidates as `API_BASE` and `FRONTEND_BASE`.
The scope label alone is not safety evidence. The package-level `bun run e2e`
entrypoint invokes the same fail-closed validator before Playwright, so it cannot
be used to bypass these checks. CI owns this setup in the normal gate. The suite
verifies a deterministic authenticated cross-layer flow; it is not UI acceptance.

Repository browser-visible acceptance, interactive investigation, DOM markers
and screenshots use the project wrapper from the repository root:

```bash
./twd --compact tabs
```

Follow `../docs/real-test-sop-template.md`. Do not call `twd.py` directly and do
not substitute one-off Playwright scripts for `./twd` evidence.

## Runtime URLs

- Server-side frontend requests use `INTERNAL_API_BASE_URL`.
- Browser requests use same-origin paths unless `NEXT_PUBLIC_API_BASE_URL` is
  explicitly configured at build time.
- The public client key is browser-visible and is not a human account/session.
- Production client environment reads must remain explicit static
  `process.env.NEXT_PUBLIC_*` property accesses so Next.js can inline them.
