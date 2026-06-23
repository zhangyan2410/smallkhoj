# Channel Memory Store and Scoped Runtime Sessions Design

## Design Position

SmallKhoj should treat channel/task memory as a control-plane product primitive, not as files that happen to exist in one agent workspace.

The winning boundary is:

```text
FastAPI backend + DB/blob store = source of truth
daemon / slock CLI = authenticated agent interface and conflict translator
frontend = visibility, review, evidence, proposals
future FUSE/macFUSE/WinFsp = local projection only
runtime provider session = transient execution context
```

This design intentionally learns from:

- `/Users/code/project/agent-platform/memory-fuse`: server-owned flat path records, synthesized tree, sha/CAS, cache invalidation, projection caveats.
- `/Users/code/project/clowder-ai`: richer task/work visibility, evidence-first task detail, runtime/session observability next to the work room.

It does not copy:

- `memory-fuse` as the first implementation layer.
- Clowder's backend-owned runtime/service architecture.
- agent private `MEMORY.md` as canonical channel knowledge.

## Product Model

### Memory Scopes

| Scope | Owner | Purpose | Canonical? | Examples |
| --- | --- | --- | --- | --- |
| `agent` | individual agent/workspace | private preferences, local recovery, self notes | No for shared channel facts | `agent/MEMORY.md` |
| `channel` | server/control-plane | durable shared channel knowledge | Yes for channel decisions/references | `MEMORY.md`, `decisions/*.md`, `references/*.md` |
| `task` | server/control-plane | execution notes, plan, evidence, final summary | Yes for task history | `plan.md`, `evidence.md`, `summary.md` |
| `thread` | server/control-plane | long thread summaries before/without task conversion | Sometimes | `threads/<root>/summary.md` |
| `runtime_session` | provider/daemon | transient conversation state | No | Claude/Codex session id |

Promotion is explicit:

```text
task memory can be promoted to channel memory only when it is durable, reusable,
safe for the channel audience, and useful outside the task execution history.
```

### Path Conventions

Paths are product affordances over flat DB rows:

```text
channel:
  MEMORY.md
  decisions/channel-memory.md
  references/smallkhoj-project-paths.md
  tasks/<task-id>/summary.md

task:
  brief.md
  plan.md
  progress.md
  evidence.md
  final-summary.md
  artifacts/<artifact-id>.md
```

No durable empty directories in the first slice. The UI may show implied folders derived from path prefixes.

## Data Model

### `memory_entries`

```text
id UUID PK
server_id UUID NOT NULL
scope_type VARCHAR(20) NOT NULL       -- channel | task | thread | agent
scope_id UUID NOT NULL
path TEXT NOT NULL
title TEXT
content_text TEXT
blob_key TEXT
mime_type VARCHAR(120)
size_bytes BIGINT NOT NULL DEFAULT 0
content_sha256 VARCHAR(64) NOT NULL
version INTEGER NOT NULL DEFAULT 1
source_message_id UUID NULL
source_channel_id UUID NULL
source_thread_id UUID NULL
source_task_id UUID NULL
source_path TEXT NULL
author_member_id UUID NULL
metadata JSONB NOT NULL DEFAULT '{}'
created_at TIMESTAMP NOT NULL
updated_at TIMESTAMP NOT NULL
deleted_at TIMESTAMP NULL

UNIQUE(server_id, scope_type, scope_id, path) WHERE deleted_at IS NULL
INDEX(server_id, scope_type, scope_id, updated_at DESC)
INDEX(server_id, source_message_id) WHERE source_message_id IS NOT NULL
INDEX(server_id, source_task_id) WHERE source_task_id IS NOT NULL
```

`content_sha256` is computed from `content_text` or blob bytes. For blob-backed entries, `content_text` should contain a summary/caption/extracted text when available, not raw binary.

### `memory_proposals`

Use proposals for high-value or contested updates, especially channel `MEMORY.md` and durable decisions.

