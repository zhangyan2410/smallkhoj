# Implementation Plan — Codex/OpenCode runtime gate repair

## 1. Planning and activation

- [x] Converge PRD, design and implementation plan with no blocking questions.
- [x] Run the Trellis Phase 1 completion review and activate the child task.
- [x] Load inline pre-development context before editing source.

## 2. RED — public OpenCode creation

- [x] Extend the focused public runtime normalizer test with canonical
      `opencode` and `open_code` expectations.
- [x] Run only that backend test and record the expected RED at
      `Unsupported runtime: opencode`.
- [x] Add the minimum aliases and rerun the same target GREEN.

## 3. RED/GREEN — Codex ACP diagnostics

- [x] Reuse the existing failing exit-127 daemon test as the RED evidence.
- [x] Change the assertion/wait contract to distinguish process-exit activity
      from the later driver error, without weakening stderr/exit-code checks.
- [x] Keep the inherited thought, prompt, warning/error and UI grouping changes.
- [x] Run the focused Codex ACP bridge/runtime and daemon tests GREEN.

## 4. RED — runtime-aware Integration Gate

- [x] Add Foundation model cases for strict runtime selection, no cross-runtime
      candidate reuse, and provider/model independence (including MiniMax).
- [x] Add an OpenCode model case proving context/compact are explicit skips.
- [x] Add Pi model/CLI cases proving strict runtime matching and explicit
      context/compact skips without introducing a key-readiness protocol.
- [x] Add CLI cases for `--runtime codex`, `--runtime opencode`, automatic
      runtime-control agent selection, report metadata and unsupported value.
- [x] Run the relevant Foundation/CLI tests and observe the expected REDs.

## 5. GREEN — Integration Gate profiles

- [x] Implement canonical runtime profile resolution and runtime matchers.
- [x] Generalize readiness/reuse/running/session selection and report evidence.
- [x] Add `all` matrix aggregation while preserving single-runtime diagnosis.
- [x] Add `skip` step/summary formatting for non-applicable OpenCode context
      controls.
- [x] Parse/validate `--runtime` before network access and use the selected
      profile for automatic runtime-control agent selection.
- [x] Preserve the seven historical mode names while removing the unintended
      MiniMax/Claude runtime coupling.

## 6. Pi product semantics

- [x] Locate the existing Pi provider credential authority and launch env
      contract across daemon, backend and frontend.
- [x] Confirm no new Pi key configuration or special credential product is in
      scope; Built-in Pi is lower priority than the other three runtimes.
- [x] Add a RED frontend contract for the false `无需配 key` copy.
- [x] Keep `Built-in Pi`, remove the keyless promise, and add no key-entry flow.
- [x] Add Pi to the runtime-aware Gate with strict workspace/session checks and
      honest context-control skips.
- [x] Attempt/cover the historical Pi reply path after the other runtime gates;
      preserve an exact Pi 0.73.1 SSE blocker if it remains external.

## 7. Isolated Codex/MiniMax real-test preflight

- [x] Keep all pure Gate/backend/daemon/frontend checks independent of local
      provider state and complete them before attempting a real provider case.
- [x] Inspect only documented/read-only CC Switch capabilities needed to prove
      an append-only, non-default creation path; do not print providers, tokens,
      raw settings, environment values or command arguments.
- [x] If safe creation cannot be proven before writing, record the Codex/
      MiniMax real case as blocked and make no local configuration change.
- [x] Do not enter the conditional write/baseline branch: the read-only
      preflight could not prove safe append-only creation before a write.
- [x] Record that no structural delta or test provider exists because the
      conditional creation branch was not entered.
- [x] Record that cleanup is not applicable because no test-owned entry was
      created; no existing row may be deleted as a probe.

## 8. Focused verification

- [x] Backend: focused `test_public_agent_runtime_normalizer...` target.
- [x] Gate: compatibility test plus all `tools/integration-gate/*.test.mjs`.
- [x] Daemon: build, Codex ACP bridge/runtime target, OpenCode driver target and
      `daemon-runtime.test.mjs`.
- [x] Frontend: scope-matched type/test check for inherited activity kinds.
- [x] Run `git diff --check` and inspect the final diff/status for unrelated or
      generated files.

## 9. Quality handoff

- [x] Load `trellis-check`, run its scope-aware quality gate, and record exact
      PASS/failure evidence.
- [x] Update task acceptance status without committing, pushing, publishing,
      restarting shared services or writing protected DB data.
- [x] Record the initial live-test limitation separately from in-repo
      completion, then replace it with identity-proven live evidence once a
      current-build daemon candidate is available.

## 10. Runtime-specific Activity repair

- [x] Confirm frontend already renders all six shared runtime Activity kinds.
- [x] Add contract tests that reject the former translation and assert the
      Claude-compatible observable sequence across Codex and OpenCode,
      including user/session filtering and Idle-last persistence.
- [x] Add a pure runtime-specific translator and keep daemon Activity/TaskRun
      side effects in the existing orchestrator.
- [x] Report Codex/OpenCode assistant analysis/narration as Thinking with
      `details.thought`; report only real tool execution as `Ran <tool>` Output
      with `details.commandPreview`; do not emit `Generated output` or an
      invented terminal-tool Activity.
- [x] Preserve Activity POST order per runtime so the turn's Idle row persists
      after every preceding Thinking/Output row.
- [x] Extend fake ACP/OpenCode integrations to assert roles, reasoning, command
      previews, filtered user envelopes, and the final Activity sequence.
- [x] Run the focused translator, Codex ACP, OpenCode SSE and daemon targets.

## 11. Live OpenCode Activity acceptance

- [x] Reconnect a daemon loaded from the current repository build without
      stopping or restarting the shared frontend/backend stack.
- [x] Reuse an existing OpenCode Agent and send a unique real marker through
      the normal conversation path.
- [x] Verify the UI shows chronological Working, real-tool Output, readable
      Thinking and Idle-last semantics with no new `Generated output` or
      terminal-tool Activity.
- [x] Capture and visually inspect the final Activity screenshot; record
      candidate/session identity and the exact safety boundary.

## 12. Aura command unification follow-up

- [x] Add RED prompt/env/warmup/Activity tests for bare `aura` and the absence
      of generated absolute wrapper instructions.
- [x] Inject the workspace wrapper directory and Slock identity boundary into
      the OpenCode child environment, matching the other runtimes.
- [x] Mechanically change runtime CLI command examples to `aura` without
      changing task, safety, routing or credential semantics.
- [x] Change daemon warmup to `aura server info` so it validates PATH rather
      than bypassing it with `runtime.wrapper.bashWrapper`.
- [x] Remove Activity-only wrapper-path collapsing while retaining proxy secret
      and token-file redaction.
- [x] Add a clean-first-start runtime environment matrix using a temporary HOME
      and a poisoned host `aura`, and prove all four runtime families resolve
      the newly generated workspace wrapper first.
- [x] Replace backend-generated memory read-more, thread-summary, and task-memory
      follow-up instructions with bare `aura` so later turns cannot reintroduce
      compatibility command names after the initial runtime prompt.
- [x] Prove generated `aura`, `slock`, and `raft` compatibility aliases share
      the same platform wrapper content and execute the same agent CLI; keep
      only `aura` advertised to new runtimes.
- [x] Run focused wrapper/prompt/OpenCode/daemon/Activity tests, build, full
      daemon regression, focused backend prompt-generation tests, distribution
      checks, and final diff/status review.
