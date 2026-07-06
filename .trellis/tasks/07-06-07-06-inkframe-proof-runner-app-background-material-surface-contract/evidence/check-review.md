# Check Review

Date: 2026-07-06

## Files Checked

- `tools/twd-guard/twd-inkframe-proof.mjs`
- `tools/twd-guard/twd-inkframe-proof.test.mjs`
- `tools/twd-guard/twd-inkframe-proof`
- `.trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract/`

## Issues Found and Fixed

1. `tools/twd-guard/twd-inkframe-proof.mjs:313` - explicit `./twd` `NO_TAB`
   payloads were still classified as `failed_twd`, despite the project no-tab
   gate contract requiring them to be treated as blocked/no-tab. Changed
   classification to return `blocked_no_tab` for `ok: false, code: "NO_TAB"`.
2. `tools/twd-guard/twd-inkframe-proof.mjs:393` - pretty-printed JSON emitted by
   `./twd --compact tabs` failure paths was not preserved as the parsed payload.
   Added a tabs-payload parser fallback that accepts whole pretty JSON from
   stdout, stderr, or combined output.
3. `tools/twd-guard/twd-inkframe-proof.test.mjs:25` - added regression coverage
   for explicit `NO_TAB` classification.
4. `tools/twd-guard/twd-inkframe-proof.test.mjs:45` - added regression coverage
   for pretty no-tab error payload parsing.
5. `tools/twd-guard/twd-inkframe-proof.test.mjs:162` - expanded the forbidden
   browser/Playwright source guard to include the imported `twd-auth-guard.mjs`
   helper used by the proof runner.

## Issues Not Fixed

- None in the reviewed code path.

## Verification Results

- TypeCheck: skipped; reviewed files are JavaScript proof-runner scripts with no
  task-specific type-check target.
- Lint: pass for whitespace via `rtk git diff --check`.
- Focused tests: pass, `rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs`
  reported 13 passed.
- TWD guard tests: pass, `rtk node --test tools/twd-guard/*.test.mjs` reported
  22 passed.
- Task validation: pass, `rtk python3 ./.trellis/scripts/task.py validate ...`
  reported all context files valid.
- Proof runner: failed in this check sandbox with `failed_twd` because
  `./twd --compact tabs` returned `PermissionError: [Errno 1] Operation not
  permitted`. This is not browser acceptance and not a no-tab result.

## Summary

Checked 4 file groups, found 5 issues, fixed 5, 0 open.
