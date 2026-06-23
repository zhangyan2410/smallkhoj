# Research: clowder task evidence and recovery design

- Query: Research sibling project `/Users/code/project/clowder-ai` for task / channel task / task evidence / output visibility / task recovery information, then translate the design to SmallKhoj channel/task memory and scoped sessions.
- Scope: mixed
- Date: 2026-06-23

## Findings

### 1. How clowder-ai makes tasks, state, evidence, artifacts, review, and recovery visible

clowder-ai does not model all work visibility as one "task memory" object. It splits visibility into several read models:

- Durable task identity and status: `TaskItem` and `TaskStore`.
- Live invocation plan/progress: `TaskProgressSnapshot`.
- Searchable project/session evidence: `EvidenceItem` and evidence search routes/tools.
- User-visible outputs: `ThreadArtifactDTO` from rich message blocks, PR tracking tasks, and thread memory artifact ledgers.
- Rolling thread recovery memory: `ThreadMemoryV1`.
- Drill-down session recovery: session chain routes/tools plus sealed transcript digests.
- Review/outcome: review workflow skills for development work, plus structured task outcome/verdict schemas for evaluation domains.

This separation is the main transferable design. SmallKhoj should avoid putting progress, artifacts, durable decisions, and review verdicts into one opaque JSON blob.

#### Durable task state

`packages/shared/src/types/task.ts:21` defines durable task status as `todo | doing | blocked | done`, while `packages/shared/src/types/task.ts:102` defines `TaskItem` with `kind`, `threadId`, `subjectKey`, `title`, `ownerCatId`, `status`, `why`, creator/timestamps, automation state, user ownership, and source pointers. Source traceability is explicit through `sourceMessageId` and `sourceSummaryId` at `packages/shared/src/types/task.ts:124`.

The task API is intentionally small. `packages/api/src/routes/tasks.ts:74` creates a task, broadcasts `task_created`, and returns the task. `packages/api/src/routes/tasks.ts:89` lists tasks by thread. `packages/api/src/routes/tasks.ts:113` patches title/status/owner/why and broadcasts `task_updated`.

The store interface in `packages/api/src/domains/cats/services/stores/ports/TaskStore.ts:77` includes task CRUD plus `getBySubject`, `upsertBySubject`, `listByKind`, and `patchAutomationState`. This gives automated PR/issue tracking a durable task surface without inventing a separate PR queue. `packages/api/src/domains/cats/services/stores/redis/RedisTaskStore.ts:7` documents Redis keys for detail, thread index, kind index, and subject index; `packages/api/src/domains/cats/services/stores/redis/RedisTaskStore.ts:113` implements subject-key upsert with atomic claim/CAS-style retries.

SmallKhoj implication: preserve `Task` as the durable product object, but move task execution notes/evidence/artifacts/review into task-scoped memory/read models instead of overloading `Task.data`.

#### Live execution progress

clowder-ai separately records invocation-level todo progress. `packages/api/src/domains/cats/services/agents/invocation/TaskProgressStore.ts:12` defines `TaskProgressSnapshot` as `{ threadId, catId, tasks, status, updatedAt, lastInvocationId, interruptReason }`. `packages/api/src/domains/cats/services/agents/invocation/RedisTaskProgressStore.ts:31` stores snapshots in Redis hashes with TTL.

The progress source is provider tool calls, not durable task rows. `packages/api/src/domains/cats/services/agents/invocation/invoke-helpers.ts:9` recognizes TodoWrite-style tools, and `packages/api/src/domains/cats/services/agents/invocation/invoke-helpers.ts:21` maps tool input todos to normalized progress items. `packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts:737` persists a running snapshot, and `packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts:764` finalizes it as completed or interrupted. `packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts:2587` emits `task_progress` system_info messages from TodoWrite tool use.

SmallKhoj implication: live per-turn plan state should remain TaskMemory `progress.md` or runtime-session state, not ChannelMemory. ChannelMemory should not receive every transient TodoWrite item.

#### Evidence search and provenance

clowder-ai's evidence layer is richer than SmallKhoj needs, but its shape is instructive. `packages/api/src/domains/memory/interfaces.ts:78` defines `EvidenceItem` with anchor, kind, status, title, summary, keywords, source path/hash, supersession/materialization pointers, updated time, drill-down hints, authority/activation, provenance, source IDs, contradiction/review metadata, ranking details, confidence, and optional raw passages. `packages/api/src/domains/memory/schema.ts:13` creates `evidence_docs`; `packages/api/src/domains/memory/schema.ts:28` adds FTS; `packages/api/src/domains/memory/schema.ts:109` adds passage-level evidence.

