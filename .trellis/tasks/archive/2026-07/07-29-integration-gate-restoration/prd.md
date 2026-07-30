# Restore Integration Gate runtime and visual control surface

## Goal

Restore the previously implemented `tools/integration-gate/` suite from the unmerged historical branch, adapt it to the current SmallKhoj authentication, Server tenancy, daemon, frontend, and persistence contracts, and make the latest results inspectable through a dedicated visual control surface.

The restored gate is an operator/developer acceptance system. Its pure model and CLI contract tests must run without starting SmallKhoj services. A real Foundation, Chat, DM, or Collaboration gate is allowed to require the corresponding live runtime stack and must report missing dependencies honestly.

## Historical Reference

- First implementation: `d554275a823078b6ad167bbf13116812b419f713`.
- Complete historical branch head: `99771f45c78041afb8b824f267fa10aa8f6f29af`.
- Reference worktree: `/Users/code/project/smallkhoj-06-23-integration-foundation-gate-context-compression`.
- Historical suite: `tools/integration-gate/{foundation-gate,chat-gate,collab-gate,run}.mjs` plus four test files.
- Historical behavior baseline: 35 model/CLI tests pass without a running SmallKhoj stack.
- Historical modes:
  - `foundation-only`
  - `chat-reply-channel-base`
  - `chat-reply-channel-group`
  - `chat-reply-dm`
  - `collab-channel-v1`
  - `collab-channel-v2`
  - `collab-channel-v3`

## Requirements

### R1. Restore the gate as a repo-owned tool

- Restore the historical report models, marker matching, failure taxonomy, compact CLI summary, structured JSON reports, and mock CLI harness.
- Preserve the seven historical modes and their stable mode names.
- Keep deterministic model and CLI tests runnable with Node only and without frontend, backend, database, daemon, provider credentials, or browser.
- Do not claim that real modes are stackless: each real run must emit explicit readiness steps for every dependency it needs.

### R2. Current authentication and Server tenancy

- Continue supporting `X-Public-Key` and `X-Account-Token` where the current public API requires them.
- Require an explicit Server target for real API gates via `--server-id` or an unambiguous environment/config source.
- Send `X-Server-Id` on scoped requests and record the Server id in the report target metadata.
- Fail closed before scenario execution when the Server is missing or ambiguous; never silently use another tenant.
- Never serialize secrets or full account tokens into reports, logs, errors, or visual output.

### R3. Foundation runtime/context evidence

- Restore a daemon-owned, allowlisted runtime control contract for:
  - inspect context;
  - compact context;
  - inspect usage/limit status.
- The contract may translate only known actions to provider-specific exact commands; it must not expose arbitrary slash command forwarding.
- Support current Claude Code and Codex runtime event shapes and bounded waiting.
- Distinguish direct observations from inferred usage in report evidence.
- Preserve context threshold behavior: above 50%, compact before a disposable gate run unless the caller explicitly records why valuable output makes compaction undesirable.
- Preserve first-class limit/quota/context failure categories.

### R4. Foundation, Chat, DM, and Collaboration scenarios

- Foundation validates session/auth readiness, frontend/backend readiness, daemon connection, provider/runtime availability, reuse candidate, limit/context preflight, optional compact, warmup, resume, and control-plane evidence.
- Channel base/group and DM scenarios validate the requested reply path with unique run markers and bounded polling.
- Collaboration V1–V3 validate the historical progressive collaboration contracts and marker/evidence relationships.
- Scenarios must isolate their own run marker, reject stale evidence, time out deterministically, and make the failing step actionable.

### R5. Result persistence

- Do not write mutable runtime results under `frontend/data/` or another tracked source directory.
- Store reports under a gitignored runtime directory owned by the gate, defaulting to `.runtime/integration-gate/`, with an overridable `--result-dir`.
- Write reports atomically and maintain a mode-specific latest pointer/document without corrupting a previous successful report on partial writes.
- Treat reports as untrusted data at the visualization boundary and enforce size/schema constraints.

### R6. Visual control surface

- Preserve the current `/control/integration` TaskRun/runtime evidence console.
- Add a distinct `/control/gates` operator route for gate status rather than replacing the current page.
- Show every supported mode, latest status, pass/step totals, run timestamp, Server target, duration, failure category/code/step, and bounded evidence details.
- Clearly label missing, stale, running, passed, and failed states.
- Provide the exact safe CLI command shape without embedding credentials.
- Add navigation from the existing control surface or rail without confusing the gate with a product-user workflow.

### R7. Verification and automation

- Add unit/model tests, CLI mock tests, daemon runtime-control regression tests, backend/result-boundary tests if an API is introduced, and frontend rendering/contract tests.
- Run the historical 35-test suite as a compatibility baseline, then add current-contract tests.
- Add a package/script entry point suitable for local and CI execution.
- Use `./twd` for real browser verification and capture marker-linked evidence; do not use Playwright for repository UI verification.

## Constraints and Non-goals

- This task does not redesign the existing `/control/integration` TaskRun console.
- This task does not make real provider/runtime scenarios hermetic or credential-free.
- This task does not forward arbitrary runtime commands through daemon control.
- This task does not push, open a PR, or merge without separate user authorization.
- Existing user-owned files in `/Users/code/project/smallkhoj`, including `session-observer/`, remain untouched.

## Acceptance Criteria

- [x] `tools/integration-gate/` exists on the feature branch and exposes all seven historical modes.
- [x] Pure gate model and CLI tests pass without any SmallKhoj service running.
- [x] Current-contract tests prove explicit `--server-id`, `X-Server-Id`, secret redaction, ambiguity failure, marker isolation, and deterministic timeout behavior.
- [x] Daemon tests prove the allowlisted runtime context/compact/usage contract, provider-specific direct command path, bounded result collection, and arbitrary-command rejection.
- [x] Foundation reports context/limit evidence accurately and preserves the 50% compaction policy.
- [x] Chat channel base/group, DM, and Collaboration V1–V3 retain their historical report contracts and can execute against the current APIs.
- [x] Runtime reports are atomically stored outside tracked frontend source data and can be read through a bounded, schema-validated interface.
- [x] `/control/integration` retains its current functionality and `/control/gates` renders all gate modes and latest results.
- [x] Frontend lint/type/build and relevant backend/daemon/tool test suites pass.
- [x] A real `./twd` browser check proves the new route, its state labels, and navigation without browser console or request failures attributable to this change.
- [x] At least one real gate smoke is attempted. If external credentials/provider capacity prevent a pass, the report must fail honestly with preserved evidence and the task records the external limitation; model/contract restoration must still be fully verified.
- [x] Trellis quality evidence is recorded and the task is marked complete only after the implemented scope passes its in-repo gates.

## Complexity in Agent Rounds

Expected execution is 8–12 focused agent implementation/verification rounds:

1. task/design/spec alignment;
2. compatibility RED tests and mechanical historical restore;
3. auth/Server tenancy adaptation;
4. daemon runtime-control restoration;
5. Foundation scenario convergence;
6. Chat/DM scenario convergence;
7. Collaboration V1–V3 convergence;
8. persistence/read boundary;
9. visual route;
10. cross-layer verification;
11. real stack/browser evidence;
12. quality-gate cleanup if needed.

The count is a risk envelope, not elapsed human time. Multiple low-risk rounds may collapse when the historical code applies cleanly.
