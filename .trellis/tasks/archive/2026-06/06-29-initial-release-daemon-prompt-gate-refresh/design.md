# Daemon and prompt gate refresh design

## Scope

This is a gate refresh, not a new product feature. The gate must catch regressions introduced by recent daemon distribution/runtime workspace changes and by Trellis/Codex workflow-state prompt injection changes.

## Gate Additions

Add two checks to `scripts/initial_release_foundation_gate.py`:

1. `daemon.runtimeWorkspaceContract`
   - Inspect `agent/daemon/aaa-daemon/src/daemon/daemon.ts`.
   - Require `defaultDaemonWorkspaceRoot`, `SMALLKHOJ_DAEMON_WORKSPACE_ROOT`, `.slock-runtimes`, `serverId`, `computerId`, `machineId`, and `workspaceId` markers.
   - Inspect `agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs`.
   - Require the test names/markers proving stable default root and different Computers on the same Server produce different runtime paths.

2. `daemon.minimumVersionContract`
   - Inspect `backend/routers/agent_api.py`.
   - Require `settings.minimum_daemon_version`, `_require_supported_daemon_version`, status `426`, and enforcement around connect/register/heartbeat markers.
   - Inspect `backend/tests/test_daemon_control.py`.
   - Require old-version rejection coverage and daemon heartbeat version field coverage.

3. `prompt.workflowStateContract`
   - Inspect `.codex/hooks/inject-workflow-state.py`.
   - Require `<workflow-state>` emission, `.trellis/workflow.md` parsing, `codex.dispatch_mode` support, inline breadcrumb support, and `UserPromptSubmit` hook semantics.
   - Require bounded-output markers such as compact current-state construction and regex extraction of status blocks, so prompt injection does not dump broad workflow text every turn.
   - Inspect `.trellis/workflow.md` for the inline Codex flow markers: `trellis-before-dev`, `trellis-check`, and `trellis-update-spec`.

## Risk Mapping

- Daemon workspace and version checks strengthen FR-02 / FR-03 / FR-11.
- Workflow-state prompt checks are a new release-foundation support risk, because stale or oversized prompt injection can silently break the development workflow and gate discipline.
- The prompt check should be non-P0 for product readiness but P0 for this child task, because the user explicitly asked to supplement the gate after prompt changes.

## Constraints

- Do not require real user-level Codex config or hook approval state; the gate should inspect the repo-scoped hook and workflow contract only.
- Do not read secrets or external credentials.
- Keep tests hermetic by using the existing temporary repo fixture in `scripts/tests/test_initial_release_foundation_gate.py`.
