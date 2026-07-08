# Channel Memory Store and Scoped Runtime Sessions

## Goal

Build the product foundation for shared channel memory and scoped runtime context in SmallKhoj/Raft.

The core problem is not file upload, git worktrees, or project file browsing. Today each agent owns its own workspace and memory files. When multiple agents participate in a channel, each agent must separately reconstruct and maintain channel-related memory. That causes duplicated, stale, inconsistent, or missing channel knowledge.

The desired product model is:

- channel knowledge is platform-owned and shared by channel members
- task knowledge is task/thread scoped and can be summarized/promoted when durable
- agent private memory remains agent-owned
- runtime sessions are scoped so unrelated DM/channel/task conversations do not pollute each other
- FUSE/WinFsp can later provide a local file view over memory, but the server/control-plane remains the source of truth

## Background

SmallKhoj already has the pieces needed for a first implementation:

- `Channel`, `ChannelMember`, `Message`, `Task`, and `EventRecord` are backend product primitives.
- `AgentWorkspace.cwd` is forwarded by `runtime_start_command()` as `workspacePath`.
- The daemon starts runtimes through `startRuntimeForAgent()` and writes runtime-local Slock wrapper files.
- Agents communicate through the project Slock CLI and daemon proxy, which can be extended with memory commands.
- Public events already support server-to-client/runtime update propagation.

The missing product layer is a server-owned memory store with clear scopes, versioning, permission checks, and retrieval rules.

## Product Requirements

### Server-Owned Channel Memory

- Add a server/control-plane owned channel memory model.
- Channel memory belongs to a channel, not to a single agent workspace or computer.
- Channel memory must remain available when the computer that originally wrote it is offline.
- Private channel memory must only be visible to members of that private channel.
- Channel memory entries must support provenance:
  - source message ID
  - source channel/thread/task where applicable
  - source path when a human pasted a local filesystem path
  - author user/agent
  - timestamps
- Channel memory should support path-like organization for agent usability, e.g.:

```text
MEMORY.md
decisions/channel-memory.md
references/smallkhoj-project-paths.md
tasks/<task-id>/summary.md
```

### Storage Model

- Server-owned does not mean unmanaged raw files on the server filesystem.
- Store markdown and small text content in DB rows.
- Store large files, images, screenshots, and binary artifacts in object/blob storage.
- Store user-pasted local paths as references and summaries, not as automatic file uploads.
- The server should manage:
  - metadata
  - permissions
  - version/content hash
  - search index
  - audit/provenance
  - deletion/retention
  - object/blob references for large content

### Task Memory

- Add or design task/thread-scoped memory as a separate scope from channel memory.
- Task memory should hold execution notes, plan state, evidence pointers, and final summaries.
- Only durable, reusable conclusions should be promoted from task memory to channel memory.
- Task completion should produce a compact task summary suitable for future retrieval.

### Agent Private Memory

- Preserve agent private memory/workspace files for agent-specific preferences, long-running self-knowledge, and local recovery.
- Do not use agent private memory as the canonical storage for channel decisions.

### Scoped Runtime Sessions

- The current one-agent/one-runtime-session model can pollute context across unrelated work.
- Introduce or design scoped runtime sessions:
  - DM scope
  - channel scope
  - thread scope
  - task scope
- A top-level DM should not reuse a channel or task session.
- A task should use a task-scoped session when practical.
- A channel conversation should use channel-scoped memory and session context.
- Thread replies should prefer thread/task scope over broad channel scope.
- Task completion should compact or summarize session state instead of keeping all raw task context alive.

### Versioning and Conflicts

- Agents should not manually reason about versions.
- Version/baseSha/CAS should be handled by daemon, FUSE, CLI, or API layers.
- On conflict, the system can:
  - return a clear re-read/merge instruction
  - attempt automatic three-way merge
  - create a memory update proposal for high-value files like channel `MEMORY.md`
- Channel memory updates must be auditable and reversible enough for operator trust.

### Retrieval and Attention Control

- Do not inject all channel memory into every runtime turn.
- Use channel memory as external memory with selective retrieval.
- Runtime context should include:
  - a short channel summary
  - top-k relevant channel memories for the current message/task
  - task memory for task-scoped sessions
  - explicit tools/commands to read or search more
