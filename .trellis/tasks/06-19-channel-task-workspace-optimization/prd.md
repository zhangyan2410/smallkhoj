# Channel and Task Workspace Optimization

## Goal

Improve SmallKhoj/Slock channel and task product behavior while preserving the existing daemon + EventRecord + ActivityLog architecture.

The immediate product direction:

- An agent entering a channel should have an independent channel-scoped workspace/runtime context.
- A channel should provide a shared public space for humans and agents, not just a message list.
- Tasks should expose richer information than the current simple title/status cards.
- Messages and tasks are separate concepts. A message can be converted "as task" by creating a task with source linkage, but the message itself is not the task.
- Task runtime execution needs a separate TaskRun layer. A Task is the product/work item; a TaskRun is one agent/runtime attempt against that work item.
- Clowder should be run locally and evaluated as a product reference before final implementation decisions are made.
- Multica should be used as an additional product/architecture reference for the task/run split, group routing, and squad/leader behavior.

## Background

SmallKhoj already has a real workbench/control-plane architecture:

- `Channel` is the collaboration space.
- `Message` supports root/reply thread behavior through `parent_id`.
- `Task` is scoped to channel and can link to a source message.
- `AgentWorkspace` binds an agent to a computer/runtime/cwd/pid/session.
- daemon and backend communicate through control commands, EventRecord, ActivityLog, WebSocket/polling, and the local `slock` proxy path.

The gap is product semantics, not a total platform absence. Current channel/task surfaces are useful but still too thin:

- Channel membership does not yet clearly imply independent agent workspace/runtime context.
- The channel has messages, tasks, files, and activity, but the shared-space concept is not strong enough yet.
- Tasks are too simple for review, evidence, ownership, source context, agent progress, and decision history.
- The current Task model also carries too much runtime meaning. It acts as product work item, assignment signal, runtime trigger, and evidence container. That is acceptable for simple task-from-message, but not enough for stable multi-agent channel task behavior.
- Clowder has stronger task/thread/session product patterns, but SmallKhoj should only borrow what fits Slock's daemon-centered architecture.
- Multica shows a useful separation: user-visible work item (`issue`) and runtime execution queue (`agent_task_queue`). SmallKhoj should keep its channel-first product model, but borrow that split.

## Product Requirements

### Channel-Scoped Agent Workspace

- When an agent joins or is added to a channel, the product should be able to represent that agent's channel-specific working context.
- The channel-level context must not collapse into a single global agent workspace when the same agent participates in multiple channels.
- The first version can keep the physical runtime under existing `AgentWorkspace`, but the product must distinguish channel-scoped participation and working state.
- Agent channel state should be visible in the channel UI: present, ready, working, idle/offline, or needs setup.
- Channel-scoped context should preserve the Slock route: runtime -> slock CLI -> daemon proxy -> backend Agent API.

### Shared Channel Space

- Channel should feel like a shared work room for humans and agents.
- The channel should surface at least messages/threads, channel members/agents, active or recent tasks, files/evidence if available, and recent activity relevant to this channel.
- The shared space should not become a Clowder clone. It should express Slock concepts: channel, task, agent, computer, activity, event, file, reminder.

### Richer Task Surface

- Tasks should show channel and source message/thread.
- Tasks should show creator, assignee, current status, and allowed next actions.
- Tasks should show linked evidence/files/trace/activity where available.
- Tasks should show last updated time and meaningful recent activity.
- Tasks should show review state or reviewer decision where available.
- Task detail should explain what the agent did, not just that the status changed.
- Agent-created/agent-claimed task actions should remain auditable through ActivityLog/EventRecord.
- The task UI should support both board/list overview and a richer detail panel.

### TaskRun Runtime Layer

- Add a TaskRun concept for one executable runtime attempt by one agent against one task.
- TaskRun lifecycle is runtime-facing and separate from product task status.
- Recommended TaskRun lifecycle:
  - `queued`: created and waiting for delivery/claim.
  - `dispatched`: delivered to daemon/runtime or selected for delivery.
  - `running`: runtime accepted the work and is actively processing.
  - `awaiting_input`: optional future state when the agent asks a blocking question.
  - `completed`: runtime produced a usable result or output message.
  - `failed`: runtime failed with a visible failure code/reason.
  - `cancelled`: human/system cancelled the run before completion.
