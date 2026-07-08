# task from message and thread

## Goal

Make "As Task" from message/thread reliable, visible, and traceable across Chat and Tasks.

## Requirements

* Add task creation action from root messages.
* Add task creation action from thread replies or thread root.
* Pre-fill title/description/source channel/message/thread.
* After creation, show task link in the message/thread context.
* Tasks page must show source channel/message/thread.

## Acceptance Criteria

* [x] User can create a task from a channel message.
* [x] User can create a task from a DM/thread context.
* [x] The resulting task links back to source.
* [x] Source link opens the correct conversation/thread.

## Real Test SOP

Use marker `REAL_task_from_msg_<timestamp>`.

1. Send marker message.
2. Convert it to a task.
3. Open `/tasks` and verify marker/source.
4. Click source link and verify original message.
5. Save screenshots/API evidence.

## Context

* Chat task: `.trellis/tasks/06-09-chat-product-surface/prd.md`
* Tasks task: `.trellis/tasks/06-09-tasks-board-list-filters/prd.md`
