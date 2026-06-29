# Implementation plan

## Phase 1: Risk register

1. Create `risk-register.md` for the foundation risk matrix.
2. Seed it from existing release tasks and deployment docs.
3. Classify each risk as P0/P1/P2.
4. Link each risk to an existing task or create a missing child task.

## Phase 2: Gate inventory

1. Inventory existing scripts:
   - `scripts/post_deploy_smoke.py`;
   - `scripts/initial_release_deploy_preflight.py`;
   - `scripts/lighthouse_host_probe.py`;
   - `scripts/lighthouse_ssh_deploy_probe.py`;
   - `scripts/make_deployment_bundle.py`;
   - `scripts/remote_deploy_evidence.py`;
   - `scripts/release_worker_rollout.py`;
   - daemon/runtime tests under `agent/daemon/aaa-daemon/test/`.
2. Map each script/test to a risk domain.
3. Identify gaps where no executable gate exists.

## Phase 3: Missing gates

Prioritize executable checks in this order:

1. Server/account/channel access boundaries.
2. Packaged daemon command shape and install/connect from outside repo.
3. Computer identity/reconnect/offline behavior.
4. Daemon WebSocket routing and auth rejection.
5. TaskRun lifecycle and evidence visibility without Feishu/Jira.
6. Production deployment smoke and resource snapshot.
7. DB backup/restore drill.
8. Storage/log retention and cleanup.

## Phase 4: Foundation runner

Add a single foundation validation entry point if the existing scripts remain scattered. The first version can be a wrapper that runs selected checks and writes one JSON report.

Suggested shape:

```bash
rtk python3 scripts/initial_release_foundation_gate.py \
  --base-url http://124.222.40.40 \
  --allow-http \
  --server-id <server-id> \
  --json
```

The runner should not require Feishu/Jira secrets.

Initial runner added:

```bash
rtk python3 scripts/initial_release_foundation_gate.py \
  --base-url http://124.222.40.40 \
  --allow-http \
  --json
```

The runner currently composes deployment preflight, public smoke, risk-register tracking, Server/account scope backend-test detection, daemon command-shape detection, daemon identity backend tests, TaskRun lifecycle backend tests, config/secrets guardrails, daemon distribution artifact detection, and a backup/restore drill plan. By default it blocks any P0 risk that has no executable gate wired yet and treats P0 warnings as `NOT READY`. Use `--partial` only while developing an individual check.

## Phase 5: Evidence and release review

1. Run the foundation gates locally.
2. Run the deployed gates on Tencent Cloud.
3. Save evidence under this task.
4. Update `risk-register.md` statuses.
5. Record release decision: pass, blocked, or pass-with-warnings.

## Validation

- `rtk python3 ./.trellis/scripts/task.py validate 06-29-06-29-initial-release-foundation-reliability-risk-gates`
- Existing backend/frontend/daemon tests as applicable to touched gates.
- `rtk python3 scripts/post_deploy_smoke.py --base-url <url> --json`
- `rtk python3 scripts/initial_release_deploy_preflight.py ...`
- `rtk python3 scripts/remote_deploy_evidence.py ...`
