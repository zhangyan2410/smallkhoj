# Research: product-validation-review

- Query: Read-only product/validation review of whether current task/channel memory UI satisfies: "task and channel task should be more visible, including more obvious outputs, images/videos, better task breakdown, and agent recovery from task/channel after compression."
- Scope: internal
- Date: 2026-06-23

## Findings

### Files Found

- `.trellis/workflow.md` - Trellis phase/task workflow; requires persisted research and task-local evidence.
- `.trellis/spec/frontend/product-ui-style.md` - Product UI rule that evidence, status, actions, and runtime facts must be easy to inspect.
- `.trellis/spec/frontend/quality-guidelines.md` - Browser evidence gate requiring marker-based `./twd` verification for browser-facing work.
- `.trellis/spec/backend/event-delivery-contracts.md` - Memory/activity/event UI must stay browser-safe and not become runtime work unless explicitly classified.
- `.trellis/spec/backend/database-guidelines.md` - Read-only marker observation patterns for message/task/event verification.
- `.trellis/spec/backend/threading-contracts.md` - Thread/task source link and summary contracts relevant to task recovery.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/prd.md` - Product goal: server-owned channel/task memory, scoped runtime sessions, task summaries, selective retrieval, and UI visibility.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md` - Detailed design for task/channel UI, artifact rendering, promotion, and recovery.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md` - Implementation checklist showing which memory/UI/session items are complete versus remaining.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/final-validation.md` - Prior validation evidence and remaining follow-ups.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/REAL_memory_ui_202606230131-chat-memory.snapshot.txt` - Browser snapshot proving text channel memory marker visibility.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/REAL_memory_ui_202606230131-task-memory.snapshot.txt` - Browser snapshot proving text task memory marker visibility.
- `frontend/app/tasks/page.tsx` - Standalone Tasks product page, task CRUD server actions, evidence form, sidebar detail, task memory section.
- `frontend/components/task-board.tsx` - Reusable client task board used in Chat Tasks tab, compact task detail, inline task memory fetch.
- `frontend/components/task-dnd-board.tsx` - Wrapper used by the standalone Tasks page board/list body.
- `frontend/app/chat/[channel]/channel-client.tsx` - Chat workbench tabs: Chat, Tasks, Memory, Files, Activity; channel memory panel; file upload/list.
- `frontend/lib/control-plane.ts` - Shared frontend API helpers and `MemoryEntry` type.
- `backend/services/memory_api.py` - Scoped memory resolution, list/read/search/write/proposal helpers and memory event payloads.

### Related Specs And Task Contracts

- Product UI style requires dense, scannable operational surfaces where "navigation, lists, details, status, actions, and evidence must be easy to inspect" and runtime/product observability should summarize/link to evidence rather than expose raw logs as the primary experience (`.trellis/spec/frontend/product-ui-style.md`).
- Frontend quality requires browser-facing work to produce real UI evidence with a unique marker, `./twd` navigation/action commands, visible DOM assertion, screenshot, API/DB cross-check when backend state matters, and trace cross-check when daemon/runtime delivery matters (`.trellis/spec/frontend/quality-guidelines.md`).
- Event delivery contracts require memory/activity events to be product-safe browser wake-ups and not runtime prompts by default; only explicitly actionable work reaches runtimes (`.trellis/spec/backend/event-delivery-contracts.md`).
- Design says task detail should show source link, structured brief, plan/subtasks, progress, evidence, images/videos/files/artifacts, API/DB/trace proof, review state, promoted conclusions, and compact final summary (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:391`).
- Design explicitly says images/videos should be visible as real assets, with image inline preview and video player controls, and "Do not ship a task/channel artifact list that only shows names" (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:431`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:433`).
- Design says task completion should create/update `final-summary.md`, append evidence pointers, create channel memory proposal, and make scoped runtime session resumable from task memory rather than raw provider history (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:321`).
- Task plan marks provider session-id routing, task completion summarization handoff, context manifest hooks, prompt injection policy, source message links, proposal audit UI, and image/video/file artifact rendering as remaining items (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:118`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:125`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:145`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:160`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:161`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:163`).

### Current Code Patterns

