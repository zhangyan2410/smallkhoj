# Clowder Product Evaluation for SmallKhoj Channel/Task Work

Date: 2026-06-19

Local run:

- Repository: `/Users/code/project/clowder-ai`
- Install: `pnpm install` succeeded
- Build: `pnpm build` succeeded
- Runtime command used: `pnpm start:direct --memory`
- Frontend: `http://localhost:3003`
- API: `http://localhost:3004`
- Mode: opensource profile, memory storage, production frontend

## What Was Explored

- Chat home / lobby thread.
- Left conversation/project navigation.
- Right status panel.
- Session Chain / audit / Runtime panel positions.
- Mission Hub task surface.
- Manual temporary task creation in memory mode:
  - `SmallKhoj channel/task evaluation`
- Mission task detail.
- SOP tab.
- Thread status tab.

## Product Patterns Worth Borrowing

1. Keep the work room and observability side panel together.

   Clowder's chat surface has the main conversation in the center and status/session/runtime/audit information in the right rail. SmallKhoj should keep the channel as the main shared room, but make agent state, recent activity, runtime health, and task evidence visible next to it.

2. Treat task creation as a structured work intake, not only a title card.

   Mission Hub asks for title, summary, priority, tags, and then opens a detail panel. SmallKhoj tasks should at minimum show source message, summary, assignee, status, recent activity, and evidence links.

3. Make task detail the place where decisions happen.

   Clowder's task detail exposes "suggested assignee", "why", "plan", and submit/approval flow. SmallKhoj can borrow the idea that a task should explain what is being done and why, while keeping its own Slock activity/evidence model.

4. Separate overview state from detail state.

   Clowder shows counters such as pending approval, running, completed, while task detail has the deeper flow. SmallKhoj should do the same: board/list for scanning, detail drawer/page for execution evidence.

5. Expose runtime/session state as first-class product information.

   Clowder has Session Chain and Runtime surfaces even when empty. SmallKhoj should expose daemon runtime/session state clearly, but map it to our concepts: `AgentWorkspace`, `Computer`, daemon connection, runtime pid/status, and channel participation.

6. Show empty states that teach the product model.

   Empty runtime/session/task states still tell the user what should appear there. SmallKhoj should avoid silent blank task/channel panels.

7. Give tasks lifecycle language beyond simple status.

   Clowder has "pending suggestion", "approval", "dispatched/running" style language. SmallKhoj can use clearer lifecycle states such as drafted, claimed, working, waiting review, accepted, blocked, failed, without making retry the center of the UX.

8. Link task work back to conversation context.

   Clowder's product shape keeps conversation and mission close. SmallKhoj already has `Task.source_message_id`; the UI should make that relationship visible and navigable.

9. Make agent capability/profile selection visible at task time.

   Clowder lets a user choose which agent/cat is proposed for the task. SmallKhoj should expose assigned agent/member/runtime in task detail, especially when a channel has multiple agents.

10. Add a shared "room state" layer above raw messages.

   Clowder's lobby is not only messages; it has participants, modes, statistics, sessions, logs. SmallKhoj channels should become shared work rooms: messages, active agents, tasks, files/evidence, activity, and runtime health in one place.

## Patterns To Reject Or Modify

1. Do not copy backend-owned runtime spawning.

   Clowder appears designed around API-side/runtime-service orchestration for agents. SmallKhoj should keep daemon as the local execution boundary and keep runtime writes flowing through `slock` CLI -> daemon proxy -> backend Agent API.

2. Do not make retry/reset the main product answer.

   SmallKhoj/Slock should prefer warmup, visible readiness, freshness checks, fail-closed behavior, and auditable error boundaries. Retry can exist, but it should not be the core interaction.

3. Do not import Clowder's cat/persona vocabulary.

   The useful part is not branding. The useful part is visible agent role, capability, runtime state, and task accountability.

4. Do not overfit to Clowder's Mission Hub as a separate product area.

   SmallKhoj already has channel/workbench/control-plane. The first version should enrich tasks inside the channel/control-plane flow rather than create a disconnected mission product.

5. Do not require a full WorkSession/RuntimeSession redesign before improving task/channel UX.

   For competition timing, first represent channel-scoped agent participation and richer task detail on top of existing `Channel`, `Task`, `AgentWorkspace`, `EventRecord`, and `ActivityLog`.

## Implications For SmallKhoj

### Channel

- Add a visible channel-level agent roster/presence area.
- Represent channel-scoped agent participation separately from global member existence.
- Keep "agent joins channel" as a product/logical state first.
- Do not automatically imply a new physical runtime per channel until policy and cost are clear.
- Show daemon/runtime readiness near channel agents:
  - offline
  - daemon connected
  - runtime warming
  - ready
  - working
  - stale/needs attention

### Task

- Add richer task card fields:
  - title
  - status
  - priority if available
  - source channel/message/thread
  - assignee
  - last meaningful activity
  - review state
- Add task detail fields:
  - source message link
  - creator
  - assignee/agent/runtime
  - current lifecycle state
  - recent ActivityLog entries
  - related files/evidence/attachments
  - review decision
  - failure/block reason when present
- Preserve auditability through `ActivityLog` and `EventRecord`.

### Backend/API

- Avoid replacing the current Python FastAPI backend.
- Add minimal model/API changes only after UI/product shape is clear.
- Likely additions to evaluate:
  - channel-agent participation record, or a derived projection from existing membership/workspace data
  - task detail endpoint that joins source message, assignee, activity, evidence, and review state
  - clearer runtime state projection for channel UI

### Daemon/Runtime

- Keep daemon as the execution bridge.
- Keep `slock` as the runtime operation interface.
- Add runtime/session visibility by projecting existing daemon state first.
- Treat physical per-channel runtime/workspace as a later decision, not a prerequisite for the first product improvement.

## Recommended MVP Direction

1. Product-level channel agent participation.
2. Channel right rail or panel showing agents, runtime readiness, active tasks, and recent activity.
3. Task detail panel with source message, assignee, activity/evidence, and review state.
4. Minimal backend projections to support the UI.
5. No backend rewrite, no Clowder-style runtime service replacement, no broad session model rewrite in this task.

## Current Judgment

Clowder is more complete as a product surface, especially around mission/task intake, runtime/session visibility, and making the workbench feel alive. SmallKhoj should learn from those product surfaces, not from the runtime ownership model.

For SmallKhoj's current stage, the strongest move is to make the existing architecture visible and coherent: channel as shared work room, task as auditable work object, daemon/runtime state as readable product state.
