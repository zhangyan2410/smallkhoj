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
- Activity→event map: `PUBLIC_ACTIVITY_EVENT_TYPES` in `routers/public_api.py` (supervisor_* activity kind → dotted public event type)
- Event type normalization: `PUBLIC_EVENT_TYPE_ALIASES` + `_event_scope()` in `services/public_events.py`; `EVENT_TYPE_ALIASES` (dotted→legacy) in `routers/public_api.py`
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
- **Runtime activity command previews are summaries, not transcripts.** `runtime_output.details.commandPreview` must be optional and token-safe. It must redact/remove Slock proxy internals such as `SLOCK_AGENT_PROXY_URL`, `SLOCK_AGENT_PROXY_TOKEN`, `SLOCK_AGENT_PROXY_TOKEN_FILE`, `SLOCK_AGENT_ACTIVE_CAPABILITIES`, and any `agent-proxy-tokens` filesystem path before the backend stores it or the UI renders it. Generated `.slock/slock`, `.cmd`, and `.ps1` wrapper paths must be normalized to the semantic `slock` command before the generic 200-character activity limit is applied; otherwise a long isolated-workspace path can consume the entire preview and make an actual `slock message send` indistinguishable from an unrelated command. The UI must not depend on full command text for product behavior.

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
  - a runtime tool command or wrapper snippet containing Slock proxy env assignments does not persist those env names or `agent-proxy-tokens` paths in `runtime_output.details.commandPreview`.
  - a real-length isolated `.slock-runtimes/.../.slock/slock message send`
    command is normalized before truncation and retains the `slock message send`
    semantic prefix without its absolute workspace path.

### Adding a new EventRecord type — required checklist

When you add a new dotted event type (e.g. `member.created`, `foo.updated`) by
extending `PUBLIC_ACTIVITY_EVENT_TYPES` + `PUBLIC_EVENT_TYPE_ALIASES` +
`_event_scope()`, you MUST verify the runtime-delivery gate, not just the SSE
browser fanout:

1. **Scope handler** — add a branch to `_event_scope()` in
   `services/public_events.py` so the event carries a meaningful `scope`
   (`{kind, id}`). Frontends filter on scope; a missing branch produces
   `scope={kind:"server"}` and may over- or under-deliver.
2. **Runtime gate** — confirm the daemon proxy at
   `agent/daemon/aaa-daemon/src/daemon/daemon.ts` drops it. The gate is
   `isRuntimeActionableEventType(eventType)` inside the `event_received`
   handler: only `task_created`/`task.created`/`thread_summary_requested`
   reach `deliverRuntimeMessage`. UI-only events (`member.*`, `workspace.*`,
   `computer.*`, `reminder.*`) must NOT be added to that allowlist unless the
   event is genuinely actionable runtime work.
3. **Message freshness** — confirm the new type is not `message.*` so it
   cannot pollute pending-message freshness in the proxy.
4. **Alias symmetry** — add the dotted→legacy pair in both
   `EVENT_TYPE_ALIASES` (backend `public_api.py`) and the daemon's
   `_dotted_event_type` / `_legacy_event_type` maps if clients rely on the
   legacy name.

Lesson source: task `06-22-06-22-frontend-realtime-sync-fixes` added
`member.created` for Members-page auto-refresh. It is UI-only; the daemon
proxy gate correctly drops it, so no runtime receives a spurious turn.

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

## Scenario: Runtime Control Results Must Belong To The Delivered Control Turn

### 1. Scope / Trigger

- Trigger: changing `daemon/runtime_control`, provider slash-command mapping,
  `ManagedRuntimeDriver.sendUserMessage(..., { control: true })`, or collection
  of provider `stream_event` output for context/usage/compact observations.

### 2. Signatures

- Request: `DaemonRuntimeControlCommand { action, agentId, workspaceId?, waitForResult?, timeoutMs? }`.
- Delivery: `ManagedRuntimeDriver.sendUserMessage(slashCommand, { control: true }): boolean`.
- Result: `DaemonRuntimeControlResult { accepted, delivered, action, agentId, runtime?, slashCommand?, reason?, output?, outputTruncated?, error? }`.
- Output budget: at most 65,536 captured characters per control result.

### 3. Contracts

- A runtime control command is immediate-only. A busy or not-yet-writable
  driver returns `false` and must not enqueue `{ control: true }` input for a
  later turn.
- `accepted=true` means the daemon recognizes and supports the requested
  action; `delivered=true` separately proves the provider runtime accepted the
  slash command immediately.
- The daemon may arm a result collector before sending so it cannot miss fast
  asynchronous output, but the collector remains valid only if
  `sendUserMessage` returns `true`.
- Busy state returns `delivered=false, reason=runtime_control_busy` without
  calling `sendUserMessage` or subscribing to the shared stream.
