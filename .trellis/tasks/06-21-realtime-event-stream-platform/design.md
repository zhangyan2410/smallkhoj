# Realtime Event Stream Platform Design

## Summary

SmallKhoj needs one browser-facing realtime event stream, not separate one-off refresh mechanisms per page. The stream should start with chat auto-refresh but be shaped from day one for tasks, members, workspaces, runtimes, and future streaming UI.

Transport: HTTP SSE.

Browser implementation: `fetch` + `ReadableStream` parser.

State model: DB is source of truth; events are wake-up/patch signals.

Consistency model: scoped seq + epoch + catch-up.

Fanout model for this task: in-process hub locally, Postgres LISTEN/NOTIFY as the first production-leaning fanout path, Redis deferred.

## System Shape

```text
public API write / daemon activity / runtime heartbeat
  -> DB transaction
  -> public event envelope
  -> durable event cursor or scoped sequencer
  -> fanout hub
  -> GET /api/v1/events/stream subscribers
  -> frontend fetch-stream SSE consumer
  -> product event projector
  -> local patch or narrow refetch
```

## Backend Components

### Public Event Envelope

The browser stream should use one envelope shape:

```ts
type PublicEventEnvelope = {
  id: string
  type: string
  scope: {
    kind: 'channel' | 'dm' | 'task' | 'workspace' | 'member' | 'computer' | 'server'
    id?: string
    name?: string
  }
  seq: number
  epoch: string
  createdAt: string
  payload: Record<string, unknown>
}
```

### Event Hub

Introduce a small backend event hub interface:

```python
class PublicEventHub:
    async def publish(event: PublicEventEnvelope) -> None: ...
    async def subscribe(server_id: UUID | None = None) -> AsyncIterator[PublicEventEnvelope]: ...
```

Initial implementation can be in-process. The interface should not prevent Postgres LISTEN/NOTIFY or Redis pub/sub later.

For this task, do not add Redis. If cross-process delivery is implemented now, use Postgres LISTEN/NOTIFY behind the hub interface. If the Postgres adapter is not completed in the first pass, keep the interface and configuration seam concrete enough that adding it does not change router/frontend contracts.

### Event Sequencer

Borrow the Clowder idea:

- `seq` is monotonic within a scope.
- `epoch` identifies the current backend/sequencer generation.
- backend restart produces a new epoch.

The simplest first implementation can keep seq in memory per scope, as long as the frontend treats epoch changes as catch-up boundaries. If a durable `event_records` table is already better suited, prefer durable cursor ids.

### SSE Endpoint

Endpoint:

```http
GET /api/v1/events/stream?scopeKind=channel&scopeId=...
```

Scope filters can be optional in the first pass. A global server stream is acceptable if events are product-safe and frontend filters locally.

Response:

```text
event: message.created
id: <event-id>
data: {"id":"...","type":"message.created",...}

: heartbeat

```

Headers:

```text
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Auth:

- Same `X-Public-Key` validation as existing public APIs.
- Respect account/session headers where current frontend uses them.

Disconnect:

- Remove subscriber queue.
- Avoid leaking tasks/queues.

### Publish Points

Initial publish points:

- Channel message created.
- DM message created if DM page is included.
- Task created/updated.
- Workspace/runtime lifecycle changed.
- Computer/member status changed.

Events should publish after DB writes are committed or at least after the object is refreshable from API. A browser receiving an event should be able to refetch and see the new state.

## Frontend Components

### SSE Reader

Add a neutral parser, inspired by agent-platform:

```ts
async function* readSSE(response: Response, options?: { signal?: AbortSignal }) {
  // parse event/data/id lines from response.body
}
```

Do not use native `EventSource`.

### Realtime Client

Add a higher-level client:

```ts
connectRealtimeEvents({
  headers,
  scope,
  signal,
  onEvent,
  onStatus,
})
```

Responsibilities:

- fetch stream with auth headers
- parse SSE
- parse JSON
- reconnect with bounded backoff
- expose connection status
- abort cleanly
- isolate malformed events

### Product Projector

Use a product-level event projector per surface or a shared hook:

- chat projector: messages/channels/dms
- task projector: tasks
- workspace projector: computers/workspaces/runtimes

Rules:

- Dedupe by stable resource id.
- Track high-water mark by event scope.
- On normal next seq, apply simple patch.
- On duplicate, drop.
- On gap or epoch change, refetch the scope.
- Keep debounced refetch to avoid event storms.

### Chat Page Integration

`frontend/app/chat/[channel]/channel-client.tsx` should subscribe on mount.

For `message.created`:

- if current channel matches, append or merge by message id
- if payload lacks enough message data, call existing `loadMessages()`

For reaction/thread/task/sidebar-impacting events:

- call narrow refetch, debounced

## Catch-Up Contract

Client state per scope:

```ts
type HighWater = {
  epoch: string
  seq: number
}
```

Algorithm:

```text
no high-water: apply/refetch seed, store epoch+seq
same epoch, seq == last+1: apply
same epoch, seq <= last: drop duplicate/late
same epoch, seq > last+1: refetch scope, then set high-water
new epoch: refetch scope, reset high-water
```

The catch-up action can be a refetch. It does not need a perfect replay endpoint in the first implementation, but the behavior must be explicit.

## Multi-Process Path

Local development:

- in-process hub
- no Redis required

Production path:

- keep DB as source of truth
- add fanout implementation behind the hub interface
- first option: Postgres LISTEN/NOTIFY
- deferred option: Redis pub/sub only if later volume, deployment shape, leases, presence, or retry/dedup requirements justify it

Do not hardwire implementation details into routers.

## Observability

Backend logs:

- stream connected
- stream disconnected
- subscriber count
- event published
- publish failure

Frontend logs/dev diagnostics:

- connected
- disconnected
- reconnect attempt
- reconnect success/failure
- duplicate dropped
- gap detected
- catch-up started/completed

## Testing Strategy

Backend:

- SSE endpoint returns stream frames.
- subscriber cleanup works on disconnect.
- publish after message create emits event.
- seq increments per scope.
- epoch exists.

Frontend:

- SSE parser handles chunked event/data lines.
- duplicate message event is deduped.
- gap triggers refetch callback.
- epoch change triggers refetch callback.
- abort closes stream.

Real browser:

- open chat page
- create marker message from backend/agent path
- verify marker appears without reload

## Migration / Rollout

1. Add stream endpoint and frontend consumer behind normal product code path.
2. Wire chat first.
3. Add seq/epoch/gap behavior before expanding broadly.
4. Add task/workspace/member events.
5. Add fanout abstraction and production implementation when needed.

Rollback:

- If stream fails, existing fetch/SSR page load still works.
- Disable subscription while preserving manual refresh/send.
