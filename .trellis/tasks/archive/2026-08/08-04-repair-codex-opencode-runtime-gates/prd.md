# Repair Codex and OpenCode runtime gates

## Goal

Make OpenCode a usable product runtime from Agent creation through daemon
startup, finish the inherited Codex ACP diagnostic work without hiding runtime
failures, and extend the Integration Gate so operators can explicitly validate
each in-scope product runtime with truthful, runtime-specific evidence. Runtime
selection and test model/provider selection are independent dimensions;
MiniMax is a model/provider chosen for test execution, not a runtime contract.

## Background

- The frontend exposes and submits `runtime: "opencode"`
  (`frontend/lib/runtime-options.ts:19`,
  `frontend/components/create-agent-form.tsx:94`), but
  `backend/routers/public_api.py:5031-5049` omits OpenCode from the public
  runtime normalizer and returns `400 Unsupported runtime: opencode` before an
  `AgentWorkspace` is created.
- The daemon already normalizes and launches `opencode` through
  `OpenCodeServerRuntimeDriver` (`agent/daemon/aaa-daemon/src/daemon/daemon.ts:819-939`).
  Its focused fake HTTP/SSE driver cases pass, but no public Agent-creation
  regression protects the preceding API boundary.
- The inherited Codex ACP diagnostic edits add thought-chunk translation,
  exact-wrapper prompt guidance, warning/error activity, and UI grouping. The
  current daemon focused run has one failure because process exit activity is
  emitted before the later ACP bridge error, while the test incorrectly expects
  both observations in the first activity row.
- The restored Integration Gate currently hard-codes a MiniMax Claude
  candidate (`tools/integration-gate/foundation-gate.mjs:307-330`) and its
  automatic runtime-control agent selection repeats the same filter
  (`tools/integration-gate/run.mjs:1180-1191`). Codex supports allowlisted
  `/status` runtime control; OpenCode does not currently expose
  `inspect_context` or `compact` through daemon runtime control.
- The MiniMax/Claude coupling is historical test-fixture residue, not intended
  product behavior. A runtime is identified by its canonical runtime type;
  provider/model metadata such as MiniMax may be recorded as execution evidence
  but must not decide whether a Claude, Codex or OpenCode runtime matches.
- The current Codex installation has no MiniMax provider. Previous attempts to
  add one by editing local provider/tool configuration caused failures. This
  task must never mutate an existing local configuration to manufacture a Gate
  pass. The user authorizes adding a separate CC Switch provider solely for
  testing, provided no current provider/configuration is changed.
- The product supports four runtime families: `claude_code`, `codex`,
  `opencode` and bundled `pi`. Pi has not yet received the same Gate validation.
  Current frontend/product copy presents Pi as not requiring a key; the user
  has confirmed that this claim must be removed. This task keeps only the
  `Built-in Pi` identity and does not introduce Pi key configuration.
- Current code does require a provider credential. The backend owns
  `PI_LLM_API_KEY` / `PI_LLM_API_BASE` / `PI_LLM_MODEL` with fallback to the
  generic `LLM_*` settings (`backend/services/pi_llm_relay.py:18-25`). The
  daemon/Pi child receives only a local relay token and explicitly removes
  provider-key environment variables
  (`agent/daemon/aaa-daemon/src/runtime/pi-runtime.ts:251-278`).
- Historical real evidence proves bundle detection, Agent creation, capacity
  lease and provider HTTP 200, but Pi 0.73.1 then crashed while parsing the
  Anthropic SSE response and never wrote the DM reply
  (`.trellis/tasks/archive/2026-07/07-28-runtime-select-guide/evidence/real-pi-relay-test.md:26-31`).

## Requirements

### R1 — Public OpenCode Agent creation

- The public runtime normalizer must accept canonical `opencode` and the
  compatibility alias `open_code`, returning canonical `opencode`.
- Existing Claude, Codex and Pi aliases remain unchanged.
- The intentionally unsupported product runtime `codex_cli` remains rejected.
- A regression test must fail before the alias change and pass afterward.

### R2 — Codex ACP diagnostics are accurate and stable

- Preserve inherited `agent_thought_chunk` translation as thinking evidence;
  diagnostic warning text must remain a warning/error activity and must not be
  mislabeled as Thinking.
- Preserve the exact generated Slock wrapper path and Codex ACP elevation/
  no-heredoc prompt guidance.
- Unexpected process exit evidence must retain status, phase, exit code and
  stderr. The later ACP bridge close error must be asserted as a separate
  driver-source runtime error instead of being retroactively attributed to the
  earlier process-exit row.
- `runtime_warning` and `runtime_error` remain visible in the runtime activity
  group. They must remain `ActivityLog` telemetry and must not become
  actionable `EventRecord` work delivered back to a runtime.
