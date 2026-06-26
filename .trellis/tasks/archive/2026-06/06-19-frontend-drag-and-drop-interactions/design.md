# Design Notes

## Library Choice

Use `@dnd-kit` for application-internal drag-and-drop:

- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`

This fits the current React/Next/Tailwind frontend and supports accessible sensors better than older drag-and-drop libraries.

Do not use dnd-kit for operating-system file drops. Browser file drops should use native drag/drop events because the payload is `DataTransfer.files`, not an in-app draggable item.

## Task Drag Data Flow

```text
TaskCard drag start
  -> drag over TaskStatusColumn
  -> drag end computes target status
  -> optimistic local state update
  -> PATCH /api/v1/tasks/{taskId} { status }
  -> success: keep new state and refresh if needed
  -> failure: restore previous state and show error
```

The backend endpoint already exists in `backend/routers/public_api.py` and records task update activity. The frontend should not fake local-only status changes.

## Component Boundary

`frontend/components/task-board.tsx` is already a client component and is the fastest first target.

`frontend/app/tasks/page.tsx` is a server component. Extract the board part into a client component, for example:

- `frontend/components/task-dnd-board.tsx`
- or extend `frontend/components/task-board.tsx` so `/tasks` can reuse it with controlled props and links

The implementation should avoid duplicating two separate dnd implementations.

## Chat File Drop

Add a drop zone around the chat content / Files area:

- track drag depth or use a stable enter/leave guard to avoid overlay flicker
- ignore non-file drags
- prevent default only when file drop is valid
- call `handleFileUpload(file)` for the first file in MVP
- later multi-file support can loop files with progress UI

## Message To Task Drag

Message drag should use an application payload:

```ts
{ type: "message", messageId, content }
```

Drop targets:

- Tasks tab button
- Tasks tab board area
- optional explicit "Drop message to create task" zone

The first version can create immediately by calling `handleCreateTaskFromMessage(message)`. If this feels too eager, a later version can add a confirm sheet.

## UX Constraints

- Drag handles may be safer than making the whole card/message draggable because cards and messages already contain clickable actions.
- DnD affordances should be subtle: cursor, outline, lifted card shadow, highlighted drop columns.
- Do not use oversized instructional text. Keep UI dense and operational.
- On mobile/touch, avoid fighting scroll. Use activation constraints so a scroll does not accidentally start drag.

## Dependency / Audit Boundary

Installing dnd-kit changes frontend dependencies. If `npm install` reports audit vulnerabilities, do not run `npm audit fix` in this task unless explicitly requested. Audit remediation is separate because it may upgrade framework or transitive packages outside the drag scope.
