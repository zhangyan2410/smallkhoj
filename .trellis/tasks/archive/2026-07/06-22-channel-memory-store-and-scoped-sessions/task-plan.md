# Task Plan

## Current Design Decision

This task is no longer a design-only spike.

The implementation should deliver a real first slice:

1. Server-owned channel/task memory rows.
2. Permission-safe scoped read/list/search/write/propose routes.
3. Agent-facing `slock memory ...` commands.
4. Logical runtime session scope selection for DM/channel/thread/task.
5. Task and channel UI visibility for memory, evidence, artifacts, and recoverable summaries.

FUSE/macFUSE/WinFsp stays a later projection after the API contract is stable.

## Operator-Reported Regressions 2026-06-23

- [x] Runtime delivery isolation: DM and channel agent runtime sessions are still not separated correctly. When a task is explicitly claimed by `kimi`, `minimax` can still receive the related message/work, so task assignment and runtime delivery targeting need another pass.
  - Fixed by backfilling missing `targetAgentId`/`assigneeId` for assigned task events during daemon event expansion before per-agent visibility checks.
  - Regression coverage: `test_pending_visible_task_events_are_scoped_to_task_assignee`.
- [x] Frontend i18n completion: the product default should remain Chinese. The language switcher path exists, but Chat, Tasks, and Computers still have untranslated or unsynchronized text from the previous UI work.
  - Fixed default locale to ignore `Accept-Language` unless the user explicitly sets `smallkhoj_locale`.
  - Localized Chat landing/channel, Tasks, task detail/recovery, Computers, and shared message/memory surfaces used by those pages.
  - Browser evidence:
    - `evidence/REAL_regression_i18n_runtime_20260623_chat_final.png`
    - `evidence/REAL_regression_i18n_runtime_20260623_tasks_final.png`
    - `evidence/REAL_regression_i18n_runtime_20260623_computers_final.png`
- [x] Computer/member lifecycle cleanup: the previously created `glm1` agent does not start correctly and cannot be deleted from the product surface/API flow.
  - Fixed stale `starting`/`restarting` workspace delete blocking with a five-minute grace threshold while keeping fresh starts protected.
  - Re-arming now includes missing `starting`/`restarting` workspaces when autostart is enabled.
  - Regression coverage: stale starting delete allowed, fresh starting delete blocked, missing starting workspace rearmed.
- [x] Task memory output reminder: do not put the reminder into the persistent runtime system prompt. When a task moves into `in_review`, or a supervisor manually clicks the task detail action, send a targeted one-shot reminder to the assigned agent.
  - Added `task.memory_requested` / `task_memory_requested` event creation with `targetAgentId`/`assigneeId`, filtered output directions, and prompt text that tells the agent to use `slock task summary` and optionally `slock task promote`.
  - Added a Tasks detail form for operator instruction text plus output direction checkboxes.
  - Regression coverage: service payload targeting, public route manual trigger, public `in_review` transition hook, daemon runtime-actionable gate/formatting, frontend lint/build, real browser DOM evidence.
  - Browser evidence: `evidence/REAL_task_memory_request_ui_20260623.png`

## Reference Research

- [x] Study `/Users/code/project/agent-platform/memory-fuse`.
- [x] Capture memory-fuse lessons in `research/memory-fuse-reference.md`.
- [x] Study `/Users/code/project/clowder-ai` deeper for task evidence and output visibility.
- [x] Capture Clowder task/evidence lessons in `research/clowder-task-evidence.md`.
- [x] Capture validation plan in `research/validation-plan.md`.
- [x] Add concrete design in `design.md`.

## Phase 0: Product Boundary and Data Model

- [x] Confirm Channel Memory Store is server/control-plane owned.
- [x] Define memory scopes:
  - agent private memory
  - channel shared memory
  - task/thread memory
  - transient runtime session context