- The standalone Tasks page fetches all tasks/channels/members and, for the selected task, fetches both activity and task memory (`frontend/app/tasks/page.tsx:612`, `frontend/app/tasks/page.tsx:621`).
- The standalone Tasks page shows a sidebar task detail with status, assignee, creator, activity, source, evidence, task memory, and review sections (`frontend/app/tasks/page.tsx:443`, `frontend/app/tasks/page.tsx:474`, `frontend/app/tasks/page.tsx:496`, `frontend/app/tasks/page.tsx:527`, `frontend/app/tasks/page.tsx:573`, `frontend/app/tasks/page.tsx:574`).
- The standalone Tasks page can add evidence through a native server-action form, but the form only captures `entryType`, `entryPath`, and `entryContent`; it does not upload or render real media assets (`frontend/app/tasks/page.tsx:550`).
- `TaskMemorySection` sorts known recovery paths (`brief.md`, `plan.md`, `progress.md`, `final-summary.md`, `promotions.md`) ahead of evidence/artifacts/other entries, which is a useful recovery foundation (`frontend/app/tasks/page.tsx:418`).
- Task memory entries render as icon + title/path/text/hash/time rows; image/video MIME types only affect the icon, not inline preview/player behavior (`frontend/app/tasks/page.tsx:386`, `frontend/app/tasks/page.tsx:396`).
- The actual standalone task board body uses `TaskDndBoard`, which delegates board mode to `TaskBoard` with `showDetail={false}` and uses the server-rendered sidebar for details (`frontend/components/task-dnd-board.tsx:67`, `frontend/components/task-dnd-board.tsx:70`).
- Standalone task list rows show channel/number/title/creator/assignee/source-message text/status, but no output/evidence/artifact/final-summary indicators (`frontend/components/task-dnd-board.tsx:81`, `frontend/components/task-dnd-board.tsx:91`).
- Reusable `TaskBoard` cards show channel number, title, status, creator, assignee, updated time, and a source badge, but no memory/evidence/artifact counts or final-summary status (`frontend/components/task-board.tsx:210`, `frontend/components/task-board.tsx:221`, `frontend/components/task-board.tsx:230`).
- Reusable `TaskBoard` inline detail fetches task memory on selection/mount, but there is no `memory.*` SSE subscription for the selected task detail; prior final validation also notes live inline task memory refresh can be improved (`frontend/components/task-board.tsx:394`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/final-validation.md:126`).
- Chat has tabs for Chat, Tasks, Memory, Files, and Activity, which is the right product surface skeleton for a shared work room (`frontend/app/chat/[channel]/channel-client.tsx:134`).
- Chat Memory tab fetches channel memory via `/api/v1/memory/scopes/channel/{channelId}` and refreshes it on `memory.*` realtime events (`frontend/app/chat/[channel]/channel-client.tsx:515`, `frontend/app/chat/[channel]/channel-client.tsx:747`).
- `ChannelMemoryPanel` prioritizes `MEMORY.md`, `decisions/`, `references/`, and artifact-like entries, but renders all entries as rows with icon/path/text/hash/size/time only; there is no inline image/video/file preview in the memory panel (`frontend/app/chat/[channel]/channel-client.tsx:179`, `frontend/app/chat/[channel]/channel-client.tsx:201`).
- Chat Files tab supports upload/list and has Preview/Download links, but this file surface is separate from memory/task evidence; memory entries with `fileId`/`blobKey` are not joined into the file preview UI (`frontend/app/chat/[channel]/channel-client.tsx:552`, `frontend/app/chat/[channel]/channel-client.tsx:1387`, `frontend/app/chat/[channel]/channel-client.tsx:1439`).
- Chat "As Task" creates a backend task from message content, preserving source metadata and a simple evidence note, but does not seed structured task memory (`brief.md`, `plan.md`, subtasks) in the frontend path (`frontend/app/chat/[channel]/channel-client.tsx:822`, `frontend/app/chat/[channel]/channel-client.tsx:859`, `frontend/app/chat/[channel]/channel-client.tsx:881`).
- `MemoryEntry` type has fields needed for richer rendering (`blobKey`, `fileId`, `mimeType`, source ids, metadata), but current UI mostly displays those indirectly or not at all (`frontend/lib/control-plane.ts:120`).
- `apiGet` returns fallback silently for non-OK responses and catches errors, which can make permission/API failures look like empty memory states in UI validation (`frontend/lib/control-plane.ts:147`).
- Backend memory API resolves channel/task/thread/agent scopes with viewer checks where provided and serializes provenance/file/blob/hash/version fields (`backend/services/memory_api.py:32`, `backend/services/memory_api.py:222`).
- Backend memory write supports CAS and emits `memory.created`/`memory.updated`/`memory.proposal.created` events with scope/channel/task identifiers for browser invalidation (`backend/services/memory_api.py:123`, `backend/services/memory_api.py:392`, `backend/services/memory_api.py:411`).

### Prior UI Evidence

- Prior evidence proves a text channel memory entry is visible in Chat Memory tab: marker `REAL_memory_ui_202606230131 channel memory visible in Chat Memory tab.` appears under `MEMORY.md` (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/REAL_memory_ui_202606230131-chat-memory.snapshot.txt:32`).
- Prior evidence proves text task memory entries are visible in the standalone Tasks sidebar: `plan.md` and `evidence.md` appear under `Task Memory`, including marker text (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/REAL_memory_ui_202606230131-task-memory.snapshot.txt:158`).
- Prior evidence does not prove image/video inline rendering, file/blob memory rendering, source-message navigation, task decomposition quality, promotion/audit UI, scoped provider session recovery, or prompt/context manifest inspection.

### Current Gaps - Blocking

1. **Media/artifact outputs are still list rows, not inspectable assets.**
   - Why blocking: The user explicitly asked for "更明显的产出结果、图片视频"; the design explicitly forbids shipping task/channel artifacts that only show names.
   - Evidence: `MemoryEntryIcon` changes only icon for image/video/artifact entries (`frontend/app/tasks/page.tsx:386`, `frontend/app/chat/[channel]/channel-client.tsx:170`). `MemoryEntryRow` and `ChannelMemoryPanel` render title/path/text/hash/time, with no `<img>`, `<video>`, file preview, or linked file detail from `fileId`/`blobKey` (`frontend/app/tasks/page.tsx:396`, `frontend/app/chat/[channel]/channel-client.tsx:201`). The Files tab has Preview/Download links, but it is separate from memory entries (`frontend/app/chat/[channel]/channel-client.tsx:1439`).
   - Product impact: Operators cannot inspect actual screenshots, videos, or produced files from task/channel memory; they only see path/caption rows.

2. **Agent compression/recovery is display-only and not end-to-end.**
   - Why blocking: The requirement says agents should recover from task/channel after compression. Current UI can show memory entries, but it does not provide a concrete recovery affordance or prove runtime rehydration from memory.
   - Evidence: The task memory section prioritizes recovery paths (`brief.md`, `plan.md`, `progress.md`, `final-summary.md`, `promotions.md`) (`frontend/app/tasks/page.tsx:418`), but task plan still leaves provider session-id routing, task completion summarization handoff, task/context injection, and context manifest hooks incomplete (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:118`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:125`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:139`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:145`). Design requires resumability from task memory rather than raw provider history (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:321`).
   - Product impact: A human can manually read task memory, but there is no visible "resume/recover this task/channel context" path and no marker-based proof that a compressed/new agent turn receives the right task/channel memory.

