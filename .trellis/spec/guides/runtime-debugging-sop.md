# Runtime Debugging SOP

> **Purpose**: When an agent doesn't reply / is slow / seems stuck, follow this standard flow instead of ad-hoc log-grepping. The Activity timeline is the primary entry point; it is fed by the daemon's verbose stream-json translator and shows the runtime's real state.

---

## The Four-State Timeline

Every runtime turn flows through four states. The Activity tab records each transition:

| State | kind | Color | What it means |
|---|---|---|---|
| **Working** 🟠 | `runtime_working` | orange | A message reached the runtime stdin (new turn started) |
| **Thinking** ⚪ | `runtime_thinking` | yellow | Claude Code is calling the provider (first `assistant` event) |
| **Output** 🔵 | `runtime_output` | blue | The runtime invoked a tool (`tool_use` block) |
| **Idle** 🟢 | `runtime_idle` | green | Turn finished (`result` event); carries token + duration metrics |

Data source of truth: **Claude Code verbose stream-json events**, reported by the daemon's `stream_event` handler. Not the daemon's self-measured guesses.

---

## Trace-ID End-to-End Latency Tracing

The four-state timeline answers "is the turn stuck, and where". For "the reply is **slow** — which segment is slow", use the trace-ID pipeline instead of grepping each layer's logs separately.

### How it works

- The backend generates a `traceId` at message creation (`backend/services/latency_trace.py` — `trace_id_from_request`, format `message:<hex>`; a caller-supplied `X-SmallKhoj-Trace-Id` header wins). The id rides the EventRecord payload over WS into the daemon (`message.traceId`) and tags every daemon/runtime span.
- Backend spans: `backend.public_message.*` / `backend.agent_send.*` — `request_received → resolve → db_flush → event_record → commit → push_events → response_ready`.
- Daemon/runtime spans: `daemon.websocket.message_received` (WS receipt) → `daemon.runtime_delivery.attempt` / `.sent_or_queued` → `daemon.runtime.stdin_write` → `daemon.runtime.first_output` → `daemon.runtime.result`.
- Every span is one `Latency trace: {traceId, span, elapsedMs, ...}` log line — backend into `.dev-logs/backend.log`, daemon via its log RPC. `smallkhoj-trace` parses both.

### Standard path for "reply is slow"

1. `./smallkhoj-trace latency` — groups spans by traceId, prints each as `+elapsed` from the first event. Widen the window with `--tail N`; raw events with `--json`.
2. `./smallkhoj-trace summary --json` — cross-layer timeline + service health, to see which layer stopped emitting.
3. `./smallkhoj-trace follow` — live 2s refresh while reproducing the slow turn.

### Notes

- This is the **only ready-made view spanning the full backend → WS → daemon → runtime chain**. Don't reconstruct the timeline from a single layer's log — one layer can't attribute time lost between layers.
- Within a layer, `elapsedMs` is monotonic-clock based; cross-layer offsets come from wall-clock `at` timestamps, so treat cross-layer gaps as approximate (second-level).
- For provider latency numbers use daemon-measured `wallClockMs`, never provider-reported `durationApiMs` (inflated — see Step 4 and the MiniMax note above).

---

## Standard Debugging Flow

### Step 1: Read the Activity timeline

Open the agent's **Activity** tab. Find the last `runtime_working` entry (the message you sent). Then read forward:

- **Stops at Working, no Thinking follows** → message never reached the runtime. Check daemon WS connection, `start_runtime` control command, and whether the runtime process is alive.
- **Stops at Thinking** → provider is slow or down. Look at the Idle entry that eventually follows (or doesn't) — if there are many `api_retry` events in the daemon log between Thinking and the next state, the provider (GLM/Kimi/MiniMax) is the bottleneck.
- **Stops at Output** → a tool call is hanging. The Output entry's `details.toolName` tells you which tool. Check slock CLI health, file permissions, etc.
- **Reaches Idle but channel has no reply** → the runtime finished its turn but never called `slock message send`. This is the **kimi-for-coding** failure mode — the model answers as plain text instead of using the slock CLI. Confirm in Step 3.

### Step 2: Confirm ground truth in the session file

The Activity timeline is derived from stream events. If it looks wrong, check the source:

```
~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
```

- `<encoded-cwd>` = the runtime workspace path with `/` → `-` and leading `-`.
- Each line is a JSON object: `user` (injected message or tool_result), `assistant` (model output + tool_use), `result` (turn summary with usage).
- **Token counts in the session file are the real billed numbers.** The daemon trace's `cacheReadInputTokens` may be inflated by provider Anthropic-compat adapters (MiniMax is known to over-report ~2-8×). Trust the session file.

### Step 3: Check for the "no slock send" failure

If the runtime reached Idle but the channel shows no agent reply:

1. Open the session jsonl for that turn.
2. Look at the `assistant` message's `content` blocks.
3. If there are **zero `tool_use` blocks** (or none with `slock message send`), the model answered as plain chat text — the reply was generated but never posted to the channel.

Known offenders: `kimi-for-coding`. Mitigation: the warmup gate (startup readiness check) exposes this early — such runtimes time out at `starting` status and degrade with `reason=warmup_timeout` in the trace.

### Step 4: Diagnose metric anomalies

If `cacheReadInputTokens` looks unrealistically high (e.g., 70k+ on a fresh session):

- Check the daemon trace's `providerReportedInflated` field — if `true`, the provider's usage report is unreliable.
- Use `wallClockMs` (daemon-measured, never inflated) for latency comparisons instead of `durationApiMs` (provider-reported).
- For real token counts, read the session file's `message.usage.cache_read_input_tokens`.

---

## Key Files

| What | Where |
|---|---|
| Four-state translator | `agent/daemon/aaa-daemon/src/daemon/daemon.ts` — `stream_event` handler + `reportRuntimeActivity` |
| Activity write API | `backend/routers/agent_api.py` — `POST /internal/agent-api/activity` + `_record_activity` |
| Activity kinds → events | `backend/routers/agent_api.py` — `ACTIVITY_EVENT_TYPES` |
| Frontend rendering | `frontend/app/(app)/members/activity-tab.tsx` — icon/label/color/bucket maps |
| Session ground truth | `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` |

---

## Design Principles (why it's built this way)

1. **Verbose stream-json is the single source of truth.** The daemon translates, it doesn't guess. No self-meured heuristics for runtime state.
2. **Truncation happens daemon-side** (200 chars per string field) — minimizes network bandwidth and keeps `activity_logs` rows small.
3. **Backend `_record_activity` is storage-agnostic.** Details are flat JSON, no SQL-relationship dependencies. When activity volume grows, the storage can migrate to NoSQL (Mongo/DynamoDB) by swapping only `_record_activity`'s implementation — daemon and frontend stay unchanged.
4. **Warmup gate before any activity.** The four-state translator only fires after `runtime.ready` is true, so startup noise doesn't pollute the timeline.
