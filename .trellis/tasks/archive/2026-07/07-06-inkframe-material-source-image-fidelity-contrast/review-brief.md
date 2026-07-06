Active task: .trellis/tasks/07-06-inkframe-material-source-image-fidelity-contrast

Please review the completed Inkframe material source image fidelity and
foreground contrast proof slice.

Scope to review:

- Task docs:
  - `prd.md`
  - `design.md`
  - `implement.md`
  - `evidence/validation.md`
- Curated context:
  - `check.jsonl`
- Changed code/tests:
  - `frontend/components/inkframe/material-surface.tsx`
  - `frontend/components/inkframe/app-desk-background.tsx`
  - `frontend/components/product-shell-body.tsx`
  - `frontend/test/material-surface.test.tsx`
  - `frontend/test/inkframe-object-ui.test.tsx`
  - `tools/twd-guard/twd-inkframe-proof.mjs`
  - `tools/twd-guard/twd-inkframe-proof.test.mjs`

Review questions:

1. Do the new `data-inkframe-resource-*` hooks actually prove visual/restore/
   source channel presence without leaking persistence semantics?
2. Do the background source-mode and has-channel hooks make future image
   background proof stronger?
3. Do foreground contrast owner hooks belong on the right component owners
   without adding visible clutter?
4. Is the proof runner selector expansion stable and route-safe?
5. Any P1/P2 blocker before marking this child task done, with browser proof
   still honestly `blocked_no_tab`?

Validation already run by main session:

- focused frontend material/background suite: `54 passed`
- frontend typecheck: pass
- `twd-inkframe-proof.test.mjs`: `13 passed`
- `tools/twd-guard/*.test.mjs`: `22 passed`
- `task.py validate`: pass
- `git diff --check`: pass
- `./twd --compact tabs`: `{"ok": true, "tabs": [], "count": 0}`, exit `2`,
  classified as `blocked_no_tab`

Please do not commit, push, pull, reset, or broaden the visual design scope.