3. **Task decomposition is not sufficiently structured or seeded.**
   - Why blocking: The user asked for "更完善任务拆分"; current create paths are title/description/status/assignee only.
   - Evidence: Tasks page create form captures title, description, channel, assignee, and status only (`frontend/app/tasks/page.tsx:712`). Chat "As Task" turns a message into a task title and generic description with source/evidence note, but no structured brief, plan, checklist/subtasks, or task-memory seed (`frontend/app/chat/[channel]/channel-client.tsx:859`, `frontend/app/chat/[channel]/channel-client.tsx:881`). Design/task plan expect `brief.md`, `plan.md`, `progress.md`, `evidence.md`, `final-summary.md`, `promotions.md` and Slice D says task creation seeds `brief.md` (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:408`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:495`).
   - Product impact: Tasks can still be opaque one-line work items unless an agent manually writes memory later.

4. **Channel work room does not yet surface active task outputs/evidence/promotions prominently.**
   - Why blocking: The user asked task and channel task to have "更多显现"; the channel should feel like a shared work room, not just chat plus separate tabs.
   - Evidence: Chat has Tasks and Memory tabs (`frontend/app/chat/[channel]/channel-client.tsx:134`), but Channel Memory panel shows memory rows only (`frontend/app/chat/[channel]/channel-client.tsx:179`) and TaskBoard cards show only task identity/status/source basics (`frontend/components/task-board.tsx:210`). Design expects channel surface to include active task summaries and evidence/artifacts from recent tasks (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:377`).
   - Product impact: A user must open multiple tabs/details and infer whether a task has outputs, evidence, final summary, or promoted conclusions.

5. **Promotion/review state is not durable enough in the UI path.**
   - Why blocking: Recovery depends on knowing what was reviewed, accepted, and promoted from task memory to channel memory.
   - Evidence: Tasks page Review form appends review entries to `Task.data.evidence.entries`, not task memory review paths or promotion metadata (`frontend/app/tasks/page.tsx:192`, `frontend/app/tasks/page.tsx:574`). Design says review state is task memory and promotion must store `source_task_id`, source path, target path, mode, reason, promoted_by, created_at (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:446`, `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:459`). Task plan marks memory proposal audit UI incomplete (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:161`).
   - Product impact: The operator cannot clearly see which outputs became durable channel knowledge and why.

### Current Gaps - Non-Blocking / Follow-Up

1. **Source links are inconsistent.**
   - Full Tasks sidebar can build an "Open channel" source link from source metadata (`frontend/app/tasks/page.tsx:284`, `frontend/app/tasks/page.tsx:513`), but Chat inline task detail only shows source type/message id text (`frontend/components/task-board.tsx:478`), and standalone list rows show only "source message" text (`frontend/components/task-dnd-board.tsx:91`). Task plan marks source message links incomplete (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md:160`).

