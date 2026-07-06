Active task: .trellis/tasks/07-06-07-06-inkframe-desk-background-owner-route-coverage

Please review the desk background owner / route coverage slice.

## Task Artifacts

- `.trellis/tasks/07-06-07-06-inkframe-desk-background-owner-route-coverage/prd.md`
- `.trellis/tasks/07-06-07-06-inkframe-desk-background-owner-route-coverage/design.md`
- `.trellis/tasks/07-06-07-06-inkframe-desk-background-owner-route-coverage/implement.md`
- `.trellis/tasks/07-06-07-06-inkframe-desk-background-owner-route-coverage/evidence/source-contract-validation.md`

## Changed Files To Review

- `frontend/components/product-shell.tsx`
- `frontend/components/inkframe/app-desk-background.tsx`
- `frontend/components/inkframe/material-surface.tsx`
- `frontend/test/inkframe-object-ui.test.tsx`
- `frontend/test/material-surface.test.tsx`
- `frontend/test/material-resource.test.ts`

## Review Focus

1. Does the route coverage test correctly pin user-facing routes without
   accidentally including internal/operator pages?
2. Are `data-inkframe-background-owner="product-shell"` and
   `data-inkframe-background-scope="global-desk"` stable enough for future
   browser assertions and for user/agent language alignment?
3. Does `MaterialSurface` exposing `data-resource-owner-kind`,
   `data-resource-tint`, and `data-resource-source-kind` make sense for
   debugging/static snapshots without leaking persistence or introducing
   inconsistent owner semantics?
4. Does `AppDeskBackground` preserve the app-background/desk contract when no
   resource exists and when a future resource is present?
5. Are the new tests meaningful, or are any of them brittle string checks that
   should be tightened to a better source/rendered contract?
6. Is browser evidence honestly blocked rather than claimed?

## Validation Already Run

```text
rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts
47 pass

rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts test/material-surface-restore.test.ts test/task-board-hydration.test.tsx test/markdown-message.test.tsx
54 pass

rtk npx tsc --noEmit --pretty false
TypeScript: No errors found

rtk npx eslint components/product-shell.tsx components/inkframe/app-desk-background.tsx components/inkframe/material-surface.tsx components/inkframe/material-resource.ts test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/material-resource.test.ts
ESLint: No issues found

rtk git diff --check
PASS

rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-desk-background-owner-route-coverage
PASS

rtk ./tools/twd-guard/twd-inkframe-proof --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof --account zy-ean --json
blocked_no_tab
```

Please fix any concrete issues you find in-scope, then report findings,
changes, and validation commands.
