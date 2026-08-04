# Scope-matched quality gate

## Final changed-target verification

- Command:
  `rtk node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs`
- Result: PASS, 51 tests, 0 failures, 0 skipped.
- Assertions include all seven historical modes, default four-runtime matrix,
  strict Codex/OpenCode/Pi selection, 44-pass/4-skip matrix semantics,
  cross-runtime daemon-log isolation, static runtime-control target mismatch,
  and secret redaction/report storage.
- `rtk node tools/integration-gate/run.mjs --help`: PASS; documents
  `--runtime all|claude_code|codex|opencode|pi` with default `all`.
- `rtk git diff --check`: PASS.

## Earlier GREEN evidence from the same task

These targets were not repeated after only Integration Gate/spec/task evidence
changed:

- Backend public runtime normalizer: 1 focused pytest PASS; canonical
  `opencode` and alias `open_code` normalize to `opencode`, while `codex_cli`
  remains rejected.
- Backend Ruff: PASS.
- Daemon TypeScript build: PASS.
- Codex ACP main managed-runtime case: PASS.
- Codex ACP MVP target: 4/4 PASS.
- Codex exit-127 regression: PASS, with separate process-exit and driver-error
  activities.
- OpenCode/Pi daemon targets: 9/9 PASS.
- Frontend Integration Gate result target: 10/10 PASS.
- Frontend runtime option/Pi copy target: 9/9 PASS.
- Frontend typecheck: PASS.
- Frontend lint: 0 errors. Four pre-existing warnings remain outside this task
  in `create-agent-dialog.tsx`, `task-board.tsx` (two), and
  `activity-unread-state.ts`.

## Deliberately excluded as PASS evidence

- The earlier long aggregate daemon command emitted 38 visible passing tests
  but its final process exit code was not retained by the orchestration layer.
  This file does not claim that aggregate command as a PASS; it relies on the
  completed build and focused daemon targets above.
- Live Foundation/browser evidence is blocked by candidate identity and backend
  health. See `evidence/live-test-boundary.md`.
- Codex/MiniMax provider creation is blocked by the safe append-only preflight.
  See `evidence/config-safety-preflight.md`.