The API surfaces evidence as searchable, ranked results. `packages/api/src/routes/evidence.ts:30` accepts query, limit, scope, retrieval mode, depth, dates, thread ID, dimension, collections, explain, active feature IDs, truth source, and recent artifact refs. `packages/api/src/routes/evidence.ts:151` uses `KnowledgeResolver` when available and otherwise falls back to `evidenceStore.search`. `packages/api/src/routes/evidence.ts:197` maps internal evidence items to user-visible results with title, anchor, snippet, confidence, source type, source path, passages, match reason, entity matches, drill-down hints, suggested actions, and ranking factors.

The MCP tool reinforces the intended use. `packages/mcp-server/src/tools/evidence-tools.ts:41` exposes `cat_cafe_search_evidence` with scope/mode/depth filters. `packages/mcp-server/src/tools/evidence-tools.ts:212` prints each hit with confidence, anchor, source type, optional source path, authority, match explanation, drill-down hints, and snippets. `packages/mcp-server/src/tools/evidence-tools.ts:269` reminds agents to read high-confidence source documents instead of relying only on search summaries.

SmallKhoj implication: implement a much smaller evidence read model first: structured task evidence entries with kind, title, file/blob/ref, source message/path, createdBy/createdAt, and human-readable markdown index. Avoid copying clowder's full FTS/vector/experiment graph until there is product need.

#### Artifact and output visibility

clowder-ai makes output artifacts inspectable rather than only mentioned in chat. `packages/shared/src/types/thread-artifact.ts:10` defines artifact types as `image | file | code | pr | audio | video`. `packages/shared/src/types/thread-artifact.ts:12` defines `ThreadArtifactDTO` with type, name, catId, createdAt, sourceMessageId, url, and ref.

The aggregator explicitly combines three sources. `packages/api/src/domains/cats/services/agents/routing/thread-artifacts-aggregator.ts:4` documents the sources: rich message blocks, PR tasks, and `threadMemory.recentArtifacts`. `packages/api/src/domains/cats/services/agents/routing/thread-artifacts-aggregator.ts:94` maps rich blocks to artifacts: media gallery to image, file block to file/video, diff to code, audio to audio. `packages/api/src/domains/cats/services/agents/routing/thread-artifacts-aggregator.ts:133` maps PR tracking tasks to `pr` artifacts. `packages/api/src/domains/cats/services/agents/routing/thread-artifacts-aggregator.ts:150` maps file ledger entries to file artifacts. `packages/api/src/domains/cats/services/agents/routing/thread-artifacts-aggregator.ts:176` aggregates, dedupes by ref, and sorts newest first.

The sealed-session path also feeds artifacts. `packages/api/src/domains/cats/services/agents/routing/artifact-tracking.ts:1` defines `RecentArtifact` with `type`, `ref`, `label`, `updatedAt`, `updatedBy`, and optional ops. `packages/api/src/domains/cats/services/agents/routing/artifact-tracking.ts:38` extracts PR/file artifacts from PR tasks and touched files. `packages/api/src/domains/cats/services/agents/routing/artifact-tracking.ts:75` merges a capped recent-artifact ledger by ref.

Frontend behavior follows the DTO. `packages/web/src/components/ArtifactsPanel.tsx:118` renders a clickable artifact row with type icon, producer/time metadata, optional source-message jump, and optional open URL. `packages/web/src/components/ArtifactsPanel.tsx:224` supports thread/global scope toggles. `packages/web/src/components/ArtifactsPanel.tsx:236` supports search/filter state. `packages/web/src/components/artifacts/artifact-view.ts:28` defines view modes `image | audio | video | pr | text | download | fallback`; `packages/web/src/components/artifacts/artifact-view.ts:71` classifies each artifact into a view mode based on type, URL/ref, and extension; `packages/web/src/components/artifacts/artifact-view.ts:123` decides whether text content comes from a URL or workspace path.

SmallKhoj implication: build a task/channel artifact read model. The read model should render images/videos/files/code/API proofs/reviews through typed viewers and source links, not bury them inside markdown. SmallKhoj already has `FileEntry`; use it for binary assets and keep markdown summaries in memory rows.

#### Rolling thread memory and session recovery

`packages/api/src/domains/cats/services/stores/ports/ThreadStore.ts:54` defines `ThreadMemoryV1` with rolling `summary`, incorporated session count, updatedAt, `decisions`, `openQuestions`, `artifacts`, and `recentArtifacts`. It is explicitly thread-level memory across sealed sessions, not raw transcript storage.

`packages/api/src/domains/cats/services/session/buildThreadMemory.ts:1` documents the merge strategy: convert a sealed-session digest into a session summary line, prepend to existing summary, trim under token budget, merge decisions/open questions/artifacts, and append/dedupe/cap artifact ledger. `packages/api/src/domains/cats/services/session/buildThreadMemory.ts:96` implements `buildThreadMemory`; `packages/api/src/domains/cats/services/session/buildThreadMemory.ts:112` trims oldest lines under token budget; `packages/api/src/domains/cats/services/session/buildThreadMemory.ts:126` builds structured decision/open-question/artifact outputs; `packages/api/src/domains/cats/services/session/buildThreadMemory.ts:157` merges the recent artifact ledger.

