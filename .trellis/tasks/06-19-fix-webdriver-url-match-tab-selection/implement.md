# Implementation Plan

## Phase 1: Diagnose

- [x] Inspect `./twd --help` and the wrapper command path.
- [x] Locate URL matching and tab selection implementation.
- [x] Reproduce or simulate multiple matching tabs.
- [x] Identify why a stale/non-visible matching tab was chosen.

## Phase 2: Regression

- [x] Add a focused test for tab selection if there is an existing Python test surface.
- [x] If no test harness exists, add a small pure function around selection logic and test it.
- [x] Confirm the test fails before the fix.

## Phase 3: Fix

- [x] Prefer active/focused matching tab if the protocol exposes that signal.
- [x] If not available, make ambiguous broad `--url-match` fail clearly unless the match is unique.
- [x] Include candidate URLs in the error.
- [x] Keep exact or specific matches working.

## Phase 4: Verify

- [x] Run the focused test.
- [x] Run `./twd --compact tabs`.
- [x] Run one eval against a specific chat URL match and confirm the returned URL matches the intended page.

Verification note: after starting a temporary `./twd serve`, the extension connected with multiple localhost tabs. Broad `./twd --compact eval --url-match 127.0.0.1:3000 --wait 2 "return location.href"` returned `AMBIGUOUS_TAB` with 3 candidate URLs. Specific `./twd --compact eval --url-match 127.0.0.1:3000/chat/all --wait 2 "return location.href"` returned `tabUrl=http://127.0.0.1:3000/chat/all` and `result=http://127.0.0.1:3000/chat/all`.

## Notes

Do not edit frontend business code in this task. The screenshot proved the actual chat sidebar is correct; this is a WebDriver tooling bug.
