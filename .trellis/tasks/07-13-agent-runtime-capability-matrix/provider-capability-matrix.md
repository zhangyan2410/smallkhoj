# Provider Capability Matrix — Runtime and Reliable Wakeup Boundary

> Evidence cut: 2026-07-14. This is a capability spike, not a production adapter contract. The investigation is closed as of 2026-07-15; see [core-conclusion.md](core-conclusion.md) for the concise product decision.
>
> The authoritative raw transcript lifetime is `/tmp`; task-local evidence has been structurally redacted. In particular, model thought/message chunks, prompt text, hook payloads, opaque IDs, and credential-shaped values are not retained here.

## How to read this matrix

`V` means a clean, dynamic observation for this exact surface and version.
`C` means dynamically observed but constrained exactly as stated. `U` means unverified; no neighboring surface may fill that gap. `B` means the environment safely blocked progress. `NE` means not executed, not unsupported.

An Adapter/Provider terminal event, a successful prompt response, or a transport acknowledgement means only that layer completed. None of these cells mean that a SmallKhoj Work Item was semantically `handled`.

## Evidence index

| ID | What it proves | Status |
| --- | --- | --- |
| [E-static-Codex](evidence/static-20260714-v2/codex-version/evidence.json) | Codex CLI version `0.144.3` | static |
| [E-Codex-handshake](evidence/appserver-20260714-v2/codex-appserver-handshake/evidence.json) | app-server `initialize` and ephemeral `thread/start`, no model input | dynamic control-only |
| [E-Codex-steer](evidence/codex-steer-20260714/codex-appserver-active-steer-interrupt/evidence.json) | `turn/start` → same `turn/started` → `turn/steer(expectedTurnId)` accepted → `turn/interrupt` accepted | `delivery_uncertain`; user-global hook ran |
| [E-static-Claude](evidence/static-20260714-v2/claude-version/evidence.json) | Claude Code version `2.1.183` | static |
| [E-Claude-argv-failure](evidence/claude-busy-20260714/claude-stream-json-busy-input/evidence.json) | initial harness rejected a valid empty argv value before any model input | harness failure, 0/2 |
| [E-Claude-stream-failure](evidence/claude-busy-20260714-v2/claude-stream-json-busy-input/evidence.json) | first input was fail-closed consumed; CLI rejected missing `--verbose` before a stream event | timed out, 1/2 |
| [E-static-Kimi](evidence/static-20260714-v2/kimi-version/evidence.json) | Kimi Code version `0.21.1` | static |
| [E-Kimi-ACP-handshake](evidence/kimi-acp-handshake-20260714/kimi-acp-handshake/evidence.json) | ACP `initialize` + `session/new`; `loadSession` and `resume` advertised | dynamic control-only |
| [E-Kimi-ACP-sequential](evidence/kimi-acp-sequential-20260714/kimi-acp-sequential-session/evidence.json) | plan-mode ACP session; two same-session prompts reached `end_turn`; no tool-call event; fixture unchanged | dynamic, 2/2 |
| [E-static-OpenCode](evidence/static-20260714-v2/opencode-version/evidence.json) | OpenCode version `1.17.13` | static |
| [E-OpenCode-ACP-handshake](evidence/opencode-acp-handshake-20260714/opencode-acp-handshake/evidence.json) | ACP `initialize` + `session/new`; load/list/resume capability advertised | dynamic control-only |
| [E-OpenCode-ACP-sequential](evidence/opencode-acp-sequential-20260714/opencode-acp-sequential-session/evidence.json) | `--pure`, plan-mode ACP session; two same-session prompts reached `end_turn`; no tool-call event; fixture unchanged | dynamic, 2/2 |
| [E-Qoder-missing](evidence/static-20260714-v2/qoder-version/evidence.json), [E-ZCode-missing](evidence/static-20260714-v2/zcode-version/evidence.json), [E-Pi-missing](evidence/static-20260714-v2/pi-version/evidence.json) | local commands absent; no installation/login was attempted | `NE` |

## Core control matrix

