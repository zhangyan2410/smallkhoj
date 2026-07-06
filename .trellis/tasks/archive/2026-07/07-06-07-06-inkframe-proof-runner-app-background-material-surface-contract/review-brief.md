# Review Brief

Active task: .trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract

Please review the proof-runner app-background inner material surface contract
slice.

Diff scope:

```text
tools/twd-guard/twd-inkframe-proof.mjs
tools/twd-guard/twd-inkframe-proof.test.mjs
.trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract/
```

Focus on bugs and missing tests.

Check these contracts:

- Every `PRODUCT_SHELL_PROOF_ROUTES` route requires the inner material surface
  owner selector:
  `[data-inkframe-surface="material"][data-inkframe-owner-kind="app-background"][data-inkframe-owner-id="global-desk"]`.
- Every route requires the inner material desk tint selector.
- Every route requires the inner material static mode selector.
- Every route requires the inner material pointer-capture false selector.
- Required selectors use `minCount === 1`.
- The runner still uses `./twd`, does not launch browsers, and does not use
  Playwright.
- No-tab behavior remains `blocked_no_tab` and does not claim browser/mobile
  acceptance.

Validation already run:

```text
node --test tools/twd-guard/twd-inkframe-proof.test.mjs: 11 passed
node --test tools/twd-guard/*.test.mjs: 20 passed
proof runner: blocked_no_tab with evidence JSON/MD
git diff --check: pass
task.py validate: pass
```

Return findings with file/line references. If you self-fix anything, report it.
