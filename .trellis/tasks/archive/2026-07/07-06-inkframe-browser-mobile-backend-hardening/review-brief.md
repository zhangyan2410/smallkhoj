# Review Brief: Browser/Mobile/Backend Hardening

Active task: `.trellis/tasks/07-06-inkframe-browser-mobile-backend-hardening`

Please review this continuation pass as a truthful hardening/review gate, not as
a new visual redesign.

## What Changed In This Continuation

- Linked the earlier optimization/proof tasks under the parent
  `07-05-inkframe-product-ui-refactor` task tree:
  - `07-06-inkframe-material-runtime-chat-events-optimization`
  - `07-06-inkframe-runtime-browser-proof-product-polish`
  - `07-06-inkframe-browser-mobile-backend-hardening`
- Added current progress evidence:
  - `.trellis/tasks/07-06-inkframe-browser-mobile-backend-hardening/evidence/2026-07-06-progress.md`
- Expanded `check.jsonl` so review sees the parent PRD, previous optimization
  PRD, browser blocker evidence, backend route-flow evidence, and current
  validation claims.

## Already Implemented Before This Review

Backend read-cursor tests were strengthened in:

- `backend/tests/test_chat_read_cursors.py`

The new tests call route handlers directly:

- `public_api.update_chat_read_cursor(...)`
- `public_api.get_chat_read_cursors(...)`

This is intended to prove handler-level route flow:

```text
active server context -> route handler -> access check ->
chat_read_cursors service -> DB session add/flush/commit -> serializer payload
```

Please specifically check whether the evidence overstates this as full HTTP/API
coverage. It should not.

## Browser Truthfulness Requirement

`./twd` remains connected to no browser tab:

```json
{"ok": true, "tabs": [], "count": 0}
```

The task should not claim browser or mobile acceptance yet. It should only claim
diagnosis of the current blocker.

## Validation Rerun In This Continuation

Frontend:

```text
TypeScript: pass
ESLint: pass
Frontend tests: 120 pass / 0 fail
```

Backend:

```text
Backend cursor/account tests: 40 pass / 0 fail
Backend compile: pass
```

Repo:

```text
git diff --check: pass
```

## Review Focus

1. Is the Trellis scope consolidation correct and visible enough for future
   agents?
2. Are browser/mobile evidence claims truthful and not faked?
3. Are backend route-handler tests a meaningful improvement without claiming
   full authenticated HTTP route coverage?
4. Did any doc/code imply backend/localStorage/IndexedDB storage for large
   material blobs? That remains out of scope.
5. Are there small mechanical doc/test issues you can safely fix in place?

Do not commit, push, pull, merge, or reset.