2. **Inline Chat task memory does not live-refresh on task-scoped `memory.*` events.**
   - `TaskMemoryInline` fetches entries when `taskId` changes (`frontend/components/task-board.tsx:398`), while Chat channel memory refreshes on `memory.*` events (`frontend/app/chat/[channel]/channel-client.tsx:747`). Prior final validation already notes this (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/final-validation.md:126`).

3. **Empty memory states can hide API/permission failures.**
   - `apiGet` returns fallback on non-OK or thrown fetch (`frontend/lib/control-plane.ts:147`), so a 401/403/500 may render as "No memory yet." This is acceptable for resilience, but validation should include API/DB checks so empty UI is not mistaken for real absence.

4. **Evidence and memory renderers are duplicated across standalone Tasks page and reusable TaskBoard.**
   - Similar `EvidenceEntryRow`/memory row logic exists in `frontend/app/tasks/page.tsx` and `frontend/components/task-board.tsx`, increasing drift risk as artifact rendering gets richer (`frontend/app/tasks/page.tsx:345`, `frontend/components/task-board.tsx:345`).

5. **Task cards remain intentionally scan-focused, but need lightweight output indicators.**
   - Design says card remains scan-focused and detail owns deeper record (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:406`), so cards do not need full artifact previews. They do need enough counts/badges to show a task has plan/evidence/final summary/media without opening every task.

6. **Backend scoped memory foundation is solid for the reviewed slice, but richer UI needs route/data joins.**
   - Backend serializes file/blob/provenance fields (`backend/services/memory_api.py:222`) and emits wake-up events (`backend/services/memory_api.py:392`), but task detail API is still not the joined "task + memory + source message + files + activity + review" endpoint envisioned by design (`.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md:158`).

## Suggested Testable Changes

1. **Add a shared `MemoryArtifactRenderer` for task and channel memory.**
   - Render image memory entries as inline previews from `fileId`, `blobKey`, `metadata.url`, or FileEntry preview URL.
   - Render video entries with `<video controls>`.
   - Render file entries with preview/download actions and source/provenance.
   - Render markdown/text/API proof in a compact expandable panel.
   - Test marker: `REAL_memory_artifact_<timestamp>`.
   - Acceptance: the same marker appears in Chat Memory and Tasks detail; screenshot shows actual image pixels or video element controls, not only the path.

2. **Add first-class Recovery section in task detail.**
   - Group `brief.md`, `plan.md`, `progress.md`, `evidence.md`, `final-summary.md`, `promotions.md` under a visible "Recovery" or "Resume context" section.
   - Add an operator action such as "Copy recovery prompt" or "Open recovery manifest" that assembles task/channel scope, key memory paths, source message, final summary, and promoted conclusions.
   - Test marker: `REAL_task_recovery_manifest_<timestamp>`.
   - Acceptance: marker appears in all seeded recovery entries and in the assembled recovery manifest; a trace/API check proves an agent can read those exact memory paths through `slock memory read/search`.

