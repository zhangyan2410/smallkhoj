# TWD Evidence Truth and Runtime Loop Implementation Plan

## Goal and Acceptance Mapping

The terminal deliverable is the complete PRD finish line, not merely green unit
tests. AC1–AC4 are implemented test-first, AC5 runs canonical gates, and
AC6–AC7 execute the real runtime/browser repair loop.

## Implementation Sequence

### 1. Establish isolated development state

- Create sibling worktree `../smallkhoj-repair-twd-evidence-runtime-loop` on
  `feat/repair-twd-evidence-runtime-loop` without modifying the dirty main tree.
- Carry the task planning artifacts into the feature branch.
- Record worktree path/branch in the Trellis task and load `trellis-before-dev`.
- Verify the focused WebDriver/guard suites are green before new RED tests.

### 2. RED — execution truth and CLI semantics

Files:

- Modify `agent/daemon/webdriver/test_twd_selection.py` or add a focused adjacent
  test module if command-level capture becomes clearer.
- Test `agent/daemon/webdriver/tmwebdriver_core.py` and
  `agent/daemon/webdriver/twd.py` through real functions with only transport
  fixtures replaced.

Tests must first fail for:

- ACK-without-result timeout returned as success;
- no-ACK timeout returned as success;
- `goto` converting an uncertainty dictionary to `navigated=true`;
- handled error output ignoring compact mode;
- `--compact` after a subcommand;
- `--collapsed false` becoming true;
- `act --cleanup-after` passing an unsupported keyword and swallowing it.

Run the exact focused Python test command and preserve the expected failure
names before implementation.

### 3. GREEN — execution and CLI fixes

- Introduce explicit execution failure types/state handling in
  `tmwebdriver_core.py`; clean owned ACK/result state on terminal paths.
- Map lower-layer failures to stable CLI `ok=false` JSON and nonzero exits.
- Make compact output a command-wide invariant and accept the option in both
  supported positions.
- Pass cleanup selector through serialized JavaScript supported by the current
  driver API and surface cleanup failure.
- Replace `type=bool` with strict textual boolean parsing.
- Run the focused Python suite after each minimal behavior change.

### 4. RED — target-aware multi-bridge selection

Add fixtures where both `28765` and `18765` have sessions:

- exact tab exists only on the second candidate;
- URL exists only on the second candidate;
- matching URL exists on both candidates;
- duplicate tab id appears across candidates;
- aggregated tabs preserve owning port and deduplicate only identical ownership
  records;
- explicit port continues to bypass discovery.

Run and record the expected first-nonempty-selection failures.

### 5. GREEN — bridge selection and startup alignment

- Refactor candidate probing into one target-aware selection path in `twd.py`.
- Make `tabs` aggregate candidate sessions with source-port diagnostics.
- Return stable no-match/ambiguous bridge failures.
- Update `tools/twd-guard/twd-auth-guard.mjs::ensureTwdServe()` to launch the
  same explicit preferred port that it waits for.
- Re-run Python and guard suites.

### 6. RED — full URL guard and navigation polling

Modify `tools/twd-guard/twd-auth-guard.test.mjs` with failures for:

- wrong origin with identical pathname;
- unexpected query when target query is empty;
- mismatched hash when the target includes a hash;
- stale non-login probe followed by the correct target;
- stale probe until timeout;
- login retry preserving exact tab;
- legacy discovery selecting once, then using only exact tab for navigation,
  evaluation, and final probe.

### 7. GREEN — guard truth

- Expand the probe result and make target assertion compare normalized URL
  components.
- Add bounded polling with injectable clock/sleep for fast deterministic tests.
- Keep exact-tab identity checks on every payload.
- Convert discovery mode to exact-tab operations immediately after initial
  selection.
- Re-run all Node guard and Inkframe proof tests.

### 8. Automated regression gate

Run at minimum:

```bash
python3 -m unittest agent/daemon/webdriver/test_twd_selection.py
node --test tools/twd-guard/twd-auth-guard.test.mjs
node --test tools/twd-guard/twd-inkframe-proof.test.mjs
make scripts-test
```

Then load `trellis-check` and run the relevant syntax, lint/type, source-contract,
and project gates it identifies. Do not proceed to runtime acceptance with a
known red automated gate.

### 9. Start current worktree and execute real scenario

- Determine unused isolated backend/frontend/database/runtime ports and create
  worktree-local environment values without reusing operator production data.
- Start required backend, frontend, daemon/runtime, and preferred TWD bridge;
  capture health and log/session identities.
- Open one disposable loopback browser tab and record exact tab id.
- Authenticate and verify exact local origin with `./twd`.
- Through visible product interactions, create unique agent/channel/task
  fixtures using marker `TWD_REAL_<timestamp>`.
- Send the marker-bearing conversation message and wait for the real agent
  reply/task reaction.
- Assert visible state with exact-tab `./twd` commands and capture a screenshot
  only as supplementary evidence.
- Cross-check marker and ids with API/database state and `./smallkhoj-trace`.

### 10. Repair loop

For every runtime discrepancy:

1. Classify product/runtime failure versus TWD observation failure.
2. If TWD-related, add the smallest deterministic RED regression.
3. Implement the minimal repair.
4. Re-run focused and full automated gates.
5. Restart/reconcile the feature worktree services as required.
6. Repeat the complete real marker scenario with a new marker.

Do not close the task while any step relies on screenshot-only, wrong-origin,
old-marker, mocked-reply, or uncertain-timeout evidence.

### 11. Completion audit

- Map AC1–AC7 to exact command output/evidence paths.
- Run `trellis-check` on the final tree and update applicable TWD quality specs
  if the repaired contracts were not previously durable.
- Verify `git diff` contains only task-owned changes plus acknowledged planning
  artifacts.
- Record final runtime identities, marker, commands, exit codes, and cleanup
  state in task evidence.

## Risk and Rollback Points

- Driver timeout changes affect every command: keep focused protocol tests green
  before touching guard behavior.
- Port aggregation can expose duplicate session ids: fail closed rather than
  silently deduplicating conflicting ownership.
- Navigation polling must never enumerate tabs after exact selection.
- Runtime startup must use the feature worktree and isolated ports; if URL/CWD
  disagree, stop before browser interaction.
