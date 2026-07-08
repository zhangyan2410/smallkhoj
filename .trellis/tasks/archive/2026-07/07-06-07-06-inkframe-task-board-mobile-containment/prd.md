# Inkframe Task Board Mobile Containment

## Goal

Continue the multi-round frontend optimization loop by hardening the Tasks page
board/filter/list path for phone-width layouts. The previous slices made the
ProductShell drawer reachable, the task detail dialog contained, and chat
message/composer surfaces mobile-safe. This slice protects the remaining core
task workspace: controls, filters, board columns, task cards, list rows, and
drag overlay must not widen the page or hide actions on mobile.

This is a child of:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

It follows:

```text
.trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability
.trellis/tasks/07-06-07-06-inkframe-task-mobile-detail-dialog-reachability
.trellis/tasks/07-06-07-06-inkframe-chat-mobile-composer-message-containment
```

## Current Facts

- The Tasks route already exposes `task-workspace`, `task-controls`,
  `task-board`, `task-detail`, `task-evidence`, and `task-review` mobile roles.
- `task-workspace` is a scroll owner with `min-h-0 min-w-0 flex-1
  overflow-x-hidden overflow-y-auto`.
- `TaskDndBoard` only wraps `TaskBoard` with `data-inkframe-mobile-role`.
  It does not yet pin its own `min-w-0` / `overflow-x-hidden` contract.
- `TaskBoard` board view currently starts with `grid-cols-2` on the base
  viewport. On phone-sized widths this can force crowded cards or horizontal
  pressure. The first breakpoint should keep one column, then expand.
- Task cards use a shared `TaskMaterialSurface`, but the card body, metadata
  row, source chip, list row, drag overlay, and status column body are not all
  source-tested for `min-w-0` / `overflow-x-hidden`.
- The filter surface is a grid inside the task workspace, but it has no stable
  `task-filters` mobile role and no source-tested `min-w-0` contract.
- Real browser/mobile proof remains blocked until `./twd` has a connected tab.

## In Scope

- Add stable source/mobile proof role for the task filter surface.
- Harden and source-test:
  - `task-filters` surface;
  - `TaskDndBoard` wrapper;
  - `TaskBoard` root;
  - board grid responsive columns;
  - status columns and task stacks;
  - sortable task card body/content/actions/source;
  - list view rows;
  - drag overlay.
- Keep route code style changes limited to layout utilities and stable roles.
- Preserve existing Inkframe object/material behavior.
- Record browser proof status honestly.
- Spawn a Trellis check worker after implementation.

## Out Of Scope

- Full visual redesign of task cards.
- Changing task data fetching, DnD semantics, backend APIs, or read/unread
  behavior.
- Persisting Inkframe material blobs.
- Launching Chrome or using Playwright.
- Reworking task detail dialog again unless a regression is discovered.

## Requirements

### R1. Filter Surface Contract

The filter surface must expose:

```text
data-inkframe-mobile-role="task-filters"
```

It should be `min-w-0`, suppress horizontal overflow, and use a one-column base
grid that expands at larger breakpoints.

### R2. Board Wrapper Contract

`TaskDndBoard` must keep the task board contained:

```text
data-inkframe-mobile-role="task-board"
min-w-0
overflow-x-hidden
```

The wrapper is the stable bridge from the Tasks route into the TaskBoard
component.

### R3. Board Grid Contract

The task board grid must use a one-column mobile base:

```text
grid-cols-1
sm:grid-cols-2
md:grid-cols-3
xl:grid-cols-5
```

or an equivalent responsive contract. It must not start at `grid-cols-2` on the
smallest viewport.

### R4. Status Column And Task Stack Containment

Each `TaskStatusColumn` and its inner task stack must be `min-w-0`; the task
stack should suppress horizontal overflow while preserving vertical flow.

### R5. Sortable Task Card Containment

`SortableTaskCard` must keep long task titles, long channels, source labels,
badges, and tool buttons inside the task paper:

```text
outer sortable wrapper -> min-w-0
interactive card -> min-w-0
TaskMaterialSurface card class -> min-w-0 overflow-x-hidden
title/body flex child -> min-w-0
action/status cluster -> shrink-0
source chip -> max-w-full/min-w-0 overflow-x-hidden
```

### R6. List Row And Drag Overlay Containment

List mode and drag overlay must follow the same contract so switching view or
dragging does not reintroduce mobile overflow.

### R7. Evidence Honesty

Run `./twd` proof if a tab is available. If not, record the no-tab or tool
failure state and do not claim browser/mobile acceptance.

## Acceptance Criteria

- [ ] New source contract test fails before implementation for at least one
      missing task board/filter containment requirement.
- [ ] `task-filters` role and containment are source-tested.
- [ ] `TaskDndBoard` wrapper containment is source-tested.
- [ ] `TaskBoard` root and board grid responsive columns are source-tested.
- [ ] Status column and inner task stack containment are source-tested.
- [ ] Sortable card body/action/source containment is source-tested.
- [ ] List row and drag overlay containment are source-tested.
- [ ] Focused frontend tests pass.
- [ ] Relevant TypeScript and scoped lint pass.
- [ ] `git diff --check` and task validation pass.
- [ ] Trellis check worker reviews the slice, or self-review is recorded if
      worker startup fails.
- [ ] Browser/mobile acceptance is not claimed while `./twd` remains blocked.