- [x] Define schema fields in `design.md`:
  - `id`
  - `server_id`
  - `scope_type`
  - `scope_id`
  - `path`
  - `title`
  - `content_text`
  - `blob_key`
  - `mime_type`
  - `size_bytes`
  - `content_sha256`
  - `version`
  - `source_message_id`
  - `source_channel_id`
  - `source_thread_id`
  - `source_task_id`
  - `source_path`
  - `author_member_id`
  - `metadata`
  - `created_at`
  - `updated_at`
  - `deleted_at`
- [x] Define unique constraint for path-like entries per scope.
- [x] Define object/blob strategy: DB text for small markdown, FileEntry/blob references for images/videos/binary artifacts.
- [x] Define first-slice delete semantics in code and task docs.
  - Memory delete is a soft delete: `deleted_at` is set, `version` increments, list/search exclude deleted entries, and API serialization exposes `deletedAt` for audit responses.
  - Hard retention, TTL, quotas, and blob lifecycle cleanup remain a follow-up policy slice.

## Phase 1: Backend API and Permissions

- [x] Add `MemoryEntry` and `MemoryProposal` models.
- [x] Add startup migration/table creation.
- [x] Export models from `backend/models/__init__.py`.
- [x] Add server-side permission checks:
  - channel members can read channel memory
  - private channel memory is private to members
  - writes require allowed role/capability
  - leaving a channel revokes access
- [x] Add APIs:
  - `GET /api/v1/memory/scopes/{scopeType}/{scopeId}`
  - `GET /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
  - `PUT /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
  - `POST /api/v1/memory/scopes/{scopeType}/{scopeId}/search`
  - `POST /api/v1/memory/scopes/{scopeType}/{scopeId}/proposals`
  - `GET /api/v1/channels/{channel}/memory`
  - `GET /api/v1/tasks/{taskId}/memory`
- [x] Add first-slice public and agent APIs:
  - `GET /api/v1/memory/scopes/{scopeType}/{scopeId}`
  - `GET /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
  - `PUT /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
  - `POST /api/v1/memory/scopes/{scopeType}/{scopeId}/search`
  - `POST /api/v1/memory/scopes/{scopeType}/{scopeId}/proposals`
  - `GET /api/v1/channels/{channel}/memory`
  - `GET /api/v1/tasks/{taskId}/memory`
  - `/internal/agent-api/memory/scopes/...` read/search/write/propose
- [x] Add version/hash CAS at API boundary.
- [x] Add provenance fields from source messages and pasted paths.
- [x] Publish `memory.created`, `memory.updated`, `memory.proposal.created` events for cache invalidation and UI updates.
- [x] Ensure memory events are browser-safe and not runtime-actionable by default.

## Phase 2: CLI / Agent API Surface

- [x] Add agent-facing memory commands to the daemon proxy/CLI:
  - `slock memory read`
  - `slock memory search`
  - `slock memory context`
  - `slock memory write`
  - `slock memory propose`
  - `slock memory proposals`
  - `slock memory accept-proposal`
  - `slock memory reject-proposal`
  - `slock memory delete`
- [x] Hide conflict bookkeeping from the agent command UX.
  - `slock memory write` conflict responses return actionable instructions without requiring the agent to manage `currentSha256`.
  - Normal read/list responses still expose entry audit fields for now; a more curated human/agent display mode remains a CLI polish follow-up.
- [x] On write conflict, return actionable language:
  - re-read latest
  - merge changes
  - create proposal if needed
- [x] Ensure private channel names/content are never exposed outside authorized contexts.
  - Agent and public memory routes pass the current viewer into the shared scope resolver.
  - Memory mutations use service-layer writable-scope checks, so public-channel read visibility does not grant write/review/delete authority.
  - Runtime prompt now warns not to disclose private channel memory, proposals, names, content, or summaries outside the authorized context.
- [x] Add route-level tests for public/UI memory routes passing the current viewer into scoped permission checks.
- [x] Add route-level tests for public/private channel memory access from agent API.
  - Agent memory list/read/proposal/delete routes assert the authenticated agent member is passed to `resolve_memory_scope(...)`.