- Preserve the inherited daemon/backend release version alignment at `0.2.6`;
  this task does not publish or push a package.

### R3 — Runtime-aware Integration Gate contract

- Add `--runtime <all|claude_code|codex|opencode|pi>` to Foundation Gate.
  The CLI defaults to `all`; an individual runtime remains available for
  focused diagnosis.
- Reject unsupported runtime values as configuration errors before business
  scenario execution.
- Replace the MiniMax-specific readiness step with a target-runtime readiness
  contract whose report evidence records the selected canonical runtime.
- Runtime detection, workspace reuse, running/warmup state, session evidence,
  and automatic runtime-control agent selection must all use the same runtime
  profile; one runtime must never satisfy another runtime's gate.
- Runtime matching uses canonical runtime type only. Provider/model metadata,
  including MiniMax, is evidence/configuration for the test invocation and must
  not be used as a runtime-family predicate.
- Existing local runtime/provider setup is immutable. Gate work must not edit,
  overwrite, switch, reorder, disable or delete any existing Codex/OpenCode/Pi/
  Claude provider entry, CC Switch setting, user-home config, daemon provider
  JSON, shell profile or environment file.
- For a Codex MiniMax real test only, the task may append one uniquely named,
  non-default CC Switch provider entry. It must not become the current/default
  provider even transiently, and the Gate report may record only its safe
  identifier — never its credential. Every pre-existing provider row and every
  current/default selector must remain unchanged. If isolated creation cannot
  be proven safe before the write, the real case is blocked instead of probing
  by mutation.
- MiniMax may be used only through an already-existing provider or the isolated
  test-only provider above. Codex's current configuration is never rewritten.
- Claude keeps `/context`; Codex uses its existing allowlisted `/status`
  contract and still requires context/compaction evidence.
- OpenCode and Pi must not claim context inspection that the daemon cannot
  perform. Their unsupported context/compact steps are explicit `skip` results
  with `applicable:false`, while the rest of Foundation remains strict.
- Reports remain honest and preserve the seven mode names, Server scoping,
  failure taxonomy and secret redaction. The old implicit MiniMax/Claude
  candidate rule is intentionally replaced rather than preserved.

### R4 — Pi credential and product semantics

- Remove the false product claim that Built-in Pi is keyless. User-facing copy
  should say only `Built-in Pi`; `bundled` means the runtime package is included
  and does not mean a model credential is unnecessary.
- Do not add a Pi API-key form, per-user/per-Agent secret storage, Server relay
  setup UI, or a new credential-readiness protocol in this task.
- Pi has lower implementation/acceptance priority than Claude, Codex and
  OpenCode, but still receives strict runtime-family selection, running
  workspace/session checks and honest context-control skips in the Gate.
- Historical relay/provider HTTP 200 evidence is not sufficient to claim a Pi
  reply path PASS. A real reply attempt may record the known Pi 0.73.1 SSE
  blocker without expanding this task into a provider credential redesign.

### R5 — Verification boundaries

- Follow TDD for the new API and Gate contracts: observe the expected RED before
  implementation and rerun the same focused targets GREEN.
- Keep pure Integration Gate tests service-free and database-free.
- Run the focused daemon build/tests covering Codex ACP diagnostics, OpenCode
  driver behavior and runtime detection.
- Do not restart/kill the shared local stack or write test Agent rows to the
  protected host database. A live read-only Gate may be attempted only when the
  candidate identity and Server/runtime target are explicit.
- Do not edit existing local runtime/provider configuration under the user's
  home, project env files, CC Switch storage or daemon manual-provider
  configuration. The sole exception is appending the isolated CC Switch test
  provider authorized above and removing only that exact test-owned entry when
  cleanup identity is certain.
- Do not push, publish, open a PR or merge without separate user authorization.

### R6 — Codex/OpenCode Activity semantics

- Preserve the established Claude Code Activity product semantics across
  providers: an accepted inbound message is Working; runtime analysis,
  narration, and assistant transcript previews are Thinking with readable
  `details.thought`; real tool execution is Output described as `Ran <tool>`
  with a sanitized `details.commandPreview`; the provider completion boundary
  is Idle.
- Provider adapters must filter user-authored input parts, delivered
  `[event=...]` envelopes, and generic connection/session events before they
  can become Thinking or Output. OpenCode must retain message id to role
  evidence and normalize reasoning/thinking parts explicitly.
- Do not synthesize `Generated output` for Codex `agent_message_chunk` or
  OpenCode assistant text. Do not add a separate `Tool completed` Activity for
  a terminal tool update when the Claude baseline records only the original
  `Ran <tool>` row.
- Preserve the existing shared frontend Activity kinds and diagnostic
  Warning/Error behavior; do not create new actionable runtime events. Activity
  persistence must preserve provider order so the turn's Idle row is last.

