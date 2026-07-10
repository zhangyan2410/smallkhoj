# Implementation Plan: Ignore Local Artifacts and Release Current Main

## 1. Repository Safeguards

- Add anchored root `.gitignore` rules for `/frontend/.playwright-cli/` and `/remotion/`.
- Verify each rule with `git check-ignore -v`; confirm the directories still exist and no tracked path matches.

## 2. Daemon Release Contract

- Bump `agent/daemon/aaa-daemon` from `0.2.0` to `0.2.1` in package metadata and lockfile.
- Add `daemon_release_version` / `DAEMON_RELEASE_VERSION` to backend configuration and production Compose environment wiring.
- Make public onboarding/reconnect package URLs use the release version, retaining `minimum_daemon_version` only for compatibility validation.
- Update local env documentation, smoke-package expectation, and focused tests to prove that `0.2.0` remains accepted while generated commands advertise `0.2.1`.

## 3. Local Verification

- Run the focused backend command-generation and Daemon/package-distribution tests.
- Run the Daemon test suite after the package metadata update.
- Build `release-artifacts/smallkhoj-daemon/` from the current Daemon source and inspect the tarball package manifest for the `aura` bin.
- Run deployment preflight before image construction.

## 4. Production Release

- Capture read-only remote Compose/image state and tag the active backend/frontend image IDs for rollback.
- Build and archive `linux/amd64` backend/frontend images using the documented transfer flow; use the local VPN build proxy only if required.
- Transfer and load the archive on the Lighthouse host. Preserve `.env.prod` secrets and set only the non-secret `DAEMON_RELEASE_VERSION=0.2.1` when absent.
- Recreate backend and frontend only, inspect remote Compose state, and run public post-deploy smoke against `http://124.222.40.40`.

## 5. Failure Handling

- A local test, artifact, transfer, or smoke failure stops promotion before reporting success.
- A production smoke failure triggers image-tag rollback for the affected service(s), followed by a repeated smoke and evidence capture.
- No database reset, secret logging, unrelated documentation commit, local artifact deletion, or Remotion upload is permitted.