| Provider / exact surface | Version | Invocation and session setup | Structured events | Observable completion boundary | Transport input acknowledgement | Busy-time second input | Cancel / post-cancel reuse | Active steer | Evidence / uncertainty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Codex exec | `0.144.3` | U | U | U | U | U | U | U | Static CLI only; do not inherit app-server results. [E-static-Codex](evidence/static-20260714-v2/codex-version/evidence.json) |
| Codex ACP | `0.144.3` CLI host | U | U | U | U | U | U | U | Existing SmallKhoj bridge/API is static code evidence only in this spike. |
| Codex app-server | `0.144.3` | V for `initialize`/ephemeral `thread/start` | V for `turn/started` notification | U: turn was interrupted before terminal completion | V at protocol layer for `turn/start`/`turn/steer` responses only | U: this is provider-specific steer, not generic queue evidence | Protocol `turn/interrupt` accepted; reuse U (no third input) | U for a safe production claim; protocol accepted once but the run is `delivery_uncertain` | [E-Codex-handshake](evidence/appserver-20260714-v2/codex-appserver-handshake/evidence.json), [E-Codex-steer](evidence/codex-steer-20260714/codex-appserver-active-steer-interrupt/evidence.json). A user-level hook executed outside the fixture. |
| Claude Code stream-json | `2.1.183` | U | U | U | U | U | U | U | One parser-level stream startup failure consumed 1/2 fail-closed budget; no `assistant` or `result` event was observed. Do not infer provider queueing. [E-Claude-stream-failure](evidence/claude-busy-20260714-v2/claude-stream-json-busy-input/evidence.json) |
| Kimi prompt mode | `0.21.1` | U | U | U | U | U | U | U | Budget was intentionally spent on ACP rather than prompt mode. |
| Kimi ACP | `0.21.1` | V for `initialize` + `session/new` | V: `session/update` | V: both `session/prompt` calls returned `stopReason=end_turn` | V only as ACP response acceptance | U | U (no cancel attempt) | U | Same resident session accepted two sequential prompts in plan mode. Cross-process load/resume and unfinished continuation remain U. [E-Kimi-ACP-sequential](evidence/kimi-acp-sequential-20260714/kimi-acp-sequential-session/evidence.json) |
| OpenCode serve | `1.17.13` | U | U | U | U | U | U | U | Serve/SSE was not started dynamically; do not infer from ACP. |
| OpenCode ACP | `1.17.13` | V for `initialize` + `session/new` | V: `session/update` | V: both `session/prompt` calls returned `stopReason=end_turn` | V only as ACP response acceptance | U | U (no cancel attempt) | U | `--pure` + plan mode; same resident session accepted two sequential prompts; no tool-call update observed. Cross-process load/resume and continuation remain U. [E-OpenCode-ACP-sequential](evidence/opencode-acp-sequential-20260714/opencode-acp-sequential-session/evidence.json) |
| Qoder CLI / QoderWork | command absent | NE | U | U | U | U | U | U | [E-Qoder-missing](evidence/static-20260714-v2/qoder-version/evidence.json). First-party Qoder Mailbox is not evidence for this adapter. |
| ZCode | command absent | NE | U | U | U | U | U | U | [E-ZCode-missing](evidence/static-20260714-v2/zcode-version/evidence.json) |
| Pi / owned-loop candidate | command absent | NE | U | U | U | U | U | U | [E-Pi-missing](evidence/static-20260714-v2/pi-version/evidence.json). This remains a separate owned-runtime spike. |

## Event, identity, and continuation matrix

| Surface | Provider session ID | Provider turn ID | Tool-call event | Compaction event | Persistent/session resume | Suspend unfinished continuation |
| --- | --- | --- | --- | --- | --- | --- |
| Codex exec | U | U | U | U | U | U |
| Codex ACP | U | U | U | U | U | U |
| Codex app-server | V thread ID and V active turn ID were exposed, but capability remains safety-constrained | V for one in-progress turn | U | U | U | U — interrupt is not pause/resume |
| Claude stream-json | U | U | U | U | U | U |
| Kimi ACP | V session ID exposed | ACP has session, not Codex-style turn ID | Event channel V; actual tool-call use U (none observed) | U | C: same resident session only; `loadSession` advertised, not dynamically exercised | U |
| OpenCode ACP | V session ID exposed | ACP has session, not Codex-style turn ID | Event channel V; actual tool-call use U (none observed) | U | C: same resident session only; `loadSession`/resume advertised, not dynamically exercised | U |

