# Integration Gate final-review P2 bug report

## Reported by

Independent peer reviewer in the detached sandbox
`/tmp/cat-cafe-review/integration-gate-restoration/codex-peer`, reviewing exact
SHA `872e3d16fae4840aabe1e1f068d074175f325870`.

## Diagnostic capsule

| Field | Collaboration audience resolution | Daemon control result collection |
|---|---|---|
| Phenomenon | With `--channel gate-lab` and no `--channel-id`, the send response supplies a durable ID but the gate reports `COLLAB_AUDIENCE_INCOMPLETE`; expected V1/V2/V3 audience evaluation against actual channel members. | While a runtime is busy, a queued control command can return the preceding turn's assistant/result stream with `delivered=false`; expected no unrelated output to be attributed to the control command. |
| Evidence | Reviewer mock reproduction exited 1 with `memberCalls=0` and `visibleAgentIds=[]`; the members endpoint for the returned ID was available. | Static data-flow trace: collection begins before `sendUserMessage`; busy runtimes return false and queue; collector accepts the first global assistant/result events without a control-turn identifier. The send-throw path also leaves collection active until timeout and captured chunks are unbounded. |
| Hypothesis / root cause | Membership is read only from the pre-send `args.channelId` branch; the late `channelId` returned by POST is assigned after roles and membership evidence have already been frozen. | Collection and delivery are ordered incorrectly for an uncorrelated global stream: subscription precedes proof of immediate delivery. Cleanup ownership is split between timeout/result handlers, and chunk accumulation has no explicit bound. |
| Diagnostic strategy | Add a CLI test whose mock POST returns the ID and whose members endpoint records calls; trace `channel.id` and `visibleAgentIds` across send and gate evaluation. | Add focused daemon tests around the control observation boundary for rejected delivery, send throw, unrelated stream events, and oversized output; inspect existing collector lifecycle and runtime busy semantics. |
| Timeout strategy | If the late-resolution fix requires protocol redesign rather than one post-send membership load, stop and escalate the scope. | If correlation cannot be guaranteed with existing runtime events, fail closed on non-immediate delivery; do not invent a new cross-runtime turn-ID protocol in this restoration task. |
| Warning signs | An extra unconditional members request would regress the explicit-ID fast path or duplicate evidence reads. | A fix that merely delays subscription can miss synchronous events; a fix that accepts queued delivery still cannot prove event ownership; three unsuccessful approaches require a state-contract redesign. |
| User-visible correction | Channel-name-only collaboration runs evaluate the actual durable membership instead of failing all role visibility checks. | Busy control probes return an explicit non-delivery state, never plausible but unrelated assistant output. |
| Acceptance | Red→Green CLI regression plus all 39 Integration Gate tests. | Red→Green daemon boundary tests, daemon typecheck/full suite, bounded capture, and immediate listener cleanup. |

## Root-cause analysis

The two findings violate different boundary invariants and therefore do not
form one shared failure-mode family:

1. Collaboration execution freezes derived audience state before the durable
   channel identity is available.
2. Daemon result observation begins before immediate delivery is established,
   even though the event stream carries no identifier that can correlate an
   event to the queued control message.

The failing tests confirmed both roots:

- `tools/integration-gate/run.mjs` built `visibleAgentIds` before the send and
  never recomputed it after `sentMessage.channelId` resolved the target. The
  same late-identity pattern also existed in `chat-reply-channel-group` and was
  included in the failure-mode sweep.
- `DaemonCore.executeRuntimeControlCommand` created the global stream collector
  before checking immediate deliverability, while Claude and Codex ACP drivers
  queued `{ control: true }` messages on busy/unready paths. The collector had
  no turn identifier, cancellation handle, or output budget.

## Repair plan

Use the newly resolved channel ID to load members exactly once before building
collaboration or channel-group evidence. For daemon controls, reject known-busy
runtimes before subscription, preserve fast-event observation by arming the
collector immediately before an idle send, then cancel and fail closed if the
send is rejected or throws. Control drivers never queue these commands, and
captured output is capped at 65,536 characters.

## Verification

Red evidence:

- Channel-name-only V1: `FAIL ... 10/11 COLLAB_AUDIENCE_INCOMPLETE`.
- Channel-name-only group chat: `FAIL ... 10/11 CHANNEL_AUDIENCE_AMBIGUOUS`.
- Daemon regressions: wrong/missing busy reason, one leaked listener after send
  throw, 70,000 uncapped characters, and queued Claude/Codex control messages.

Green evidence so far:

- Integration Gate: 39 passed, 0 failed.
- Daemon: 279 passed, 0 failed, including the real bundled Pi relay test.
- Daemon TypeScript build and `git diff --check`: pass.

Canonical CI and independent reviewer continuity are still required before
archive.
