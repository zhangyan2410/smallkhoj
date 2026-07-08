# Implementation Plan: Inkframe Selector Driven TWD Proof Runner

## Phase 0: Preflight

1. Confirm current worktree:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git branch --show-current
rtk git status --short
```

2. Read task and source checklist:

```bash
rtk sed -n '1,260p' .trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner/prd.md
rtk sed -n '1,260p' .trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner/design.md
rtk sed -n '1,260p' .trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness/evidence/twd-proof-checklist.md
```

3. Inspect existing guard tools:

```bash
rtk ls tools/twd-guard
rtk rg -n "twd|selector|open|auth|tabs|compact" tools/twd-guard scripts frontend/test
```

## Phase 1: Test First

Add tests for the runner model before writing the runner implementation.

Candidate test locations:

```text
scripts/tests/test_twd_inkframe_proof.py
```

or frontend/tooling test location if the repo already has a better precedent.

Tests:

- no-tab result parses to `blocked_no_tab`;
- selector manifest includes all required groups;
- evidence path stays inside a provided task directory;
- command construction invokes `./twd`;
- command construction does not mention Playwright.

Run the tests and confirm red for the missing runner.

## Phase 2: Minimal Runner

Implement the smallest runner that:

- defines selector groups;
- runs the tab gate;
- writes blocked evidence when no tab exists;
- can emit a Markdown summary;
- can be called with a task directory argument.

Do not launch Chrome.

## Phase 3: Route And Selector Checks

When tabs are present, the runner should:

- authenticate/open `/chat` and `/tasks` through guard wrappers if available;
- assert selector counts for shell/chat/task/material/unread groups;
- record per-selector pass/fail status;
- distinguish route/open failures from selector failures.

If the current `./twd` CLI lacks a direct selector-count command, add a small
wrapper around the supported command surface rather than using Playwright.

## Phase 4: Mobile Mode

Add mobile proof attempt:

- target width: 390px;
- chat mobile selectors;
- task mobile selectors;
- record unsupported if viewport control is unavailable.

## Phase 5: Validation

Run:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Run the new runner test command discovered/created in Phase 1.

Run:

```bash
rtk ./twd --compact tabs
```

If no tab exists, run the proof runner and confirm it writes blocked evidence
without claiming acceptance.

## Phase 6: Review

Dispatch a check worker with:

```text
Active task: .trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner

Review the selector-driven twd proof runner. Prioritize false pass behavior,
failure classification, accidental Playwright use, launching Chrome, evidence
path safety, and selector drift from the Inkframe DOM contract.
```

Fix findings and rerun tests.

## Execution Status: 2026-07-06

- Phase 0 complete: task artifacts, relevant specs, source checklist, and
  existing `tools/twd-guard` wrappers were inspected.
- Phase 1 complete: added
  `tools/twd-guard/twd-inkframe-proof.test.mjs`, confirmed the initial missing
  module red state, then added a regression for the real no-tab/nonzero-exit
  behavior.
- Phase 2 complete: added
  `tools/twd-guard/twd-inkframe-proof.mjs` and executable wrapper
  `tools/twd-guard/twd-inkframe-proof`.
- Phase 3 complete at code level: connected-tab route assertions use the
  existing `evalOnTarget(...)` guard flow for `/chat` and `/tasks`; real route
  execution remains pending because no connected `./twd` tab exists.
- Phase 4 complete at DOM-contract level: mobile selector groups are included
  and viewport/overflow facts are captured by the DOM count script. Actual
  viewport resizing remains pending unless the local `./twd` bridge exposes
  viewport control.
- Phase 5 complete for browserless validation: runner tests pass, existing
  `twd-guard` tests pass, `git diff --check` passes, and no-tab proof evidence
  is written as `blocked_no_tab` with exit code `2`.
- Phase 6 attempted: check worker channel
  `cr-07-06-selector-proof-runner` was created and sent
  `evidence/check-brief.md`, but the worker failed before review with
  `Failed to authenticate. API Error: Attention Required! | Cloudflare`.
  See `evidence/review-status.md`.

Current blocker: real browser/mobile acceptance still cannot be claimed because
`rtk ./twd --compact tabs` returns `{"ok": true, "tabs": [], "count": 0}`.
