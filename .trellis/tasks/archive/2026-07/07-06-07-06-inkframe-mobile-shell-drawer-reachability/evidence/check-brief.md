Active task: .trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability

Please review the completed mobile shell drawer reachability slice.

Files changed for this task:

- `frontend/components/product-shell-body.tsx`
- `frontend/test/material-surface.test.tsx`
- `.trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability/implement.jsonl`
- `.trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability/check.jsonl`
- `.trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability/evidence/source-contract-validation.md`

Review focus:

- The mobile drawer is actually reachable from source, not just tagged with a marker.
- Toggle `aria-expanded`, drawer `data-inkframe-state`, and close behavior are coupled to `mobileListOpen`.
- Desktop three-column behavior remains intact: `sm:flex`, resize handle, and resizable list width remain owned by `ProductShellBody`.
- Drawer content keeps explicit scroll ownership with `min-h-0`, `min-w-0`, and `overflow-y-auto`.
- The source test couples selectors/classes to the same drawer/toggle elements instead of broad whole-file matching.
- No real browser/mobile acceptance is claimed while `./twd` remains `blocked_no_tab`.

Validation already run:

- `cd frontend && rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx` -> 18 pass.
- `cd frontend && rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/task-board-hydration.test.tsx test/markdown-message.test.tsx` -> 38 pass.
- `cd frontend && rtk npx tsc --noEmit --pretty false` -> pass.
- `cd frontend && rtk npx eslint components/product-shell-body.tsx test/material-surface.test.tsx` -> pass.
- `rtk git diff --check` -> pass.
- `rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability` -> pass.
- `rtk ./tools/twd-guard/twd-inkframe-proof --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof --account zy-ean --json` -> `blocked_no_tab`.