Session sealing is a lifecycle state machine. `packages/api/src/domains/cats/services/session/SessionSealer.ts:42` defines `requestSeal`, `finalize`, and stuck-session reconciliation. `packages/api/src/domains/cats/services/session/SessionSealer.ts:90` requests seal through an active to sealing transition. `packages/api/src/domains/cats/services/session/SessionSealer.ts:141` finalizes sealing sessions. `packages/api/src/domains/cats/services/session/SessionSealer.ts:326` flushes transcript/digest. `packages/api/src/domains/cats/services/session/SessionSealer.ts:349` updates `ThreadMemory` from digest, decision signals, and recent artifacts. `packages/api/src/domains/cats/services/session/SessionSealer.ts:383` optionally generates a handoff digest after thread memory.

Bootstrap is bounded and section-aware. `packages/api/src/domains/cats/services/session/SessionBootstrap.ts:6` lists injected context: session identity, previous digest, task snapshot, and recall instructions. `packages/api/src/domains/cats/services/session/SessionBootstrap.ts:23` sanitizes handoff bodies so summaries remain data, not instructions. `packages/api/src/domains/cats/services/session/SessionBootstrap.ts:49` caps bootstrap at 2000 tokens. `packages/api/src/domains/cats/services/session/SessionBootstrap.ts:167` injects thread memory when available. `packages/api/src/domains/cats/services/session/SessionBootstrap.ts:246` injects a task snapshot. `packages/api/src/domains/cats/services/session/SessionBootstrap.ts:262` injects tool recall instructions. `packages/api/src/domains/cats/services/session/SessionBootstrap.ts:284` drops variable sections in priority order under token pressure.

Session chain APIs/tools make recovery drill-down explicit. `packages/api/src/domains/cats/services/stores/ports/SessionChainStore.ts:47` defines the session chain store with create/get/getActive/getChain/getChainByThread/update/getByCliSessionId/getByChainKey/incrementCompressionCount/listSealingSessions. `packages/api/src/routes/session-chain.ts:104` lists sessions by thread/cat with access checks. `packages/api/src/routes/session-chain.ts:148` gets a single session with ownership checks. `packages/api/src/routes/session-chain.ts:177` supports manual unseal/reopen. `packages/mcp-server/src/tools/session-chain-tools.ts:5` exposes list, event read, digest read, invocation detail, and session search. `packages/mcp-server/src/tools/session-chain-tools.ts:326` recommends `handoff` view first, then drill into specific invocations.

SmallKhoj implication: scoped runtime session recovery should have a compact entry point:

- resolve current scope (`dm`, `channel`, `thread`, `task`)
- load task memory when task-scoped
- load short channel summary plus top-k matching channel memories
- expose read/search tools for more
- keep raw events/transcripts behind drill-down APIs/tools
- sanitize summaries as data, not instructions
- cap and drop lower-value sections deterministically

#### Review and outcome visibility

Development review in clowder-ai is workflow-heavy. `cat-cafe-skills/request-review/SKILL.md:24` requires quality gate, green tests, original requirement reference, architecture ownership, browser evidence for frontend changes, and artifact hygiene before requesting review. `cat-cafe-skills/request-review/SKILL.md:81` calls out required review-request fields: original requirements, architecture ownership, open questions, and self-check evidence. `cat-cafe-skills/request-review/SKILL.md:92` stores review requests under `review-notes/YYYY-MM-DD-{topic}-review-request.md`.

`cat-cafe-skills/receive-review/SKILL.md:47` separates code-level from vision-level feedback. `cat-cafe-skills/receive-review/SKILL.md:90` defines READ, CLASSIFY, CLARIFY, VERIFY, AUDIT, FIX, CONFIRM. `cat-cafe-skills/receive-review/SKILL.md:147` requires creating tracking tasks for P1/P2 findings. `cat-cafe-skills/receive-review/SKILL.md:166` requires returning to the feedback source for confirmation. `cat-cafe-skills/receive-review/SKILL.md:204` requires real browser verification for UX/frontend review.

