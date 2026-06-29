# Initial release completion audit

Date: 2026-06-29

## Objective Under Audit

Complete parent task `06-28-07-15-initial-release`.

The parent task defines an initial release around:

```text
Feishu entry -> Integration Connector/Route/EventLog -> SmallKhoj Channel/Task/TaskRun -> daemon runtime -> TaskRun evidence -> Feishu/Jira write-back
```

This audit treats the parent PRD acceptance criteria as the source of truth. A child task being archived is supporting evidence, not proof by itself.

## Current Task Tree State

- Parent task status: `planning`
- Child tasks listed in `task.json`: `38`
- Child tasks with status `completed`: `38`
- Completed but not archived before this audit: `06-29-initial-release-better-auth-server-switcher`

## Commands Run During This Audit

```bash
rtk .venv/bin/python -m pytest \
  tests/test_integration_gateway.py \
  tests/test_jira_rest.py \
  tests/test_feishu_adapter.py \
  tests/test_release_loop.py \
  tests/test_task_run_writeback.py \
  tests/test_feishu_replies.py \
  tests/test_feishu_reply_orchestration.py \
  tests/test_feishu_event_loop.py \
  tests/test_feishu_worker_runtime.py \
  tests/test_feishu_channel_transport.py \
  tests/test_feishu_worker_cli.py \
  tests/test_integration_runtime.py \
  tests/test_integration_bootstrap.py \
  -q
```

Result: `98 passed in 0.36s`.

```bash
rtk python3 scripts/initial_release_foundation_gate.py --base-url http://124.222.40.40 --allow-http --json
```

Result: exit code `0`, `ready=true`, `failures=0`, `blocked=0`, `warnings=0`, `p0Warnings=0`.

```bash
rtk python3 ./.trellis/scripts/task.py validate 06-28-07-15-initial-release
```

Result: context files valid.

## Proven By Current Evidence

### Integration Gateway / Feishu / Jira Code Path

Evidence:

- `backend/tests/test_integration_gateway.py`
- `backend/tests/test_jira_rest.py`
- `backend/tests/test_feishu_adapter.py`
- `backend/tests/test_release_loop.py`
- `backend/tests/test_task_run_writeback.py`
- `backend/tests/test_feishu_replies.py`
- `backend/tests/test_feishu_reply_orchestration.py`
- `backend/tests/test_feishu_event_loop.py`
- `backend/tests/test_feishu_worker_runtime.py`
- `backend/tests/test_feishu_channel_transport.py`
- `backend/tests/test_feishu_worker_cli.py`
- `backend/tests/test_integration_runtime.py`
- `backend/tests/test_integration_bootstrap.py`

These prove the first-release code path at unit/service level:

- Feishu message normalization for `im.message.receive_v1`.
- `@SmallKhoj 分析 JIRA-123` / direct-chat `分析 JIRA-123` command parsing.
- Unaddressed group messages, duplicate events, unknown commands, and missing routes are dropped/audited without creating work.
- Jira REST issue lookup and comment append use Atlassian REST API v3 shapes.
- Jira issue/comment mappings persist through `ExternalMapping`.
- Feishu outbound text/reply APIs create Feishu message mappings.
- Accepted Feishu Jira-analysis outcome creates SmallKhoj message/task/TaskRun through existing TaskRun helper boundaries.
- Terminal TaskRun write-back hooks can append Jira comments and send Feishu terminal replies.
- Worker runtime and Channel SDK transport can be tested with fake transport and do not import daemon/runtime execution helpers.
- Runtime dependencies resolve config/connectors/credentials outside source-controlled secrets.

### Foundation / Deployment / Daemon Gates

Evidence:

- `scripts/initial_release_foundation_gate.py --base-url http://124.222.40.40 --allow-http --json`: ready.
- `.trellis/tasks/archive/2026-06/06-29-06-29-initial-release-foundation-reliability-risk-gates/evidence/FOUNDATION_gate_20260629162132.md`
- `.trellis/tasks/archive/2026-06/06-29-initial-release-daemon-prompt-gate-refresh/evidence/FOUNDATION_gate_daemon_prompt_refresh_20260629165608.md`
- `docs/initial-release-production-deployment.md`

