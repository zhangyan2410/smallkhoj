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
- [x] Report any live-test limitation separately from in-repo completion.