The more transferable structured model appears in task-outcome/eval code. `packages/api/src/infrastructure/harness-eval/task-outcome/task-outcome-episode.ts:14` defines verdict classes: success, corrected_success, needs_investigation, harness_fix_needed, routing_failure, taste_mismatch, abandoned. `packages/api/src/infrastructure/harness-eval/task-outcome/task-outcome-episode.ts:138` defines a `TaskOutcomeEpisode` with episodeId, trigger, threadId, participants, artifacts, signals, terminalState, verdict, and createdAt. `packages/api/src/routes/task-outcome.ts:4` exposes routes to record cancel/A1 signals and read episodes. `packages/mcp-server/src/tools/publish-verdict-tool.ts:91` keeps task-outcome verdict schema in sync and `packages/mcp-server/src/tools/publish-verdict-tool.ts:237` exposes `cat_cafe_publish_verdict`.

SmallKhoj implication: do not keep review only as chat prose or skill artifacts. Add structured review/outcome entries linked to task memory and evidence:

- review state: not_requested, requested, changes_requested, approved, accepted, rejected
- reviewer member ID / runtime source
- decision and severity summary
- source feedback message or external PR/review URL
- evidence/ref links
- updatedAt and covered revision/session/task memory version

### 2. TaskMemory vs ChannelMemory boundary for SmallKhoj

#### Put in TaskMemory

TaskMemory should hold task-scoped facts that explain execution and recovery:

- `brief.md`: source message/thread/task brief and acceptance criteria.
- `plan.md`: durable plan/subtasks at task scope.
- `progress.md`: important execution checkpoints, not every raw runtime event.
- `evidence.md`: human-readable index of structured evidence entries.
- `artifacts.md`: typed references to images/videos/files/code/API proofs/traces.
- `review.md`: requested/approved/changes_requested state and reviewer notes.
- `final-summary.md`: compact completion summary.
- `promotions.md`: what was promoted to channel memory or proposed for promotion.
- runtime/session recovery metadata: current task-scoped runtime session IDs, last digest/handoff refs, latest good context manifest, and continuation notes.

TaskMemory can include transient-ish but recovery-relevant execution information because it answers "how do I resume this task after compaction?" It should be visible in task detail and searchable for that task.

#### Promote to ChannelMemory only when reusable

ChannelMemory should hold durable knowledge useful outside the task:

- channel `MEMORY.md` summary and current operating agreements.
- decisions that are stable and relevant to future tasks.
- references such as canonical project paths, API contracts, external docs, or architectural anchors.
- accepted/published task conclusions, not raw evidence.
- open questions that affect future channel work.
- canonical artifacts or artifact summaries only when the artifact itself is reusable by the channel.
- promotion records/audit entries linking source TaskMemory path to target ChannelMemory path.

ChannelMemory should not contain raw TodoWrite snapshots, noisy activity logs, per-invocation progress, unreviewed evidence dumps, failed trial details, private agent memory, or task-specific review chatter unless summarized into a durable lesson.

#### Promotion rule

Promotion should be explicit:

```text
TaskMemory -> ChannelMemory only when the content is durable, reusable,
safe for the channel audience, and useful outside the task execution history.
```

Promotion should record source task, source path, target channel path, mode (`write` or `proposal`), promotedBy, reason, timestamp, and review/approval status if required.

### 3. Recommended SmallKhoj data fields, API/UI blocks, and agent recovery entry points

SmallKhoj already has these relevant primitives:

- `backend/models/slock.py:259` defines `Task` with channel/task number/message/title/description/status/creator/assignee/data/timestamps.
- `backend/models/slock.py:313` defines append-only `EventRecord` with server seq, type, actor, channel, task, message, and JSON payload.
- `backend/models/slock.py:358` defines `FileEntry` for uploaded files with channel/message/uploader/mime/size/storage path/metadata.
- `backend/services/memory_store.py:22` already has `MemoryScope`.
- `backend/services/memory_store.py:49` already normalizes memory paths safely.
- `backend/services/memory_store.py:68` already models base SHA conflict handling.
- `backend/services/memory_store.py:75` already has scope visibility checks for agent/channel/task/thread.
- `backend/services/memory_store.py:170` already builds a selective retrieval manifest that includes top-k channel/task memory snippets and read-more commands.
- `backend/tests/test_memory_store.py:34` through `backend/tests/test_memory_store.py:110` already express intended contracts for path safety, CAS, private visibility, selective search, and no full channel memory injection.

#### Recommended data model

Use a generalized `memory_entries` row for text memory and blob-backed artifacts:

```text
id
server_id
scope_type          -- channel | task | thread | agent
scope_id
path
title
entry_kind          -- index | decision | reference | plan | progress | evidence | artifact | review | summary | promotion
content_text
blob_key
file_id             -- nullable FK to files for existing FileEntry assets
mime_type
size_bytes
content_sha256
version
source_message_id
source_channel_id
source_thread_id
source_task_id
source_path
author_member_id
visibility          -- inherited | private | channel
metadata
created_at
updated_at
deleted_at
```

Add a partial unique key on `(server_id, scope_type, scope_id, path)` where not deleted. Store markdown/small text in `content_text`. Store image/video/binary in `FileEntry`/blob storage and keep captions/summaries/extracted text in `content_text`.