```text
id UUID PK
server_id UUID NOT NULL
scope_type VARCHAR(20) NOT NULL
scope_id UUID NOT NULL
path TEXT NOT NULL
base_entry_id UUID NULL
base_sha256 VARCHAR(64) NULL
proposed_content_text TEXT
proposed_blob_key TEXT NULL
author_member_id UUID NOT NULL
reason TEXT NULL
status VARCHAR(20) NOT NULL            -- open | accepted | rejected | superseded
reviewer_member_id UUID NULL
review_note TEXT NULL
created_at TIMESTAMP NOT NULL
updated_at TIMESTAMP NOT NULL
resolved_at TIMESTAMP NULL
```

### Task Data Compatibility

Existing `Task.data` can continue to carry quick UI metadata, but it should stop being the only place for execution evidence.

Recommended `Task.data` shape:

```json
{
  "source": {
    "messageId": "...",
    "messageShortId": "...",
    "threadId": "...",
    "channel": "#window"
  },
  "memory": {
    "scope": "task",
    "summaryPath": "final-summary.md",
    "planPath": "plan.md",
    "evidencePath": "evidence.md"
  },
  "review": {
    "state": "pending_review",
    "decision": null,
    "reviewerId": null,
    "updatedAt": "..."
  }
}
```

The task detail API should join task memory entries, source message, files, and recent activity rather than requiring the frontend to infer all context from `Task.data`.

## Permission Rules

Channel memory:

- public channel: authenticated server members may read if the channel is public; writes require membership or explicit capability.
- private channel: only channel members may read/search/list/write/propose.
- leaving a private channel revokes future access.
- DM memory is treated as private channel memory with DM participants only.

Task memory:

- task memory inherits visibility from the task's channel.
- assigned agent, creator, and channel members can read when they can see the task.
- writes are allowed for assigned agent, creator/supervisor, or explicit capability.
- promotion to channel memory requires channel write capability or creates a proposal.

Agent private memory:

- not exposed through channel memory routes.
- can be projected later under `.smallkhoj/agent/`, but not mixed with shared scope search by default.

## API Surface

Prefer a generalized internal service with scoped public/agent routes.

### Public/UI API

```text
GET    /api/v1/memory/scopes/{scopeType}/{scopeId}
GET    /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}
PUT    /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}
POST   /api/v1/memory/scopes/{scopeType}/{scopeId}/search
POST   /api/v1/memory/scopes/{scopeType}/{scopeId}/proposals
POST   /api/v1/memory/proposals/{proposalId}/accept
POST   /api/v1/memory/proposals/{proposalId}/reject
```

Convenience aliases:

```text
GET    /api/v1/channels/{channel}/memory
GET    /api/v1/tasks/{taskId}/memory
```

Write body:

```json
{
  "title": "Channel memory decision",
  "contentText": "...",
  "baseSha256": "optional current sha",
  "sourceMessageId": "optional",
  "sourcePath": "optional pasted local path",
  "metadata": {
    "kind": "decision",
    "tags": ["memory", "runtime"]
  }
}
```

Conflict response:

```json
{
  "detail": "Memory changed since you read it.",
  "code": "MEMORY_CONFLICT",
  "currentSha256": "...",
  "instruction": "Re-read the memory, merge your update, then retry or create a proposal."
}
```

### Agent API

```text
GET    /internal/agent-api/memory/scopes/{scopeType}/{scopeId}
GET    /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/path/{path}
POST   /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/search
PUT    /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/path/{path}
POST   /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/proposals
GET    /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/proposals
POST   /internal/agent-api/memory/proposals/{proposalId}/accept
POST   /internal/agent-api/memory/proposals/{proposalId}/reject
DELETE /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/path/{path}
POST   /internal/agent-api/tasks/{taskId}/memory/summary
POST   /internal/agent-api/tasks/{taskId}/memory/promote
```

The daemon proxy maps local runtime paths:

