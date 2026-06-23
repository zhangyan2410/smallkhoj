# Clowder Product Reference Notes

Reference project: `/Users/code/project/clowder-ai`

Reviewed paths:

- `docs/features/F049-mission-control-backlog-center.md`
- `docs/features/F058-mission-control-enhancements.md`
- `docs/features/F160-task-board-upgrade.md`
- `docs/features/F232-thread-artifacts-panel.md`
- existing SmallKhoj prior note: `.trellis/tasks/06-19-channel-task-workspace-optimization/clowder-evaluation.md`

This note is a focused product-design extraction. It does not copy Clowder's runtime ownership architecture.

## Product Lessons

### 1. Split Task Levels Explicitly

Clowder's F160 names a three-layer task architecture:

| Layer | Scope | Purpose |
| --- | --- | --- |
| Mission Hub | project/feature/global | what should be worked on, approval, dispatch, backlog |
| Thread task board | thread-level persistent work | durable tasks inside a conversation/work room |
| Invocation plan board | single agent call | transient execution plan; disappears after invocation |

SmallKhoj should use the same separation but with Slock terms:

| SmallKhoj Layer | Scope | Store |
| --- | --- | --- |
| Product task / channel task | channel/task | `Task` + `TaskMemory` |
| Runtime turn plan | runtime session turn | context manifest/runtime local state |
| Channel memory | channel durable knowledge | `ChannelMemory` |
| Agent private memory | agent workspace | local private memory |

Do not put invocation-level scratch plans into durable channel memory. Do persist task plans/evidence/final summaries when the task should be recoverable after compaction.

### 2. Persistent Tasks Need Protocol And UI, Not Only Storage

F160's diagnosis is directly relevant: persistent task boards fail when the agent does not know the capability exists and the UI hides the task surface.

SmallKhoj implications:

- Add `slock memory` / `slock task memory` commands to the runtime prompt only after CLI + proxy + backend tests exist.
- Make task memory visible in task detail, not only accessible through API.
- Seed task `brief.md` / `plan.md` so agents have a standard place to write useful recovery state.
- Show empty states that teach where task plan/evidence/final summary will appear.

### 3. Backlog/Dispatch Must Be Auditable

F049/F058 emphasize suggestion, approval, dispatch, lease, status transitions, and audit. SmallKhoj does not need to copy Redis/Lua, but should preserve the product idea:

- task creation captures source and why
- assignment/claim/status changes remain auditable through `ActivityLog`/`EventRecord`
- review decisions are first-class entries, not just chat prose
- promotion from task memory to channel memory records who promoted what and why

### 4. Evidence Must Be Clickable And Inspectable

F232's strongest lesson: an artifacts panel is valuable only when clicking an artifact opens the content. Listing file names is not enough.

SmallKhoj task/channel memory should therefore distinguish:

- memory text: markdown summaries, decisions, plans
- artifact reference: image/video/file/API proof/trace pointer
- renderer intent: image preview, video player, markdown viewer, JSON/API proof, trace log, external link

Task detail should render images/videos/files through real assets, not bury them in markdown-only notes.

### 5. Overview And Detail Should Be Separate

Clowder keeps overview scan surfaces separate from detail surfaces:

- overview: counters, statuses, grouped lists
- detail: plan, why, evidence, review, source links, artifacts

SmallKhoj implication:

- task cards stay dense and scannable
- task detail owns `brief`, `plan`, `progress`, `evidence`, `final-summary`, `promotions`
- channel side rail shows summary and recent updates, not every full memory body

### 6. Recovery Needs Stable Anchors

Clowder's feature docs repeatedly connect tasks, threads, PRs, artifacts, and review gates with stable IDs and evidence paths. SmallKhoj should do the same through task memory:

```text
Task detail recovery anchors:
  source channel/message/thread
  task brief
  subtasks / plan
  progress log
  evidence index
  final summary
  promoted channel conclusions
  review decision
```

This is exactly what an agent should read after context compaction before resuming a task.

## Suggested SmallKhoj Task Memory Contract

### Required Paths

Every non-trivial task should have these logical memory entries:

```text
brief.md
plan.md
progress.md
evidence.md
final-summary.md
promotions.md
```

`brief.md` should be seeded at task creation. `final-summary.md` should be required before human/supervisor marks done.

### Task Evidence Entry

Represent evidence as structured metadata plus a human-readable markdown index:

```json
{
  "kind": "screenshot | video | file | api_proof | db_proof | trace | review | note",
  "title": "Channel memory panel shows marker",
  "description": "Visible DOM includes REAL_channel_memory...",
  "fileId": "optional FileEntry id",
  "blobKey": "optional blob storage key",
  "path": "optional local task evidence path",
  "url": "optional external URL",
  "sourceMessageId": "optional",
  "createdBy": "member id",
  "createdAt": "iso timestamp",
  "contentSha256": "optional"
}
```

`evidence.md` should be a readable index that links to those structured entries.

### Review Entry

Review should not live only as a chat message:

```json
{
  "state": "not_requested | requested | changes_requested | approved | accepted",
  "reviewerId": "member id",
  "decision": "approved",
  "note": "No P1/P2 findings",
  "evidencePath": "review-notes/...",
  "updatedAt": "iso timestamp"
}
```

### Promotion Entry

Promotion from task to channel memory:

```json
{
  "sourceTaskId": "...",
  "sourceTaskMemoryPath": "final-summary.md",
  "targetChannelMemoryPath": "decisions/channel-memory.md",
  "mode": "write | proposal",
  "reason": "Reusable durable decision",
  "promotedBy": "member id",
  "createdAt": "iso timestamp"
}
```

## Suggested UI Sections

### Channel Memory Rail

- `MEMORY.md` summary preview
- Decisions
- References
- Recent updates
- Active/recent task summaries
- Recent evidence/artifacts
- Open memory proposals

### Task Detail

- Source: channel/message/thread
- Brief
- Subtasks/plan
- Progress
- Evidence/artifacts with previews
- Review state
- Final summary
- Promoted conclusions
- Recent activity

### Artifact Rendering

Borrow F232's "click to inspect" rule:

- image -> inline preview
- video -> video controls
- markdown/text -> content renderer
- JSON/API proof -> formatted JSON/text panel
- trace -> trace summary panel/link
- PR/link -> external link plus summary

## What Not To Copy

- Do not copy Clowder's cat/persona vocabulary into SmallKhoj UI.
- Do not copy backend-owned runtime spawning; SmallKhoj's daemon remains execution boundary.
- Do not introduce a separate Mission Hub unless SmallKhoj's channel/task surfaces prove insufficient.
- Do not make artifact lists non-clickable; that was explicitly called out as insufficient in Clowder's F232 dogfood.
- Do not mix task levels: channel/task memory is durable, runtime plan state is transient unless explicitly summarized.

## Immediate Implementation Implications

1. Backend task serialization should include memory summary counts and paths.
2. Task detail API should return task memory entries, evidence entries, source message, recent activity, and review state.
3. Frontend task detail should render evidence/artifact entries with type-specific viewers.
4. Agent prompt/CLI should make task memory commands discoverable once implemented.
5. Final task completion should require a compact summary suitable for recovery.