- [x] Add daemon proxy route rewriting and JSON-RPC forwarding.
  - JSON-RPC forwarding now includes `daemon/memory.proposals`, `daemon/memory.proposal.accept`, `daemon/memory.proposal.reject`, and `daemon/memory.delete`.

## Phase 3: Scoped Runtime Sessions

- [x] Define runtime session scope identifiers:
  - `dm:<user_id>`
  - `channel:<channel_id>`
  - `thread:<channel_id>:<root_message_id>`
  - `task:<task_id>`
- [x] Add a pure scope selector with tests.
- [x] Extend daemon/runtime state so an agent can have separate logical sessions by scope.
- [x] Route incoming messages:
  - DM top-level -> DM scope
  - channel top-level -> channel scope
  - thread reply -> thread scope
  - task thread/work -> task scope
- [x] Preserve provider-specific session IDs per scope when supported.
  - Daemon stores `agent + scope -> providerSessionId` in an in-memory scoped provider session store.
  - Runtime drivers accept `RuntimeSendOptions.sessionId`; `null` intentionally starts a fresh scoped provider session, while a string resumes the provider session for that logical scope.
  - Claude stream-json, Codex CLI, and Codex ACP carry scoped send options through queued messages.
  - Daemon heartbeat projects scoped session snapshots under each active workspace.
- [x] Add explicit task memory summarization/promotion handoff:
  - task session summary -> task memory
  - durable conclusions -> channel memory proposal/write
  - Agent API and CLI routes are available through `slock task summary` and `slock task promote`.
  - Task status transitions into `in_review` now create a one-shot targeted `task.memory_requested` runtime reminder instead of changing the persistent system prompt.
  - Supervisors can manually resend the same reminder from the Tasks detail UI with free-text instruction and output direction choices.
- [x] Add tests proving unrelated DM/channel/task messages do not reuse the same conversation context by default.
  - Scope store tests prove DM/channel/task provider IDs do not collide.
  - Daemon normalization tests prove top-level channel, thread reply, and task events choose distinct scope keys.
  - Claude runtime tests prove `sessionId: null` does not reuse the current provider session and scoped existing IDs are used when supplied.

## Phase 4: Retrieval and Prompt Policy

This phase is intentionally after storage/API/session scope.

- [x] Define default retrieval policy per scope in `design.md`.
- [x] For channel sessions, inject only:
  - short channel memory summary
  - relevant top-k memory snippets
  - tool instructions for further memory read/search
- [x] For task sessions, inject:
  - task brief
  - task memory
  - minimal channel summary
  - relevant channel memory only when matched
- [x] For DM sessions, avoid channel memory unless explicitly referenced or authorized.
  - Daemon scoped runtime delivery requests `/memory/context-manifest` through the local proxy for `channel`, `thread`, and `task` scopes only.
  - DM-scoped runtime delivery returns no manifest request by default, so no channel memory is injected into DM prompts.
  - Prompt formatting consumes only manifest `snippet` and `readMore` fields; raw/full memory content is not inserted.
- [x] Add context manifest hooks so prompt/context injection remains inspectable.
- [x] Add tests or evidence that full channel memory is not blindly inserted into every prompt.
  - Backend route and pure helper return a selective manifest with top-k snippets and read-more hints.
  - Daemon/CLI expose `slock memory context` / `daemon/memory.context` without adding `memory.*` events to the runtime-actionable allowlist.
  - Daemon runtime tests verify automatic manifest fetch/injection for channel scope and no full `contentText` leakage.

## Phase 5: UI Visibility

- [x] Add channel memory visibility to the channel surface:
  - `MEMORY.md` or summary
  - decisions
  - references
  - recent memory updates
- [x] Add task memory visibility to task detail:
  - plan
  - evidence
  - final summary
  - promoted conclusions
- [x] Add source/provenance display for memory entries:
  - source path
  - source task/thread/message IDs when present
  - content hash/version for audit