- A false send returns
  `delivered=false, reason=runtime_control_not_delivered`; a thrown send
  returns its sanitized error. Both paths detach the collector immediately.
- Assistant text is captured only until the control output budget. Extra text
  is discarded and `outputTruncated=true` is returned. Timeout, result, send
  failure, and rejected delivery all detach the listener exactly once.
- Provider stream events do not currently carry a cross-runtime control-turn
  identifier. Therefore queued delivery must fail closed; temporal proximity
  to the first later `assistant` or `result` event is not correlation proof.

### 4. Validation & Error Matrix

| Condition | Expected result |
| --- | --- |
| Runtime or workspace missing | `accepted=false`, `delivered=false`, explicit runtime/workspace reason. |
| Runtime is busy | `accepted=true`, `delivered=false`, `reason=runtime_control_busy`, no queued control input. |
| Driver returns `false` despite a pre-send idle check | `accepted=true`, `delivered=false`, `reason=runtime_control_not_delivered`, collector detached. |
| Driver throws while sending | `delivered=false`, error returned, collector detached immediately. |
| Assistant output exceeds 65,536 characters | Output is capped at 65,536 characters and `outputTruncated=true`. |
| Matching immediate control turn emits `result` | Collector returns bounded output and detaches. |
| No result before bounded timeout | `reason=runtime_control_timeout`; partial bounded output may be returned and listener detaches. |

### 5. Good/Base/Bad Cases

- Good: an idle Claude runtime accepts `/context`, emits assistant text and a
  result, and the daemon returns that bounded text with `delivered=true`.
- Base: a busy runtime returns `runtime_control_busy`; the caller can retry
  after observing idle.
- Bad: enqueue `/status` behind an existing user turn and treat that turn's
  first later `result` event as the status response.
- Bad: leave a collector attached until timeout after stdin send throws.
- Bad: append provider text without a control-plane size budget.

### 6. Tests Required

- Daemon boundary tests must assert busy controls do not invoke send, consume
  unrelated output, or retain a `stream_event` listener.
- Send-throw and false-send tests must assert immediate listener cleanup and
  explicit delivery/error state.
- Output-budget tests must emit more than 65,536 characters and assert the
  exact cap plus `outputTruncated=true`.
- Claude and Codex ACP driver tests must assert ordinary user messages still
  queue while busy but control messages do not.
- The successful JSON-RPC control-result test must continue to prove that an
  immediately delivered command captures its actual provider output.

### 7. Wrong vs Correct

#### Wrong

```typescript
const result = collectFirstGlobalResult(driver);
const delivered = driver.sendUserMessage('/status', { control: true });
// delivered=false may mean queued; the next result can belong to older work.
return result;
```

#### Correct

```typescript
if (driver.busy) return { accepted: true, delivered: false, reason: 'runtime_control_busy' };
const collector = collectBoundedControlResult(driver);
const delivered = driver.sendUserMessage('/status', { control: true });
if (!delivered) {
  collector.settle({ reason: 'runtime_control_not_delivered' });
  return { accepted: true, delivered: false, reason: 'runtime_control_not_delivered' };
}
return collector.promise;
```

---

## Scenario: Browser Public Realtime SSE Events

### 1. Scope / Trigger

- Trigger: adding or changing browser-facing realtime events under `GET /api/v1/events/stream`.
- This is separate from daemon/runtime delivery. Browser events wake product UI surfaces; runtime events become model work only when explicitly classified by the runtime delivery contract above.

### 2. Signatures

- Public stream: `GET /api/v1/events/stream?scopeKind=<kind>&scopeId=<id-or-name>`
- Auth: public API auth through `X-Public-Key` only. Reusable credentials in query strings are rejected.
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
- Compacted and minimal Postgres NOTIFY envelopes must preserve the selected Server
  identity both as top-level `serverId` and `payload.serverId`. Cross-process SSE
  authorization uses that identity; dropping it makes every other backend worker
  discard an otherwise valid event. If even the minimal identity-bearing envelope
  cannot fit the payload limit, fail before calling `pg_notify`.

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
| Large Server-scoped event is compacted | `serverId` remains available at the top level and in `payload`; same-Server subscribers can receive it and foreign-Server subscribers reject it. |

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
- Unit: compact and minimal NOTIFY envelopes retain Server identity, and an identity
  too large for the minimal envelope is rejected.
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

---

## Scenario: PostgreSQL Fanout and SSE Resource Ownership

### 1. Scope / Trigger

- Trigger: changing PostgreSQL `LISTEN/NOTIFY`, browser or agent SSE routes, database pool sizing, backend worker count, reconnect logic, or application lifespan startup/shutdown.

### 2. Signatures

