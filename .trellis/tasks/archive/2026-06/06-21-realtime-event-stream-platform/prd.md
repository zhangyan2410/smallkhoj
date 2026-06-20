# Realtime Event Stream Platform

## Goal

Build a browser-facing realtime event stream so SmallKhoj UI updates immediately when backend-visible events happen: agent messages, human messages, task changes, member status changes, and workspace/runtime lifecycle changes.

The first visible product win is chat: when an agent sends a message to a channel, the already-open chat page must show it without a manual browser refresh. The same architecture must be extensible enough for tasks, computers/workspaces, notifications, and future streaming agent UI.

## Decision

Use **SSE over HTTP**, consumed by the browser through **fetch streaming**, not native `EventSource`.

This is a single task, not "MVP now, hardening later". Implementation can be phased internally, but the task's design target is the full extensible realtime platform.

Fanout decision for this task: keep Redis deferred. Use the database as source of truth, use an in-process hub for local subscribers, and implement or explicitly wire the production fanout seam around **Postgres LISTEN/NOTIFY** first. Do not add Redis as a runtime dependency in this task.

## Why This Shape

### Why SSE

- The current product need is backend-to-browser push.
- Chat/task/workspace updates are mostly server-originated events.
- SSE works well through normal HTTP infrastructure and is simpler than WebSocket for one-way update streams.
- FastAPI can expose SSE with `StreamingResponse`.
- We already have separate daemon WebSocket/control-plane paths; frontend realtime must not reuse those private channels.

### Why Fetch Streaming, Not Native EventSource

Native `EventSource` cannot send custom headers. SmallKhoj frontend currently uses public API headers such as `X-Public-Key` and account/session tokens. A fetch-based SSE reader keeps the same auth model as existing API calls.

### Why Not Frontend Custom WebSocket

`frontend/server.ts` contains a custom WebSocket server, but normal Next dev/start flows do not enable it. The realtime product path must work under normal frontend startup, so it should not depend on that server.

### Why Not Browser-to-Daemon WebSocket

The daemon WebSocket is control-plane/runtime infrastructure. The browser needs a product event stream filtered and shaped by the backend. Do not expose daemon control payloads to UI clients.

## External References

Primary reference: **agent-platform**

- `/Users/code/project/agent-platform/internal/sse-consumer/src/read-sse.ts`
- `/Users/code/project/agent-platform/internal/sse-consumer/src/run-turn.ts`
- `/Users/code/project/agent-platform/web/src/lib/api/sse.ts`
- `/Users/code/project/agent-platform/web/src/stores/agent-session-store.ts`

What to learn:

- Fetch-based SSE parser over `ReadableStream`.
- Stream consumer with abort, reconnect, timeout, and plugin/handler isolation.
- Frontend store actions as the only place where SSE events mutate chat state.
- Reconnect flow scoped by session/event stream, not global blind reloads.

Secondary reference: **Clowder AI**

- `/Users/code/project/clowder-ai/packages/api/src/infrastructure/websocket/ThreadSequencer.ts`
- `/Users/code/project/clowder-ai/packages/api/src/infrastructure/websocket/SocketManager.ts`
- `/Users/code/project/clowder-ai/packages/web/src/hooks/useAgentMessages.ts`

What to learn:

- Per-thread/per-scope monotonic sequence numbers.
- Server epoch to detect backend restart and reset client high-water marks.
- Gap detection followed by catch-up instead of silent stale UI.
- Duplicate event dropping.
- Single frontend projection/reducer boundary so live events and hydrated history do not fight each other.
- Stable message identity to avoid duplicate or wrongly merged bubbles/messages.

Do not copy Clowder's full Socket.IO + bubble pipeline. Borrow the consistency discipline.

## Current SmallKhoj Facts

- Chat channel page currently uses SSR initial data plus client-side fetches.
- `frontend/app/chat/[channel]/channel-client.tsx` owns visible channel state.
- `backend/routers/public_api.py` exposes public message/task/member/workspace APIs.
- `backend/services/daemon_control.py` already has daemon/control event concepts, but those are not a browser product stream.
- There is an older `.trellis/tasks/06-02-P1-realtime-events` task marked done, but it focused on daemon realtime delivery and does not solve browser UI auto-refresh.
- `.trellis/tasks/06-09-production-readiness-broadcast-cache/architecture-gap-analysis.md` already identifies multi-process fanout as a production concern.