3. **Seed structured task memory when a task is created.**
   - On task creation from Tasks page or Chat "As Task", write at least `brief.md` and `plan.md` (even if plan starts as a one-step checklist).
   - If the message contains checklist-like lines, preserve them as subtasks in `plan.md` or structured task data.
   - Test marker: `REAL_task_breakdown_<timestamp>`.
   - Acceptance: creating a task from chat shows the task in Chat Tasks tab and `/tasks`, with `brief.md` and `plan.md` visible; the source message link opens the original message.

4. **Add lightweight task output indicators to task cards/list rows.**
   - Show compact badges/counts for memory entries, evidence count, media artifacts, final summary, and promoted conclusions.
   - Keep cards scan-focused; details still own full rendering.
   - Test marker: `REAL_task_output_badges_<timestamp>`.
   - Acceptance: board/list card shows nonzero media/evidence/final-summary indicators for the seeded task without opening detail.

5. **Add a channel work summary rail inside Chat.**
   - In or near Chat Tasks/Memory tabs, surface active task summaries, recently updated task evidence/artifacts, and recently promoted channel memory.
   - Test marker: `REAL_channel_work_rail_<timestamp>`.
   - Acceptance: with one active task and one promoted conclusion, the channel surface shows both the active task summary and the promoted channel memory entry.

6. **Add promotion/audit UI for memory proposals and durable conclusions.**
   - Show proposal status, source task, source memory path, target channel memory path, reason, reviewer/promoter, and timestamp.
   - Test marker: `REAL_memory_promotion_<timestamp>`.
   - Acceptance: completing/reviewing a task creates or displays a promotion/proposal row in task detail and channel memory audit surface.

7. **Make memory UI failures distinguishable from empty memory.**
   - Keep resilient fallback if desired, but expose an error state when memory fetch fails in task/channel panels.
   - Test marker: `REAL_memory_error_state_<timestamp>`.
   - Acceptance: forced 403/500 is visibly different from "No memory yet" and does not pass as empty success.

8. **Add task-scoped realtime refresh for inline Chat task detail.**
   - Subscribe selected task detail to task-scope `memory.*` or refetch selected task memory after relevant channel memory events.
   - Test marker: `REAL_task_memory_live_<timestamp>`.
   - Acceptance: with Chat Tasks tab open and task selected, writing task memory through API/CLI updates visible memory without manual refresh.

## Real UI Verification Scenarios And Markers

Use project WebDriver CLI `./twd` per project SOP, not Playwright. Do not rely on a long production build for these checks; run against local dev services if available. Each scenario should save screenshot/snapshot under `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/` and cross-check API/DB/trace as noted.

### Scenario 1: Channel Memory Text + Media Artifact

- Marker: `REAL_channel_memory_artifact_20260623_<hhmm>`.
- Seed:
  - Channel memory `MEMORY.md` with marker text.
  - `artifacts/<marker>-image.md` or equivalent memory entry with `entryKind=artifact`, `mimeType=image/png`, and a valid file/blob/preview reference.
  - Optional `artifacts/<marker>-video.md` with `mimeType=video/mp4`.
- UI steps:
  - Open `/chat/<channel>`.
  - Click `Memory` tab.
  - Assert marker text, `MEMORY.md`, artifact path/title, an image preview element, and video controls when video is seeded.
- API/DB check:
  - `GET /api/v1/memory/scopes/channel/<channelId>` includes entries and file/blob metadata.
  - Read-only DB query verifies `memory_entries.scope_type='channel'` and marker in content/metadata.
- Pass marker:
  - Visible DOM contains `REAL_channel_memory_artifact_...`.
  - Screenshot shows real media rendering, not only a row icon/path.

### Scenario 2: Task Recovery From Memory After Compression

- Marker: `REAL_task_recovery_manifest_20260623_<hhmm>`.
- Seed:
  - A task with task memory entries: `brief.md`, `plan.md`, `progress.md`, `evidence.md`, `final-summary.md`, `promotions.md`, all containing marker.
- UI steps:
  - Open `/tasks?task=<taskId>`.
  - Assert Task Detail shows a visible recovery-oriented grouping and all expected paths.
  - Trigger "Copy recovery prompt" or "Open recovery manifest" if implemented.
