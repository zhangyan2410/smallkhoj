Active task: .trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability

Please review the completed Inkframe background image/resource/readability
contract slice.

Scope to review:

- Task docs:
  - `.trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability/prd.md`
  - `.trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability/design.md`
  - `.trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability/implement.md`
  - `.trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability/evidence/contract-validation.md`
- Curated context:
  - `.trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability/check.jsonl`
- Relevant source/test files:
  - `frontend/components/product-shell.tsx`
  - `frontend/components/product-shell-body.tsx`
  - `frontend/components/inkframe/app-desk-background.tsx`
  - `frontend/components/inkframe/material-resource.ts`
  - `frontend/components/inkframe/material-surface.tsx`
  - `frontend/test/inkframe-object-ui.test.tsx`
  - `frontend/test/material-resource.test.ts`
  - `frontend/test/material-surface.test.tsx`

Review questions:

1. Does the current evidence prove the PRD acceptance criteria except for real
   browser proof, which is explicitly `blocked_no_tab`?
2. Is the shell background still owned by `ProductShell` / `app-background` /
   `global-desk` with `desk` tint, including future image-resource metadata?
3. Is discard/replace behavior safely returning to app-background desk defaults
   without introducing backend/localStorage/IndexedDB blob persistence?
4. Are foreground readability and pointer-ownership contracts strong enough at
   source/unit-test level for this browserless slice?
5. Are there any P1/P2 issues that should block marking this child task done?

Validation already run by main session:

- `rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts test/material-surface-restore.test.ts`
  - result: `53 passed`
- `rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false`
  - result: pass
- `rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability`
  - result: pass
- `rtk git diff --check`
  - result: pass
- `rtk ./twd --compact tabs`
  - result JSON: `{"ok": true, "tabs": [], "count": 0}`
  - classification: `blocked_no_tab`

Please do not commit, push, pull, reset, or broaden the visual design scope.
If you make a small mechanical self-fix, report it clearly.
