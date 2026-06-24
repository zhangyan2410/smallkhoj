# Multica Task Model Research

## Scope

Reference project: `/Users/code/project/multica`

Purpose: understand how Multica models tasks, group task routing, chat-triggered work, and runtime execution, then decide what SmallKhoj should borrow for channel task design.

## Summary

Multica's task shape is a two-layer model:

- User-visible work item: `issue`
- Runtime execution item: `agent_task_queue`

This is different from a direct `channel -> message -> task` model. A message or comment can trigger runtime work, but the message is not the task and the runtime queue item is not the product work item.

SmallKhoj should keep its channel-first model, but borrow Multica's separation between product work item and runtime run.

## Core Multica Objects

### Issue

`issue` is the user-visible product work item. It carries title, description, status, priority, creator, assignee, parent issue, acceptance criteria, and context refs.

Relevant files:

- `/Users/code/project/multica/server/migrations/001_init.up.sql`
- `/Users/code/project/multica/packages/core/types/issue.ts`

Important detail: assignee can be member, agent, and in later code squad.

### Comment

`comment` belongs to an issue. It is the issue discussion/progress surface. Agent output and status/progress notes can be written as comments.

Relevant files:

- `/Users/code/project/multica/server/migrations/001_init.up.sql`
- `/Users/code/project/multica/server/pkg/db/queries/comment.sql`

### Agent Task Queue

`agent_task_queue` is the runtime execution queue. It is the thing daemon/runtime claims and executes.

It can link to:

- `issue_id`
- `chat_session_id`
- `autopilot_run_id`
- contextual quick-create source

Relevant files:

- `/Users/code/project/multica/server/pkg/db/queries/agent.sql`
- `/Users/code/project/multica/server/internal/service/task.go`
- `/Users/code/project/multica/packages/core/types/agent.ts`

Lifecycle:

```text
queued -> dispatched -> running -> completed | failed | cancelled
```

This lifecycle is runtime-facing and separate from issue product status.

### Chat Session and Chat Message

`chat_session` is a persistent conversation with an agent. `chat_message` belongs to the session and can link to a task queue item.

Relevant files:

- `/Users/code/project/multica/server/migrations/033_chat.up.sql`
- `/Users/code/project/multica/server/pkg/db/queries/chat.sql`

Chat-triggered work creates an `agent_task_queue` row linked by `chat_session_id`.

### Squad

`squad` is a group of agents/members with one leader agent. Assigning an issue to a squad routes execution to the leader. The leader coordinates or delegates.

Relevant files:

- `/Users/code/project/multica/server/migrations/084_squad.up.sql`
- `/Users/code/project/multica/server/internal/service/task.go`
- `/Users/code/project/multica/server/internal/handler/comment.go`
- `/Users/code/project/multica/packages/core/types/squad.ts`

This is the closest Multica equivalent to SmallKhoj's intended "architect + worker + human" channel group workflow.

## Group Task Behavior

Multica does not treat group chat as a symmetric free-for-all where every agent responds to every message.

Instead:

1. A product work item exists, usually an issue.
2. The issue may be assigned to an agent or squad.
3. If assigned to a squad, the leader agent receives the execution run.
4. Comments and mentions can trigger additional runs.
5. Runtime execution records stay separate from the issue itself.

This gives Multica a stable routing layer. It avoids ambiguous "who should act on this group message?" behavior.

## Chat / External Group Message Behavior

For external IM group messages, Multica maps external room/chat into an internal `chat_session`. Incoming messages are persisted, then a short silence-window debounce creates one runtime queue item for a batch of messages.

Relevant files:

- `/Users/code/project/multica/server/internal/integrations/lark/chat_service.go`
- `/Users/code/project/multica/server/internal/integrations/lark/dispatcher.go`
- `/Users/code/project/multica/server/internal/integrations/lark/pending_batcher.go`

SmallKhoj should borrow the durable source-link and batching idea, but should not copy the exact in-process debounce reliability boundary.

## SmallKhoj Implications

Use this interpretation:

```text
Message = conversation/evidence/source
Task = channel-scoped product work item
TaskRun = one agent runtime attempt
```

Message can be converted as task, but message is not task.

Task can be assigned to a leader or directly assigned to one or more agents.

TaskRun should be created when an agent/runtime is actually expected to execute work.

## Borrow

- Split Task from TaskRun.
- Preserve source links to message/thread/channel.
- Use a leader/coordinator mode for group tasks.
- Support direct assignment as explicit runtime runs, not implicit message fan-out.
- Track runtime lifecycle independently from task product status.
- Require visible run output: message, task update, evidence, or failure reason.
- Store context usage and token evidence on the run when available.

## Do Not Borrow Directly

- Do not replace SmallKhoj channel/task with Multica issue-only product model.
- Do not map SmallKhoj group channels to a single agent chat session.
- Do not use weak external connector tables for internal channel/message/task relationships.
- Do not make an in-process debounce the only guarantee that runtime work is triggered.
- Do not add quick-create/autopilot/squad complexity before the first TaskRun gate is stable.

