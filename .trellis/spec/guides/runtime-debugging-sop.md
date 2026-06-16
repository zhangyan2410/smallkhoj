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
| Frontend rendering | `frontend/app/members/activity-tab.tsx` — icon/label/color/bucket maps |
| Session ground truth | `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` |

---

## Design Principles (why it's built this way)

1. **Verbose stream-json is the single source of truth.** The daemon translates, it doesn't guess. No self-meured heuristics for runtime state.
2. **Truncation happens daemon-side** (200 chars per string field) — minimizes network bandwidth and keeps `activity_logs` rows small.
3. **Backend `_record_activity` is storage-agnostic.** Details are flat JSON, no SQL-relationship dependencies. When activity volume grows, the storage can migrate to NoSQL (Mongo/DynamoDB) by swapping only `_record_activity`'s implementation — daemon and frontend stay unchanged.
4. **Warmup gate before any activity.** The four-state translator only fires after `runtime.ready` is true, so startup noise doesn't pollute the timeline.
