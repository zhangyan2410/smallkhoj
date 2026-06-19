# Channel and Task Workspace Optimization

## Goal

Improve SmallKhoj/Slock channel and task product behavior while preserving the existing daemon + EventRecord + ActivityLog architecture.

The immediate product direction:

- An agent entering a channel should have an independent channel-scoped workspace/runtime context.
- A channel should provide a shared public space for humans and agents, not just a message list.
- Tasks should expose richer information than the current simple title/status cards.
- Clowder should be run locally and evaluated as a product reference before final implementation decisions are made.

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
- Clowder has stronger task/thread/session product patterns, but SmallKhoj should only borrow what fits Slock's daemon-centered architecture.

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

## Acceptance Criteria

- [ ] Clowder project can be run locally or a clear blocker is documented.
- [ ] `clowder-evaluation.md` records product patterns to borrow and reject.
- [ ] A channel UX proposal describes shared space, agent presence, and channel-scoped working context.
- [ ] A task UX proposal describes richer task cards/detail fields and links to messages/evidence/activity.
- [ ] Backend model/API implications are listed separately from UI-only changes.
- [ ] Final design preserves daemon + EventRecord + ActivityLog + slock CLI architecture.

## Initial Validation Plan

- Run or inspect Clowder locally enough to capture screenshots/notes of relevant channel/thread/task/runtime surfaces.
- Use current SmallKhoj UI and API to identify the smallest channel/task deltas.
- Validate any future frontend changes through the project WebDriver tool, not Playwright.
- Validate backend changes through FastAPI/SQLAlchemy tests and event/activity evidence.
