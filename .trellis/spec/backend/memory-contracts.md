# Memory Contracts

> Server-owned channel/task/thread/agent memory, proposal audit, scoped runtime context manifests, and agent CLI/API contracts.

---

## Scenario: Server-Owned Scoped Memory

### 1. Scope / Trigger

- Trigger: adding or changing shared memory, task handoff, proposal review, runtime memory context, or `slock memory ...` commands.
- This is a cross-layer contract: database rows -> backend services -> public/agent API -> daemon local proxy -> runtime prompt context -> frontend Channel Memory / Task Recovery UI.
- Channel and task memory are control-plane product primitives. Agent private files and future local projections are not the canonical source for shared channel/task facts.

### 2. Signatures

- Database tables:
  - `memory_entries(server_id, scope_type, scope_id, path, title, entry_kind, content_text, blob_key, file_id, mime_type, size_bytes, content_sha256, version, source_message_id, source_channel_id, source_thread_id, source_task_id, source_path, author_member_id, visibility, metadata, created_at, updated_at, deleted_at)`
  - `memory_proposals(server_id, scope_type, scope_id, path, base_entry_id, base_sha256, proposed_content_text, proposed_blob_key, author_member_id, reason, status, reviewer_member_id, review_note, metadata, created_at, updated_at, resolved_at)`
