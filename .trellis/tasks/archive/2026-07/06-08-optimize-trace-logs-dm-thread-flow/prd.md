# Optimize Trace Logs for DM/Thread Agent Flow

## Problem

The current `smallkhoj-trace` output is helpful for broad daemon/backend/frontend visibility, but DM and thread routing issues still require manual cross-checking across browser DOM, database rows, event payloads, daemon delivery logs, and runtime replies.

Recent DM thread debugging showed that automated E2E can pass while the real user-visible flow is still wrong. Trace output should make this kind of issue easier to see without manually querying every layer.

## Goals

- Make trace summaries expose DM/thread routing context clearly.
- Show message roots, replies, `parent_id`, `threadId`, `shortId`, `target`, `channel`, `channelId`, `agentId`, and `targetAgentId` where available.
- Highlight suspicious mismatches such as thread replies with missing target, agent replies with empty `parent_id` after a thread delivery, or replayed events lacking reply-safe targets.
- Add trace filters or sections for a specific member, channel/DM, message marker, thread root, or event cursor.
- Keep output readable for human debugging and machine-readable for scripts.

## Non-Goals

- Replace Playwright/WebDriver acceptance checks.
- Redesign event storage.
- Add a full observability platform.

## Acceptance Criteria

- `smallkhoj-trace summary` makes a DM/thread routing failure diagnosable from one timeline.
- A developer can search by a marker and see the related frontend request, backend message/event row, daemon delivery, and runtime send/reply where logs exist.
- Trace output distinguishes top-level DM messages from thread replies.
- Machine-readable JSON includes enough routing fields for automated checks.
- Documentation or help text explains the DM/thread trace workflow.
