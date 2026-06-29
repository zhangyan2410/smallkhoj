# Initial release scope update: Feishu/Jira deferred

Date: 2026-06-29

## Decision

Live Feishu and Jira validation are deferred from parent task `06-28-07-15-initial-release`.

Reason: the user's company Jira is self-hosted. A live run against Jira Cloud credentials would not prove compatibility with the real target Jira environment.

GitHub/OAuth is also out of this release slice. Later login work should consider WeChat scan login and GitHub login.

## New Closure Standard

The parent task closes as a foundation/code-path release slice, not as a completed live external integration release.

Closure requires:

- account login and Server switching foundation;
- Server-scoped Channel/Member/Computer behavior;
- integration gateway connector/route/event/session/mapping model;
- deterministic Feishu/Jira adapter and release-loop tests;
- TaskRun/daemon execution boundary and evidence gates;
- versioned daemon distribution and duplicate Computer prevention;
- Tencent Lighthouse deployment/control-plane readiness with IP-only/ICP/domain constraints documented;
- foundation reliability gate ready.

## Deferred To Follow-Up

- Real Feishu long-connection worker run with production app credentials.
- Self-hosted Jira REST/API discovery and adapter compatibility.
- Real deployed Feishu -> SmallKhoj TaskRun -> Jira/Feishu write-back scenario.
- Public HTTPS/domain/tunnel/gateway validation for live external use.

## Current Evidence

Backend integration slice:

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

Foundation gate:

```bash
rtk python3 scripts/initial_release_foundation_gate.py --base-url http://124.222.40.40 --allow-http --json
```

Result from latest audit run: `ready=true`, `failures=0`, `blocked=0`, `warnings=0`, `p0Warnings=0`.

Supporting evidence:

- `evidence/INITIAL_RELEASE_completion_audit_20260629170815.md`
- `.trellis/tasks/archive/2026-06/06-29-06-29-initial-release-foundation-reliability-risk-gates/evidence/FOUNDATION_gate_20260629162132.md`
- `.trellis/tasks/archive/2026-06/06-29-initial-release-daemon-prompt-gate-refresh/evidence/FOUNDATION_gate_daemon_prompt_refresh_20260629165608.md`
- `.trellis/tasks/archive/2026-06/06-29-initial-release-better-auth-server-switcher/evidence/two-account-server-computer-validation.md`
- `docs/initial-release-production-deployment.md`