- Scope types: `agent`, `channel`, `task`, `thread`.
- Public/UI API:
  - `GET /api/v1/memory/scopes/{scopeType}/{scopeId}`
  - `GET /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
  - `PUT /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
  - `POST /api/v1/memory/scopes/{scopeType}/{scopeId}/search`
  - `POST /api/v1/memory/scopes/{scopeType}/{scopeId}/proposals`
  - `GET /api/v1/memory/scopes/{scopeType}/{scopeId}/proposals?status=open|accepted|rejected|superseded`
  - `POST /api/v1/memory/proposals/{proposalId}/accept`
  - `POST /api/v1/memory/proposals/{proposalId}/reject`
  - `DELETE /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
  - `GET /api/v1/channels/{channelName}/memory`
  - `GET /api/v1/tasks/{taskId}/memory`
- Agent API mirrors the scoped memory routes under `/internal/agent-api/memory/...` and adds:
  - `POST /internal/agent-api/memory/context-manifest`
  - `POST /internal/agent-api/tasks/{taskId}/memory/summary`
  - `POST /internal/agent-api/tasks/{taskId}/memory/promote`
- Agent CLI:
  - `slock memory read|search|context|write|propose|proposals|accept-proposal|reject-proposal|delete`
  - `slock task summary`
  - `slock task promote`
- Daemon JSON-RPC forwarding:
  - `daemon/memory.read`
  - `daemon/memory.search`
  - `daemon/memory.context`
  - `daemon/memory.write`
  - `daemon/memory.propose`
  - `daemon/memory.proposals`
  - `daemon/memory.proposal.accept`
  - `daemon/memory.proposal.reject`
  - `daemon/memory.delete`
  - `daemon/task.memory.summary`
  - `daemon/task.memory.promote`

### 3. Contracts

- Memory entries are flat DB records with path-like keys. Do not add durable empty-directory semantics in the first slice.
- `content_sha256` and `version` are server-managed. API/CLI callers may pass `baseSha256` for CAS, but agents should receive actionable conflict instructions rather than being forced to reason about hashes.
- `deleted_at` means soft delete. List/search must exclude deleted entries; audit responses may serialize `deletedAt`.
- Large binary outputs should be represented by `file_id`, `blob_key`, `mime_type`, `size_bytes`, and summary text/metadata. Do not store raw image/video bytes in `content_text`.
- Public/UI memory routes require both public API auth and a current account/session viewer. They must pass that viewer into `resolve_memory_scope(...)`.
- Agent memory routes must pass the authenticated agent member into the same scope resolver.
- Private channel memory is visible only to channel members. Public-channel readability is not write authority.
- Mutations require `ensure_scope_writable(...)` semantics: channel membership/write capability, task creator/assignee, or explicit capability as implemented by the service layer.
- Task memory inherits task visibility, but task-scoped context manifests must not blindly include associated channel memories. Re-resolve the associated channel scope with the current viewer before listing channel snippets; if that check returns `403`, omit channel snippets and preserve permitted task snippets.
- Runtime context manifests are selective:
  - include snippets, path/title/kind, scope, and read-more hints
  - do not include every entry in the scope
  - do not insert raw full `contentText` into prompts
  - skip DM scope by default unless a later spec explicitly changes this
- `memory.*` browser/public events are cache/UI wakeups. They are not runtime-actionable unless explicitly added to the runtime delivery allowlist in `event-delivery-contracts.md`.
- FUSE/macFUSE/WinFsp local projection is a later read/write projection over these APIs, not the source of truth.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Unknown `scopeType` | HTTP 400/CLI failure before forwarding to an unsupported backend path. |
| Private channel non-member reads memory | HTTP 403; no path/title/content leak. |
| Task-visible non-member requests task context manifest for a private-channel task | Task snippets may be returned; associated private channel snippets are omitted. |
| Public channel non-member attempts write/propose/review/delete | HTTP 403 unless explicit write capability exists. |
| `baseSha256` does not match current entry | HTTP 409 `MEMORY_CONFLICT` with re-read/merge/proposal instruction. |
| Accepting a proposal whose baseline changed | HTTP 409 or proposal-safe resolution; do not overwrite silently. |
| Delete succeeds | Entry gets `deleted_at`, version increments, list/search omit it, and `memory.deleted` is emitted. |
| DM runtime delivery | No automatic memory context manifest request by default. |
| Channel/thread/task runtime delivery | Daemon may fetch a selective context manifest and prepend only snippet/read-more context. |
| Memory event reaches daemon event stream | It remains non-actionable runtime noise unless explicitly classified as runtime work. |

### 5. Good/Base/Bad Cases

- Good: a task writes `brief.md`, `plan.md`, `progress.md`, `evidence.md`, and `final-summary.md`; durable conclusions are promoted to channel memory or proposed for review.
- Good: Channel Memory UI groups durable channel knowledge, task outputs, promotions, and open proposals.
- Good: Task Recovery UI shows recovery signals, task breakdown, outputs/evidence, artifact previews, and provenance/hash/version.
- Base: `slock memory write --scope task --id <taskId> --path progress.md` writes through the daemon proxy with write gates enabled.
- Base: `slock memory context --scope channel --id <channelId> --query "runtime session"` returns selective snippets plus read-more commands.
- Bad: reading private channel memory while resolving a task manifest only because the task is visible to the viewer.
- Bad: injecting an entire channel `MEMORY.md` into every runtime prompt.
- Bad: treating `memory.created`, `memory.updated`, or `memory.proposal.*` as runtime work.
- Bad: copying an agent workspace `MEMORY.md` into channel memory without provenance, review, or permission checks.

### 6. Tests Required

- Backend model/service tests:
  - create/update/list/read/search scoped entries
  - CAS conflict with `baseSha256`
  - soft delete exclusion and audit serialization
  - proposal create/accept/reject and changed-baseline handling
  - public/private channel read permissions
  - mutation permissions separate from public read visibility
  - task context manifest omits private-channel snippets for task-visible non-members
- Public API tests:
  - public/UI routes pass the current account viewer into `resolve_memory_scope`
  - explicit memory actor spoofing is rejected
  - channel/task aliases return the same scoped entries as generalized routes
- Agent/daemon tests:
  - CLI commands map to scoped memory endpoints
  - write commands remain behind explicit write gates
  - JSON-RPC forwarding covers read/search/context/write/propose/proposal review/delete/task summary/task promote
  - `memory.*` events are not runtime-actionable
  - DM scope skips automatic memory context; channel/thread/task scopes can request selective manifests
- Frontend/browser tests:
  - Channel Memory shows channel knowledge, task outputs, promotions, and proposals
  - Task Recovery shows brief/plan/progress/output signals and task breakdown
  - Image/video/file artifacts render through typed viewers, not buried markdown
  - Real UI smoke with `./twd` must cross-check visible DOM against API memory rows when the UI depends on persisted memory

### 7. Wrong vs Correct

#### Wrong

```typescript
// Do not blindly attach channel memory to every task prompt.
const channelEntries = await listMemoryEntries(db, server, {
  scope: { type: "channel", id: task.channelId },
})
prompt += channelEntries.map((entry) => entry.contentText).join("\n\n")
```

#### Correct

```typescript
// Resolve every scope through the current viewer and use a selective manifest.
const manifest = await fetchMemoryContextManifest({
  sessionScope: { type: "task", id: taskId },
  query: currentPrompt,
})
prompt = formatRuntimeIncomingMessageWithMemoryContext(message, manifest)
```

#### Wrong

```bash
# Raw full channel memory in every runtime turn.
slock memory read --scope channel --id "$CHANNEL_ID" --path MEMORY.md >> prompt.txt
```

#### Correct

```bash
# Selective snippets plus read-more instructions.
slock memory context --scope channel --id "$CHANNEL_ID" --query "$CURRENT_TASK"
```
