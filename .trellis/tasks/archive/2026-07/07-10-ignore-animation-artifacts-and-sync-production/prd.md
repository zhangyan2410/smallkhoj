# Ignore local animation artifacts and sync production

## Goal

Keep local browser-test evidence and the local Remotion animation project out of version control, then release the current `main` frontend, backend, and Daemon changes to the existing Tencent Cloud Lighthouse deployment without exposing secrets or deploying unrelated worktree changes.

## Confirmed Facts

- `frontend/.playwright-cli/` is an untracked local WebDriver/Playwright evidence directory containing timestamped `.log` and `.yml` files. The user explicitly requested that it be ignored.
- `remotion/aura-team-promo/` is an untracked local Remotion project. It contains source code as well as generated reference media, analysis frames, and output media. Its nested `.gitignore` already excludes its local `assets/`, `out/`, `node_modules/`, and common rendered-media formats, but the repository root currently does not ignore the top-level `remotion/` tree.
- The tracked repository-level `.gitignore` is the appropriate shared location for ignoring both paths.
- The current deployment runbook identifies the existing target as Tencent Cloud Lighthouse `124.222.40.40`, accessed as `ubuntu`, with the server-side deployment bundle located under `/home/ubuntu/smallkhoj-deploy`. Production uses Docker Compose with separately built backend/frontend images, and requires a post-deploy smoke check.
- Current uncommitted changes include frontend code, new frontend avatar assets, two pre-existing Trellis documents, the requested local artifact directories, and this newly created task. Existing worktree changes must not be reverted or included in a release unless they are deliberately selected.
- The current `main` HEAD (`511e506`, 2026-07-09) contains a committed Daemon release change. It adds the `aura` executable alias, changes server-generated Daemon onboarding/reconnect commands to invoke `aura`, and updates the Daemon distribution builder.
- The checked-out `release-artifacts/smallkhoj-daemon/` package is ignored by Git and is stale: its `0.2.0` npm package lacks the `aura` executable. A backend image built from it would generate `aura` commands but serve an incompatible package.
- The server currently derives the hosted package URL from `MINIMUM_DAEMON_VERSION`. Raising that value to a new Daemon version would also reject connected `0.2.0` Daemons at their next registration or heartbeat; leaving it at `0.2.0` cannot cause the backend to advertise the new package version.
- Decision: preserve `0.2.0` client connectivity. Introduce an independent release-package version, set it to `0.2.1` for this release, and keep `MINIMUM_DAEMON_VERSION=0.2.0` on the deployment target.
- The current release set is all committed application code at `511e506` plus the user-owned uncommitted frontend chat UI and avatar assets. It deliberately excludes the two existing Trellis document edits, `frontend/.playwright-cli/`, and `remotion/`.

## Requirements

1. Add a narrow root Git-ignore rule for `frontend/.playwright-cli/` so local browser-test logs and page snapshots remain untracked.
2. Add a root Git-ignore rule for the local `remotion/` workspace, preserving it on disk while preventing its source, analysis outputs, and media files from being staged accidentally.
3. Verify the ignore rules with Git's ignore inspection and confirm no tracked file would be hidden.
4. Regenerate the ignored Daemon distribution from the current Daemon source before building the backend image. The new artifact must expose the `aura` executable and be served from `/downloads/smallkhoj-daemon/`.
5. Establish the exact release set before deployment; it must include the required backend/Daemon release changes and frontend changes, while excluding local artifact directories and unrelated Trellis documentation edits.
6. Follow the repository's documented production flow: build the selected application images for the server architecture, transfer/load them over SSH, restart only the required Compose services, and run the documented public smoke check.
7. Keep production secrets outside the repository and do not print them in task artifacts or command output.
8. Ensure the new Daemon release version is independently configurable from the minimum accepted version, so future feature releases do not involuntarily disconnect older compatible Daemons.

## Acceptance Criteria

- [x] `git check-ignore -v` attributes `frontend/.playwright-cli/` and `remotion/` files to intentional root `.gitignore` rules.
- [x] The existing local files remain on disk after the Git-ignore change.
- [x] The regenerated Daemon npm package contains an `aura` executable and is reachable through the deployed `/downloads/smallkhoj-daemon/` route.
- [x] The selected release set is documented and contains only user-approved frontend, backend, and Daemon changes.
- [x] The selected production images are built for the Lighthouse architecture, transferred and loaded successfully, and only the corresponding service(s) are recreated.
- [x] `scripts/post_deploy_smoke.py --base-url http://124.222.40.40 --allow-http --json` succeeds after deployment, or any failure is reported with the service left in a known state.
- [x] `MINIMUM_DAEMON_VERSION=0.2.0` remains accepted after the release, while newly generated onboarding commands reference the new `0.2.1` package.

## Out Of Scope

- Deleting local browser evidence or the Remotion project.
- Committing, releasing, or modifying the two pre-existing Trellis document edits unless they are separately approved.
- Changing production secrets, domain configuration, or the deployment architecture.

## Outcome

- Main commits: `35325e9` (frontend), `a0da9db` (existing Trellis documentation), `1db6868` (Daemon compatibility and ignore rules), and `dc1e64f` (production env updater allowlist).
- The Daemon package was regenerated as `0.2.1`; its package manifest exposes the `aura` executable. The local and cloud production smokes both downloaded the new hosted tgz successfully.
- The actual active server deployment directory is `/home/ubuntu/smallkhoj-deploy/smallkhoj-deploy`. The host's running backend/frontend image IDs were tagged for rollback as `smallkhoj-backend:rollback-20260710121757` and `smallkhoj-frontend:rollback-20260710121757` before replacement.
- Cloud production now runs backend image `sha256:17ac9404e87ba4efb5482a8fd8798f9c4bc26b029db92244d7147daaa9f92aae` and frontend image `sha256:bb9a0b6c01d9e450836299b6d0cbcac2ea2331ca2d8ab4a80a1fd8847ce06c20`, both `linux/amd64`.
