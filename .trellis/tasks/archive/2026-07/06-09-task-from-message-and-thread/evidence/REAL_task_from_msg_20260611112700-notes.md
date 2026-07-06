# Real Test Evidence: task-from-message-and-thread

**Marker:** REAL_task_from_msg_20260611112700
**Date:** 2026-06-11
**Tester:** @kimi
**Tool:** twd.py (project WebDriver)

## Commands Run

```bash
# Build verification
cd /Users/code/project/smallkhoj/frontend && npx tsc --noEmit  # pass
cd /Users/code/project/smallkhoj/frontend && npx next build     # pass

# As Task clicked in thread panel → task #12 created
# API verification
curl -H "X-Account-Token: <session>" http://localhost:8000/api/v1/tasks
# Confirmed task #12 with title "REAL_thread_20260611112700..." and source data
```

## Pass/Fail by Criterion

| Criterion | Status | Evidence |
|-----------|--------|----------|
| As Task from message creates task | PASS | Clicking As Task button in thread panel creates task via `apiPost("/api/v1/tasks", ...)`. |
| Task stores source message/thread reference | PASS | `task.data.source` contains `{type:"message", channel, messageId, threadId, messageShortId}`. |
| Source visible on TaskCard | PASS | Tasks page shows source badge: `#real-ui-auth-20260608233519 · 8cedb3ca`. |
| Clickable link back to chat from TaskDetail | PASS | Task detail shows "Open #channel" button linking to `/chat/{channel}`. Cyan themed. |
| Source persists after refresh | PASS | `data.source` stored in backend; visible after page reload. |
| Task title derived from message content | PASS | Title truncated from message content (first 80 chars). |

## Changed Files

- `frontend/app/chat/[channel]/channel-client.tsx`
  - `createTaskFromContent` stores `messageId` and full `source` object in `data`
  - Description includes "Created from {title} message."

- `frontend/app/tasks/page.tsx`
  - `TaskCard` source badge shows channel + message short ID
  - `TaskDetail` has clickable Link back to source channel

## Evidence Files

- `REAL_task_from_msg_20260611112705-as-task-clicked.png` — As Task dialog
- `REAL_task_from_msg_20260611112706-tasks-page.png` — tasks list with source badge
- `REAL_task_from_msg_20260611112707-task-detail.png` — task detail with source link