```text
slock memory read --scope channel --id <channel-id-or-name> --path MEMORY.md
slock memory search --scope channel --id <channel> --query "runtime session"
slock memory write --scope task --id <task-id> --path progress.md < body.md
slock memory propose --scope channel --id <channel> --path decisions/foo.md --reason "..."
slock memory proposals --scope channel --id <channel> --status open
slock memory accept-proposal --id <proposal-id> --note "durable decision"
slock memory reject-proposal --id <proposal-id> --note "keep task-local"
slock memory delete --scope task --id <task-id> --path progress/obsolete.md
```

Write commands stay behind the existing `SLOCK_ALLOW_WRITES=1` / allowlist gate.

## Events and Invalidation

Add browser-safe public events:

```text
memory.created
memory.updated
memory.deleted
memory.proposal.created
memory.proposal.resolved
```

Scope rules:

- channel memory event scope: `{kind:"channel", id:<channelId>, name:<channelName>}`
- task memory event scope: `{kind:"task", id:<taskId>}`
- proposal events follow the affected memory scope

Runtime delivery rule:

- memory events are not runtime-actionable by default.
- runtimes learn memory through explicit `slock memory read/search` or selective context manifests.
- do not add `memory.*` to daemon runtime actionable event allowlists unless a future spec defines targeted memory work.

## Scoped Runtime Sessions

Current daemon runtime instances are keyed primarily by agent. This creates context pollution when one agent handles unrelated DMs, channels, threads, and tasks.

Introduce logical `RuntimeSessionScope`:

```text
dm:<peer-member-id>
channel:<channel-id>
thread:<channel-id>:<root-message-id>
task:<task-id>
```

### Scope Selection

| Incoming work | Session scope |
| --- | --- |
| top-level DM | `dm:<peer-member-id>` |
| top-level public/private channel message | `channel:<channel-id>` |
| thread reply | `thread:<channel-id>:<root-message-id>` |
| assigned task work | `task:<task-id>` |
| task thread/review message | `task:<task-id>` when source links to a task, otherwise thread scope |

Task scope wins over thread scope when a message/event is task-linked.

### Provider Session Mapping

Daemon keeps provider session ids per logical scope:

```text
agent_id
runtime_workspace_id
scope_key
provider_session_id
status
last_used_at
summary_memory_entry_id
```

First implementation can be in daemon memory with heartbeat projection; durable DB table can follow once behavior is stable. Do not spawn a new physical runtime per scope by default. Reuse the same runtime process when needed, but route provider `session_id`/resume id by scope where the provider supports it.

### Session Compaction

When a task reaches review/done:

1. create/update task `final-summary.md`
2. append evidence pointers to task `evidence.md`
3. create channel memory proposal for durable conclusions
4. mark the scoped runtime session resumable from task memory, not raw provider history

This lets future agents recover from task/channel memory without depending on one provider's giant session transcript.

## Retrieval and Attention Control

Do not inject all channel memory.

Context manifest per turn:

```text
stable prefix:
  Slock runtime instructions
  safety and reply-target rules

session/task variable:
  session scope key
  short channel summary
  task brief when task-scoped
  top-k relevant channel memory snippets
  top-k task memory snippets
  commands for further read/search

message variable:
  current event/message/task envelope
```

Recommended defaults:

- channel scope: channel `MEMORY.md` short summary + top 3 relevant memories
- task scope: task `brief.md`, `plan.md`, latest `progress.md`, evidence index + top 2 channel memories
- DM scope: no channel memory unless explicitly referenced or authorized
- thread scope: thread summary + relevant channel memory snippets

All injected blocks should be represented as a future `ContextManifest` block so the operator can inspect what an agent saw.

## Task and Channel UI

### Task Levels

Borrow the task-level separation from Clowder, adapted to SmallKhoj:

| Level | SmallKhoj Surface | Memory Rule |
| --- | --- | --- |
| Channel/product task | `Task` in a channel/DM | Durable task memory is allowed and expected. |
| Runtime turn plan | provider/session execution | Transient unless summarized into task memory. |
| Channel knowledge | channel memory | Only durable reusable conclusions, not every task scratch note. |
| Agent private notes | agent workspace | Private recovery/preferences, never canonical channel truth. |

