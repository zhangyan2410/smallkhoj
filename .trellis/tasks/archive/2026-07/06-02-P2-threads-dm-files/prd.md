# P2 Threads + DM Polish

## Goal

Implement the current thread and DM polish plan for Slock chat.

This task intentionally excludes Files. Files will be redesigned later around remote storage that agents experience as local files.

## Scope

In scope:

- Channel and DM single-layer threads.
- Right-side thread panel in the web chat UI.
- Root message cards show reply count and thread summary.
- DM UI shows the peer member name instead of raw `dm:uuid-uuid`.
- Dedicated thread summary metadata, updated by an agent through agent API/CLI.
- Backend scheduler requests a new summary when a thread has new replies and the previous request/summary is older than 10 minutes.

Out of scope:

- Files/filesystem implementation.
- Nested threads.
- Production auth changes.
- Full Activity/Reminders/Reactions/Permissions expansion beyond preserving existing behavior.

## Requirements

### Thread behavior

- Threads are single-layer: replies to replies attach to the root message.
- Channel and DM threads both work.
- Main channel/DM timeline shows root messages only.
- Thread replies appear only in the right-side thread panel.
- Root message cards show:
  - reply count,
  - current thread summary when available,
  - a reply/open-thread control.

### Thread summary

- Add a `thread_summaries` persistence model keyed by root message.
- Summary is metadata, not a normal message.
- Summary text is non-empty and at most 300 characters.
- Backend chooses the most recent participating agent for summary requests, preferring online/active agents bound to online computers.
- Backend emits a daemon-delivered `thread.summary_requested` event to the selected agent only.
- Agent writes summary through a dedicated API/CLI, not by sending a chat message.

### DM polish

- DM titles/sidebar entries display the peer member, e.g. `DM @deepseek`.
- Raw `dm:uuid-uuid` channel names remain valid internally and in URLs.
- Existing DM E2E behavior stays working.

## Acceptance Criteria

- [ ] `GET /api/v1/channels/{channel}/messages?threadMode=roots` returns root messages with `replyCount` and `threadSummary`.
- [ ] `GET /api/v1/threads/{thread_id}` returns root, replies, reply count, and summary.
- [ ] `POST /api/v1/channels/{channel}/messages` with `threadId` creates a thread reply.
- [ ] `GET /api/v1/dms` and `POST /api/v1/dm` expose peer display metadata.
- [ ] `POST /internal/agent-api/threads/{thread_id}/summary` stores a valid summary and rejects empty/too-long text.
- [ ] `slock thread read` and `slock thread summary` route to the canonical agent API endpoints.
- [ ] Daemon runtime delivery accepts `thread.summary_requested` and targets only the selected agent.
- [ ] Browser channel thread flow works.
- [ ] Browser DM thread flow works.
- [ ] Existing management flow still passes.
- [ ] Backend, frontend, daemon, and E2E checks pass or documented blockers are recorded.
