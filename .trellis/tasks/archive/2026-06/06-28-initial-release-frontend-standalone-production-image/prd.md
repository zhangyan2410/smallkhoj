# Initial release frontend standalone production image

## Goal

Make the production frontend image buildable for the initial release deployment path. The current `frontend/Dockerfile` expects Next.js standalone output at `.next/standalone`, but `frontend/next.config.mjs` does not enable standalone output, so a production Docker build can fail after `next build`.

## Requirements

- `frontend/next.config.mjs` must generate the `.next/standalone` server artifact expected by `frontend/Dockerfile`.
- The fix must keep same-origin `/api` rewrites and existing next-intl configuration intact.
- The release deployment runbook should remain accurate: the frontend image should be buildable on a stronger machine or CI, then pulled by the 2 vCPU / 2 GB server.
- Verification must prove the standalone artifact exists after `bun run build`.
- Verification should run a real Docker build when the local Docker daemon is available.

## Acceptance Criteria

- [x] Frontend config enables standalone production output.
- [x] `rtk bun run build` succeeds and creates `.next/standalone/server.js`.
- [x] `rtk docker build -t smallkhoj-frontend:standalone-smoke ./frontend` succeeds when Docker is available.
- [x] Existing runtime URL tests still pass.
- [x] The change is committed with the task archived.

## Notes

- Red test: `rtk bunx tsx --test test/next-production-config.test.ts` failed with `actual undefined`, proving standalone output was missing.
- Green tests: `rtk bunx tsx --test test/next-production-config.test.ts test/runtime-url.test.ts` passed 11 tests.
- Build/artifact: `rtk bun run build` passed, then `rtk sh -lc 'test -f .next/standalone/server.js && ls -lh .next/standalone/server.js'` confirmed the standalone server artifact.
- Docker build: first build without proxy stalled at `bun install`; rerun with `host.docker.internal:7897` HTTP/HTTPS proxy build args succeeded and tagged `smallkhoj-frontend:standalone-smoke`.
- Container smoke: `rtk docker run --rm -d --name smallkhoj-frontend-standalone-smoke -p 3100:3000 smallkhoj-frontend:standalone-smoke`, `curl -fsS -I http://127.0.0.1:3100/login` returned HTTP 200, then the container was stopped.
