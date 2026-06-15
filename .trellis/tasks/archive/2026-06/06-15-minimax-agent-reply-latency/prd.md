# MiniMax Agent Reply Latency & Context Bloat Investigation

> Status: **done**.  
> Note: The initial diagnosis in this document (that MiniMax's cache read was due to a ~96k static prompt) was incorrect. Another agent found that MiniMax's Anthropic-compatible adapter inflates reported `cache_read_input_tokens` by roughly **3× in `usage` and ~8× in `modelUsage`** compared to the actual session jsonl. The implemented fix adds a runtime warmup gate and flags `providerReportedInflated` in the latency trace rather than trying to reduce a non-existent 95k prompt.
>
> Owner: Kimi (diagnosis). Fix implemented by another agent. This task is archived for reference only.

> ⚠️ **2026-06-15 correction (Codex):** Section "Fresh Agent Test" below concluded that MiniMax's
> static prompt is ~72k tokens (4.5× Kimi). That conclusion is **disproven** by the Claude Code
> session files (`~/.claude/projects/...`), which are the ground truth. Real per-turn
> `message.usage.cache_read_input_tokens` for MiniMax is **~23k**, the same as Kimi (~21.5k) and
> GLM (~23k). The 72k/95k figures came from `daemon.runtime.result` traces that read a
> provider-reported `usage` field the MiniMax Anthropic-compat layer over-counts. MiniMax is still
> slower per call (~24s vs Kimi ~7.6s), so the latency gap is a model/provider speed issue, not a
> context-size issue. See `info.md` → "Finding 2" for the full token table and evidence paths.
>
> A second unrelated issue was also found: **kimi-fresh does not reply in-channel because
> `kimi-for-coding` answers as plain text instead of calling `slock message send`** (zero tool_use
> per turn). minimax-fresh and glm-fresh both send correctly. See `info.md` → "Finding 1".

## Problem Statement

`@minimax-test` (MiniMax-M3 via CC Switch / Claude Code runtime) takes **15–25s** to reply to a simple DM. Initial hypothesis was routing overhead inside SmallKhoj; after adding fine-grained latency traces, the bottleneck is the upstream model API call.

## Key Observations

### 1. Latency breakdown

Latest `daemon.runtime.result` latency traces:

```json
{
  "durationApiMs": 19537,
  "inputTokens": 3622,
  "outputTokens": 868,
  "cacheReadInputTokens": 95494,
  "model": "MiniMax-M3"
}
{
  "durationApiMs": 22144,
  "inputTokens": 210,
  "outputTokens": 107,
  "cacheReadInputTokens": 26264,
  "model": "MiniMax-M3"
}
```

Daemon internal overhead is tiny:

| Span | Typical duration |
|---|---|
| `daemon.websocket.message_received` | ~0 ms |
| `daemon.runtime.stdin_write` | ~1 ms |
| `daemon.runtime.first_output` | ~10 ms |

**Conclusion: ~19–25s is almost entirely the upstream model API (`durationApiMs`).**

### 2. Where the 95k `cacheReadInputTokens` comes from

`cacheReadInputTokens` is not a single huge message. It is the **cached context that Claude Code re-reads on every turn**, made up of:

1. **Claude Code static system prompt + all tool definitions** (Bash, Read, Edit, Write, Glob, Grep, etc.). This alone is ~25k tokens.
2. **The Slock system prompt** appended by the daemon (`claude-system-prompt.md`, ~1.5k tokens).
3. **Conversation history accumulated in the current session** because the runtime is resumed every turn.

### 3. Session reuse is the amplification mechanism

The daemon keeps an in-memory `runtimeSessionIds` map and passes `--resume <sessionId>` to Claude Code on every restart/retry:

```ts
// agent/daemon/aaa-daemon/src/daemon/daemon.ts:555
const resumeSessionId = this.runtimeSessionIds.get(agentId) ?? this.config.runtimeResumeSessionId;
```

```ts
// agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts:201
if (options.resumeSessionId) {
  args.push('--resume', options.resumeSessionId);
}
```

Within one daemon process the same `session_id` is reused indefinitely, so every prior turn stays in context. The observed `session_id: 5dd4fdaa-4841-4864-9a6c-bbaf5fe17119` persisted across multiple result events.

Note: after the daemon process itself restarts, the map is empty, so the next runtime start gets a fresh session. The backend workspace `session_id` is **not** currently used to resume across daemon restarts.

### 4. Message input timing

User message → backend websocket → daemon → written to runtime stdin.

The daemon does not pre-feed future messages. If the runtime is offline, messages are queued and flushed once it starts. After start, the runtime also proactively calls `slock message check` to poll for pending messages, which is why logs often show a tool result like:

```json
{"state":"held","reason":"pending_messages","seenUpToSeq":0,"pendingCount":1,...}
```

### 5. Unnecessary tool turns add overhead

Before replying, the runtime typically performs:

- `slock message check`
- read `MEMORY.md` if present
- possibly `slock message read` / `slock server info`

Each tool call produces a result that becomes input tokens on the next API call, increasing both `inputTokens` and the number of turns.

## Fresh Agent Test (new session, no history)

To rule out session-history accumulation, brand-new agents were created for MiniMax, Kimi, and GLM under the same daemon/computer, and each was sent its very first DM.

### First reply results

**`@minimax-fresh` (MiniMax-M3)** — first reply:

```json
{
  "durationApiMs": 24114,
  "inputTokens": 24110,
  "outputTokens": 443,
  "cacheReadInputTokens": 71936,
  "model": "MiniMax-M3"
}
```

**`@kimi-fresh` (kimi-for-coding)** — first reply:

```json
{
  "durationApiMs": 7592,
  "inputTokens": 21311,
  "outputTokens": 112,
  "cacheReadInputTokens": 256,
  "model": "kimi-for-coding"
}
```

**`@kimi-fresh` second reply** (after the user sent another message):

```json
{
  "durationApiMs": 9852,
  "inputTokens": 311,
  "outputTokens": 49,
  "cacheReadInputTokens": 21504,
  "model": "kimi-for-coding"
}
```

**`@glm-fresh` (glm-5.2)** — first reply:

```json
{
  "durationApiMs": 216628,
  "inputTokens": 0,
  "outputTokens": 0,
  "cacheReadInputTokens": 0,
  "model": "glm-5.2"
}
```

(GLM did eventually reply, but the API call took ~3.6 minutes and reported 0 tokens, which suggests the GLM provider path has a separate issue.)

### What this tells us

> ⚠️ **The bullets below are SUPERSEDED — see the correction banner at the top of this PRD and
> `info.md` → "Finding 2".** They were derived from `daemon.runtime.result` traces whose
> `cacheReadInputTokens` field is misreported by the MiniMax Anthropic-compat layer. The Claude
> Code session files show all three providers have a real static context of ~21–23k tokens. Kept
> here only for traceability of how the original (incorrect) conclusion was reached.

- ~~The 71k+ `cacheReadInputTokens` is not accumulated conversation history.~~ A fresh MiniMax
  session's *real* cache_read (from session jsonl) is ~128 on the first call, ~23k steady-state.
- **Kimi’s first call had a cold cache (`256`), but its second call shows ~21.5k cached tokens.**
  This means Kimi’s static system/tool prompt is actually ~21k tokens; it just wasn’t counted as
  cache on the first call.
- ~~MiniMax’s static prompt is much larger than Kimi’s.~~ **WRONG** — both are ~21–23k per session
  files. The 72k/95k were provider-side over-counts.
- **So MiniMax is slow for one reason, not two:** MiniMax-M3 is genuinely slower per call than
  kimi-for-coding in this setup (~24s vs ~7.6s). Context size is not a differentiator.
- **Session reuse still amplifies the problem over time** as real history accumulates, but the
  baseline static context is comparable across providers and is not MiniMax-specific.

## Candidate Fixes (awaiting decision)

1. **Cap or reset session reuse**
   - Stop passing `resumeSessionId` when `cacheReadInputTokens` exceeds a threshold (e.g. 40k).
   - Or reset the session after N turns / after a period of idle time.
   - Trade-off: loses long-term in-conversation memory, but replies become fast again.

2. **Add default limits to `slock message check` / `slock message read`**
   - Currently neither command has a default `--limit`:
     ```ts
     if (group === 'message' && command === 'check') {
       const limit = getOption(rest, '--limit');
       ...
     }
     ```
   - Adding a small default (e.g. 10–20) prevents a busy channel from dumping hundreds of messages into context.

3. **Reduce static context size**
   - Disable unused Claude Code tools beyond the current `EnterPlanMode`, `ScheduleWakeup`, `CronCreate`, etc.
   - Shorten the Slock system prompt if sections are not strictly necessary.
   - Load memory/project docs only when needed, not on every turn.

4. **Push message context directly from daemon instead of making runtime poll**
   - If the daemon includes the message body and minimal channel context in the user message, the runtime can skip `slock message check` for simple replies.

5. **Provider/model switch**
   - Fresh-agent test shows Kimi replies in ~7.6–9.9s with ~21k cached tokens vs MiniMax ~24s with ~72k cached tokens under the same runtime.
   - Consider making MiniMax non-default, or let users pick per-agent, until the MiniMax provider context issue is understood.

6. **Investigate the CC Switch MiniMax adapter / system prompt**
   - The 72k cached prompt is loaded by the MiniMax provider path. Check whether CC Switch injects a large provider-specific system prompt, or whether `MiniMax-M3` via Claude Code uses a different tokenizer/context packing that inflates `cacheReadInputTokens`.
   - If the large prompt is unavoidable from the provider side, the fix may need to live in CC Switch rather than SmallKhoj.

7. **Streaming / first-token UX**
   - Does not reduce total time, but can show a typing indicator while the model call runs.

## Files to Read Before Deciding

- `agent/daemon/aaa-daemon/src/daemon/daemon.ts` — session reuse logic, message delivery.
- `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts` — `--resume`, system prompt file, command args.
- `agent/daemon/aaa-daemon/src/slock-cli.ts` — `message check` / `message read` implementation.
- `agent/daemon/aaa-daemon/src/proxy/agent-proxy.ts` — `/receive` and `/history` proxy paths.

## Acceptance Criteria for the Implementing Agent

- [ ] Pick one or more candidate fixes and document the choice in this task.
- [ ] Implement the smallest coherent change that measurably reduces `durationApiMs` or `cacheReadInputTokens`.
- [ ] Add a real-test evidence entry showing before/after latency metrics.
- [ ] Update `.trellis/spec/` if a new runtime-context policy is introduced.

## Evidence Already Collected

- `daemon.runtime.result` traces with `durationApiMs` / `inputTokens` / `cacheReadInputTokens` / `model`.
- DM conversation with `@minimax-test` showing ~17.6s end-to-end reply time.
- Workspace listing confirming `runtimeProvider: 358a7582-ac8b-4bd6-945c-cbf764047012` (MiniMax-M3).
- Fresh-agent comparison:
  - `@minimax-fresh` first reply: `durationApiMs=24114`, `cacheReadInputTokens=71936`.
  - `@kimi-fresh` first reply: `durationApiMs=7592`, `cacheReadInputTokens=256`.
  - `@kimi-fresh` second reply: `durationApiMs=9852`, `cacheReadInputTokens=21504`.
  - `@glm-fresh` first reply: `durationApiMs=216628`, `cacheReadInputTokens=0` (reported 0 tokens, but replied after ~3.6 min).
