# Foundation reliability and risk gates design

## Purpose

This task turns release risk into visible gates. It is not another product surface and it is not an integration adapter. It is the release confidence layer for the lower platform.

The guiding question is:

> If Feishu/Jira were ready tomorrow, would SmallKhoj's own server, daemon, runtime, TaskRun, deployment, and recovery layers survive real use?

## Gate Levels

Use four outcomes for every check:

- `pass`: evidence proves the release requirement works.
- `warn`: known limitation exists, but it is acceptable for the first release with documented mitigation.
- `fail`: release candidate cannot pass until fixed.
- `blocked`: validation cannot run because an external dependency or missing decision prevents it.

Warnings are not free. Every warning must include:

- exact limitation;
- expected user-visible symptom;
- why it is acceptable for the first release;
- follow-up task or trigger for escalation.

## Risk Domains

### Identity And Scope

Risk: resources leak across accounts, Servers, or channels.

Required evidence:

- account owns or joins a Server through membership;
- active Server is validated against membership;
- public/private channel access is enforced;
- Computer and Agent creation are scoped to selected Server.

### Daemon Distribution

Risk: onboarding only works on the developer machine.

Required evidence:

- versioned daemon artifact or install flow;
- connect command does not point at a repository path;
- daemon reports version;
- UI/backend show daemon version;
- old/unsupported versions are warned or blocked.

### Computer And Daemon Runtime

Risk: one physical machine creates duplicate Computers, stale commands kill healthy daemons, or reconnect loses control-plane state.

Required evidence:

- same physical machine reconnects into one Computer;
- daemon heartbeat renews lease;
- daemon shutdown/offline transition is visible;
- restarted daemon resumes event cursor without duplicate execution;
- invalid/expired connect tokens fail with useful diagnostics.

### Agent, Runtime, And TaskRun

Risk: work is accepted but does not execute, executes on the wrong machine, or fails invisibly.

Required evidence:

- TaskRun can be created without Feishu/Jira;
- target Computer/runtime receives the work;
- non-target Computer/runtime stays idle;
- status moves through queued/running/completed or failed;
- evidence and failure reason are visible in UI/API/log trace.

### Deployment And Network

Risk: local dev works but production URL, Caddy, WebSocket, CORS, or reverse proxy breaks.

Required evidence:

- production compose/preflight passes;
- public URL smoke passes;
- daemon WebSocket route rejects unauthenticated upgrades but reaches backend;
- browser API and WebSocket URLs are not localhost-only;
- server URL in daemon connect command matches the deployed public strategy.

### Capacity And Storage

Risk: the low-cost server is fine at idle but fails under realistic control-plane activity or disk growth.

Required evidence:

- resource snapshot after deployed foundation activity;
- no server-side image/build pressure during normal deploy;
- upload/log/evidence limits or retention plan;
- Docker image/cache cleanup path;
- database size and disk usage recorded.

### Backup, Restore, And Recovery

Risk: a bad deployment or DB issue destroys the demo/release environment.

Required evidence:

- database backup command documented and tested;
- restore into a clean DB or staging environment tested;
- service restart and rollback steps documented;
- deployment evidence collector captures enough data after failure.

### Config And Secrets

Risk: release scripts leak secrets or allow partially configured production envs.

Required evidence:

- env template validation rejects placeholders;
- update scripts do not print secret values;
- no real secrets are committed;
- missing optional integrations do not break foundation gates.

## Validation Layers

1. Static/config gates:
   - env template validation;
   - deploy preflight;
   - CORS/API/WS URL inspection;
   - daemon command shape inspection.

2. Unit/integration tests:
   - server membership;
   - channel privacy;
   - Computer identity;
   - daemon version compatibility;
   - TaskRun state transitions.

3. Real local runtime gates:
   - packaged daemon install/connect outside the repo path;
   - daemon restart/reconnect;
   - TaskRun delivery to selected Computer/runtime.

4. Deployed gates:
   - production compose;
   - public smoke;
   - daemon WebSocket smoke;
   - deployed Computer connect;
   - resource snapshot after activity.

5. Recovery drills:
   - backup;
   - restore;
   - service restart;
   - rollback or redeploy previous known-good artifact.

## Evidence Shape

Each gate should produce a small evidence file under this task, for example:

```text
evidence/FOUNDATION_<gate>_<YYYYMMDDHHMMSS>.md
evidence/FOUNDATION_<gate>_<YYYYMMDDHHMMSS>.json
```

Evidence should include:

- command or UI workflow run;
- target environment;
- pass/warn/fail/blocked result;
- important IDs with secrets redacted;
- links to logs/screenshots/traces where relevant;
- follow-up task when not pass.

## Release Decision Rule

The foundation goal is ready when:

- every P0 gate passes;
- every P1 gate either passes or has an explicit accepted warning;
- every failure has a linked fix task;
- external Feishu/Jira secrets are not required to run foundation gates.

