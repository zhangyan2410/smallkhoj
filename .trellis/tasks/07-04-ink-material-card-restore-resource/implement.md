# Implement Plan: Ink material card restore and resource lifecycle

## Phase 1: Red Tests

1. Open `message-cards-ink.test.html`.
2. Convert the documented T15/T16/T17 comments into executable assertions.
3. Add a test hook for object URL lifecycle, for example
   `revokedObjectUrlCount()`.
4. Run the test page before implementation and confirm the new tests fail for
   the expected reason:
   - T15 fails because re-rendered card surfaces start blank.
   - Resource lifecycle test fails because private resources are not explicitly
     revoked.

## Phase 2: Minimal Fix

1. Add image resource helpers to `message-cards-ink.html`.
2. Replace private card keep snapshots with Blob/objectURL resources.
3. Restore private card image during `activateCard()` with
   `loadImage(img)` + `bakeSource({ density: 0.9, wet: 0 })`.
4. Guard async restore so stale image loads cannot mutate a no-longer-active
   surface.
5. Release private object URLs on replace, discard, and pagehide/unload.
6. Preserve shared initial paper behavior and existing desk behavior.

## Phase 3: Regression Verification

Run the full test page and verify all old and new assertions pass.

Suggested command sequence:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/06-30-ink-wash-theme-exploration/evidence
python3 -m http.server 8771
```

Then in repo root:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
./twd goto --url-match 127.0.0.1:8771 "http://127.0.0.1:8771/message-cards-ink.test.html?v=$(date +%s)"
./twd eval --url-match 127.0.0.1:8771 "return window.__testResult"
```

If rAF/WebGL pauses because the tab is backgrounded, bring it forward with
`./twd cdp Page.bringToFront --url-match 127.0.0.1:8771` or equivalent before
waiting for `window.__testResult`.

## Phase 4: Review Checklist

Before marking implementation complete:

- [ ] T15/T16/T17/resource lifecycle tests fail before the fix and pass after.
- [ ] No screenshots are used as acceptance evidence.
- [ ] `ink-material-engine.js` is unchanged.
- [ ] Only demo/test files are changed unless a helper file is clearly needed.
- [ ] Restored ink can be drawn over and kept again.
- [ ] Shared paper image is not revoked prematurely.
- [ ] Private object URLs are revoked on replace, discard, and pagehide/unload.
- [ ] Repeated keep on the same card does not grow per-card resource count.
- [ ] Existing singleton behavior remains intact.

## Handoff Note For Implementing Agent

Product decision is final for this task: session-only restore, no backend,
no localStorage, no IndexedDB, restored ink remains editable.

After implementation, notify Codex for review. Codex should review code and
tests against `prd.md`, `design.md`, and this `implement.md`.
