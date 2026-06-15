# Implementation Handoff / Discussion Notes

## Purpose

This task is currently in the **discussion/research** phase. The implementing agent should:

1. Read `prd.md` and this `info.md`.
2. Confirm the diagnosis with fresh traces (restart daemon if needed; see note below).
3. Propose the chosen optimization(s) to the human/team before writing code.
4. Implement the smallest coherent fix.
5. Capture before/after evidence in `evidence/`.

## How to Reproduce the Issue

1. Ensure the local stack is running:
   - PostgreSQL test DB on `:55432`
   - FastAPI backend on `:8000`
   - SmallKhoj daemon connected
2. Create or use an agent with provider `MiniMax` / model `MiniMax-M3`.
3. Send a DM to the agent.
4. Query daemon logs for `daemon.runtime.result`:
   ```bash
   curl -sS -X POST http://127.0.0.1:<daemon-proxy>/internal/daemon/jsonrpc \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"daemon/logs","params":{}}' \
     | python3 -m json.tool
   ```
5. Look for `durationApiMs`, `inputTokens`, `cacheReadInputTokens`, `model`.

> Note: the daemon background task has been killed a couple of times; generate a fresh connect token via `POST /api/v1/computers/connect-command` if needed.

## Cross-cutting Rules

- Do not use Playwright for UI verification; use `agent/daemon/webdriver/twd.py`.
- For runtime/control-plane changes, run `./smallkhoj-trace summary` and include the output in evidence.
- Update `.trellis/spec/` if a new policy about session lifetime or context limits is introduced.

## Suggested Evidence Checklist

- [ ] `daemon.runtime.result` trace before the fix (latency + token counts).
- [ ] `daemon.runtime.result` trace after the fix (latency + token counts).
- [ ] Screenshot or text log showing the agent still replies correctly.
- [ ] Notes explaining which candidate fix was chosen and why.

---

## 2026-06-15 Session Inspection Findings (Codex)

> Read the Claude Code session jsonl files directly from `~/.claude/projects/...`
> instead of trusting `daemon.runtime.result` traces. The session files are the
> ground truth for what the runtime actually saw, did, and was billed.

### Finding 1 — kimi-fresh DOES reply, but its replies never reach the channel

kimi-fresh (`d2bae91f`, model `kimi-for-coding`) received all 4 DMs and produced
an assistant response for each. Session file
`d98f9f3c-7e08-4304-b030-ac6c6881c962.jsonl` (last write 14:43, matching the last
"为什么没有回复" message) shows 4 complete user→assistant turns.

The problem: **every kimi-fresh assistant turn is pure text, with ZERO `tool_use`
calls.** It answers "Hello! I received your message. How can I help?" directly as
chat text instead of calling `slock message send`. So nothing is posted back to
the SmallKhoj channel.

Contrast with its siblings on the same daemon:
- `minimax-fresh` (`da7343dd.jsonl`): received msg → `slock message send` (1st
  attempt held, retried after `slock message check`) → reply delivered ✓
- `glm-fresh` (`5c3072bc.jsonl`): received msg → `slock message read` →
  `slock message send` → reply delivered ✓

**Root cause: `kimi-for-coding` does not follow the Slock system prompt's
"Always communicate through `slock` CLI commands" instruction.** It treats the
injected message as ordinary chat and answers in-band. This is a model
instruction-following issue, not a latency/context/delivery issue. The message
pipeline (WS → daemon → runtime stdin) is confirmed working.

Evidence paths:
- kimi-fresh: `~/.claude/projects/-Users-code-project-smallkhoj-agent-daemon-aaa-daemon--slock-runtimes-d2bae91f-8858-488b-b609-dd958cb31f57/d98f9f3c-7e08-4304-b030-ac6c6881c962.jsonl`
- minimax-fresh: `~/.claude/projects/...-bf28de6b.../da7343dd-cda1-4276-8ccd-19b5f789fdfd.jsonl`
- glm-fresh: `~/.claude/projects/...-eb329912.../5c3072bc-3df1-4758-ae78-c13d08290c96.jsonl`

Possible mitigations to discuss (separate from the latency work):
- Harden the system prompt: move the "reply via slock message send" rule to the
  very top as a hard requirement, or add a few-shot example of a forced tool call.
