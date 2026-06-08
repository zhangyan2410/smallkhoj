# Threading Contracts

## Scenario: Single-Level Threads With Agent Summaries

### 1. Scope / Trigger

- Trigger: frontend chat, public API, agent API, daemon event delivery, and persistence all participate in thread behavior.
- Threads are single-level. Replies to replies must resolve to the root message and store `messages.parent_id = <root_message_id>`.
- Thread summaries are metadata in `thread_summaries`, not normal chat messages.

### 2. Signatures

- DB: `messages.parent_id` points to the root message; `thread_summaries.root_message_id` is unique.
- Public API:
  - `GET /api/v1/channels/{channel}/messages?threadMode=roots`
  - `GET /api/v1/threads/{thread_id}`
  - `POST /api/v1/channels/{channel}/messages` with optional `threadId` or `parentId`
  - `GET /api/v1/dms`
  - `POST /api/v1/dm`
- Agent API:
  - `GET /internal/agent-api/threads/{thread_id}`
  - `POST /internal/agent-api/threads/{thread_id}/summary`
- Daemon/CLI:
  - `thread.summary_requested` event targets one agent with `payload.targetAgentId`.
  - `slock thread read --thread-id <id>`
  - `slock thread summary --thread-id <id> --summary <text>`

### 3. Contracts

- Root timeline responses return root messages only when `threadMode=roots`; each root may include `replyCount` and `threadSummary`.
- Thread detail responses return `{thread, replies, messages, replyCount, threadSummary}`. `messages` includes root first, then replies for backward compatibility.
- Reply creation must accept either a root message id/short id or a reply id/short id, then persist against the root id.
- Summary text must be non-empty and at most 300 characters.
- Summary request events must include `targetAgentId`, `threadId`, `threadShortId`, `target`, `content`, `replyCount`, and `summaryMaxChars`.
- DM APIs keep raw `dm:...` channel names for routing but include `displayName` and `peer` for human-facing UI.

### 4. Validation & Error Matrix

- Missing thread id for CLI/API read -> invalid params or HTTP 400.
- Unknown thread id/short id -> HTTP 404.
- Empty summary -> HTTP 400.
- Summary over 300 characters -> HTTP 400.
- Summary writer is neither the requested agent nor a thread participant -> HTTP 403.
- Targeted summary event delivered to any non-target runtime -> bug; filter by `targetAgentId`.

### 5. Good/Base/Bad Cases

- Good: main timeline fetches `threadMode=roots`, opens the right-side panel via `GET /threads/{id}`, posts replies with `threadId`, and refreshes both the root list and panel.
- Base: an agent receives `thread.summary_requested`, reads the thread with `slock thread read`, and writes metadata with `slock thread summary`; it does not send a chat message.
- Bad: rendering replies in the main channel timeline.
- Bad: creating nested replies by storing a reply's id as `parent_id`.
- Bad: displaying raw `dm:uuid-uuid` as the primary DM title when peer metadata is available.

### 6. Tests Required

- Backend/API: root-only timeline includes `replyCount` and `threadSummary`; thread detail separates `thread` and `replies`; summary write rejects empty/too-long/non-participant writes.
- Daemon: CLI/proxy/JSON-RPC route `thread.read` and `thread.summary` to canonical agent API endpoints.
- Runtime delivery: `thread.summary_requested` is classified as a runtime event and delivered only to `targetAgentId`.
- Browser E2E: channel and DM thread replies appear in the thread panel and not in the main timeline; DM headers/sidebar use peer display names.

### 7. Wrong vs Correct

#### Wrong

```python
# Creates nested threads when replying to a reply.
parent_id = reply_message.id
```

#### Correct

```python
# Single-level threads: all replies attach to the root.
parent_id = reply_message.parent_id or reply_message.id
```

#### Wrong

```typescript
fetch(`/api/v1/channels/${channel}/messages?limit=50`)
```

#### Correct

```typescript
fetch(`/api/v1/channels/${channel}/messages?limit=50&threadMode=roots`)
```