- [x] Add memory update/proposal audit UI if proposals are in MVP.
  - Channel Memory includes an open proposal review queue with proposal reason/content/base audit fields and Accept/Reject actions.
- [x] Keep Slock file upload UI separate and non-primary.
  - Memory UI centers server-owned memory/proposals/task recovery; binary output rendering uses FileEntry/blob/artifact references rather than making Slock upload the primary memory path.
- [x] Render image/video/file artifact entries from FileEntry/blob references or explicit artifact URLs rather than burying them in markdown.
- [x] Make task detail recoverable after agent/context compaction for the first slice:
  - brief
  - plan/subtasks
  - progress notes
  - evidence
  - final summary
  - promoted conclusions

## Phase 6: Local Projection / FUSE Later

- [ ] Spike local memory projection only after backend memory APIs are stable.
- [ ] Linux: evaluate FUSE/go-fuse or libfuse.
- [ ] macOS: evaluate macFUSE installation and limitations.
- [ ] Windows: evaluate WinFsp/cgofuse or Dokany.
- [ ] Mount example:

```text
.smallkhoj/
  channels/<channel>/MEMORY.md
  channels/<channel>/decisions/*.md
  tasks/<task-id>/MEMORY.md
```

- [ ] Ensure FUSE writes still go through server API with daemon-managed versions.
- [ ] Ensure server events invalidate local daemon caches.
- [ ] Document supported filesystem semantics before enabling by default.

## Implementation Slices

### Slice 0: Red Tests and Contracts

- [x] Add initial red tests for memory path/CAS/permission/retrieval contract.
- [x] Add red tests for CLI memory command mapping and write gate.
- [x] Add red tests for runtime session scope selection.
- [x] Add red tests for public event envelope scope for memory events.

### Slice 1: Read-Only Channel/Task Memory API

- DB model for memory entries.
- Read/list/search APIs.
- Channel permission tests.
- CLI/API read/search commands.
- No write from agent yet except seed/admin path.

### Slice 2: Write and Provenance

- Write API with version/hash.
- Source message/path provenance.
- Agent CLI write/propose.
- Public events on update.
- Conflict tests.

### Slice 3: Task Memory and Promotion

- Task memory model or generalized memory scope.
- Task brief/plan/progress/evidence/final summary paths.
- Promote durable conclusion to channel memory.
- Task detail endpoint joins memory, source message, activity, files, and review state.

### Slice 4: Scoped Sessions

- Logical session scope routing in daemon/backend.
- Provider session ID tracking by scope where possible.
- Tests for DM/channel/task isolation.

### Slice 5: Context Retrieval

- Short summary + top-k memory retrieval.
- Context manifest integration.
- Prompt policy that avoids all-memory injection.

### Slice 6: Frontend Product Visibility

- Channel memory panel/rail.
- Task detail memory/evidence/artifact sections.
- Memory proposal/update audit UI.
- Browser evidence with `./twd`.

### Slice 7: Local Projection

- FUSE/WinFsp spike.
- Mount lifecycle and cache invalidation.
- Platform support matrix.

## Risks

- Server storage can grow without retention/quotas.
- Private channel memory can leak if retrieval ignores channel membership.
- Full memory injection can hurt attention and cost.
- One runtime session per agent can keep polluting context unless scoped sessions are implemented.
- Version conflicts can confuse agents if daemon does not translate them into actionable instructions.
- FUSE can add installation and platform-specific support burden; keep it optional and late.

## Definition of Done for Design Phase

- [ ] PRD reviewed with operator.
- [x] Backend schema/API shape agreed.
- [x] Session scope routing rules agreed.

The remaining PRD review checkbox is an explicit operator sign-off checkpoint, not an implementation gap. The review packet is `evidence/operator-review-packet.md`.

## Verification Evidence

- [x] Backend targeted memory/public-event/public-route tests:
  `cd backend && rtk env PYTHONPATH=. uv run pytest tests/test_memory_store.py tests/test_public_memory_routes.py tests/test_public_events.py -q`
  - Result: `20 passed`.