- Task product status remains review-oriented:
  - `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`.
  - Agents should not silently mark tasks `done`; human/supervisor review owns final approval.
- A TaskRun must record enough evidence to explain what happened without requiring the operator to inspect daemon logs:
  - task id, agent id, optional assignment id, source channel/thread/message ids
  - runtime workspace id, daemon/computer id when known, runtime provider/model/session id
  - lifecycle timestamps and failure code
  - output message id, task status update id, or evidence id
  - token usage and context usage summary when the provider exposes it
  - sanitized tool-call/progress summary when available
- TaskRun context is an explicit input package, not the full channel history:
  - task title/description/acceptance criteria
  - source message and source thread/root
  - bounded recent channel/thread messages
  - relevant task memory/evidence/files
  - role assignment: leader/coordinator, worker, reviewer, or direct assignee
  - runtime instructions for where to reply and how to update task state
- If context usage is available and exceeds the configured threshold, the run should either compact before continuing or mark the reason clearly. The current product threshold under discussion is 50% context occupancy unless the run is producing useful output.

### Channel Task Assignment Modes

SmallKhoj channel tasks should support two product modes:

1. Human-designated leader/coordinator mode:
   - Human creates or converts a message into a parent task.
   - Human assigns a leader/architect/coordinator.
   - Backend creates a TaskRun for the leader.
   - Leader may create child tasks or child runs for workers.
   - Worker output is linked back to the parent task through child task/run evidence.

2. Direct drag assignment mode:
   - Human drags a task to one or more agents in the UI.
   - Dragging to an agent creates an assignment and a TaskRun for that agent.
   - A task should not be limited to exactly one agent long-term.
   - Existing `Task.assignee_id` can remain as a backward-compatible primary owner, but multi-agent task assignment should move toward a separate assignment model.

The initial implementation does not need full squad/autopilot complexity. It does need clear semantics for source message, assignment, TaskRun creation, runtime delivery, and visible outcome.

### Workspace and Context Placement

- TaskRun should reference the runtime workspace that actually executes the work.
- Default behavior can reuse the selected agent's existing daemon-managed physical `AgentWorkspace` when it is ready and healthy.
- Reusing a physical workspace/cwd must not imply reusing the same model conversation session or context window.
- TaskRun should have an independent runtime context by default. It may share the same daemon process/cwd, but it needs its own scoped session identity or an equivalent context boundary.
- TaskRun creation must not imply a new physical cwd/process every time. A separate physical runtime workspace is a policy choice, not the default data model.
- The run should snapshot runtime fields that are needed for audit:
  - `agent_workspace_id`
  - `computer_id` / daemon connection when known
  - `runtime`, `runtimeProvider`, `runtimeModel`
  - physical workspace `sessionId` when reused
  - TaskRun scoped runtime session id / conversation id when different
  - `cwd` / workspace path
- Logical context scope should be explicit:
  - channel-scoped for ambient channel participation
  - thread-scoped for a thread conversation
  - task-scoped for parent task work
  - run-scoped for one execution attempt
- The frontend should show this separation: task card/detail for product state, run timeline for runtime state, and workspace/session info for debugging.

## Multica Reference Findings

Multica does not model group task as "a group message becomes a claimable task." Its architecture separates:

- Product work item: `issue`
- Discussion: `comment`
- Chat conversation: `chat_session` / `chat_message`
- Runtime execution: `agent_task_queue`
- Group routing: `squad` with a leader agent

Important lessons to borrow:

- Keep work item and runtime run separate.
- Preserve source links from message/comment/chat to the work item/run, but do not let the source object become the lifecycle owner.
- Use a leader/coordinator for group work instead of letting every agent respond freely.
- Serialize or dedupe runs per agent and per source scope to avoid duplicate runtime work.
- Require a visible output path when a run completes: channel message, task status update, evidence entry, or failure record.

Important lessons not to copy directly:

- Do not replace SmallKhoj's native channel/message/task model with a Linear/Jira-style issue-only model.
- Do not collapse SmallKhoj group channel behavior into a single chat session for one agent.
- Do not copy Multica's external `channel_*` weak-FK connector layer for SmallKhoj's internal channel model.
- Do not rely on an in-process debounce window as the only durable guarantee for runtime triggering.