Use separate structured refs for task evidence/artifacts, either as `entry_kind=evidence/artifact` memory rows or a dedicated read model:

```json
{
  "kind": "screenshot | video | file | code | api_proof | db_proof | trace | review | note",
  "title": "Channel memory panel shows marker",
  "description": "Visible DOM includes the verification marker.",
  "fileId": "optional FileEntry id",
  "blobKey": "optional blob key",
  "path": "optional local task evidence path",
  "url": "optional external URL",
  "sourceMessageId": "optional",
  "sourceTaskMemoryPath": "evidence.md",
  "createdBy": "member id",
  "createdAt": "ISO timestamp",
  "contentSha256": "optional",
  "metadata": {}
}
```

Use structured review/outcome rows or `entry_kind=review` entries:

```json
{
  "state": "not_requested | requested | changes_requested | approved | accepted | rejected",
  "reviewerId": "member id",
  "source": "local | remote | human | agent",
  "decision": "approved",
  "severitySummary": {"p1": 0, "p2": 0, "p3": 1},
  "note": "No blocking findings.",
  "evidenceRefs": ["memory entry id", "file id", "trace id"],
  "coveredTaskRevision": "task updatedAt or content sha",
  "updatedAt": "ISO timestamp"
}
```

Add scoped runtime-session rows/read model:

```text
id
server_id
agent_id
scope_type          -- dm | channel | thread | task
scope_id
provider
provider_session_id
runtime_workspace_id
status              -- active | sealing | sealed | failed | superseded
message_count
context_health
last_digest_memory_entry_id
continuity_capsule_memory_entry_id
last_context_manifest
created_at
updated_at
sealed_at
```

The row should represent logical SmallKhoj session scope, not just a daemon workspace's latest provider session.

#### Recommended API

Memory:

```text
GET    /api/v1/memory/scopes/{scopeType}/{scopeId}
GET    /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}
PUT    /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}
POST   /api/v1/memory/scopes/{scopeType}/{scopeId}/search
POST   /api/v1/memory/scopes/{scopeType}/{scopeId}/proposals
POST   /api/v1/memory/proposals/{proposalId}/accept
POST   /api/v1/memory/proposals/{proposalId}/reject
```

Task-oriented aliases/read models:

```text
GET    /api/v1/tasks/{taskId}/memory
GET    /api/v1/tasks/{taskId}/evidence
POST   /api/v1/tasks/{taskId}/evidence
GET    /api/v1/tasks/{taskId}/artifacts
GET    /api/v1/tasks/{taskId}/review
POST   /api/v1/tasks/{taskId}/review
POST   /api/v1/tasks/{taskId}/memory/promote
GET    /api/v1/channels/{channelId}/memory
GET    /api/v1/channels/{channelId}/artifacts?scope=channel
```

Agent/internal API:

```text
GET    /internal/agent-api/memory/scopes/{scopeType}/{scopeId}
GET    /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/path/{path}
POST   /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/search
PUT    /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/path/{path}
POST   /internal/agent-api/tasks/{taskId}/memory/summary
POST   /internal/agent-api/tasks/{taskId}/memory/promote
GET    /internal/agent-api/runtime-sessions/current?scopeType=task&scopeId={taskId}
GET    /internal/agent-api/runtime-sessions/{sessionId}/digest
```

Event types:

```text
memory.created
memory.updated
memory.deleted
memory.proposal.created
memory.proposal.resolved
task.evidence.created
task.artifact.created
task.review.updated
runtime_session.sealed
```

Per SmallKhoj's event spec, these should be browser/product events by default. They must not become runtime prompts unless explicitly classified as actionable. The existing spec says UI/activity changes should not create runtime noise and unknown event types are non-runtime by default.

#### Recommended UI blocks

Task detail:

- Overview: task number, channel, source message/thread, creator, assignee, status, dates.
- Brief: `brief.md`, acceptance criteria, source context.
- Plan: `plan.md` and current progress/checkpoints.
- Evidence: typed evidence entries with screenshot/video/file/API/DB/trace/review icons and source links.
- Artifacts: image/video/file/code/PR/link previews using `FileEntry` or external refs.
- Review: current review state, reviewer, decision, findings, covered revision, confirmation trail.
- Memory: final summary, promotions, promoted conclusions, task memory paths.
- Activity: existing `ActivityLog` timeline as observability, not the source of truth for task memory.

Channel memory panel:

- `MEMORY.md` summary preview.
- Decisions.
- References.
- Open questions.
- Recent promoted task summaries.
- Recent canonical artifacts.
- Memory proposals and audit.

