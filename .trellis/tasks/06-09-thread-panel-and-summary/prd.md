# thread panel and summary

## Goal

Make threads a first-class collaboration surface with root context, replies, status/summary, and reliable cross-layer persistence.

## Requirements

* Render thread panel with root message context and reply list.
* Support sending replies from the panel.
* Show reply count and summary/status on root messages when available.
* Preserve `parent_id`, `threadId`, and DM/channel target contracts.
* Include empty/loading/error states.

## Acceptance Criteria

* [ ] Opening a thread shows the root and replies.
* [ ] Sending a reply updates the thread and root reply count.
* [ ] API fields agree with visible state.
* [ ] DM thread and channel thread paths both work.

## Real Test SOP

Use marker `REAL_thread_<timestamp>`.

1. Send a root marker in a channel.
2. Open thread, send reply marker.
3. Verify DOM, `/api/v1/threads/<id>`, and message `parent_id`.
4. Repeat on a DM if runtime path is affected.
5. Save screenshots/API evidence.

## Context

* Existing code: `frontend/app/chat/[channel]/channel-client.tsx`
* Backend spec: `.trellis/spec/backend/threading-contracts.md`
* Runtime spec: `.trellis/spec/backend/runtime-slock-integration.md`