- Process owner: `services.public_events.PostgresNotifyRuntime`.
- Lifespan entrypoints: `start_postgres_public_event_listener()` and `stop_postgres_public_event_listener()`.
- Publisher pool application name: `smallkhoj-notify-publisher`.
- Listener application name: `smallkhoj-notify-listener`.
- Public stream: `GET /api/v1/events/stream`.
- Agent stream: `GET /internal/agent-api/events/stream`.
- Frozen agent claim: `AgentEventStreamClaims(member_id, server_id)`.
- Connection budget: `(DATABASE_POOL_SIZE + DATABASE_MAX_OVERFLOW + NOTIFY_PUBLISHER_POOL_SIZE + 1 listener) * BACKEND_WORKERS + BETTER_AUTH_DATABASE_POOL_SIZE + (DATABASE_POOL_SIZE + DATABASE_MAX_OVERFLOW) Feishu-worker reserve + POSTGRES_CONNECTION_HEADROOM <= POSTGRES_MAX_CONNECTIONS`.

### 3. Contracts

- One backend process owns at most one publisher pool and one listener generation. Repeated start/stop is idempotent.
- Publisher acquire/execute failure closes the failed pool, creates one replacement under a recovery lock, and retries only within `NOTIFY_PUBLISH_ATTEMPTS` and operation timeouts. It must not open an unbudgeted raw connection per event.
- Listener termination transitions to degraded/reconnecting, restores `LISTEN`, and rejects callbacks captured by an older generation.
- Listener, callback tasks, publisher pool, and connection close are bounded by `NOTIFY_SHUTDOWN_TIMEOUT_SECONDS`; shutdown must not wait forever.
- A request-scoped `AsyncSession` and live ORM entity must not escape into `StreamingResponse`. Setup/auth freezes primitive identifiers under a function-scoped dependency; agent polling opens a short session per poll and serializes frames before closing it.
- Public browser streaming is queue-based after setup and captures only the selected Server id, scope filter, request cancellation state, and queue.
- Queue capacity is bounded. Queue overflow may be best-effort/drop with observable logging; it must not grow without limit.
- The budget is deployment-wide, not backend-only. Better Auth owns one process-global
  `pg.Pool` with an explicit validated maximum. The optional Feishu worker is an
  independent SQLAlchemy process and is reserved even while its Compose profile is
  disabled. Operational headroom is not a substitute for either service pool.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Publisher connection is terminated | Replace pool and retry within the configured attempt/timeout budget; return to healthy after success. |
| Listener connection is terminated | Reconnect with capped backoff, restore `LISTEN`, and deliver the next event exactly once. |
| Callback from a stopped generation fires | Ignore it; do not publish. |
| Shutdown resource stalls | Log timeout, terminate where supported, and complete bounded shutdown. |
| Required connection budget exceeds capacity | Settings validation fails before startup with required/capacity/worker details. |
| SSE request remains open | Its setup dependency is already finalized; ordinary queries can acquire the pool. |
| Stream identity disappears between agent polls | Reject/terminate the poll path without retaining stale ORM state. |

### 5. Good/Base/Bad Cases

- Good: terminate the real listener and publisher PIDs in disposable PostgreSQL; new PIDs appear, two subsequent events each arrive once, and double stop leaves zero named owner connections.
- Good: with SQLAlchemy `pool_size=1,max_overflow=0`, hold either stream open and execute `SELECT 1` from an independent session.
- Base: a transient notification is dropped after the bounded retry budget while durable `EventRecord` remains the source of truth.
- Bad: `asyncpg.connect()` for every committed event, an unlimited raw-connect fallback, or increasing the SQLAlchemy pool to hide a retained SSE session.
- Bad: a stream closure captures `db`, `Member`, or `Server` from request setup.

### 6. Tests Required

- Unit state tests: idempotent lifecycle, publisher replacement, listener termination callback, stale generation rejection, reconnect cap, and bounded shutdown.
- Real PostgreSQL: terminate named publisher/listener connections, observe replacement/delivery exactly once, and assert zero owner connections after stop.
- Controlled ASGI/HTTP: observe `get_db` finalization after the ready frame while the stream remains open, then disconnect and assert subscription/task cleanup.
- Tiny real pool: independent query succeeds while public and agent streams remain open.
- Configuration: the complete backend + Better Auth + Feishu worker + headroom budget
  accepts the documented default, calculates three backend workers as 84 connections,
  and rejects capacity 83.

### 7. Wrong vs Correct

#### Wrong

```text
request session -> StreamingResponse closure -> open for hours
event commit -> new asyncpg TCP connection -> pg_notify -> close
```

#### Correct

```text
short setup session -> frozen claims -> dependency finalized -> bounded stream state
lifespan owner -> publisher pool + generation-guarded listener -> bounded recovery/shutdown
```
