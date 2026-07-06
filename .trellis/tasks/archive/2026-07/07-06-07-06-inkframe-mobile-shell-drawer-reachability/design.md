# Design: Inkframe Mobile Shell Drawer Reachability

## Strategy

Keep `ProductShellBody` as the owner of list/detail workspace chrome. Add a
small mobile drawer state machine in the existing client component rather than
duplicating drawer logic in each route.

## State Machine

```text
NO_LIST
  -> no drawer toggle, single-column layout unchanged

LIST_COLLAPSED
  -> mobile toggle visible
  -> list aside has data-inkframe-state="collapsed"
  -> desktop aside remains sm:flex

LIST_OPEN
  -> toggle aria-expanded=true
  -> mobile drawer is visible/reachable
  -> close control available inside drawer
  -> desktop layout remains unchanged
```

## DOM Contract

Toggle:

```text
data-inkframe-mobile-role="sidebar-drawer-toggle"
aria-controls="inkframe-mobile-sidebar-drawer"
aria-expanded="false|true"
```

Drawer:

```text
id="inkframe-mobile-sidebar-drawer"
data-inkframe-mobile-role="sidebar-drawer"
data-inkframe-state="collapsed|open"
```

Close control:

```text
data-inkframe-mobile-role="sidebar-drawer-close"
```

## Layout Contract

The drawer can use source-level responsive classes:

- collapsed: hidden below `sm`;
- open: flex below `sm`, positioned above the main panel;
- desktop: `sm:flex` remains the normal list column.

The content region inside the drawer must remain the scroll owner:

```text
min-h-0 min-w-0 flex-1 overflow-y-auto
```

## Test Strategy

Use source/component tests because real browser is blocked:

- add a source contract test in `frontend/test/material-surface.test.tsx`;
- assert the toggle, drawer id, drawer state, close control, and scroll-owner
  classes exist;
- assert desktop `sm:flex` and resize handle remain present.

If render tests are cheap, render `ProductShellBody` directly with a list prop,
but avoid fighting Next/client hook setup if a source-level test is clearer and
already matches the existing test style.

## Browser Gate

After implementation, rerun:

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

If it remains `blocked_no_tab`, record that in this task's evidence.

## Risks

- A drawer toggle can clutter desktop header if not hidden with `sm:hidden`.
- An absolute mobile drawer can cover content without a close control.
- A source test can become too broad if it searches the whole file for classes
  instead of coupling classes to the drawer/toggle element.