Task cards/board should remain dense. They should show counts/badges for evidence/artifacts/review, but not inline every detail. SmallKhoj's current `frontend/components/task-board.tsx:45` already has a `TaskEvidence` shape in `Task.data`; `frontend/components/task-board.tsx:394` renders source/evidence/activity in an inline task detail. Treat this as a temporary display path and move durable evidence/artifacts into task memory/read APIs.

#### Recommended agent compression/recovery entry point

At runtime start/resume or after context compaction:

1. Resolve scope:
   - top-level DM -> `dm:<memberId>`
   - channel message -> `channel:<channelId>`
   - thread reply -> `thread:<channelId>:<rootMessageId>`
   - task work -> `task:<taskId>`
2. Load a bounded recovery packet:
   - scope identity and task/channel names
   - task brief/plan/progress/final-summary when task-scoped
   - latest task evidence index and review state
   - short channel summary
   - top-k relevant channel memories based on current prompt/task
   - latest sealed runtime session digest/continuity capsule for the same logical scope
   - explicit tools/commands to read more
3. Do not inject:
   - full channel memory
   - raw event feed
   - full trace logs
   - unrelated DM/channel/task session context
   - live progress snapshots from other tasks
4. Mark memory summaries as reference data, not instructions, following clowder's bootstrap sanitization pattern.

Candidate recovery manifest:

```json
{
  "policy": "selective",
  "sessionScope": {"type": "task", "id": "..."},
  "task": {
    "id": "...",
    "number": 12,
    "briefPath": "brief.md",
    "planPath": "plan.md",
    "progressPath": "progress.md",
    "summaryPath": "final-summary.md",
    "reviewState": "changes_requested"
  },
  "channel": {
    "id": "...",
    "summaryPath": "MEMORY.md"
  },
  "taskMemories": [],
  "channelMemories": [],
  "recentEvidence": [],
  "recentArtifacts": [],
  "runtimeSession": {
    "id": "...",
    "providerSessionId": "...",
    "lastDigestPath": "runtime-sessions/<id>/digest.md"
  },
  "readMore": {
    "task": "slock memory read --scope task --id <task-id> --path <path>",
    "channel": "slock memory search --scope channel --id <channel-id> --query <terms>",
    "sessions": "slock session digest --scope task --id <task-id>"
  }
}
```

### 4. What not to copy from clowder-ai

- Do not copy clowder's full evidence graph/vector/experiment system. SmallKhoj's first need is scoped task/channel memory visibility, not a large knowledge research platform.
- Do not copy Redis task storage or Redis key layout. SmallKhoj is DB-backed with SQLAlchemy/Postgres-shaped models; reuse DB rows, permissions, and public event contracts.
- Do not promote live `TaskProgressSnapshot` into ChannelMemory. That state is invocation-level and should become TaskMemory progress only when summarized.
- Do not copy clowder's backend-owned runtime invocation architecture. SmallKhoj's daemon/control-plane boundary is different, and runtime sessions should be logical scope records around daemon/provider state.
- Do not make workspace/local file paths the source of truth. SmallKhoj's task already says server/control-plane memory rows are canonical; FUSE/local projection is later.
- Do not expose global artifact search/view without privacy scoping. clowder has global artifact views; SmallKhoj private channel/task memory must inherit channel membership.
- Do not keep review only in skill docs or chat messages. Use structured task review/outcome state linked to evidence.
- Do not auto-promote raw evidence or unreviewed task notes to ChannelMemory. Promotion needs explicit audience/safety/reuse criteria.
- Do not copy clowder's cat/persona language or UI style. SmallKhoj should stay a calm cyan/blue operational workspace per frontend spec.
- Do not let memory update events reach runtimes by default. SmallKhoj's event-delivery spec requires UI-only/activity events to stay out of runtime prompt delivery unless explicitly classified.

## Files Found

### SmallKhoj context

- `.trellis/workflow.md` — Trellis workflow and research persistence contract.
- `.trellis/spec/backend/index.md` — backend spec index.
- `.trellis/spec/backend/database-guidelines.md` — DB/task-number concurrency and read-only evidence query conventions.
- `.trellis/spec/backend/event-delivery-contracts.md` — runtime/actionable vs UI-only event contract.
- `.trellis/spec/frontend/index.md` — frontend spec index.
- `.trellis/spec/frontend/product-ui-style.md` — product UI conventions and evidence expectations.
- `.trellis/spec/frontend/state-management.md` — placeholder state-management guide.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — cross-layer data-flow and contract guidance.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/prd.md` — task goal and memory/session requirements.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md` — current SmallKhoj design proposal for memory entries, API, scoped sessions.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md` — implementation slices and explicit request to study clowder-ai task/evidence lessons.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/research/clowder-product-reference.md` — prior product-level clowder notes.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/research/memory-fuse-reference.md` — prior memory-fuse reference notes.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/research/validation-plan.md` — planned validation matrix for this task.
- `backend/models/slock.py` — SmallKhoj Server/Channel/Message/ThreadSummary/Task/ActivityLog/EventRecord/FileEntry models.
- `backend/services/memory_store.py` — current helper contracts for memory scope/path/CAS/search/context manifest.
- `backend/routers/public_api.py` — frontend-facing task/file/event APIs.
- `backend/routers/agent_api.py` — daemon/agent task/file/event APIs.
- `frontend/components/task-board.tsx` — current task board and inline evidence display.
- `backend/tests/test_memory_store.py` — current tests describing memory helper expectations.

