# Implementation Plan — Integration Gate Restoration

## Round 1 — Planning and spec alignment

- [x] Create isolated worktree and `feat/integration-gate-restoration`.
- [x] Integrate the single `origin/main` audit commit without modifying root `main`.
- [x] Create PRD and technical design.
- [x] Load package context and read applicable shared/backend/frontend/daemon/testing specs.
- [x] Record related files and task manifests.

Checkpoint: task can be started only after PRD/design/plan review and branch metadata are set.

## Round 2 — Compatibility RED and historical restore

- [x] Add a current-tree compatibility test that imports every historical gate model/mode and observe failure because the directory is absent.
- [x] Restore the historical `tools/integration-gate/` source and tests from `99771f4`.
- [x] Run the historical Node suite and establish the 35-pass baseline.
- [x] Refactor only after green to remove obsolete assumptions while retaining report contracts.

Checkpoint: all historical pure tests green on the current feature branch.

## Round 3 — Current auth and Server tenancy

- [x] Add RED tests for mandatory `--server-id`, `X-Server-Id`, ambiguous/missing Server failure, report target metadata, and recursive secret redaction.
- [x] Adapt CLI normalization and HTTP transport.
- [x] Map current channel/DM/member/task APIs and update fixtures.
- [x] Verify no reports or summaries contain credential values.

Checkpoint: current tenancy/auth contract tests green.

## Round 4 — Daemon runtime/context control

- [x] Add RED daemon tests for `daemon/runtime_control`, the three allowlisted actions, exact provider commands, arbitrary-command rejection, timeout, and structured result collection.
- [x] Restore/adapt the runtime-control method and provider direct-command paths.
- [x] Cover current Claude compact status/result events and Codex ACP structured usage/status events.
- [x] Run focused daemon build/tests.

Checkpoint: runtime control works in tests without opening arbitrary command execution.

## Round 5 — Foundation convergence

- [x] Adapt readiness calls and daemon log/runtime snapshot parsing.
- [x] Preserve 50% context policy and first-class limit failures.
- [x] Add stale/missing/direct-vs-inferred evidence tests.
- [x] Produce deterministic Foundation mock reports.

Checkpoint: Foundation model and mock transport suite green.

## Round 6 — Chat and DM convergence

- [x] Adapt base-channel, group-channel, and DM route calls to current API contracts.
- [x] Add unique marker, time-bound polling, stale evidence rejection, and relationship tests.
- [x] Verify each mode independently through the mock CLI harness.

Checkpoint: all three Chat/DM modes green in deterministic tests.

## Round 7 — Collaboration V1–V3 convergence

- [x] Restore progressive V1–V3 assertions and update current event/message shapes.
- [x] Test participant, thread, marker, and artifact/evidence relationships.
- [x] Preserve actionable failure category/code/step output.

Checkpoint: all collaboration modes green in deterministic tests.

## Round 8 — Atomic result persistence

- [x] Add RED tests for default runtime path, override, atomic replacement, index/latest publishing, malformed report rejection, size caps, and redaction.
- [x] Implement report store and add `.runtime/integration-gate/` ignore contract.
- [x] Remove all `frontend/data/integration-gate` assumptions.

Checkpoint: crash-safe report store tests green and source tree stays clean after a run.

## Round 9 — Visual control route

- [x] Add RED frontend tests for bounded result reading and seven-mode rendering.
- [x] Implement `/control/gates` with missing/stale/pass/fail states and safe command help.
- [x] Link the gate route from the current control surface without changing its TaskRun behavior.
- [x] Add translations and accessible state labels.

Checkpoint: focused frontend tests, lint, type/build green.

## Round 10 — Cross-layer quality

- [x] Run complete integration-gate Node suite.
- [x] Run focused daemon build/tests.
- [x] Run relevant backend tests if any backend boundary changed.
- [x] Run frontend tests, lint, and production build.
- [x] Run `git diff --check` and inspect accidental/generated files.

Checkpoint: all in-repo quality gates pass.

## Round 11 — Real stack and browser evidence

- [x] Start the feature worktree stack with isolated ports/data.
- [x] Execute at least one real gate smoke with explicit Server id.
- [x] Open `/control/gates` using repository `./twd`, assert state text/DOM markers, inspect browser console/network, and capture screenshot evidence.
- [x] If provider credentials/capacity block a pass, retain the honest structured failure report and distinguish external limitation from implementation failures.

Checkpoint: visual route verified against real runtime result data.

## Round 12 — Finish

- [x] Update task evidence and acceptance checklist.
- [x] Run Trellis quality check/finish workflow.
- [x] Mark task complete only when required implementation and in-repo verification are complete.
- [x] Report branch/worktree/commit state; do not push or merge without authorization.
