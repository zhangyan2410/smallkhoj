# Check Review

Date: 2026-07-06

## Self-Check Complete

### Files Checked

- `frontend/components/inkframe/app-desk-background.tsx`
- `frontend/components/inkframe/material-surface-lifecycle.ts`
- `frontend/test/material-surface.test.tsx`
- `.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/evidence/validation.md`
- `.trellis/spec/frontend/quality-guidelines.md`

### Issues Found and Fixed

1. `frontend/components/inkframe/material-surface-lifecycle.ts:25` — pointer capture allowed any non-`none` pointer mode while the material surface was `keeping` or `discarding`, which contradicted the app-background contract that pointer capture is true only for explicit active draw/water editing. Changed the helper to return true only for `active` + `draw`/`water`.
2. `frontend/components/inkframe/app-desk-background.tsx:84` — the app background duplicated pointer-capture logic instead of deriving its shell metadata from `shouldMaterialSurfaceCapturePointer`. Changed the data attribute to use the shared helper.
3. `frontend/test/material-surface.test.tsx:181` — the pointer-capture regression test name said “only active draw or water” but asserted `keeping` + `water` captured the pointer. Updated the test matrix to cover `active` + `water` as true and `keeping`/`discarding` pointer modes as false.

### Issues Not Fixed

- None.

### Verification Results

- Focused material test: pass via `rtk env NODE_PATH=./node_modules node --import tsx --test test/material-surface.test.tsx` (`26 passed`).
- Focused material/object tests: pass via `rtk env NODE_PATH=./node_modules node --import tsx --test test/material-surface.test.tsx test/inkframe-object-ui.test.tsx` (`43 passed`).
- Full frontend tests: pass via `rtk env NODE_PATH=./node_modules node --import tsx --test test/*.test.ts test/*.test.tsx` (`136 passed`).
- TypeCheck: pass via `rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false`.
- Lint: pass via `rtk npm run lint -- --max-warnings=0`.
- Whitespace: pass via `rtk git diff --check`.
- Task context validation: pass via `rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract`.
- Browser proof: blocked. Main-session validation recorded `./twd --compact tabs` as `{"ok": true, "tabs": [], "count": 0}` and makes no browser/mobile acceptance claim. The check sandbox could not re-run `./twd` because it returned `PermissionError: [Errno 1] Operation not permitted`.

### Summary

Checked 5 files, found 3 issues, fixed 3, 0 open. The slice now has an exported action resolver, the requested action matrix, shared pointer-capture derivation, desk owner/tint preservation tests, session-local resource checks, and honest no-tab browser evidence.