## What the live evidence changes

1. **ACP is a usable resident-session control surface for Kimi and OpenCode.** Both local implementations accepted control-only initialize/new-session setup, supported plan-mode configuration, emitted structured `session/update`, and completed two sequential `session/prompt` requests in one session. This is stronger than a one-shot CLI process, but it is *not* active-turn injection, suspension, or exactly-once business handling.

2. **Codex app-server genuinely exposes a richer protocol shape, but it is not yet a safe SmallKhoj adapter.** The exact active turn was observable and a same-turn steer response was accepted before interrupt. The process also executed a user-level hook from outside the fixture. The probe therefore proves an interesting provider-specific experiment, not a production-safe or portable contract. A later dedicated adapter spike must explicitly control or reject global hook execution, preserve the safe fallback, and re-establish clean evidence.

3. **Claude's key busy-input question remains open.** The first configured stream-json run showed a harness invocation bug; the second sent one input but Claude rejected the missing `--verbose` flag before emitting `assistant`/`result`. The ledger correctly retained that attempt. There is no observed Claude provider queue, same-turn merge, rejection of a second active input, or completion boundary from this spike.

4. **The universal statement is still deliberately small.** No tested vendor surface proved a portable “pause current turn, inject `@`, resume losslessly” operation. Session identifiers, ACP `loadSession` advertising, and interrupt acknowledgements are not continuation evidence.

## Reliable wakeup contract implied by the matrix

The safe common denominator remains:

```text
Actionable event
  → durable SmallKhoj Work Item (queued)
  → scheduler/poll wakes or rechecks authoritative queue
  → adapter capacity is observed at an invocation boundary
  → submit a fresh/full input to a new or referenced Provider session
  → record adapter terminal evidence separately from semantic outcome evidence
```

This contract guarantees durable work identity, queue visibility, a later submission attempt, and evidence about that attempt. It does **not** guarantee that the current model notices the event, that it semantically acted, that a Provider resumes a tool loop, or that side-effecting work is exactly once.

Policy tiers after this spike:

| Tier | Default action | When it applies | Fallback |
| --- | --- | --- | --- |
| Portable vendor | Durable queue → next invocation | All vendor adapters | Retry only after idempotency/semantic evidence review |
| Provider enhancement | A narrowly evidenced protocol feature such as app-server steer | Only an explicitly opt-in adapter with its own safety gate | Persist/queue the Work Item and return to portable tier |
| Interrupt-and-reconcile | Stop an owned invocation after policy approval | Urgent work or liveness recovery | Mark `delivery_uncertain` if final side effects cannot be correlated |
| Owned loop | Real continuation/RPC semantics | A future Pi/owned-runtime product decision | Not interchangeable with vendor CLI tier |

## Retry and wait rules

- `delivery_uncertain` is terminal for automatic replay. It requires explicit reconciliation or an idempotent, scoped retry decision.
- `stopReason=end_turn`, a process exit, or a runtime `idle` activity is **not** a `handled` claim. A correlated reply, task transition, artifact, or explicit application acknowledgement is separately required.
- ACP same-session continuity does not demonstrate cross-process session resume, unfinished tool-loop recovery, or `await` semantics.
- `slock message check` remains useful for context catch-up, but it cannot be the only correctness path for a persisted actionable Work Item.

## Follow-up decisions, not implementation tasks yet

1. A production durable Work Item / next-invocation queue design is justified by the portable boundary.
2. A Codex app-server adapter is *not* ready to build until a clean hook-isolation and side-effect policy experiment passes.
3. If product needs real `wait`/Agent RPC continuation rather than “later invocation callback,” evaluate Pi or another owned loop in a separate task with its own auth/tool/sandbox contract.
4. Re-run the Claude busy-input case only in a fresh, explicitly approved budget window; use the fixed `--verbose` stream-json argv and preserve the two-call cap.