- [x] Backend full test suite before public-route permission tightening:
  `cd backend && rtk env PYTHONPATH=. uv run pytest -q`
  - Earlier result: `53 passed`.
  - Final result after task handoff/context manifest work: `63 passed`.
  - Final result after proposal review/delete/conflict work: `70 passed`.
  - Final result after agent proposal/delete management work: `73 passed`.
  - Final result after final scoped prompt/context work: `73 passed`.
  - Final result after private-channel context-manifest permission fix: `74 passed`.
- [x] Daemon memory CLI/proxy/session-scope targeted tests:
  `cd agent/daemon/aaa-daemon && rtk node --test test/session-scope.test.mjs test/proxy-wrapper.test.mjs test/slock-cli.test.mjs`
  - Result: `24 passed`.
- [x] Daemon full test suite:
  `cd agent/daemon/aaa-daemon && rtk npm test`
  - Earlier result: `131 passed`.
  - After scoped provider session routing: `135 passed`.
  - Final result after memory context/task handoff work: `136 passed`.
  - Final result after memory conflict UX work: `137 passed`.
  - Final result after agent proposal/delete command and prompt work: `137 passed`.
  - Final result after scoped prompt/context injection and DM-scope regression fix: `141 passed`.
- [x] Frontend static checks:
  `cd frontend && rtk npx tsx --test test/memory-presentation.test.ts && rtk npm run lint && rtk npm run build`
  - Result: presentation tests `3 passed`; lint and production build passed.
  - Final result after final scoped prompt/context work: presentation tests `3 passed`; lint and production build passed.
  - Final result after private-channel context-manifest permission fix: presentation tests `3 passed`; lint and production build passed.
- [x] Subagent verification:
  - Gauss independently reviewed command-level verification and fixed daemon memory scope allowlist, agent-private memory routing tests, and frontend lint warning.
  - Final subagent-reported checks: backend focused suite, daemon targeted tests, frontend lint/build, and `rtk git diff --check` passed.
  - Mencius was dispatched for independent verification of memory context/task handoff/scoped-session regressions after the final context-manifest edits.
  - Bacon independently reviewed proposal/delete/conflict/UI evidence, found and fixed public channel read visibility being reused as write/review/delete permission, added a regression test, and reported backend focused/full, daemon targeted/full, frontend lint/build, and `rtk git diff --check` passed.
  - Hubble independently reviewed agent proposal/delete/prompt work, fixed proposal accept CAS for empty baseline proposals, added runtime non-actionable memory event coverage, and reported backend focused/full, daemon targeted/full, frontend lint/build, and `rtk git diff --check` passed.
  - Peirce independently reviewed scoped prompt/context injection, fixed legacy/proxy-shaped `target=dm:...` events so they stay DM-scoped even when `channelType` is absent, and reported targeted daemon tests `41 passed`.
  - Mendel independently reviewed final permission boundaries, found a P1 private-channel context-manifest leak for task-visible non-members, and the main thread fixed it with route-level channel re-resolution plus regression coverage. Backend focused tests now report `38 passed`; backend full suite reports `74 passed`. Mendel re-verified after the patch and reported no remaining P0/P1/P2 findings.
- [x] Real UI verification with `./twd` on local ports `3011`/`8011`:
  - Chat memory page showed `MEMORY.md` and marker `REAL_memory_ui_202606230131 channel memory visible in Chat Memory tab.`
  - Task detail showed `Task Memory`, `plan.md`, `evidence.md`, and marker `REAL_memory_ui_202606230131 task memory visible in Task Detail.`
  - Evidence files:
    - `evidence/REAL_memory_ui_202606230131-chat-memory.png`
    - `evidence/REAL_memory_ui_202606230131-chat-memory.snapshot.txt`
    - `evidence/REAL_memory_ui_202606230131-task-memory.png`
    - `evidence/REAL_memory_ui_202606230131-task-memory.snapshot.txt`