### clowder-ai task/state/evidence/output/recovery paths

- `packages/shared/src/types/task.ts` — durable task type, status, kind, source pointers, automation state.
- `packages/api/src/routes/tasks.ts` — task CRUD API and thread broadcasts.
- `packages/api/src/domains/cats/services/stores/ports/TaskStore.ts` — task store interface and in-memory implementation.
- `packages/api/src/domains/cats/services/stores/redis/RedisTaskStore.ts` — Redis-backed durable task store and subject-key upsert.
- `packages/api/src/domains/cats/services/agents/invocation/TaskProgressStore.ts` — live task progress snapshot type.
- `packages/api/src/domains/cats/services/agents/invocation/RedisTaskProgressStore.ts` — Redis-backed progress snapshot storage.
- `packages/api/src/domains/cats/services/agents/invocation/invoke-helpers.ts` — TodoWrite/tool progress extraction and resume failure classification helpers.
- `packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts` — invocation pipeline, progress snapshot persistence, session recovery hooks.
- `packages/api/src/domains/memory/interfaces.ts` — evidence item/search/provenance interfaces.
- `packages/api/src/domains/memory/schema.ts` — SQLite evidence schema, FTS, passages, task ledger.
- `packages/api/src/routes/evidence.ts` — evidence search API and ranked response mapping.
- `packages/mcp-server/src/tools/evidence-tools.ts` — agent-facing evidence search MCP tool.
- `packages/shared/src/types/thread-artifact.ts` — thread/global artifact DTOs.
- `packages/api/src/domains/cats/services/agents/routing/thread-artifacts-aggregator.ts` — artifact aggregation from rich blocks, PR tasks, and thread memory ledger.
- `packages/api/src/domains/cats/services/agents/routing/artifact-tracking.ts` — recent artifact extraction and ledger merge.
- `packages/web/src/components/ArtifactsPanel.tsx` — artifact list, filters, source jump, open/select behavior.
- `packages/web/src/components/artifacts/artifact-view.ts` — artifact type to viewer classification and content-source resolution.
- `packages/api/src/domains/cats/services/stores/ports/ThreadStore.ts` — thread model, `ThreadMemoryV1`, pending continuation fields.
- `packages/api/src/domains/cats/services/session/buildThreadMemory.ts` — rolling thread memory merge and artifact ledger update.
- `packages/api/src/domains/cats/services/session/SessionSealer.ts` — active/sealing/sealed lifecycle, digest/thread memory/handoff update.
- `packages/api/src/domains/cats/services/session/SessionBootstrap.ts` — bounded bootstrap context, thread memory, task snapshot, recall tools.
- `packages/api/src/domains/cats/services/stores/ports/SessionChainStore.ts` — session chain records and lookup/update interface.
- `packages/api/src/routes/session-chain.ts` — session chain API and access checks.
- `packages/mcp-server/src/tools/session-chain-tools.ts` — list/read/search session recovery tools.
- `cat-cafe-skills/request-review/SKILL.md` — review request prerequisites, evidence expectations, review-note output.
- `cat-cafe-skills/receive-review/SKILL.md` — review feedback classification, red/green, confirmation, frontend evidence expectations.
- `packages/api/src/infrastructure/harness-eval/task-outcome/task-outcome-episode.ts` — structured task outcome episode/verdict schema.
- `packages/api/src/routes/task-outcome.ts` — task outcome signal and episode API.
- `packages/mcp-server/src/tools/publish-verdict-tool.ts` — structured verdict publishing MCP tool.

## Code Patterns

