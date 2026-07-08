# Design: Inkframe Task Board Mobile Containment

## Contract Shape

This slice keeps the task workspace physically coherent on small screens:

```text
ProductShell
  -> task-workspace (route scroll owner)
    -> task-controls
    -> task summary cards
    -> task-filters
    -> TaskDndBoard wrapper
      -> TaskBoard root
        -> board grid
          -> TaskStatusColumn
            -> sortable task card
        -> list view rows
        -> drag overlay
```

The route owns data and composition. `TaskBoard` and task primitives own board
layout details. The changes should be narrow layout utility hardening rather
than new visual object language.

## Mobile Layout Decision

The board view should not start with two columns at the smallest viewport. A
two-column base makes each task ticket too narrow and creates pressure from
status pills, material toggles, source chips, and long task titles.

Use:

```text
grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5
```

Desktop still reaches five status columns, but phone gets one readable task
column at a time.

## Source Tests

Because real `./twd` browser proof is still blocked in the current environment,
source tests pin the containment owners. These tests are not visual acceptance,
but they catch likely regressions before browser proof is available:

- missing `task-filters` role;
- `TaskDndBoard` wrapper losing `min-w-0`;
- board grid accidentally reverting to base `grid-cols-2`;
- task card body/source/list/overlay losing containment.

## Guardrails

- Do not add hover/motion in this slice. The user wants motion to imply
  movable/actionable objects, and DnD already carries that meaning.
- Do not replace task object primitives.
- Do not add route-local cards or raw visual controls.
- Do not claim browser/mobile acceptance while `./twd` cannot run route
  assertions.

## Review Focus

Reviewers should check:

- whether the source test pins the actual element that owns containment;
- whether the mobile base board grid is one column;
- whether list view and drag overlay are covered, not only board columns;
- whether changes are limited to layout/source contracts;
- whether browser evidence remains honest.
