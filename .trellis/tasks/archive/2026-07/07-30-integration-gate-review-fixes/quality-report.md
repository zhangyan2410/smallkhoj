# Quality Gate Report

## Scope and vision

- Task: `07-30-integration-gate-review-fixes`.
- Original requirements: restore Integration Gate on the Pi-enabled `main`,
  investigate every gate/review failure, and merge only after all P1/P2 issues
  are fixed.
- Source feedback: independent review of exact SHA `872e3d1` returned two P2s:
  late channel identity did not refresh audience membership, and daemon control
  output was not correlated with immediate control delivery.
- Delivery completeness: both P2s and the same-family channel-group path are
  repaired; there is no deferred P1/P2 tail.

## Acceptance matrix

| Requirement | Result | Evidence |
|---|---|---|
| Channel-name-only collaboration resolves members | Pass | V1 CLI Red `COLLAB_AUDIENCE_INCOMPLETE` → Green; members endpoint called exactly once |
| Same failure-mode sweep covers group chat | Pass | group CLI Red `CHANNEL_AUDIENCE_AMBIGUOUS` → Green; members endpoint called exactly once |
| Explicit channel ID remains compatible | Pass | V2/V3 and existing explicit-ID cases remain in the 39/39 suite |
| Busy control cannot consume unrelated output | Pass | daemon busy regression returns `runtime_control_busy`, sends zero messages, captures no output, retains zero listeners |
| Rejected/throwing control cleans up | Pass | false-send/send-throw paths settle immediately; listener count is zero |
| Output is bounded | Pass | 70,000-character stream returns exactly 65,536 characters with `outputTruncated=true` |
| Normal message queues remain intact | Pass | existing Claude/Codex queue tests pass; new tests prove only `{ control: true }` is immediate-only |

## Red → Green evidence

- `tools/integration-gate/cli.test.mjs`:
  - V1 without `--channel-id`: `10/11`, `COLLAB_AUDIENCE_INCOMPLETE` → pass.
  - channel group without `--channel-id`: `10/11`,
    `CHANNEL_AUDIENCE_AMBIGUOUS` → pass.
- `agent/daemon/aaa-daemon/test/runtime-mcp.test.mjs`:
  - busy reason was absent, send-throw retained one listener, oversized output
    remained 70,000 characters, and Claude control queued → all new assertions
    now pass.
- `agent/daemon/aaa-daemon/test/codex-acp-runtime.test.mjs`:
  - unready control queued one prompt → now queue count remains zero.

## Failure-mode sweep

- Finding families are independent: late identity derivation versus
  uncorrelated asynchronous result collection.
- Late-identity scan found one sibling path, `chat-reply-channel-group`; it was
  included in the same Red→Green change.
- Stream collector scan found one production control collector. It now owns
  one bounded listener lifecycle across result, timeout, rejection, and throw.
- Project has no `scripts/check-fallback-layers.mjs`; manual diff inspection
  found no new fallback stack. The fix replaces ambiguous queue behavior with
  explicit state rather than adding fallback layers.

## Architecture ownership

- Architecture cell: Integration Gate runner / daemon runtime-control
  observation boundary.
- Map delta: none.
- Why: the change tightens existing delivery and collection contracts; it does
  not create a parallel Store, Queue, Router, Adapter, Dispatcher, or Binding.
- Reference-project check: no reusable runtime-control result correlator was
  found in `agent-platform`, `clowder-ai`, or `multica`; SmallKhoj's current
  fail-closed immediate-delivery contract remains the source of truth.

## Spec compliance

- The executable runtime-control contract, response fields, error matrix,
  output budget, cases, and tests are recorded in
  `.trellis/spec/backend/event-delivery-contracts.md`.
- `accepted` and `delivered` remain distinct; public method/action names and
  existing result fields remain compatible.
- Ordinary user messages still queue; only daemon-owned allowlisted control
  messages are immediate-only.

## Dogfood-your-slice

- Scope verdict: required because this changes operator-facing Integration
  Gate CLI behavior and daemon observation reliability.
- End-to-end slice: the CLI tests spawn the real
  `tools/integration-gate/run.mjs` process against a current API-shaped HTTP
  server, omit `--channel-id`, receive the durable ID from POST, load members,
  and produce PASS reports for both collaboration and group-chat paths.
- Daemon slice: JSON-RPC control invokes the real `DaemonCore` boundary and a
  provider-shaped EventEmitter stream; successful immediate output and all
  fail-closed paths are exercised.
- Browser scope: exempt for this review-fix delta because no frontend source or
  visible layout changed. The parent restoration already has isolated `./twd`
  proof for `/control/gates`.

## Fresh verification

- Integration Gate: 39 passed, 0 failed.
- Daemon: TypeScript build pass; 279 passed, 0 failed.
- Canonical `make ci` on disposable PostgreSQL 17:
  - scripts: 170 passed, 1 skipped;
  - backend: Ruff pass; 514 passed, 9 skipped;
  - frontend: 217 passed; lint, application typecheck, E2E typecheck, and
    production build pass;
  - Alembic upgrade/check, standalone artifact, Compose config, and
    `git diff --check` pass.
- Temporary PostgreSQL container stopped and removed after verification.

## Artifact hygiene and design check

- No frontend source changed and no `.pen` design comparison applies.
- Root media/design artifact guard: no task-created root artifacts.
- Bug evidence is stored in
  `docs/bug-report/integration-gate-final-review-p2s/bug-report.md`; task
  metadata remains under `.trellis/tasks/`.

## Result

Local quality gate passes. The independent reviewer approved exact work SHA
`cd7d1bc83a98f85ffc9d779caba4991f290e72c0` with no P0/P1/P2/P3 findings.
