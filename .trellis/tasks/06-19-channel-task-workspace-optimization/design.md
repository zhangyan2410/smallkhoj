# Channel Task and TaskRun Design

## Decision

SmallKhoj should model channel task execution as three separate layers:

```text
Message
  -> Task
      -> TaskRun
```

Message is conversation and evidence. It can be used "as task" by creating a Task with source linkage.

Task is the channel-scoped product work item.

TaskRun is one executable attempt by one agent/runtime against a Task.

## Why TaskRun Is Needed

Current `Task` carries too many meanings:

- product work item
- source-message conversion result
- assignee notification
- runtime actionable event
- rough execution status
- review state
- evidence container

That is not stable enough for channel group work. Group tasks need retries, multiple agents, leader/worker split, runtime context, token usage, workspace/session linkage, and failure classification. Those are properties of runs, not of the product task itself.

## Proposed Data Model

### Task

Keep `tasks` as the product work item.

Existing fields remain:

- `id`
- `task_number`
- `channel_id`
- `message_id`
- `title`
- `description`
- `status`
- `creator_id`
- `assignee_id`
- `data`

Recommended semantic tightening:

- `message_id` means source message for task-from-message.
- `assignee_id` means backward-compatible primary owner or primary assignee.
- Product status remains review-oriented.
- Agent runtimes do not directly own final approval.

Useful future additions:

- `parent_task_id`
- `root_task_id`
- `thread_root_message_id`
- `source_type`
- `source_message_id`
- `source_channel_id`
- `owner_role`

### TaskAssignment

Introduce when direct multi-agent drag assignment is implemented.

Purpose: represent many agents/humans assigned to the same product task.

Suggested fields:

- `id`
- `task_id`
- `assignee_id`
- `assignee_type`: `member | agent`
- `role`: `leader | worker | reviewer | participant`
- `assignment_mode`: `leader_designated | direct_drag | agent_delegated | system`
- `status`: `active | completed | cancelled`
- `created_by`
- `created_at`
- `updated_at`

Compatibility:

- `Task.assignee_id` stays as primary owner during migration.
- New code prefers `TaskAssignment` when present.

### TaskRun

One executable runtime attempt.

Suggested fields:

- `id`
- `task_id`
- `assignment_id`
- `agent_id`
- `channel_id`
- `source_message_id`
- `thread_root_message_id`
- `parent_run_id`
- `attempt`
- `status`: `queued | dispatched | running | awaiting_input | completed | failed | cancelled`
- `trigger_type`: `task_created | direct_drag | leader_delegated | retry | resume | comment_or_message`
- `runtime_workspace_id`
- `computer_id`
- `daemon_id`
- `runtime`
- `runtime_provider`
- `runtime_model`
- `prompt_profile`
- `workspace_session_id`
- `runtime_session_id`
- `context_session_id`
- `cwd`
- `context_scope`: `channel | thread | task | run`
- `context_summary`
- `context_usage`
- `token_usage`
- `tool_usage_summary`
- `output_message_id`
- `failure_code`
- `failure_reason`
- `started_at`
- `completed_at`
- `created_at`
- `updated_at`

## Lifecycle

Task product lifecycle:

```text
todo -> in_progress -> in_review -> done
                       -> blocked
                       -> cancelled
```

TaskRun runtime lifecycle:

```text
queued -> dispatched -> running -> completed
                              -> failed
                              -> cancelled
                              -> awaiting_input
```

Rules:

- Creating a Task does not always mean creating a TaskRun.
- Creating an actionable assignment to an agent creates a TaskRun.
- Runtime delivery updates TaskRun, not only Task.
- TaskRun completion does not automatically approve Task as `done`.
- TaskRun failure must be visible as a failure code/reason, not hidden as generic startup ambiguity.

## Context Model

TaskRun context is a bounded input package.

TaskRun context must be independent by default. It should not silently inherit the whole current agent conversation just because the physical daemon workspace is reused.

TaskRun should also use a runtime prompt profile that matches the run role and scope. A leader/coordinator run, a worker implementation run, a reviewer run, and a direct drag assignment run should not all receive the same ambient channel prompt. The prompt profile is part of the run contract and should be auditable through the TaskRun record.

Required context:

- task title
- task description
- acceptance criteria when present
- source channel
- source message
- source thread root when present
- current task status
- assignee role
- reply target
- task update rules
- runtime prompt profile and role-specific system/developer instruction bundle

Optional context:

- recent thread messages
- recent channel messages
- task memory entries
- linked files/evidence
- parent task summary
- previous TaskRun summaries

Do not inject unlimited channel history into a run. The run should know where to read more through `slock` commands.

Context usage should be stored when available:

```json
{
  "inputTokens": 0,
  "outputTokens": 0,
  "cacheReadTokens": 0,
  "cacheWriteTokens": 0,
  "contextWindow": 0,
  "occupancyRatio": 0.0,
  "compactionRequired": false,
  "compactedAt": null,
  "source": "runtime_usage_event"
}
```

If occupancy exceeds the configured threshold, the run should either trigger/ask for compaction or mark the issue clearly. The current product threshold under discussion is 50%.

## Workspace Model

TaskRun references the workspace that actually executes the work.

Default:

- Reuse an existing healthy daemon-managed physical `AgentWorkspace` when possible.
- Create or select an independent runtime context/session for the TaskRun.
- Store both the physical workspace snapshot and the run-scoped session/context identity on the TaskRun.
- Do not create a new physical cwd/process for every run by default.

Important distinction:

```text
Physical workspace/cwd/process reuse != model context/session reuse
```

