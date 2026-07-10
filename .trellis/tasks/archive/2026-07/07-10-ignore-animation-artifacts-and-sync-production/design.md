# Design: Ignore Local Artifacts and Release Daemon Compatibility Update

## Boundaries

This release makes two durable repository changes and deploys the current application snapshot to the existing Lighthouse host:

- Root `.gitignore` owns local-only workspace exclusions: `/frontend/.playwright-cli/` and `/remotion/`.
- The Daemon package release version becomes independent from the minimum server-accepted Daemon version.
- The deployment builds the Daemon artifact locally into ignored `release-artifacts/`, incorporates it into a new backend image, and updates backend/frontend containers on the host.

`release-artifacts/` remains generated and ignored. It is an input to the backend Docker build, not a tracked source artifact.

## Daemon Version Contract

`MINIMUM_DAEMON_VERSION` remains the compatibility gate used by Daemon registration and heartbeat validation. It stays at `0.2.0` for this release.

New `DAEMON_RELEASE_VERSION` controls only the self-hosted package URL emitted by the public onboarding/reconnect APIs. It defaults to `0.2.1` with the source release and is explicitly passed to the backend container. The code path becomes:

```text
public onboarding API
  -> DAEMON_RELEASE_VERSION
  -> /downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.1.tgz
  -> package includes `aura` executable

daemon register / heartbeat
  -> MINIMUM_DAEMON_VERSION (0.2.0)
  -> accepts existing 0.2.0 and new 0.2.1 clients
```

This removes the present coupling that would otherwise force an availability-impacting compatibility-gate increase to advertise a new package. Existing `smallkhoj-daemon` invocations remain available as package aliases; only newly generated product instructions use `aura`.

## Deployment Shape

1. Build and test the Daemon source, then generate its `0.2.1` npm package under `release-artifacts/smallkhoj-daemon/`.
2. Build `linux/amd64` backend and frontend release images from the selected current source tree. The backend Dockerfile copies the generated release artifact.
3. Before loading images, record and tag the host's running backend/frontend image IDs as rollback tags.
4. Upload/load the release images through the documented SSH archive flow. Keep `.env.prod` on the host; update only non-secret `DAEMON_RELEASE_VERSION=0.2.1` if missing.
5. Force-recreate only backend and frontend, preserving database and Caddy containers. Confirm public frontend, backend health, hosted Daemon package, and unauthenticated Daemon WebSocket behavior with the existing smoke script.

## Rollback

If smoke fails, re-tagged host image IDs provide the rollback target. Restore the previous backend/frontend image variables or tags, force-recreate the affected services, then rerun the public smoke. The database schema and production secrets are out of scope; this release must not run destructive data migrations.

## Scope Decision

One task owns both ignore rules and deployment because the ignore rules protect the exact dirty worktree used as the release source. They are sequential safeguards rather than independent production deliverables.
