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