The daemon may keep one managed runtime process or workspace for an agent, but a TaskRun should still have a distinct context boundary. Depending on provider capability this can be:

- a fresh provider conversation/session for the run
- a resumed task-scoped session id for retries/resume of the same task
- a run-scoped context package sent into a stateless/non-resumable provider
- a controlled compacted session derived from a previous task/run session

What should not happen by default:

- every new TaskRun blindly continues the agent's ambient channel chat context
- unrelated tasks share the same long provider context window
- `workspace.session_id` is treated as the only session identity for all runs
- every TaskRun receives the same generic channel-agent system prompt regardless of role

When no usable workspace exists:

- TaskRun can remain `queued` with failure/preflight detail, or transition to `failed` with a clear startup failure.
- Backend/daemon should not report a run as ready when the runtime did not actually start.

Future policy options:

- per-agent workspace
- per-channel logical context over same workspace
- per-task workspace for isolated long-running work
- per-run ephemeral workspace for high-risk tasks
- per-task provider session while reusing the same physical workspace
- per-run provider session for strict isolation

This policy should be explicit. TaskRun should support all of them by referencing the selected runtime workspace and storing context scope.

## TaskRun vs Subagent

TaskRun is not a replacement name for subagent.

They are different layers:

```text
Subagent / runtime process = who can execute work
TaskRun = the product/control-plane record that one execution attempt exists
```

A subagent is an executor capability:

- model/provider/process/session
- tools and permissions
- system prompt base
- local workspace/cwd
- streaming output
- ability to call `slock`

A TaskRun is the durable work boundary:

- which product task is being attempted
- who assigned it and by what mode
- which role the executor is playing
- what source message/thread/task context was supplied
- which prompt profile was used
- which workspace/session/context identity was used
- whether delivery happened
- whether execution started
- token/context usage
- output/failure/evidence
- whether the product task should move to review

The same subagent/runtime can execute many TaskRuns over time, but those runs must not silently share task context. The same Task can also have multiple TaskRuns across different subagents, roles, retries, or reviewers.

TaskRun's advantage over "just spawn a subagent" is not intelligence. It is control:

- durable audit trail instead of only conversation transcript
- backend-visible lifecycle for gates and UI
- explicit source linkage to message/thread/task
- explicit assignment and role semantics
- independent context boundary even when physical workspace is reused
- stable failure classification
- retry/resume/cancel semantics
- multi-agent fan-out without losing which output belongs to which role
- product review flow separated from runtime completion

If a run has no product task, no assignment, no source context, no lifecycle, and no UI/gate evidence, then it should just be a subagent conversation and does not need TaskRun.

If the work is part of a channel task that humans need to assign, watch, review, retry, compare, or gate, then it should be a TaskRun.

## Assignment Modes

### Leader/Coordinator Mode

Flow:

```text
Human message
  -> as task / create parent task
  -> assign leader
  -> create leader TaskRun
  -> leader creates child tasks or child assignments
  -> worker TaskRuns execute
  -> leader reviews/summarizes
  -> parent task moves to in_review
```

This mode fits architecture + runcode worker workflows.

### Direct Drag Mode

Flow:

```text
Human creates task
  -> drag task to agent A
  -> create assignment A + TaskRun A
  -> drag same task to agent B
  -> create assignment B + TaskRun B
```

This mode supports product-side explicit control. It should not depend on the leader interpreting a message correctly.

The task can have more than one assigned agent. The product must decide later how competing/complementary outputs are reviewed, but the data model should not block multiple runs.

## Backend and Daemon Implications

Backend:

- Add TaskRun persistence.
- Add TaskAssignment or prepare migration bridge.
- Create TaskRun when an actionable task assignment is created.
- Emit run lifecycle events:
  - `task_run.created`
  - `task_run.dispatched`
  - `task_run.running`
  - `task_run.completed`
  - `task_run.failed`
  - `task_run.cancelled`
- Keep `task.created` for product/event compatibility, but use TaskRun for runtime execution evidence.
- Preserve source linkage from message/thread/channel to task and run.

Daemon:

- Treat TaskRun as the actionable runtime unit once available.
- Report dispatch/running/completed/failed against run id.
- Attach runtime workspace/session/token usage to the run.
- Keep message reply target and task update target explicit in the runtime prompt.

Frontend/control:

- Task detail shows product state plus run timeline.
- Control/integration shows run lifecycle, runtime workspace/session, context usage, and failure reason.
- Dragging a task to an agent creates assignment/run and makes the run visible immediately.

## V3 Gate Implication

V3 should validate real group task behavior after backend/daemon changes:

- source message exists
- parent task is linked to source message/channel/thread
- leader assignment or direct assignment is explicit
- TaskRun is created for the intended agent
- TaskRun is delivered to the correct runtime
- runtime workspace/session is recorded
- run reaches running/completed/failed with clear evidence
- worker output is linked to channel message, task update, or evidence
- product task does not jump to `done` without review

The gate should fail with specific classifications such as:

- `TASK_SOURCE_LINK_MISSING`
- `TASK_ASSIGNMENT_MISSING`
- `TASK_RUN_MISSING`
- `TASK_RUN_TARGET_MISMATCH`
- `TASK_RUN_WORKSPACE_MISSING`
- `TASK_RUN_RUNTIME_NOT_READY`
- `TASK_RUN_CONTEXT_USAGE_MISSING`
- `TASK_RUN_OUTPUT_MISSING`

## Open Product Question

The main remaining decision is the first implementation boundary:

Should TaskRun be introduced only for channel task execution first, or as a universal runtime execution log for all runtime work immediately?

Recommended answer: start with channel task execution and V3 gate. This keeps the migration bounded while solving the current unstable behavior.