- [x] Rich task/channel output verification with `./twd` on local ports `3012`/`8012`:
  - Task detail showed `Task Recovery`, `4/4 recovery signals`, structured `Task breakdown`, `Outputs and evidence`, image artifact preview, and video artifact controls.
  - DOM eval confirmed an `img` with natural size and a `video` element with `controls`.
  - Channel memory showed `TASK OUTPUTS` and `PROMOTIONS` sections for promoted task outputs and promotion audit.
  - Evidence files:
    - `evidence/REAL_memory_rich_outputs_202606230153-task-recovery.png`
    - `evidence/REAL_memory_rich_outputs_202606230153-task-recovery.snapshot.txt`
    - `evidence/REAL_memory_rich_outputs_202606230153-channel-memory.png`
    - `evidence/REAL_memory_rich_outputs_202606230153-channel-memory.snapshot.txt`
- [x] Proposal review queue verification with `./twd` on local ports `3013`/`8013`:
  - Seeded proposal marker `REAL_memory_proposal_review_202606230249`.
  - Before accept, the channel Memory tab showed the review queue, proposal path, reason/content, and Accept/Reject actions.
  - After accept, the queue no longer showed the open proposal and the accepted decision appeared under channel knowledge.
  - API cross-check confirmed proposal status `accepted`, `resolvedAt` set, reviewer recorded, open queue no longer contains the proposal, and the accepted channel memory entry exists with `deletedAt: null`.
  - Evidence files:
    - `evidence/REAL_memory_proposal_review_202606230249-proposal-create.json`
    - `evidence/REAL_memory_proposal_review_202606230249-before.png`
    - `evidence/REAL_memory_proposal_review_202606230249-before.snapshot.txt`
    - `evidence/REAL_memory_proposal_review_202606230249-after-accept.png`
    - `evidence/REAL_memory_proposal_review_202606230249-after-accept.snapshot.txt`
- [x] Final browser smoke verification with `./twd` on local ports `3014`/`8014`:
  - Channel Memory tab showed `CHANNEL KNOWLEDGE`, `TASK OUTPUTS`, `PROMOTIONS`, the rich output marker, and the accepted proposal marker.
  - Task detail showed `Task Recovery`, `4/4 recovery signals`, `Task breakdown`, `Outputs and evidence`, one loaded image, and one video element with controls.
  - Temporary ports `3014` and `8014` were stopped after capture.
  - Evidence files:
    - `evidence/REAL_memory_final_smoke_202606230338-channel-memory.png`
    - `evidence/REAL_memory_final_smoke_202606230338-channel-memory.snapshot.txt`
    - `evidence/REAL_memory_final_smoke_202606230338-task-recovery.png`
    - `evidence/REAL_memory_final_smoke_202606230338-task-recovery.snapshot.txt`
- [x] Post privacy-fix browser smoke verification with `./twd` on local ports `3015`/`8015`:
  - API cross-check showed 4 channel memory entries and 7 task memory entries.
  - Channel Memory tab showed 4 entries, `CHANNEL KNOWLEDGE`, `TASK OUTPUTS`, `PROMOTIONS`, the rich output marker, and the accepted proposal marker.
  - Task detail showed `Task Recovery`, `4/4 recovery signals`, structured `Task breakdown`, `Outputs and evidence`, one loaded image with natural dimensions, and one video element with controls.
  - Evidence files:
    - `evidence/REAL_memory_post_privacy_fix_202606230400-channel-memory.png`
    - `evidence/REAL_memory_post_privacy_fix_202606230400-channel-memory.snapshot.txt`
    - `evidence/REAL_memory_post_privacy_fix_202606230400-task-recovery.png`
    - `evidence/REAL_memory_post_privacy_fix_202606230400-task-recovery.snapshot.txt`
- [x] Retrieval policy agreed for the first slice: selective manifests and explicit read/search tools, no full memory injection.
- [x] First implementation slice selected and implemented across backend, daemon/CLI, runtime scope, and frontend visibility.
- [x] FUSE explicitly marked as later projection unless operator changes priority.
