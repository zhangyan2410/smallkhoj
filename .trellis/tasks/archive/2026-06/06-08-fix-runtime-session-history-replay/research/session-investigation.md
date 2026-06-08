# Runtime Session Replay Investigation

## Investigated Runtime

- Runtime: glm2
- Agent ID: `a29dd830-2993-4ccb-bb83-3c1fe425a671`
- Claude session ID: `ea9e6334-ffd2-4ed8-9b0d-9e27d0cde236`
- Session path: `/Users/lee/.claude/projects/-Users-code-project-smallkhoj-agent-daemon-aaa-daemon--slock-runtimes-a29dd830-2993-4ccb-bb83-3c1fe425a671/ea9e6334-ffd2-4ed8-9b0d-9e27d0cde236.jsonl`

## What Was Delivered

The runtime session began receiving historical `message.created` prompts at `2026-06-08T09:10:35Z`.

The first delivered prompt was:

```text
[event=message.created eventSeq=5956 target=#aaa channel=40af9eb2-18d3-4361-ae6a-3786744a5268 msg=3e9e17fb-9c65-4624-bff4-e60d4817e831 time=2026-06-06T21:19:02.187913+00:00 actor=e9abeddb-4137-430c-96a6-ae42a77344da type=message.created] 你好g l m
```

This event was nearly two days old relative to the session start.

The session then received many older prompts including:

- `@aaa WS_LIVE_MARKER_1780835730`
- `你好`
- `你好=`
- `写一个小作文200-300字 题目是 命运`
- `glm2 glm3 你俩交流一下`
- Many `@glm3` discussion messages about `命运`, `犹豫`, `灵魂`, eval, and AI self-description.

## Quantitative Summary

Parsed from the Claude JSONL session:

```json
{
  "totalMessageCreatedPrompts": 261,
  "selfEcho": 205,
  "nonSelf": 56,
  "duplicateEventSeqCount": 73,
  "duplicateDeliveries": 146
}
```

Target distribution:

```text
#mac        total=168 self=128 other=40
dm:@zy-ean  total=69  self=59  other=10
#aaa        total=24  self=18  other=6
```

Top repeated self-authored contents included:

- `Summarize this thread in 1-2 short, precise sentences...` repeated 17 times.
- `你好！有什么我可以帮你的吗？` repeated 9 times.
- `你好！有什么可以帮你的吗？` repeated 6 times.
- Multiple long glm2-to-glm3 discussion replies repeated 2-4 times.

## Database Cross-Check

Local database was available on Docker Postgres port `55432`:

```text
postgresql://smallkhoj:smallkhoj@localhost:55432/smallkhoj
```

Member cursor snapshot showed:

```text
glm2 id=a29dd830-2993-4ccb-bb83-3c1fe425a671 eventCursor=194 eventLogCursor=10087 sent_messages=115
glm3 id=830649a7-c1d0-460a-bd49-4e4ff196b3f7 eventCursor=92 eventLogCursor=8334
glm4 id=adf81c31-b3ea-4310-8285-1a71c2159080 eventCursor=73 eventLogCursor=7614
```

Recent `event_records` were dominated by `workspace.heartbeat`, but the runtime session replayed much older `message.created` records into Claude.

## Current Working-Tree Clues

At the time of investigation, the working tree already had relevant uncommitted changes:

- `backend/routers/agent_api.py`
  - Daemon WebSocket missing/zero/invalid cursor falls back to max `EventRecord.seq`.
- `backend/services/daemon_control.py`
  - `_event_visible_to_agent` filters `thread.summary_updated`.
  - `_event_visible_to_agent` filters `message.created` where `record.actor_id == agent.id`.
- `e2e/management-flow.spec.ts`
  - Contains Playwright-era focused coverage for daemon WebSocket initial replay.

The follow-up agent should not assume those changes are complete. Verify them against the session facts and current running services.

## Important Project Constraint

Do not use Playwright for browser/UI verification. The project rule is recorded in `AGENTS.md`:

- Use `/Users/code/project/smallkhoj/agent/daemon/webdriver/twd.py` for browser/UI checks.
- Use API/WS/trace checks for runtime delivery when browser visibility is not required.

## Suggested Reproduction Shape

1. Create or use an agent on a connected daemon computer.
2. Add the agent to a channel.
3. Create historical `message.created` rows visible to that agent.
4. Start a daemon WebSocket without `eventLogCursor`, with `eventLogCursor=0`, and with invalid cursor.
5. Confirm those historical rows are not sent to the daemon/runtime.
6. Send a message authored by the target agent.
7. Confirm the target agent runtime does not receive its own message.
8. Send a human-authored message afterward.
9. Confirm the human message is delivered once and the cursor has advanced beyond skipped self events.

