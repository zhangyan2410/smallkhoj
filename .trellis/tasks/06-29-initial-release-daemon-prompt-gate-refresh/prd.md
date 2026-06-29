# Initial release daemon and prompt gate refresh

## Goal

Supplement the initial-release foundation gate for daemon distribution/runtime workspace and system prompt contracts, then rerun the gate after recent daemon and prompt-related changes.

## Requirements

- Extend the initial-release foundation gate so daemon distribution/runtime workspace changes are covered by executable checks, not only archived task evidence.
- Extend the gate so Trellis/Codex system prompt workflow-state injection is covered by executable checks:
  - hook code exists at `.codex/hooks/inject-workflow-state.py`;
  - hook output is bounded/compact enough to run every user prompt;
  - hook derives workflow-state blocks from `.trellis/workflow.md` rather than hard-coding stale prompt text;
  - workflow text preserves inline Codex constraints: `trellis-before-dev -> edit -> trellis-check -> trellis-update-spec -> commit`.
- Keep gate checks no-secret and deterministic. Do not inspect user-level secrets or require real Feishu/Jira credentials.
- Re-run the supplemented foundation gate after implementation and save evidence under this task.
- Fix any failing tests directly if the supplemented gate exposes drift in existing daemon/prompt contracts.

## Acceptance Criteria

- [x] A new foundation gate check covers daemon runtime workspace isolation: default daemon workspace root exists in source, runtime path includes `<serverId>/<computerId-or-machineId>/<workspaceId>`, and tests cover different Computers producing different runtime directories.
- [x] A new foundation gate check covers daemon minimum-version enforcement: backend source exposes `MINIMUM_DAEMON_VERSION` / `settings.minimum_daemon_version`, connect/register/heartbeat enforcement, and tests cover old-version rejection with `426`.
- [x] A new foundation gate check covers system prompt workflow-state injection: `.codex/hooks/inject-workflow-state.py` exists, reads `.trellis/workflow.md`, emits `<workflow-state>`, respects Codex inline dispatch mode, and does not embed broad/full workflow text on each prompt.
- [x] Foundation gate unit tests cover pass and failure cases for the new daemon/prompt checks.
- [x] The supplemented foundation gate runs against the current worktree with `ready=true`, `failures=0`, `blocked=0`, and `p0Warnings=0`.
- [x] The task records evidence for the rerun gate and archives cleanly.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
