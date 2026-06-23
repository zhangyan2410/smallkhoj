# Task Memory Request Reminder Validation

Date: 2026-06-23

## Scope

Implemented a one-shot `task.memory_requested` runtime reminder instead of adding task memory instructions to the persistent runtime system prompt.

Triggers:

- automatic: task status transitions into `in_review`
- manual: Tasks detail form posts to `POST /api/v1/tasks/{task_id}/memory/request`

Reminder target:

- assigned agent only, through `targetAgentId` / `assigneeId`

Reminder content:

- asks the agent to run `slock task summary`
- asks for `slock task promote --proposal` only when channel memory output is requested
- includes optional operator instruction and filtered output directions

## Automated Checks

```bash
cd backend
rtk .venv/bin/python -m pytest tests/test_agent_task_memory_handoff.py tests/test_public_memory_routes.py tests/test_public_events.py tests/test_daemon_control.py -q
# 74 passed

cd agent/daemon/aaa-daemon
rtk npm run build
# passed

cd agent/daemon/aaa-daemon
rtk node --test test/runtime-mcp.test.mjs
# 28 passed

cd frontend
rtk npm run lint
# passed

cd frontend
rtk npm run build
# passed

rtk git diff --check
# passed
```

## Browser Evidence

Real browser tab:

- URL: `http://127.0.0.1:3015/tasks`
- DOM checks:
  - `提醒产出记忆` visible
  - `产出方向` visible
  - `发送记忆提醒` visible
- URL: `http://127.0.0.1:3015/chat/slock`
- DOM checks after opening the channel Tasks tab and selecting task `#3`:
  - `提醒产出记忆` visible
  - `发送提醒` visible
  - `频道提案` visible
  - no counted `DndDescribedBy-<number>` id remains in the page HTML

Screenshot:

- `evidence/REAL_task_memory_request_ui_20260623.png`
- `evidence/REAL_chat_task_memory_request_ui_20260623.png`

## Runtime/Daemon Notes

`task.memory_requested` and legacy `task_memory_requested` are both daemon runtime-actionable. The daemon formats the event as a normal incoming one-shot runtime message and does not modify the persistent Claude/Slock system prompt.

`actorId` is preserved from the event creator when present. It is intentionally distinct from `targetAgentId`, which controls the receiving assigned agent.
