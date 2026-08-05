# Scope-matched quality gate

## Final changed-target verification

Scope note: the pre-existing user-owned changes in `.gitignore` and
`docs/multi-agent-development-workflow.md` are deliberately excluded from this
task, its diff review, and every PASS statement below. They were neither edited
nor reverted during this work.

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

## Runtime-specific Activity repair

- The previously checked tests encoded the rejected contract (`Generated
  output` for Codex/OpenCode text plus a separate terminal tool row), so their
  historical PASS is not acceptance evidence for this correction.
- `rtk npm run build`: PASS.
- `rtk node --test test/runtime-activity.test.mjs test/codex-acp-mvp.test.mjs test/codex-acp-runtime.test.mjs test/opencode-server-runtime.test.mjs`:
  PASS, 21/21.
- Latest combined translator/OpenCode/runtime-MCP regression:
  `rtk node --test test/runtime-mcp.test.mjs test/opencode-server-runtime.test.mjs test/runtime-activity.test.mjs`:
  PASS, 56/56.
- `rtk node --test --test-name-pattern "daemon starts public Codex runtime with ACP implementation" test/daemon-runtime.test.mjs`:
  PASS, 1/1.
- Final full `rtk node --test --test-reporter=dot test/daemon-runtime.test.mjs`:
  PASS, 32/32.
- The focused daemon test delays backend persistence of `runtime_output` by
  150 ms. It proves Working precedes `Ran Bash`, `details.commandPreview` is
  `pwd`, no `Generated output` or terminal `Tool completed`/`Tool failed` row
  exists, and Idle is the last persisted row.
- The OpenCode fake SSE test sends user and assistant parts before their
  `message.updated` role records, then sends terminal tool/final narration SSE
  after the HTTP message response. It proves buffered role filtering, readable
  reasoning/text normalization, command extraction, user-echo suppression, and
  the bounded SSE drain before `result`.
- Translator assertions prove Codex thought/message narration and OpenCode
  reasoning/text all use readable Thinking, while only actual tool start emits
  Output. Claude plain-text fallback and diagnostic Warning/Error behavior stay
  intact.
- Latest `rtk npm test`: 295/296 pass. The sole failure is the pre-existing unrelated
  real bundled Pi target `real bundled Pi loads the scoped provider and streams
  through AgentProxy without provider credentials`; a focused rerun fails at
  `pi-runtime.test.mjs:306` because the generated provider endpoint is never
  called. No Activity/Codex/OpenCode target failed.
- Final `rtk git diff --check`: PASS.

## Aura command and clean-first-start verification

- `rtk npm run build`: PASS.
- `rtk node --test test/proxy-wrapper.test.mjs test/runtime-mcp.test.mjs test/opencode-server-runtime.test.mjs test/codex-acp-runtime.test.mjs test/runtime-activity.test.mjs`:
  PASS, 73/73.
- `rtk uv run pytest -q tests/test_memory_store.py tests/test_agent_task_memory_handoff.py tests/test_reminder_scheduler.py`:
  PASS, 25/25. It proves selective memory `readMore`, generated thread-summary
  requests, and task-memory summary/promote requests advertise bare `aura`
  commands and reject `slock`/`raft` command examples in those Agent-facing
  payloads.
- Focused backend Ruff over the six changed source/test files: PASS.
- `rtk node --test --test-reporter=dot test/daemon-runtime.test.mjs`:
  PASS, 32/32. The daemon fake-runtime path executes bare `aura server info`
  through the generated workspace wrapper and keeps the warmup/prompt contract
  free of absolute wrapper instructions.
- `rtk node --test test/proxy-wrapper.test.mjs`: PASS, 8/8. Its wrapper case
  proves the `aura`, `slock`, and `raft` compatibility launchers share the same
  POSIX/CMD/PowerShell content and each executable alias reaches the same agent
  CLI. Its clean-first-start matrix creates an empty temporary HOME and
  workspace, places a deliberately wrong host `aura` first in the untrusted
  base PATH, then constructs the Claude, Codex/Codex ACP, OpenCode and Pi child
  environments. Each environment prepends its new workspace `.slock`
  directory and successfully executes bare `aura server info` through the
  agent CLI instead of the host command.
- The clean-first-start matrix is unit-level PATH/wrapper evidence using a fake
  agent CLI. Separately,
  `rtk python3 -m unittest scripts.tests.test_build_daemon_distribution`:
  PASS, 5/5. It proves `dist/slock-cli.js` ships alongside `dist/cmd/main.js`
  and the top-level daemon launchers. That packaging check does not claim a
  live installed-artifact execution; executable workspace-alias behavior is
  covered by the wrapper test above.
- Pi now exposes the same testable runtime-env builder shape as the other
  runtimes. It preserves the daemon-local LLM relay variables while removing
  ambient Slock proxy secrets from the provider child; no global
  `aura`/`slock`/`raft` installation or existing user-home collaboration CLI
  state is required.
- No new live UI run was performed for this non-UI follow-up. The existing
  OpenCode screenshot below proves the Activity state/order repair only; it
  predates the final Aura execution contract and is not used as Aura evidence.

## Live OpenCode Activity acceptance

- PASS against the current repository daemon build and the existing `open1`
  OpenCode Agent using marker `ACTIVITY_QA3_20260805T0155_b42f`.
- The UI proves the chronological sequence Working, real `Ran bash` Output,
  readable Thinking, then Idle. This earlier run included semantic `pwd` plus
  display-normalized `raft` previews; those preview rows are historical
  Activity-order evidence only and do not prove the later bare-Aura execution
  contract.
- The new turn has no `Generated output`, `Tool completed` or `Tool failed`
  Activity. The user-authored marker is not mislabeled as Thinking.
- Screenshot `/tmp/smallkhoj-activity-qa3.png` was captured and visually
  inspected. Full candidate/session identity and the safety boundary are in
  `evidence/live-test-boundary.md`.

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

- The aggregate `rtk npm test` run is not claimed as an overall PASS because of
  the independently reproducible Pi failure above. Activity acceptance relies
  on the completed build and focused Codex/OpenCode/daemon targets.
- Codex/MiniMax provider creation is blocked by the safe append-only preflight.
  See `evidence/config-safety-preflight.md`.