- Agent/trace check:
  - Use `slock memory read --scope task --id <taskId> --path final-summary.md` or equivalent agent API.
  - If runtime resume is wired, send a task-scoped message after simulated compaction/new session and verify trace contains `task:<taskId>` scope plus marker-derived manifest, not full unrelated channel memory.
- Pass marker:
  - UI and agent-readable memory both contain `REAL_task_recovery_manifest_...`.

### Scenario 3: Chat "As Task" Creates Structured Breakdown

- Marker: `REAL_task_breakdown_20260623_<hhmm>`.
- Chat message content:
  - Include a short task title plus checklist-like lines, for example `1. collect evidence`, `2. implement`, `3. verify with marker REAL_task_breakdown...`.
- UI steps:
  - Open `/chat/<channel>`.
  - Send the message with `As Task` enabled or use "Create task from message".
  - Click `Tasks` tab.
  - Open the task detail.
- Assertions:
  - Task appears in the channel task board.
  - Source link opens/highlights the original message.
  - Task memory/detail includes `brief.md` and `plan.md` or structured subtasks preserving the checklist.
- API/DB check:
  - `GET /api/v1/tasks` returns the task with source message id.
  - `GET /api/v1/tasks/<taskId>/memory` returns seeded brief/plan entries.

### Scenario 4: Task Output Badges And Media Evidence

- Marker: `REAL_task_output_media_20260623_<hhmm>`.
- Seed:
  - One task with evidence entry, image artifact, video/file artifact, and `final-summary.md`.
- UI steps:
  - Open `/tasks`.
  - Verify board/list card shows output/evidence/media/final-summary indicators.
  - Open task detail and inspect media/artifacts.
- Assertions:
  - Card badges show counts or labels without layout shift.
  - Detail shows inline image/video/file actions.
  - Evidence section and Task Memory section both show marker.
- API/DB check:
  - Read-only DB query verifies task and memory rows; file entries if used.

### Scenario 5: Channel Work Rail Shows Active Task Outputs And Promotions

- Marker: `REAL_channel_work_rail_20260623_<hhmm>`.
- Seed:
  - Channel has one active task with `progress.md`.
  - Same task has `final-summary.md`.
  - A promoted channel memory entry/proposal points back to the task.
- UI steps:
  - Open `/chat/<channel>`.
  - Inspect Tasks/Memory/work rail.
- Assertions:
  - Channel surface shows active task summary, latest evidence/artifact, and promoted conclusion.
  - User can navigate from channel work item to task detail and from task detail back to channel memory/source.
- API/DB check:
  - `memory_entries.source_task_id` or proposal metadata links promotion back to the task.

### Scenario 6: Scoped Session Isolation And Recovery

- Marker set:
  - `REAL_scope_dm_20260623_<hhmm>`
  - `REAL_scope_channel_20260623_<hhmm>`
  - `REAL_scope_task_20260623_<hhmm>`
- Steps:
  - Send a DM to the same agent.
  - Send a channel message to the same agent.
  - Create/assign a task to the same agent and send task-linked work.
  - Simulate compaction/new runtime turn if tooling supports it.
- Trace assertions:
  - DM uses `dm:<peerMemberId>`.
  - Channel uses `channel:<channelId>`.
  - Task-linked work uses `task:<taskId>`.
  - Task recovery turn references task memory manifest and marker, not unrelated DM/channel marker.
- Caveat:
  - Current task plan marks provider session-id routing and task completion summarization handoff incomplete, so this scenario is expected to fail or be partial until that work lands.

## Caveats / Not Found

- I did not run a build, tests, dev server, or live browser verification in this read-only review. Findings are based on source, task docs, and existing evidence snapshots.
- I did not edit code, specs, task docs, or evidence files. The only write for this review is this research file under the active task's `research/` directory.
- I did not inspect every route/model/test involved in memory because the requested focus was the product/UI validation surface and the named files. Backend conclusions are limited to `backend/services/memory_api.py` plus existing task evidence.
- No external references were needed; this was an internal repository/task review.
- Current UI does satisfy a first slice of text memory visibility: channel `MEMORY.md` and task `plan.md`/`evidence.md` can be rendered with markers. The gaps above are about meeting the fuller user requirement for prominent outputs, media, task decomposition, promotion/audit, and real recovery after compression.