## Product Requirements

- Open chat pages update when backend/agent creates a message.
- Task board can update or refetch when tasks are created/updated.
- Computers/workspaces page can update or refetch when daemon/runtime lifecycle changes.
- Member/agent status changes become visible without full-page manual refresh.
- The stream should be inspectable and debuggable: disconnects, reconnects, gaps, duplicate drops, and catch-up should be visible in logs or dev diagnostics.
- The first implementation must be good enough for demo/competition usage, but the contracts should not block production hardening.

## Technical Requirements

### Backend

- Add a browser-facing event stream endpoint, likely `GET /api/v1/events/stream`.
- Use existing public API auth model (`X-Public-Key` and account/session headers where applicable).
- Return `text/event-stream`.
- Emit heartbeat comments to keep idle connections alive.
- Cleanup subscriber state on disconnect.
- Define a stable public event envelope.
- Attach event scope, type, id, cursor/order fields, and payload.
- Publish public UI events after relevant DB writes.
- Keep browser event payloads separate from daemon control commands.
- Preserve DB as source of truth; event stream is delivery/wakeup, not authoritative storage.

### Frontend

- Add a fetch-stream SSE helper inspired by agent-platform's `readSSE`.
- Add a higher-level realtime event subscriber with:
  - abort on unmount/session change
  - reconnect with bounded backoff
  - JSON parse isolation
  - duplicate guard
  - gap/catch-up hook
- Use existing frontend auth/header helpers.
- Do not use native `EventSource`.
- Do not use `frontend/server.ts` WebSocket.
- Wire chat page first, then task/computer/member surfaces.
- Use a single state/projection boundary for each product surface, not scattered event handlers.

### Event Envelope

Target shape:

```json
{
  "id": "event-id",
  "type": "message.created",
  "scope": {
    "kind": "channel",
    "id": "channel-id",
    "name": "general"
  },
  "seq": 42,
  "epoch": "backend-stream-generation",
  "createdAt": "2026-06-21T00:00:00Z",
  "payload": {
    "message": {}
  }
}
```

Fields:

- `id`: stable event id or durable event record id.
- `type`: event kind, e.g. `message.created`.
- `scope`: event routing scope, e.g. channel, dm, task, workspace, member.
- `seq`: monotonic sequence within scope.
- `epoch`: backend event stream generation, changes on backend restart or sequencer reset.
- `createdAt`: server timestamp.
- `payload`: product-safe data needed to patch/refetch UI.

If the first implementation cannot fully persist `seq` yet, it must still expose the field or clearly document the temporary fallback. Do not hide lack of catch-up behind optimistic naming.

## Event Types

Priority event types:

- `message.created`
- `message.updated`
- `message.deleted`
- `reaction.updated`
- `task.created`
- `task.updated`
- `member.status.updated`
- `workspace.updated`
- `runtime.updated`
- `computer.status.updated`

Additional future event types can reuse the same envelope.

## Ordering / Catch-Up Rules

Frontend should track high-water marks per scope:

- Same epoch and `seq == lastSeq + 1`: apply event.
- Same epoch and `seq <= lastSeq`: duplicate/late event, drop.
- Same epoch and `seq > lastSeq + 1`: gap detected, run catch-up/refetch for that scope.
- New epoch: backend likely restarted or sequencer reset, run catch-up/refetch and reset high-water mark.

For the first version, catch-up can be a narrow refetch of current channel/tasks/workspaces. It does not need a perfect offline replay mechanism, but the gap must not be ignored silently.

## Frontend Projection Rules

- Live events and fetched history must converge to the same visible state.
- Dedupe by stable resource id, e.g. `message.id`, `task.id`, `workspace.id`.
- Prefer narrow patch for simple `message.created`.
- Prefer debounced refetch for complex updates such as reaction/thread/task/workspace state.
- Avoid multiple components each mutating the same resource list independently.
- Do not create duplicate chat messages when local send and stream event both arrive.

## Multi-Process Fanout

The implementation should be designed behind a fanout interface:

