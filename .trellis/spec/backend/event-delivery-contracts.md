# Event Delivery Contracts

> Runtime delivery, event filtering, and activity/event separation contracts.

---

## Scenario: Activity/Event Changes Must Not Create Runtime Noise

### 1. Scope / Trigger

Use this spec whenever code changes any of:

- `ActivityLog` creation or `ACTIVITY_EVENT_TYPES`
- `EventRecord` creation, event type aliases, or payload shape
- daemon WebSocket / SSE / polling delivery
- daemon proxy event buffering or freshness checks
- runtime message formatting or delivery
- task/message/thread/reminder events that may reach an agent runtime

### 2. Signatures

- Backend event storage: `event_records(server_id, seq, event_type, actor_id, channel_id, message_id, task_id, payload)`
- Backend activity storage: `activity_logs(server_id, agent_id, kind, description, details, channel_id, task_id)`
- Daemon WS: `WS /internal/agent-api/ws?eventLogCursor=<seq>`
- Agent polling/SSE: `/internal/agent-api/events`
- Runtime delivery: `ClaudeRuntimeDriver.sendUserMessage()`
- Proxy freshness: `readUpToSeq`, `seenUpToSeq`, pending `message_received` events

### 3. Contracts

- **Activity is observability, not work.** Runtime state activities such as `runtime_working`, `runtime_thinking`, `runtime_output`, and `runtime_idle` are for UI/debug timelines. They must not become prompts delivered back into the same runtime.
- **Only actionable events reach runtimes.** Runtime delivery is allowed for concrete inbound work: visible `message.created`, assigned `task.created`, targeted `thread.summary_requested`, and explicit control commands. New event types are non-runtime by default until this spec says otherwise.
- **Self-authored message events are suppressed for runtime delivery.** A `message.created` where `actor_id == receiving_agent.id` must not be delivered back to that same runtime; otherwise the model can answer itself, waste tokens, or loop.
- **Targeted events are exclusive.** When `payload.targetAgentId` exists, only that agent may receive the event. Do not also broadcast it by channel membership.
- **Workspace and heartbeat events stay out of runtime inboxes.** `workspace.*`, daemon heartbeat, register/heartbeat-derived status refreshes, and high-volume activity must update state/UI only.
- **Event cursors advance over invisible events.** A daemon connection should not repeatedly reconsider invisible or suppressed events. Cursor handling must advance past them while delivering only visible/actionable events.
- **Dotted and legacy event names must normalize before classification.** `message.created` and `message_received` are equivalent for message delivery; `task.created` and `task_created` are equivalent for assigned task delivery.
- **Non-message events must not poison message freshness.** Task/thread/control events can be delivered to runtime when actionable, but they must not block later sends as pending unread messages.
- **Runtime prompt payloads must stay small and reply-safe.** A delivered message event must include `target` for replies and enough context to act, but not full activity feeds or unrelated event payloads.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Runtime reports `runtime_idle` activity | Activity appears in UI/debug surfaces only; no runtime receives it as a new turn. |
| Agent sends a message | `message.created` persists, but the sender runtime does not receive its own message as inbound work. |
| Human sends DM to one agent | Only the recipient agent runtime receives the event; `target` is `dm:@<human>` or thread-qualified. |
| Event has `targetAgentId` for agent A | Agent A receives it; agents B/C do not, even if channel-visible. |
| `workspace.heartbeat` or daemon heartbeat-like update | Updates current state only; no `EventRecord` delivered to runtime. |
| Dotted `task.created` assigned to agent | Delivered as actionable task work, but does not set pending message freshness. |
| Unknown new event type | Stored/visible where appropriate, but not delivered to runtime until explicitly classified. |

### 5. Good/Base/Bad Cases

- Good: adding a new UI activity kind only changes timeline rendering and API serialization.
- Good: adding a new runtime-actionable event updates backend visibility, daemon classification, runtime formatting, and tests together.
- Base: a channel `message.created` event is delivered to visible agents except the actor.
- Bad: mapping all `ActivityLog` kinds to `EventRecord` and pushing them over daemon WS.
- Bad: using `EventRecord.actor_id` as the daemon delivery target.
- Bad: delivering `runtime_output` / `runtime_idle` activity changes to the runtime that produced them.
- Bad: adding an event type that reaches daemon WS but lacks `targetAgentId` filtering or message freshness classification.

### 6. Tests Required

- Backend visibility test for `_event_visible_to_agent` / daemon event expansion:
  - self-authored `message.created` is suppressed for that agent.
  - `targetAgentId` delivers only to the target.
  - `workspace.*` and `thread.summary_updated` do not deliver to runtime.
- Daemon proxy classification test:
  - dotted and legacy message events normalize to `message_received`.
  - dotted task events are non-message runtime events and do not create pending message freshness.
  - unknown events are ignored or surfaced as non-runtime notifications, not prompts.
- Activity regression:
  - runtime activity reports create/update activity surfaces without generating runtime work.
  - heartbeat/register updates do not create high-volume activity/event records.
- Token regression:
  - a runtime that sends a message does not receive its own `message.created` event as a new turn.

### 7. Wrong vs Correct

#### Wrong