### R7 — One short Aura collaboration command across runtimes

- Claude, Codex, OpenCode and Pi must all execute the runtime-local
  collaboration CLI as bare `aura ...`; no runtime should be taught a generated
  absolute `.slock/slock`, `.slock/raft` or `.slock/aura` wrapper path.
- The daemon must prepend each runtime workspace's generated `.slock` directory
  to the child PATH. This is especially required for OpenCode, which previously
  omitted the injection and therefore depended on an absolute prompt path.
- The runtime-local `aura` wrapper targets the agent collaboration CLI and must
  win over the package/global `aura` daemon command. Existing `slock`/`raft`
  wrappers stay as compatibility aliases but are not advertised to new turns.
- Prompt changes are limited to the CLI command name and PATH contract; existing
  routing, safety, credential, task and communication language remains intact.
- Activity keeps proxy-secret redaction but must not disguise a long wrapper
  path as a short command. The short preview must be truthful because the
  provider actually executed `aura ...`.
- First-start correctness must not depend on a host/global `aura`, `slock` or
  `raft` installation, an existing runtime workspace, or user-home CLI state.
  The daemon-generated workspace wrapper is the only collaboration CLI a
  managed runtime needs after the daemon package itself has started.
- Automated verification must simulate a clean temporary HOME and a hostile
  host PATH entry named `aura`; every managed runtime child environment must
  still resolve bare `aura ...` to its own newly generated `.slock/aura`
  wrapper before the host command.

## Acceptance Criteria

- [x] `_normalize_runtime("opencode")` and `_normalize_runtime("open_code")`
      return `opencode`; `codex_cli` remains a 400.
- [x] The inherited Codex ACP diagnostic test target is green and separately
      proves exit/stderr evidence, driver error evidence, thought translation,
      and warning-vs-thinking classification.
- [x] Foundation Gate pure model tests prove distinct runtime profiles cannot
      cross-match workspaces and that MiniMax metadata does not determine the
      runtime family.
- [x] Every pre-existing Codex provider/configuration row remains byte-for-byte/
      field-for-field unchanged, and current/default selection never changes.
      A MiniMax test uses one uniquely named additive CC Switch test provider or
      reports an explicit safe blocker.
- [x] Any CC Switch cleanup removes only the exact test-owned provider; existing
      providers, current/default selection and credentials are unchanged.
- [x] CLI tests prove `--runtime codex` selects a Codex agent for runtime
      control, `--runtime opencode` passes only with an OpenCode running session
      and reports context steps as skipped, and an unsupported value fails
      closed.
- [x] Pi is independently selectable in Foundation Gate, cannot cross-match
      another runtime, and reports unsupported context controls as skipped.
- [x] Frontend/product surfaces display `Built-in Pi` without claiming that no
      key is required and without adding a key-entry flow.
- [x] A Pi reply regression covers the historical SSE parsing failure or
      records an exact external/package blocker; relay HTTP 200 alone is not a
      runtime PASS.
- [x] Integration Gate compatibility plus all `tools/integration-gate/*.test.mjs`
      tests pass without SmallKhoj services.
- [x] Focused backend and daemon verification passes; any unrelated blocker is
      reported with exact failing test and ownership.
- [x] Codex ACP and OpenCode SSE tests prove assistant analysis/narration is
      readable Thinking, user/session envelopes are filtered, real tools emit
      one `Ran <tool>` Output with a command preview, no `Generated output` or
      invented terminal-tool row appears, and Idle persists last without
      changing the shared frontend Activity vocabulary.
- [x] No user-owned unrelated changes are reverted, no test Agent/workspace or
      provider-configuration rows are created, and no commit is pushed. The
      authorized live acceptance reuses an existing Agent and writes only its
      marker message/reply and Activity telemetry.
- [x] Claude, Codex, OpenCode and Pi prompts/warmup advertise only bare
      `aura ...`; all runtime child environments resolve the workspace-local
      wrapper first on both existing and clean first-start environments;
      Activity no longer rewrites absolute wrapper paths.

## Out of Scope

- Adding arbitrary runtime-control commands or OpenCode slash-command support.
- Adding Pi key configuration, BYOK, Server relay configuration UI or a new
  credential-readiness API.
- Modifying existing local provider/runtime configuration, including current or
  default CC Switch selection, Codex/OpenCode/Claude/Pi settings, daemon
  manual-provider JSON, shell profiles and project/user env files. Only the
  explicitly authorized additive CC Switch test provider is in scope.
- Redesigning `/control/gates`, Agent creation UI, runtime provider discovery or
  runtime startup adapters.
- Publishing daemon `0.2.6`, committing, pushing, opening a PR, merging or
  restarting the shared local stack.
