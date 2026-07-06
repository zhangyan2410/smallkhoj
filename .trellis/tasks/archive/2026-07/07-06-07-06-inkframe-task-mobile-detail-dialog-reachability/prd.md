# Inkframe Task Mobile Detail Dialog Reachability

## Goal

Make the Tasks page detail path reachable, contained, and source-testable on
mobile. The previous shell slice made the left list drawer reachable; this slice
protects the next path: selecting a task opens `TaskDetailDialog`, and the
material detail, evidence, review, and memory controls must fit inside a
phone-sized viewport without horizontal overflow.

This is a child of:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

It follows:

```text
.trellis/tasks/07-06-07-06-inkframe-mobile-shell-drawer-reachability
```

## Current Facts

- Desktop task detail lives in the optional ProductShell right sidebar, which is
  `lg:flex` and intentionally hidden on mobile.
- Mobile detail reachability depends on URL-driven `TaskDetailDialog`.
- `TaskDetailDialog` currently uses only `max-w-4xl max-h-[88vh]
  overflow-y-auto`; it has no stable mobile proof role and no explicit
  `100svh`/horizontal containment contract.
- `TaskDetail` already exposes `task-detail`, `task-evidence`, and
  `task-review` mobile roles, but the task detail dialog itself is not
  source-testable as the mobile container that makes those roles reachable.
- Real browser/mobile proof remains blocked while `./twd` has no connected tab.

## In Scope

- Add a stable mobile/source proof contract to `TaskDetailDialog`.
- Make the dialog content explicitly phone-contained:
  - width constrained to viewport;
  - height constrained to viewport with `svh` or equivalent mobile viewport
    unit;
  - horizontal overflow suppressed at the dialog container;
  - vertical scroll owned by the dialog content.
- Add stable source roles for task detail dialog content.
- Tighten `TaskDetail` source contracts so evidence/review forms do not widen
  the dialog on mobile.
- Add source/component tests proving these contracts.
- Record `./twd` browser gate status truthfully; no browser acceptance while
  the gate is `blocked_no_tab`.

## Out Of Scope

- Full visual redesign of task detail.
- Changing task data fetching or backend task APIs.
- Replacing `ProductShell` or route ownership.
- Persisting Inkframe/WebGL material blobs.
- Launching Chrome or using Playwright.

## Requirements

### R1. Dialog Mobile Container Contract

`TaskDetailDialog` must expose a stable selector:

```text
data-inkframe-mobile-role="task-detail-dialog"
```

on the dialog content container.

### R2. Viewport Containment

The task detail dialog must avoid phone-width overflow:

```text
w-[calc(100vw-...)]
max-w-4xl
max-h-[calc(100svh-...)]
overflow-x-hidden
overflow-y-auto
```

or an equivalent explicit containment contract.

### R3. Material Detail Inner Containment

The task detail material frame must remain `min-w-0` / `overflow-x-hidden`
friendly so long task titles, source ids, evidence paths, and review notes do
not widen the modal.

### R4. Evidence And Review Form Containment

Evidence/review form rows must avoid unbounded flex children. Inputs and rows
inside `task-evidence` and `task-review` need `min-w-0` or an equivalent
containment class tied to the same element that owns the row.

### R5. Evidence Honesty

Run the selector proof gate or record the existing no-tab status. This task may
claim source contract hardening only until `./twd` has a connected tab.

## Acceptance Criteria

- [ ] `TaskDetailDialog` exposes `data-inkframe-mobile-role="task-detail-dialog"`.
- [ ] `TaskDetailDialog` content constrains width and height to mobile viewport.
- [ ] `TaskDetailDialog` content owns vertical scroll and suppresses horizontal
      overflow.
- [ ] Task detail material frame includes explicit mobile containment.
- [ ] Evidence and review form controls include source-tested containment on the
      actual row/input elements.
- [ ] Focused frontend tests pass.
- [ ] Relevant TypeScript and scoped lint pass.
- [ ] `git diff --check` and task validation pass.
- [ ] Check worker review is attempted and findings are fixed or recorded.
- [ ] Browser/mobile acceptance is not claimed while `./twd` remains
      `blocked_no_tab`.

