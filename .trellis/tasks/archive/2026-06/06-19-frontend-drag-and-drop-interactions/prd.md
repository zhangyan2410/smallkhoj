# Frontend Drag And Drop Interactions

## Goal

Add practical drag-and-drop interactions to the SmallKhoj frontend where they improve real work flow: task status movement, chat file upload, and turning chat messages into tasks.

The first version should make the existing channel workbench feel more direct without changing the backend architecture or inventing new product concepts.

## User Value

- A user can move tasks through the workflow by dragging cards instead of opening update forms.
- A user can drop files into a chat/channel instead of using only the file picker.
- A user can turn a message into a task by dragging it into the task area.
- Channel chat, tasks, and files feel like one shared work room rather than separate tabs.

## Confirmed Facts

- Frontend stack is Next.js 16, React 19, Tailwind, shadcn-style local components, and lucide icons.
- `frontend/components/task-board.tsx` is a client component used by the chat channel Tasks tab.
- `frontend/app/tasks/page.tsx` has a separate server-rendered board/list task surface.
- Public task update already supports `PATCH /api/v1/tasks/{task_id}`.
- Chat already has `handleFileUpload(file)` for file picker uploads.
- Chat already has `handleCreateTaskFromMessage(message)` and `createTaskFromContent(...)`.
- `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities` are compatible with the current React version.

## Requirements

### P0: Chat Tasks Tab Drag Status

- Add drag-and-drop task status movement to `TaskBoard` in `frontend/components/task-board.tsx`.
- Dropping a task card into another status column updates the task status through the existing public task PATCH API.
- Empty columns must be valid drop targets.
- The UI should optimistic-update and roll back on API failure.
- Dragging must not break normal click-to-select task detail behavior.
- Keyboard drag support should be enabled through dnd-kit sensors where practical.

### P0: Tasks Page Drag Status

- Add the same status movement capability to `/tasks`.
- Because `frontend/app/tasks/page.tsx` is server-rendered, extract the interactive board into a client component instead of forcing dnd-kit into the server component.
- Keep existing filters, board/list toggle, selected task detail, and create/update forms working.

### P0: Chat File Drop Upload

- Add file drop upload to `frontend/app/chat/[channel]/channel-client.tsx`.
- Use native browser drag/drop events for OS file drops; do not use dnd-kit for this path.
- Reuse existing `handleFileUpload(file)` behavior.
- Show a visible drop overlay/state when a valid file is dragged over the chat or Files area.
- If upload succeeds, refresh Files and keep or switch to a sensible tab state.
- If no `channelId` exists, show disabled behavior and do not upload.

### P1: Message To Task Drag

- Allow a chat message to be dragged into the Tasks tab or task drop zone.
- Reuse existing `handleCreateTaskFromMessage(message)` behavior.
- The created task must preserve source message/channel metadata.
- After creation, show the task link or switch/highlight the Tasks tab so the user sees the result.

## Non-Goals

- Do not make chat messages reorderable.
- Do not implement channel list reordering.
- Do not implement physical agent workspace drag orchestration in this task.
- Do not add broad backend model changes unless a small endpoint gap blocks the UI.
- Do not run `npm audit fix` as part of this task; dependency audit remediation should be a separate task.

## Acceptance Criteria

- [ ] Chat Tasks tab supports dragging a task between status columns.
- [ ] `/tasks` board supports dragging a task between status columns.
- [ ] A dropped task status change persists through the backend API and survives refresh.
- [ ] Invalid or failed task drops roll back and show a clear error.
- [ ] Empty status columns accept drops.
- [ ] File drop upload works in a channel/DM with a visible drag-over state.
- [ ] File drop upload reuses the existing upload API and refreshes Files.
- [ ] Dragging a message to the task zone creates a task linked to the source message.
- [ ] Pointer interaction, keyboard access, scrolling, normal card click, message actions, and text selection remain usable.
- [ ] Frontend lint/build pass.
- [ ] Real browser verification uses the project `./twd` tool, not Playwright directly.

## Implementation Notes

- Use `@dnd-kit` for in-app draggable objects: task cards and chat messages.
- Use native `dragenter`, `dragover`, `dragleave`, and `drop` for files dragged from the operating system.
- Prefer scoped client components:
  - reusable task DnD board component for chat and tasks page
  - file-drop behavior localized to chat channel client
  - message-to-task drag localized to chat message rendering
- Keep backend writes through existing public API routes so ActivityLog/EventRecord behavior remains intact.
