Active task: .trellis/tasks/07-06-07-06-inkframe-task-mobile-detail-dialog-reachability

Please review the completed task mobile detail dialog reachability slice.

Files changed for this task:

- `frontend/components/task-detail-dialog.tsx`
- `frontend/components/task-material-state.tsx`
- `frontend/app/tasks/page.tsx`
- `frontend/test/material-surface.test.tsx`
- `.trellis/tasks/07-06-07-06-inkframe-task-mobile-detail-dialog-reachability/*`

Review focus:

- `TaskDetailDialog` mobile containment is on the actual `DialogContent` element, not broad file-level decoration.
- Width/height/overflow classes make sense for phone-sized task detail and do not alter the generic dialog atom.
- `TaskRouteDetailMaterialFrame` has local `min-w-0` / horizontal containment.
- Evidence/review form containment is bound to actual form row/input elements.
- The source test couples selectors/classes to exact elements rather than whole-file matches.
- No browser/mobile acceptance is claimed while `./twd` remains `blocked_no_tab`.
- No unrelated visual redesign or backend behavior changes were introduced.

Validation already run:

- `cd frontend && rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx` -> 19 pass.
- `cd frontend && rtk env NODE_PATH=./node_modules npx tsx --test test/inkframe-object-ui.test.tsx test/material-surface.test.tsx test/task-board-hydration.test.tsx test/markdown-message.test.tsx` -> 39 pass.
- `cd frontend && rtk npx tsc --noEmit --pretty false` -> pass.
- `cd frontend && rtk npx eslint components/task-detail-dialog.tsx components/task-material-state.tsx app/tasks/page.tsx test/material-surface.test.tsx` -> pass.
- `rtk git diff --check` -> pass.
- `rtk python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-06-07-06-inkframe-task-mobile-detail-dialog-reachability` -> pass.
- `rtk ./tools/twd-guard/twd-inkframe-proof --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof --account zy-ean --json` -> `blocked_no_tab`.