- Durable task is small and status-oriented: `TaskItem` fields at `packages/shared/src/types/task.ts:102`.
- Task source traceability is explicit: `sourceMessageId`/`sourceSummaryId` at `packages/shared/src/types/task.ts:124`.
- Task route broadcasts product events after create/update: `packages/api/src/routes/tasks.ts:82` and `packages/api/src/routes/tasks.ts:128`.
- Store-level subject upsert prevents duplicate tracking work: `packages/api/src/domains/cats/services/stores/ports/TaskStore.ts:88` and `packages/api/src/domains/cats/services/stores/redis/RedisTaskStore.ts:125`.
- Invocation progress is extracted from TodoWrite tool use: `packages/api/src/domains/cats/services/agents/invocation/invoke-helpers.ts:21`.
- Invocation progress is persisted as a separate live snapshot: `packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts:737`.
- Evidence search separates summary results from source drill-down: `packages/api/src/routes/evidence.ts:197` and `packages/mcp-server/src/tools/evidence-tools.ts:269`.
- Artifacts are a typed DTO, not raw markdown: `packages/shared/src/types/thread-artifact.ts:12`.
- Artifacts aggregate from multiple sources and dedupe by ref: `packages/api/src/domains/cats/services/agents/routing/thread-artifacts-aggregator.ts:176`.
- Artifact UI supports click-to-inspect and source-message jump: `packages/web/src/components/ArtifactsPanel.tsx:140` and `packages/web/src/components/ArtifactsPanel.tsx:173`.
- Artifact viewer classification is type/source-aware: `packages/web/src/components/artifacts/artifact-view.ts:71`.
- Rolling thread memory is compact, structured, and capped: `packages/api/src/domains/cats/services/session/buildThreadMemory.ts:96`.
- Session sealing turns raw execution into digests/thread memory/artifacts: `packages/api/src/domains/cats/services/session/SessionSealer.ts:326` and `packages/api/src/domains/cats/services/session/SessionSealer.ts:349`.
- Bootstrap injects bounded summaries and tool entry points, not raw everything: `packages/api/src/domains/cats/services/session/SessionBootstrap.ts:262` and `packages/api/src/domains/cats/services/session/SessionBootstrap.ts:284`.
- Recovery tools encourage overview first, then detail: `packages/mcp-server/src/tools/session-chain-tools.ts:326`.
- Review workflow requires self-check evidence and original requirements before review: `cat-cafe-skills/request-review/SKILL.md:24`.
- Review feedback becomes tracked fix work for P1/P2: `cat-cafe-skills/receive-review/SKILL.md:147`.
- Structured task outcome episode carries artifacts, signals, terminal state, and verdict: `packages/api/src/infrastructure/harness-eval/task-outcome/task-outcome-episode.ts:138`.
- SmallKhoj current `Task.data` is already used for source/evidence but is not enough as a durable evidence store: `frontend/components/task-board.tsx:83` and `frontend/components/task-board.tsx:394`.
- SmallKhoj current memory helper already encodes safe paths, CAS, visibility, search, and selective retrieval: `backend/services/memory_store.py:49`, `backend/services/memory_store.py:68`, `backend/services/memory_store.py:75`, and `backend/services/memory_store.py:170`.

## External References

- No external web references were used. This research is grounded in local repository inspection of SmallKhoj and `/Users/code/project/clowder-ai`.
- Runtime/library versions were not investigated because the requested output is product/code design transfer, not dependency migration.

## Related Specs

- `.trellis/spec/backend/event-delivery-contracts.md`: new memory/evidence/review events should be browser-safe and non-runtime-actionable by default.
- `.trellis/spec/backend/database-guidelines.md`: task creation and task-number allocation should follow existing DB/retry conventions; observation/evidence queries must stay read-only.
- `.trellis/spec/frontend/product-ui-style.md`: task/channel memory surfaces should be dense operational UI with visible evidence, not marketing or raw logs.
- `.trellis/spec/guides/cross-layer-thinking-guide.md`: memory/evidence/review spans DB, API, daemon/CLI, runtime context, and UI, so contracts must be explicit at every boundary.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/prd.md`: server-owned memory, task memory, channel promotion, scoped sessions, retrieval policy, and FUSE-as-later-projection.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/design.md`: existing proposed memory entry fields, API shape, event policy, runtime session scope, and UI sections.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/task-plan.md`: this research completes the explicit clowder-ai task/evidence reference item.

## Caveats / Not Found

- CodeGraph was not used because this worktree did not have an initialized CodeGraph index during the prior pass; discovery used `rg`, `find`, and direct file reads.
- The research is source-inspection only. No clowder-ai services, SmallKhoj services, tests, or browser flows were run for this file.
- clowder-ai has broad evidence/knowledge/eval infrastructure. The recommendations intentionally narrow it to SmallKhoj's current memory/session task and should not be treated as a full clowder architecture clone.
- SmallKhoj currently has `backend/services/memory_store.py` and `backend/tests/test_memory_store.py`, but this research did not verify whether DB models/routes for `memory_entries` already exist elsewhere. The inspected code suggests helper/test contracts exist, while full persistence/API integration remains task work.
- clowder-ai's global artifact view is useful as a UX reference but risky for SmallKhoj private channels unless every artifact query enforces channel/task membership.
- clowder-ai review skills are procedural documents, not a durable product store by themselves. SmallKhoj should persist structured review outcomes instead of relying on skill-generated markdown alone.