```text
ActivityLog(kind="runtime_idle") -> EventRecord(event_type="runtime.idle") -> daemon WS -> runtime prompt
```

This feeds the runtime its own telemetry and burns tokens without user work.

#### Correct

```text
Runtime stream event -> ActivityLog(kind="runtime_idle") -> Activity tab / trace only
```

Only concrete inbound work is eligible for runtime delivery.

---

## Scenario: Adding A New Event Type

Before introducing a new event type, answer these questions in code review:

1. Is it storage/UI-only, or should a runtime act on it?
2. If runtime-actionable, what is the exact target agent?
3. Does it need `targetAgentId`, `channelId`, `messageId`, `taskId`, or `threadId`?
4. Should it affect message freshness / pending sends?
5. Does it need replay on reconnect, or only live delivery?
6. What prevents self-echo loops?
7. Which WebDriver/API/DB/trace evidence proves the event reached the right place and nowhere else?

If any answer is unclear, do not deliver the event to runtime yet.

---

## Scenario: Browser Public Realtime SSE Events

### 1. Scope / Trigger

- Trigger: adding or changing browser-facing realtime events under `GET /api/v1/events/stream`.
- This is separate from daemon/runtime delivery. Browser events wake product UI surfaces; runtime events become model work only when explicitly classified by the runtime delivery contract above.

### 2. Signatures

- Public stream: `GET /api/v1/events/stream?scopeKind=<kind>&scopeId=<id-or-name>`
- Auth: existing public API auth through `X-Public-Key` or `api_key`.
- Response media type: `text/event-stream`.
- Backend envelope:
  - `id: string`
  - `type: string`
  - `scope: {kind: channel|dm|task|workspace|member|computer|server, id?: string, name?: string}`
  - `seq: number`
  - `epoch: string`
  - `createdAt: string`
  - `payload: object`
- Local fanout: `services.public_events.public_event_hub`.
- Cross-process seam: Postgres `LISTEN/NOTIFY` channel `smallkhoj_public_events`.

### 3. Contracts

- Public browser events are derived from committed `EventRecord` rows. The database remains the source of truth; the stream is a wake-up/patch path.
- Publish browser events only after the write transaction commits and the changed resource is refreshable through public APIs.
- Browser event payloads must stay product-safe. Do not expose daemon control commands, runtime prompt envelopes, local proxy secrets, machine tokens, or raw provider logs.
- `seq` currently uses durable `EventRecord.seq`, which is server-global and monotonic. Frontend catch-up may refetch on apparent gaps; future per-scope sequencing must preserve the same envelope field names.
- `epoch` changes when the backend process restarts, allowing clients to refetch/reset high-water state.
- SSE must emit heartbeat comments, not data events, for idle keepalive.
- Subscriber queues must be cleaned up on disconnect.
- Redis must not be introduced for this stream unless a later production-readiness spec explicitly changes the fanout decision.
- Postgres fanout must validate NOTIFY channel identifiers and keep payloads under the Postgres NOTIFY payload limit.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Missing/invalid public API key | HTTP 401 through `verify_public_api_key`. |
| Client disconnects | Subscription queue is removed from the in-process hub. |
| Idle stream | Emits `: heartbeat` comments within the configured heartbeat interval. |
| Duplicate event id reaches the local hub | Duplicate is dropped by recent-id memory. |
| Scope filter does not match | Event is not yielded to that subscriber. |
| Postgres NOTIFY channel contains unsafe characters | Adapter construction fails with `ValueError`. |
| Event payload exceeds NOTIFY payload budget | Adapter publish fails before sending oversized payload. |

### 5. Good/Base/Bad Cases

- Good: `message.created` from either public API or agent API commits an `EventRecord`, then publishes a browser envelope with channel scope and message payload.
- Good: `task.updated`, `member.status.updated`, `workspace.updated`, and reaction updates reuse the same stream endpoint and envelope.
- Base: local development uses the in-process hub and works with a single backend process.
- Base: production-shaped deployments can use Postgres `LISTEN/NOTIFY` behind the same public event envelope.
- Bad: using native browser `EventSource` when the client needs public API headers.
- Bad: sending daemon WebSocket/control-plane payloads directly to `/api/v1/events/stream`.
- Bad: adding Redis as a required service for this task.

### 6. Tests Required

- Unit: event envelope includes `id`, `type`, `scope`, `seq`, `epoch`, `createdAt`, and `payload`.
- Unit: heartbeat/comment and SSE frame formatting.
- Unit: in-process hub scope filtering and subscriber cleanup.
- Unit: Postgres NOTIFY seam validates channel names and builds `pg_notify`.
- API: `/api/v1/events/stream` returns `text/event-stream` and a ready frame with public auth.
- Integration/real test: an agent-created chat message appears in an already-open browser without manual refresh.

### 7. Wrong vs Correct

#### Wrong

```text
Agent/runtime EventRecord -> daemon prompt envelope -> browser stream
```

This leaks runtime-specific delivery semantics into product UI and risks exposing control-plane details.

#### Correct

```text
Committed EventRecord -> public event envelope -> /api/v1/events/stream -> frontend projector/refetch
```

The browser stream remains product-safe and independent from runtime prompt delivery.