These prove:

- Server/account scope P0 gate passes.
- Daemon command shape and versioned distribution P0 gate passes.
- Daemon identity/reconnect/lease backend tests pass.
- Deployed daemon WebSocket auth route is reachable and rejects unauthenticated upgrades.
- TaskRun lifecycle/evidence backend tests pass.
- Production compose/Caddy/frontend/backend shape and public HTTP smoke pass.
- Backup/restore drill evidence exists and passes.
- Config/secrets guardrails pass.
- Daemon minimum-version and workflow-state prompt contracts pass.

### Better Auth / Server Switcher

Evidence:

- `.trellis/tasks/06-29-initial-release-better-auth-server-switcher/evidence/two-account-server-computer-validation.md`
- Browser screenshots under `.trellis/tasks/06-29-initial-release-better-auth-server-switcher/evidence/`

These prove:

- Two real Better Auth email/password accounts can sign up through the login page.
- Each account receives its own default Server.
- Server switching and server-scoped Channel/Member/Computer views work in the tested browser surfaces.
- GitHub/OAuth is intentionally not required for this release slice; WeChat scan login and GitHub login remain later auth extensions per user direction.

## Not Proven / Cannot Honestly Mark Complete Yet

The parent PRD still contains explicit acceptance criteria that current evidence does not satisfy strongly enough:

1. **Real Feishu long-connection live run.**
   - Current evidence proves fake-transport and service-level Feishu event handling.
   - It does not prove a real Feishu app long-connection session using live `FEISHU_WORKER_APP_ID`, `FEISHU_WORKER_APP_SECRET`, and `FEISHU_REPLY_ACCESS_TOKEN`.
   - `docs/initial-release-production-deployment.md` records live-run preflight as expected to fail before worker runtime env is configured.

2. **Real Jira account/site write-back.**
   - Current evidence proves Jira REST API request shapes and mappings using fake clients.
   - It does not prove a live Jira site with real `JIRA_EMAIL` and `JIRA_API_TOKEN` can read an issue or append a comment.

3. **Deployed Feishu -> TaskRun -> Jira scenario.**
   - Current evidence proves the code path by unit/service tests.
   - It does not prove the deployed server processed a real or fake end-to-end external event through the worker into a TaskRun and external write-back.

4. **HTTPS/domain release readiness.**
   - Current deployment smoke is `http://124.222.40.40 --allow-http`.
   - `docs/initial-release-production-deployment.md` explicitly records `SMALLKHOJ_SITE_ADDRESS` as not an HTTPS production domain and notes the mainland-region ICP filing constraint.
   - Therefore parent criteria requiring HTTPS/domain operation are not yet proven.

5. **Release workload on the original 2 vCPU / 2 GB plan.**
   - Current resource evidence is for a 4 vCPU / about 4 GB Lighthouse instance with 3 GiB swap.
   - This is stronger capacity than the original 2C2G candidate, but it does not prove the 2C2G plan is sufficient.

6. **Runtime/provider/daemon failures reachable from the operator workflow for the primary scenario.**
   - Foundation TaskRun evidence and daemon gates exist.
   - The primary Feishu/Jira scenario has not been live-run, so operator-facing failure evidence for that exact scenario remains unproven.

## Completion Decision

Do not archive `06-28-07-15-initial-release` yet.

The code foundation and lower-layer gates are in good shape, but the parent task's stated release acceptance requires live external integration and HTTPS/domain evidence that are currently missing or explicitly documented as not configured.

## Minimum Closure Options

The task can close after one of these paths:

1. **Strict closure:** configure real Feishu + Jira credentials outside the repo, run live-run preflight to ready, run a deployed Feishu `分析 JIRA-123` scenario through TaskRun and Jira/Feishu write-back, and record evidence.
2. **Explicit release-scope downgrade:** user accepts that this parent closes as "foundation + code-path complete" rather than "live external initial release complete"; update PRD acceptance criteria and document deferred live Feishu/Jira/HTTPS/domain work as follow-up tasks.

Until one of those happens, the thread goal remains active.
