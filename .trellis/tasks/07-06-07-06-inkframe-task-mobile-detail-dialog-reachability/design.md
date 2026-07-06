# Design: Task Mobile Detail Dialog Reachability

## Strategy

Keep the existing route ownership:

```text
TasksPage
  -> ProductShell list/main/sidebar
  -> TaskDetailDialog for URL-driven mobile/detail overlay
  -> TaskDetail / TaskRouteDetailMaterialFrame for material detail content
```

Do not introduce a second task detail implementation. The same `TaskDetail`
tree must render in the desktop sidebar and in the mobile dialog.

## DOM Contract

Dialog content:

```text
data-inkframe-mobile-role="task-detail-dialog"
```

Task detail content remains:

```text
data-inkframe-mobile-role="task-detail"
data-inkframe-mobile-role="task-evidence"
data-inkframe-mobile-role="task-review"
```

## Layout Contract

Dialog content should be the mobile scroll owner:

```text
w-[calc(100vw-1rem)]
max-w-4xl
max-h-[calc(100svh-1rem)]
overflow-x-hidden
overflow-y-auto
p-3 sm:p-6
```

The material detail frame should add:

```text
min-w-0 overflow-x-hidden
```

Rows with flexible children inside evidence/review forms should add:

```text
min-w-0
```

Inputs inside flexible rows should use:

```text
min-w-0
```

## Test Strategy

Use source tests while real browser proof is blocked:

- add a source contract test in `frontend/test/material-surface.test.tsx`;
- assert `TaskDetailDialog` has the mobile role and viewport/overflow classes
  on the same `DialogContent` element;
- assert `TaskRouteDetailMaterialFrame` passes `min-w-0 overflow-x-hidden`;
- assert task evidence/review form controls use `min-w-0` on the actual row or
  input elements.

If a source test passes immediately, strengthen it to bind classes to the same
element rather than broad file-level matching.

## Browser Gate

After source validation, run:

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

If it remains `blocked_no_tab`, record that real browser/mobile proof remains
pending.

## Risks

- A broad test could pass because the class appears elsewhere. Bind assertions
  to the exact `DialogContent`, `TaskRouteDetailMaterialFrame`, and form row
  elements.
- Dialog changes should not affect the generic `DialogContent` atom; this task
  is about the task detail dialog instance.
- Do not make every task object tilt or animate; this slice is containment and
  reachability, not a visual redesign.