## Clowder Reference Evaluation

Before implementation, run and experience `/Users/code/project/clowder-ai` locally enough to evaluate its channel/thread/task/session product patterns.

Evaluation should focus on product lessons, not copying architecture:

- How it presents threads/conversations/projects.
- How it presents task lifecycle and review/evidence.
- How it surfaces agent activity and runtime/session state.
- Which concepts improve user understanding.
- Which concepts conflict with SmallKhoj/Slock's daemon-centered product boundary.

Expected output of this evaluation:

- notes in this task directory, e.g. `clowder-evaluation.md`
- product patterns to borrow
- product patterns to explicitly reject
- concrete implications for channel/task UI and backend model changes

## Non-Goals

- Do not replace FastAPI backend.
- Do not copy Clowder's backend-spawn AgentService architecture.
- Do not introduce ACP as the channel/task foundation.
- Do not redesign all runtime session models in this task unless the Clowder evaluation makes a minimal change unavoidable.
- Do not make retry/reset the primary UX for stuck agents.
- Do not build a full plugin market or Clowder-style onboarding flow here.

## Open Questions

1. What does "agent enters channel" mean operationally?

   Recommended starting point: channel membership creates product-level participation; runtime/workspace launch remains explicit or policy-driven.

   Why it matters: automatic runtime launch can be expensive and surprising, especially for a paid Slock-like product.

2. Should channel-specific workspace mean a separate process/cwd, or a logical context over the same physical AgentWorkspace?

   Recommended starting point: logical channel-scoped context first; physical separate runtime only when needed.

   Why it matters: separate runtime per channel is clearer but more expensive and can multiply provider sessions.

3. What is the minimum task detail that improves the product immediately?

   Recommended starting point: source message/thread, assignee, evidence/activity, review status, and recent activity.

   Why it matters: adding too many task fields before the UI is understood can create backend churn.

4. Which Clowder task/channel concepts should be rejected because they conflict with Slock?

   Recommended starting point: reject concepts that assume backend directly owns agent CLI sessions or user-managed retry-heavy flows.

   Why it matters: SmallKhoj must keep daemon/proxy/event/activity as its product boundary.

5. What is the first TaskRun implementation boundary?

   Recommended starting point: add TaskRun for channel task execution and V3 gate first, not every possible background runtime action.

   Why it matters: if TaskRun is introduced as a universal execution log on day one, the migration surface gets too large. If it is introduced only for channel task runtime work, the V3 gate can validate the important behavior first.

6. Should multi-agent assignment be represented as a real assignment table or stored temporarily in `Task.data`?

   Recommended starting point: design for a real `task_assignments` table, but allow a compatibility bridge from current `Task.assignee_id` while migrating.

   Why it matters: direct drag assignment to multiple agents is awkward and fragile if `Task.assignee_id` remains the only assignment field.

## Acceptance Criteria

- [ ] Clowder project can be run locally or a clear blocker is documented.
- [ ] `clowder-evaluation.md` records product patterns to borrow and reject.
- [ ] Multica reference findings are recorded and translated into SmallKhoj-specific decisions.
- [ ] A channel UX proposal describes shared space, agent presence, and channel-scoped working context.
- [ ] A task UX proposal describes richer task cards/detail fields and links to messages/evidence/activity.
- [ ] A TaskRun design describes lifecycle, context package, workspace/session linkage, runtime evidence, and failure behavior.
- [ ] Channel task supports a leader/coordinator mode in the design.
- [ ] Channel task supports a direct drag assignment mode in the design.
- [ ] V3 validation expectations are updated to check real Task/TaskRun/source/assignment evidence instead of relying only on message/task status.
- [ ] Backend model/API implications are listed separately from UI-only changes.
- [ ] Final design preserves daemon + EventRecord + ActivityLog + slock CLI architecture.

## Initial Validation Plan

- Run or inspect Clowder locally enough to capture screenshots/notes of relevant channel/thread/task/runtime surfaces.
- Use current SmallKhoj UI and API to identify the smallest channel/task deltas.
- Validate any future frontend changes through the project WebDriver tool, not Playwright.
- Validate backend changes through FastAPI/SQLAlchemy tests and event/activity evidence.