- Prompt/context injection by session scope is a later phase after storage and retrieval semantics are defined.

### Local File Projection

- FUSE/macFUSE/WinFsp projection is a later layer, not the core source of truth.
- After the server-owned memory API stabilizes, a daemon can project memory locally:

```text
.smallkhoj/
  agent/MEMORY.md
  channels/<channel>/MEMORY.md
  channels/<channel>/decisions/*.md
  tasks/<task-id>/MEMORY.md
```

- Linux can use FUSE; macOS can use macFUSE with installation caveats; Windows can use WinFsp/cgofuse or Dokany.
- Local projection should read/cache server memory and commit writes through server API with daemon-managed conflict handling.

## Non-Goals

- Do not make Slock file uploads the primary product path.
- Do not prioritize git worktree browsing/editing in this task.
- Do not move message/task state machines into the filesystem.
- Do not make FUSE the first implementation step or the only interface.
- Do not inject full channel memory into every prompt.
- Do not copy `agent-platform/memory-fuse` directly without adapting for channel/task memory and SmallKhoj permissions.

## Reference Projects

### agent-platform / memory-fuse

Reference path: `/Users/code/project/agent-platform/memory-fuse`

Useful patterns:

- FUSE daemon over server-owned records.
- Synthesized directory tree from flat path-keyed records.
- Lazy fetch and sha-keyed content cache.
- Buffered writes committed on `flush/close/fsync`.
- Version/hash precondition for conflict handling.
- Server-triggered invalidate plus periodic refresh fallback.
- Clear supported/unsupported filesystem semantics.

Do not blindly copy:

- Its exact Go dependency choice if cross-platform Windows support is required.
- Its memory-specific frontmatter policy.
- Its assumption that FUSE is the main access shape.

### clowder-ai

Reference path: `/Users/code/project/clowder-ai`

Useful patterns:

- Workspace-oriented UI/product patterns.
- Path safety, realpath checks, denylist, sha conflict detection.
- Context inspection and product visibility lessons.

Do not prioritize:

- Worktree browsing as the first slice for this task.
- Clowder-specific backend runtime ownership patterns that conflict with SmallKhoj daemon boundaries.

## Open Questions

1. Should direct channel memory writes be allowed for all agents, or should `MEMORY.md` updates start as proposals?
2. What is the initial storage backend for object/blob content: local server blob directory, database bytea, or S3-compatible storage?
3. What is the minimum viable memory search: SQL text search, trigram, external index, or embedding later?
4. How should task-scoped runtime sessions map to provider session IDs and daemon `RuntimeRecord`s?
5. Should memory retrieval happen in backend before delivery, daemon before runtime send, or runtime tool calls only?
6. How much channel memory should be visible in the UI before FUSE/local projections exist?

## Acceptance Criteria

- [x] A backend schema/API proposal defines channel memory, task memory, metadata, version/hash, provenance, and blob references.
- [x] Permission rules for public/private channel memory are documented and testable.
- [x] A first CLI/API surface is specified for read/search/write/propose update.
- [x] The design explains how daemon/CLI/FUSE hides versions from agents while preserving conflict safety.
- [x] The design defines scoped runtime sessions for DM/channel/thread/task and when each scope is selected.
- [x] The design defines retrieval rules that prevent full channel memory injection and attention dilution.
- [x] FUSE/macFUSE/WinFsp projection is documented as a later phase with platform-specific caveats.
- [x] The design explicitly explains why Slock file uploads and git worktrees are not first-slice requirements.
- [x] Implementation tasks can be split into backend storage/API, daemon routing/session scope, retrieval/prompt policy, UI visibility, and later local projection.

## Initial Validation Plan

- Add backend unit tests for channel memory permission checks and version conflict behavior.
- Add API tests for read/search/write/propose operations.
- Add daemon tests for session-scope routing decisions without launching real providers.
- Add runtime delivery tests showing DM/channel/task messages do not share unrelated session context.
- Add a product dogfood scenario:
  - two agents on different computers join one channel
  - agent A records channel memory
  - agent B reads it without relying on agent A's local workspace
  - task work produces task memory
  - durable conclusion is promoted to channel memory
- Defer FUSE smoke tests until the memory API is stable.