- Local dev can use in-process subscribers.
- Production fanout should use Postgres LISTEN/NOTIFY first because SmallKhoj already depends on Postgres.
- Redis pub/sub is deferred and should only be reconsidered for later high-volume fanout, leases, presence, or distributed retry/dedup needs.
- Durable event rows remain source of truth.
- Broadcast is a wake-up path, not the only copy of the event.

This task should at least introduce the abstraction and document the production path. Prefer implementing the Postgres LISTEN/NOTIFY adapter now; if any part is deferred, the remaining seam must be concrete and Redis must remain out of the dependency graph.

## Implementation Phases Inside This Task

### Phase 1: Chat-Proven Vertical Slice

- Backend SSE endpoint.
- Fetch-stream frontend consumer.
- `message.created` emitted from channel message creation path.
- Chat page updates without manual refresh.
- Duplicate guard by message id.
- Real browser test with marker.

### Phase 2: Ordering and Reconnect

- Add event `seq` and `epoch`.
- Track high-water marks per scope.
- Add reconnect backoff.
- Add gap detection and catch-up refetch.
- Add structured logs for connect/disconnect/reconnect/gap/duplicate.

### Phase 3: Product Surface Expansion

- Add task events.
- Add workspace/runtime/computer status events.
- Add member status events.
- Wire relevant frontend pages to common subscriber path.

### Phase 4: Production Boundary

- Add fanout abstraction.
- Keep in-process implementation for local dev.
- Implement or concretely specify Postgres LISTEN/NOTIFY fanout behind the same interface.
- Do not introduce Redis in this task.
- Add tests for duplicate/gap/reconnect and, if implemented, simulated multi-process fanout.

## Acceptance Criteria

- [ ] `/chat/[channel]` shows a backend/agent-created channel message without manual browser refresh.
- [ ] Frontend stream uses fetch streaming and existing auth headers.
- [ ] Browser UI does not depend on `frontend/server.ts` custom WebSocket.
- [ ] Browser UI does not connect to daemon WebSocket.
- [ ] Event envelope includes type, scope, id, seq or documented seq fallback, epoch or documented epoch fallback, timestamp, and payload.
- [ ] Duplicate `message.created` events do not duplicate visible messages.
- [ ] SSE disconnect triggers reconnect with bounded backoff.
- [ ] Event gaps or epoch changes trigger catch-up/refetch rather than silent stale UI.
- [ ] Task updates can refresh the task UI through the same realtime event path.
- [ ] Workspace/runtime/computer status updates can refresh the relevant UI through the same realtime event path.
- [ ] Redis is not introduced as a new dependency or required service for this task.
- [ ] Postgres LISTEN/NOTIFY is implemented or the exact adapter seam/config/test plan is documented behind the event hub interface.
- [ ] Backend subscriber cleanup is tested or otherwise verified.
- [ ] Targeted backend tests pass.
- [ ] Targeted frontend tests/type checks pass.
- [ ] Real browser test with a unique marker proves chat auto-refresh without reload.
- [ ] `./smallkhoj-trace summary --json` or equivalent logs show the backend/runtime event path for the real test when daemon/agent delivery is involved.

## Out of Scope

- Token-by-token assistant rendering unless the event stream naturally exposes it.
- Replacing daemon/runtime control-plane protocol.
- Full Clowder bubble model migration.
- Cross-user authorization beyond the existing SmallKhoj public/account auth model.
- Shipping Redis if local/postgres-backed fanout is enough for current deployment.

## Real Test Marker

Use:

```text
REAL_realtime_event_stream_<YYYYMMDDHHMMSS>
```

Required proof:

1. Open chat page with `./twd`.
2. Start SSE subscription by loading the page.
3. Create a message containing the marker through backend API, daemon/agent path, or product UI.
4. Do not manually refresh the browser.
5. Verify the marker appears in visible DOM.
6. Save screenshot and notes under this task's `evidence/` directory.

## Recommended Implementation Bias

Do not overfit to the final ideal before proving the vertical slice. But every Phase 1 choice should leave the Phase 2/3/4 path open:

- Use fetch streaming now.
- Use event envelopes now.
- Use scoped ids now.
- Add explicit TODOs only where the PRD allows a temporary fallback.
- Keep daemon/control payloads private.
- Keep DB as source of truth.
