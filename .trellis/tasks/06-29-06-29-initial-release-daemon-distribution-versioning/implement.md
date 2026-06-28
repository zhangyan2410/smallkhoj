# Implementation plan

## Phase 1: Version source of truth

1. Pick daemon package version source, likely `agent/daemon/aaa-daemon/package.json`.
2. Make the CLI print the package version rather than a wrapper hard-code.
3. Ensure connect/register/heartbeat sends daemon version consistently.
4. Add backend tests around version serialization and old-version handling if enforcement is implemented.

## Phase 2: Artifact builder

1. Add a repeatable script that builds the daemon and emits a platform/versioned artifact.
2. Include only runtime files needed by the daemon.
3. Emit checksum metadata.
4. Keep local dev wrapper behavior available but separate from release artifact behavior.

## Phase 3: Install/connect UX

1. Add a release artifact URL/config to deployment env.
2. Change backend command generation so production commands use installed `smallkhoj-daemon`, not repository absolute paths.
3. Add install or bootstrap command text to the Computer onboarding response.
4. Keep connect tickets one-time and short-lived.
5. Update frontend copy so users understand install vs connect vs reconnect.

## Phase 4: Compatibility checks

1. Define minimum supported daemon version in backend config.
2. Validate daemon version during connect/register/heartbeat or record explicit deferred behavior.
3. Surface unsupported/old daemon diagnostics in API and UI.

## Phase 5: Real validation

1. Build the macOS arm64 artifact.
2. Install into a temporary path outside the repository checkout.
3. Generate a connect ticket from the app.
4. Connect to local or deployed backend with the packaged daemon.
5. Verify Computer record, daemon version, heartbeat, WebSocket connection, and reconnect behavior.
6. Save evidence in this task directory.

## Suggested validation commands

```bash
rtk python3 ./.trellis/scripts/task.py validate 06-29-06-29-initial-release-daemon-distribution-versioning
rtk ./scripts/<daemon-artifact-build-script>
rtk ~/.smallkhoj/bin/smallkhoj-daemon --version
rtk ~/.smallkhoj/bin/smallkhoj-daemon connect --token <token> --server <server>
```

