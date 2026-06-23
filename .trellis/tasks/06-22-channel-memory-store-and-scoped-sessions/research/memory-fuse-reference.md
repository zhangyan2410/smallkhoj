# agent-platform memory-fuse Reference Notes

Reference project: `/Users/code/project/agent-platform/memory-fuse`

Reviewed paths:

- `README.md`
- `KNOWN-SEMANTICS.md`
- `internal/cpclient/client.go`
- `internal/cache/cache.go`
- `internal/memfs/memfs.go`
- `internal/memfs/snapshot_test.go`
- `internal/mountmgr/mountmgr.go`

## Core Architecture Lesson

`memory-fuse` is not a filesystem-first memory system. It is a local projection over a server-owned, flat, path-keyed memory store. The server/control-plane owns identity, content hash, path, authorization, and durable records. The FUSE daemon only synthesizes a directory tree and gives agents familiar `ls`, `cat`, write, delete, and rename affordances.

SmallKhoj should copy this boundary:

```text
server DB / blob store = source of truth
daemon / CLI / future FUSE = convenience projection and conflict translator
runtime prompt = selective memory manifest, not full mounted tree dump
```

## Patterns To Borrow

### Flat Path-Keyed Records

`memory-fuse` stores memory as flat records with paths such as `/MEMORY.md` and `/notes/foo.md`, then derives every directory prefix during snapshot load. SmallKhoj should store channel/task memory as DB rows keyed by:

```text
server_id
scope_type: channel | task | thread | agent
scope_id
path
```

The API should return path-like organization, but the database should not depend on nested filesystem objects.

### Synthesized Directory Tree

The `snapshot` in `internal/memfs/memfs.go` builds:

- `files: absolute path -> metadata`
- `children: dir path -> immediate child names`
- `ephemeral: mkdir-only dirs without backing records`

SmallKhoj first slice does not need FUSE, but the same concept is useful for UI and CLI:

- `GET /memory/tree` can return synthesized folders for `MEMORY.md`, `decisions/`, `references/`, `tasks/<id>/`.
- Empty folders should be UI affordances, not durable memory records, unless they contain an entry.
- Future FUSE/macFUSE/WinFsp projection can reuse this model.

### Lazy Content Fetch + Hash-Validated Cache

`memory-fuse` lists lightweight memory metadata first, then fetches content on first read. Its disk cache is valid only when the cached `.sha` equals the authoritative snapshot sha.

SmallKhoj should borrow this for daemon and frontend:

- list endpoints should return metadata and short snippets
- content read should be a separate endpoint
- daemon cache entries must include `contentSha256`
- browser UI should not hydrate all memory bodies for a channel by default

This directly supports attention control: memory is visible and searchable without injecting every full document into every runtime turn.

### CAS As The Conflict Contract

Writes in `memory-fuse` pass `if_match_sha256`. A `412` means the server copy changed; the daemon drops its local view and the next read sees the server copy.

SmallKhoj should expose CAS at the API boundary but hide it from agents:

```text
API: baseSha256 / ifMatchSha256
daemon/CLI: "Memory changed. Re-read, merge, then retry or create a proposal."
UI: show conflict diff/proposal for high-value entries such as MEMORY.md
```

Agents should not manually reason about version numbers. The daemon/CLI should translate conflict errors into a concrete recovery instruction.

### Commit Points Matter

`memory-fuse` writes are buffered and committed on `close(2)` / `fsync(2)`. That behavior is explicit in `KNOWN-SEMANTICS.md`.

SmallKhoj should be equally explicit:

- API writes commit immediately.
- CLI writes commit per command.
- future FUSE writes commit on close/fsync.
- task completion summary promotion commits as a separate operation from task status transition.

### Restricted Projection Semantics

`KNOWN-SEMANTICS.md` is valuable because it says what is unsupported:

- no durable empty directories
- no symlinks/hardlinks
- no xattrs
- no full POSIX permissions
- no directory rename
- locks are not real locks; CAS arbitrates

SmallKhoj should document projection limits before shipping local mount support. Otherwise agents will infer false filesystem guarantees.

### Server-Pushed Invalidation + Poll Backstop

