# Live Foundation/UI/runtime test boundary

Status: `PASS`

## Live candidate identity

The final acceptance used the current repository build with an existing
OpenCode Agent and workspace:

- daemon PID `65162`, started from
  `agent/daemon/aaa-daemon/dist/cmd/main.js` at 2026-08-05 01:49 CST;
- OpenCode server PID `66036`, started as `opencode serve` by that daemon at
  2026-08-05 01:54 CST;
- Agent `a4af4b18-4b9a-43d2-8a13-4fbe02d0ad4a` (`open1`), workspace
  `8eb55651-5f52-41b9-8eee-476bf2a83890`;
- runtime `opencode`, provider/model `zai-coding-plan / glm-5.2`;
- OpenCode session `ses_03213ce03ffej2EYkpb63pNqlB`.

The real marker `ACTIVITY_QA3_20260805T0155_b42f` received the reply
`ACTIVITY_QA3_20260805T0155_b42f_DONE`.

## Observable Activity result

The Activity page showed the new 01:57 turn newest-first as:

1. `Idle`;
2. `Thinking`, preview `完成`;
3. `Ran bash`, semantic `raft message send ...` preview;
4. `Ran bash`, preview `raft message send --help`;
5. `Ran bash`, semantic `raft message send ...` preview;
6. `Ran bash`, preview `pwd`;
7. `Working on message`.

Therefore the chronological provider sequence is Working, real tool Output,
readable Thinking, then Idle. The new turn contains no `Generated output` and
no terminal `Tool completed`/`Tool failed` row. Generated wrapper paths were
normalized to readable `raft` commands by the implementation under test at
that time, while `pwd` remained intact. The user marker itself did not appear
as Thinking. Older 08/04 `Generated output` and `Tool completed` rows remain
historical data and are not part of this turn.

This screenshot predates the subsequent Aura command correction. It is valid
evidence for Activity state classification/order, but it is deliberately not
used to claim that the provider executed bare `aura` or that wrapper-path
rewriting had been removed. Those final properties are covered by the
clean-first-start and runtime environment automation recorded in
`evidence/quality-gate.md`.

Screenshot: `/tmp/smallkhoj-activity-qa3.png` (captured and visually inspected
at 2026-08-05 02:01 CST).

## Safety boundary

- Existing frontend/backend processes on ports 3000/8000 were not stopped,
  killed, restarted or reconfigured.
- The existing `open1` Agent/workspace/provider was reused; no Agent,
  workspace, provider or provider-configuration row was created or changed.
- The live acceptance intentionally created only the marker message, runtime
  reply and their Activity telemetry in the existing conversation.
- No Codex/OpenCode/Claude/Pi provider configuration, CC Switch selection,
  daemon manual-provider JSON, project env file or user-home config changed.
- No commit, push, publish, PR or merge was performed.