This prevents a one-line task from turning into an opaque chat-only execution. The task itself becomes the recovery object.

### Channel Surface

Add a memory/work rail or tab with:

- Channel `MEMORY.md` summary
- Decisions list
- References list
- Recent memory updates
- Active task summaries
- Evidence/artifacts from recent tasks
- Agent roster with runtime readiness and current scoped work

The UI should make the channel feel like a shared work room, not only a message list.

### Task Detail

Task detail should show:

- source message/thread link
- structured brief
- plan / subtasks
- progress notes
- evidence entries
- images/videos/files/artifacts
- API/DB/trace proof pointers
- review state and reviewer notes
- promoted conclusions
- compact final summary

Task card remains scan-focused; task detail owns the deeper work record.

Recommended task memory paths:

```text
brief.md
plan.md
progress.md
evidence.md
final-summary.md
promotions.md
```

Evidence entries should support:

```text
kind: screenshot | video | file | api_proof | db_proof | trace | review | note
title
description
file_id / blob_key / path / url
source_message_id
created_by
created_at
```

Images/videos should be visible in task detail as real assets, not hidden in a text-only note. Large assets use `FileEntry`/blob storage; memory stores captions, hashes, and references.

Artifact rendering rule:

| Kind | Detail behavior |
| --- | --- |
| image | inline preview |
| video | inline player with controls |
| markdown/text | content renderer |
| JSON/API proof | formatted JSON/text proof panel |
| trace | trace summary/link |
| PR/external link | link plus summary/provenance |

Do not ship a task/channel artifact list that only shows names. The operator should be able to click an output and inspect it.

### Review and Promotion

Review state is task memory, not only a chat message. Store:

```text
review.state
review.reviewer_id
review.decision
review.note
review.evidence_path
review.updated_at
```

Promotion from task memory to channel memory must store:

```text
source_task_id
source_task_memory_path
target_channel_memory_path
mode: write | proposal
reason
promoted_by
created_at
```

This keeps channel memory curated while still making task work recoverable.

## Implementation Slices

### Slice A: Design + Contracts

- Complete reference research.
- Finalize DB/API/session/retrieval/UI contracts.
- Add red tests for memory path normalization, permission, CAS, selective retrieval, CLI mapping, session scope selection.

### Slice B: Backend Memory Store

- Add `MemoryEntry` and `MemoryProposal` models/startup migration.
- Add service-layer permission and CAS helpers.
- Add public/agent scoped memory routes.
- Emit `memory.*` public events after commit.

### Slice C: Agent CLI and Daemon Scope

- Add `slock memory read/search/write/propose`.
- Proxy routes to agent API.
- Add session-scope selector and provider session id map.
- Annotate delivered runtime messages with scope key and memory manifest summary.

### Slice D: Task Memory and Promotion

- Task creation seeds `brief.md`.
- Task update/detail surfaces task memory.
- Task completion/review writes `final-summary.md`.
- Promotion creates channel memory entry or proposal.

### Slice E: Frontend Visibility

- Channel memory panel/rail.
- Task detail memory/evidence sections.
- Render image/video/file artifact entries through existing file surface when available.
- Show memory update/proposal audit affordances.

### Slice F: Verification

- Backend tests: permissions, CAS, private channel leakage, search/list/read/write.
- Daemon tests: CLI mapping, write gates, scope selection, provider session map.
- Frontend build/lint and browser evidence with `./twd`.
- Runtime trace evidence only when runtime delivery/session routing is part of the tested slice.

## First Implementation Decision

Implement storage/API/CLI/UI visibility before local projection. The first visible user value is:

```text
agents and humans can record, search, inspect, and promote shared channel/task knowledge,
and task detail becomes a recoverable execution record with evidence.
```

FUSE projection is valuable but should wait until server-owned memory semantics are proven.