`mountmgr.Invalidate` drops cache and forces a snapshot refresh; periodic refresh remains a backstop.

SmallKhoj should use `memory.updated` public/daemon-safe events for invalidation, plus a polling/read refresh path:

- browser updates memory sidebar on public event
- daemon invalidates scoped memory cache on server event
- CLI `memory read/search` always has an explicit refresh path

## Patterns To Modify

### Frontmatter Validation

`memory-fuse` requires frontmatter for most memory files. SmallKhoj should not copy this literally. Channel/task memory should be product-authored rows with metadata columns, so frontmatter is optional display text, not the authoritative metadata carrier.

Recommended SmallKhoj rule:

- API validates metadata fields structurally.
- Markdown content may include frontmatter, but frontmatter never overrides DB metadata.
- `MEMORY.md` remains a conventional index path.

### Internal Unauthenticated CP API

`memory-fuse` uses trusted cluster-internal `/_cp` endpoints. SmallKhoj should not copy that auth model. SmallKhoj needs:

- public UI API authenticated by public key/session token
- agent API authenticated by agent/machine principal
- daemon-local proxy auth for runtimes
- channel/private permission checks at the server boundary

### FUSE First

`memory-fuse` is a FUSE product. SmallKhoj should not make FUSE the first slice. The first slice should be server store + API + CLI + UI visibility. FUSE/macFUSE/WinFsp comes after API semantics and conflict behavior are stable.

## SmallKhoj Design Consequences

### Memory Entry Shape

Recommended fields:

```text
id
server_id
scope_type
scope_id
path
title
content_text
blob_key
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
metadata
created_at
updated_at
deleted_at
```

Unique key:

```text
server_id, scope_type, scope_id, path
```

### Entry Classes

Use `metadata.kind` or a typed column later:

- `index`: `MEMORY.md`
- `decision`: durable decisions
- `reference`: links, local path summaries, external docs
- `task_plan`: task decomposition
- `task_evidence`: screenshots, videos, API proofs, trace pointers
- `task_summary`: compact completion summary
- `proposal`: suggested update awaiting human/operator acceptance

### Scope Rules

```text
channel memory: durable, shared, visible to channel members
task memory: execution notes, plans, evidence, compact summaries
thread memory: useful when a long thread becomes a task-like context
agent private memory: stays in agent workspace, not canonical channel knowledge
runtime session context: transient provider/session state
```

Promotion rule:

```text
task memory -> channel memory only when the conclusion is durable, reusable, and safe for every authorized channel member
```

### Retrieval Rules

Borrow lazy fetch and top-k behavior:

- channel view shows metadata, snippets, and update activity
- task view loads task memory and evidence details for selected task
- runtime context gets a manifest:
  - short channel summary
  - top-k relevant channel memories
  - task memory for task sessions
  - explicit read/search commands
- never blindly inject all channel memory

### Future Projection Contract

Mount example:

```text
.smallkhoj/
  agent/MEMORY.md
  channels/<channel>/MEMORY.md
  channels/<channel>/decisions/*.md
  channels/<channel>/references/*.md
  tasks/<task-id>/plan.md
  tasks/<task-id>/evidence.md
  tasks/<task-id>/summary.md
```

Projection constraints should be documented before implementation:

- no durable empty dirs
- file writes require CAS
- binary files are blob references, not arbitrary DB text
- conflicts become proposal/re-read flows
- server remains source of truth

## Risks

- Treating path-like memory as real filesystem hierarchy too early.
- Leaking private channel memory through search or retrieval.
- Adding full channel memory to runtime prompts and hurting attention/cache.
- Letting agents overwrite `MEMORY.md` without proposal/conflict handling.
- Duplicating task evidence in chat messages, task data JSON, file rows, and memory rows without a source-of-truth rule.

## Recommended First Slice

1. Server DB model for `MemoryEntry` and optional `MemoryProposal`.
2. Generalized scope API for channel/task read/list/search/write/propose.
3. Agent CLI commands `slock memory read|search|write|propose`.
4. Task completion writes a task summary memory entry.
5. Channel/task UI shows memory/evidence side panels.
6. FUSE/local projection remains documented later work.