- Daemon-side guardrail: if a runtime turn ends with an assistant text block but
  no outbound `slock message send` was observed for that target, either (a)
  auto-post the text to the source target, or (b) nudge the runtime with a
  follow-up user turn. (Option (a) is the smallest change and recovers all
  providers that "forget" to send.)

### Finding 2 — The "MiniMax 72k/95k cacheReadInputTokens" claim is DISPROVEN

PRD section "Fresh Agent Test" claims minimax-fresh first reply had
`cacheReadInputTokens=71936` and minimax-test had `95494`, concluding MiniMax's
static prompt is ~4.5× larger than Kimi's. **The session files contradict this.**

Real `message.usage` from the session jsonl (ground truth):

| Provider (agent) | Session | 1st-turn input | 1st-turn cache_read | steady-state cache_read |
|---|---|---|---|---|
| MiniMax (minimax-fresh) | `da7343dd` | 23049 | 128 | ~23296 |
| MiniMax (minimax-test)  | `15b3eb62`, `4698e0d3`, `5dd4fdaa` | 21368–22791 | 370–1778 | ~22898–24098 |
| Kimi (kimi-fresh) | `d98f9f3c` | 21311 | 256 | ~21504–21760 |
| GLM (glm-fresh) | `5c3072bc` | 22998 | 64 | ~23040–23296 |

All three providers have a real static context of **~21–23k tokens**, within ~10%
of each other. There is no 72k/95k static prompt.

The inflated `cacheReadInputTokens` values in the `daemon.runtime.result` traces
must come from a mismatch between what the CC Switch MiniMax provider returns in
its `result.usage` payload and what Claude Code persists into the session file —
i.e. the daemon trace was reading a provider-reported number that MiniMax's
Anthropic-compat layer over-counts (possible duplicate cache accounting or a
context-window-sized value). The daemon trace path is
`daemon.ts:626 resultUsage?.cache_read_input_tokens`.

Implication for the optimization decision:
- Fix #3 in the PRD ("reduce static context size") and Fix #6 ("investigate CC
  Switch MiniMax adapter") were motivated by the 72k number. With the real
  number being ~23k, **static-context reduction yields at most a ~10% win** and
  is no longer the primary lever.
- MiniMax-M3 is still genuinely slower per call (~24s vs Kimi ~7.6s in the same
  runtime), so the latency gap is a model/provider speed issue, not a
  context-size issue.

### Finding 3 — Worker stack daemon currently NOT running on :3457

During this session the worker orchestration daemon (`SMALLKHOJ_DAEMON_PORT=3457`,
started by `start-worker-stack.sh`) was down. The live daemon that held the
`local-mac` computer lease was a `--runtime none --register-daemon` process
(pid 90933) that re-spawned all 6 fresh/test runtimes via backend
`start_runtime` control commands after the previous worker daemon died. That
process has no proxy port (`--proxy-port 0`), so the `daemon/logs` RPC path in
"How to Reproduce" above is currently unreachable — use the session jsonl files
and `smallkhoj-trace` instead.

### Revised recommendation

Given Findings 1 & 2, the highest-value, smallest changes are:

1. **Daemon reply guardrail (Finding 1):** when a runtime turn produces only
   assistant text and no `slock message send` tool_use for the incoming target,
   auto-post that text to the source target. Recovers kimi-for-coding (and any
   other provider that forgets the tool step) without prompt surgery. One
   focused change in `daemon.ts` runtime event handling.

2. **Trust session jsonl, not daemon trace, for token metrics (Finding 2):**
   stop using `daemon.runtime.result.cacheReadInputTokens` as the optimization
   north-star; it is provider-misreported. Either parse the real usage from the
   session file, or drop the metric and optimize on `durationApiMs` directly.

3. **Keep the session-reuse cap (original Fix #1):** still valid for
   long-running conversations where history genuinely accumulates. ~40k
   threshold on the *real* (session-derived) token count is reasonable.

Static-context shrinkage (Fix #3) and CC Switch MiniMax adapter work (Fix #6)
should be deprioritized until a real >40k reading is reproduced from a session
file.
