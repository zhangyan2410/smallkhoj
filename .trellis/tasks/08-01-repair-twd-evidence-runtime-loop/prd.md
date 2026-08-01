# Repair TWD evidence truth and real runtime verification loop

## Goal

Make `./twd` a fail-closed browser evidence tool for SmallKhoj: it must target
the intended bridge and tab, distinguish completed execution from timeout or
navigation-in-progress, and prove the final browser origin and URL before a
result can be accepted. Delivery is complete only after automated regression
tests pass and a real locally running SmallKhoj agent/channel/task conversation
is verified through the visible browser with `./twd`.

## Background

Read-only diagnosis on 2026-08-01 confirmed the outer `./twd` shell launchers
are pass-through wrappers. The defects are in the Python CLI/core and the
authenticated guard:

- `tmwebdriver_core.py` returns timeout/reload uncertainty as ordinary result
  dictionaries; `twd.py` then emits `ok=true` and exit 0.
- `twd.py` chooses the first candidate bridge with any sessions before using
  `--tab` or `--url-match`. A target on `18765` therefore fails when `28765`
  has unrelated tabs. A temporary dual-bridge fixture reproduced auto failure
  and explicit `--port 18765` success for the same exact tab.
- `twd-auth-guard.mjs::assertTargetResult()` compares only pathname and checks
  query only when the expected query is non-empty. It accepts a cloud
  `http://124.222.40.40/members` probe for local
  `http://127.0.0.1:3000/members`.
- `goto` reports `navigated=true` immediately after assigning
  `location.href`; the guard probes once and retries only `/login`.
- Error paths ignore `--compact`; `act --cleanup-after` passes an unsupported
  `args=` keyword and swallows the resulting error; `groups --collapsed false`
  parses as `true`.

The original GA-derived core/bridge already contained the timeout and immediate
navigation semantics. SmallKhoj's later multi-port discovery introduced the
target-independent bridge choice. Existing exact-tab and ambiguity fixes are
valuable and must remain fail-closed.

## Requirements

### R1 — Execution truth

- A command that times out, is not delivered, or loses its final result must
  never emit `ok=true` or exit 0.
- `eval`, `scan`, `input`, `click`, `cdp`, `screenshot`, `snapshot`, `act`,
  `groups`, and `goto` must preserve this fail-closed rule.
- Timed-out request bookkeeping must not leave unbounded ACK/result state.
- Existing page-script errors and invalid explicit tabs remain failures; no
  implicit fallback to another tab is allowed.

### R2 — Target-aware bridge selection

- Explicit `--port` and `TWD_PORT` remain authoritative.
- With automatic discovery, `--tab <id>` selects the candidate bridge that
  owns that exact session.
- With `--url-match`, discovery selects the bridge containing the matching URL;
  ambiguity across bridges fails with actionable candidates instead of picking
  by candidate order.
- `tabs` reports connected sessions across all live candidate bridges with
  enough source information to diagnose ownership without duplicate tab rows.
- Starting the preferred bridge and waiting for it must use the same explicit
  port.

### R3 — Navigation and guard truth

- Final acceptance compares the actual `origin`, `pathname`, `search`, and
  relevant hash against the normalized target URL.
- An empty expected query does not permit an unexpected actual query.
- After navigation starts, the guard polls only the selected exact tab until
  the target URL is reached or the bounded wait expires.
- Login recovery may re-authenticate once, but it must keep the same exact tab
  and must never fall back to enumeration or URL matching.
- Legacy discovery remains available only when the caller deliberately omits
  `--tab`; once a tab is selected, subsequent navigation, evaluation, and
  probes use that exact tab.

### R4 — CLI reliability

- `--compact` produces one-line JSON on success and handled failure paths and
  is accepted both before and after the subcommand.
- `act --cleanup-after` actually removes the requested selector or reports a
  cleanup failure; it must not silently swallow a wrapper API mismatch.
- `groups --collapsed true|false` parses both values correctly and rejects
  invalid boolean text.

### R5 — Automated regression protection

- Tests are written RED before implementation for every confirmed defect.
- Focused Python and Node suites cover timeout/error exit semantics,
  target-aware dual-bridge selection, full-URL guard validation, navigation
  polling, compact failures, cleanup, and boolean parsing.
- Existing WebDriver selection, guard, Inkframe proof, script, lint/type, and
  relevant project gates remain green.

### R6 — Real delivery loop

- Start the current feature worktree's backend, frontend, WebDriver bridge, and
  runtime prerequisites on isolated local ports/configuration.
- Through the real product, create uniquely marked disposable Server context as
  needed, one real agent, one real channel, and one assigned task.
- Send a uniquely marked visible conversation message and receive a real agent
  reply through the SmallKhoj runtime, not a mocked API response.
- Use `./twd` exact-tab commands to drive and assert the visible workflow,
  including the final URL/origin and marker-bearing reply/task state.
- Cross-check the same marker with API/database/runtime trace evidence where
  applicable. A screenshot alone is insufficient.
- If this run exposes another TWD defect, add a failing regression, repair it,
  and repeat the real flow until it passes.

## Constraints

- Browser acceptance uses the project `./twd` wrapper; Playwright is not a
  substitute.
- Do not enumerate or mutate unrelated operator tabs after an exact disposable
  local tab has been selected.
- Do not use the existing cloud tab as proof for the local worktree.
- Preserve the user's dirty `main` worktree. Code implementation occurs in a
  sibling feature worktree.
- Do not weaken a check or reinterpret an uncertain result to make the loop
  green.

## Acceptance Criteria

- [ ] AC1: A deterministic delayed-script test and a live read-only probe both
  show timeout as `ok=false` with nonzero exit, never `ok=true`.
- [ ] AC2: A two-bridge fixture proves automatic exact-tab and URL selection
  reach the owning bridge; cross-bridge ambiguity fails closed.
- [ ] AC3: Guard tests reject wrong origin and unexpected query, and a stale
  post-`goto` probe is polled on the same exact tab until the target is ready.
- [ ] AC4: `--compact` failure JSON is one line in both option positions;
  cleanup and collapsed-boolean regression tests pass.
- [ ] AC5: Existing focused and canonical repository gates pass from the final
  candidate.
- [ ] AC6: A real local worktree run creates a unique agent, channel, and task,
  sends a unique chat marker, receives the real agent reply, and shows the same
  state in visible `./twd` evidence plus runtime/API/DB trace evidence.
- [ ] AC7: Any defect discovered during AC6 has its own RED→GREEN regression and
  the complete real flow is rerun after the repair.

## Out of Scope

- Replacing the Chrome extension or TMWebDriver protocol wholesale.
- Product UI redesign unrelated to completing the real verification flow.
- Treating cloud production validation as a substitute for the required local
  current-worktree run.
