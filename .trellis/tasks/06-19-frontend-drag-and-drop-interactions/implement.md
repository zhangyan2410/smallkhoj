# Implementation Plan

## Phase 0: Setup And Baseline

- [ ] Create a feature worktree/branch for frontend DnD work.
- [ ] Install `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities` in `frontend`.
- [ ] Record resulting dependency changes separately from any audit remediation.
- [ ] Run baseline `npm run lint` or existing frontend verification to know current state.

## Phase 1: Reusable Task Drag Board

- [ ] Add task drag/drop support to `frontend/components/task-board.tsx` or extract a reusable client board.
- [ ] Implement status columns as droppable zones.
- [ ] Implement task cards as draggable items, preferably with a handle or activation constraint.
- [ ] Add optimistic update and rollback on PATCH failure.
- [ ] Preserve task selection/detail behavior.
- [ ] Ensure empty columns accept drops.

## Phase 2: Apply To `/tasks`

- [ ] Refactor `/tasks` board rendering into a client component.
- [ ] Reuse the same DnD board logic instead of duplicating behavior.
- [ ] Preserve filters, board/list toggle, selected task routing, and server actions.
- [ ] Verify status persists after refresh.

## Phase 3: Chat File Drop

- [ ] Add native file drag/drop handling in `frontend/app/chat/[channel]/channel-client.tsx`.
- [ ] Show a visible but compact drop overlay.
- [ ] Reuse existing `handleFileUpload(file)`.
- [ ] Refresh Files after upload and keep tab behavior predictable.
- [ ] Handle disabled/no-channel and upload failure states.

## Phase 4: Message To Task Drag

- [ ] Add a safe drag affordance to chat messages.
- [ ] Add Tasks tab / task area drop target for message payloads.
- [ ] Reuse `handleCreateTaskFromMessage(message)`.
- [ ] Preserve source message metadata and visible task link.
- [ ] Avoid breaking text selection and message action buttons.

## Phase 5: Verification

- [ ] `npm run lint` in `frontend`.
- [ ] `npm run build` in `frontend` if feasible.
- [ ] Use `./twd` for real browser verification:
  - drag task from todo to in_progress in chat Tasks tab
  - drag task between columns on `/tasks`
  - drop a file into chat and verify Files refresh
  - drag a message into Tasks and verify linked task creation
- [ ] Cross-check API data for persisted task status/source metadata.

## Risk Points

- `/tasks` is server-rendered; DnD must live in a client component.
- Whole-card dragging can conflict with click-to-select; use a handle or activation constraints.
- Native file drag events can flicker without drag-depth handling.
- Audit output after `npm install` should be reported but not auto-fixed in this task.
