# Fix Runtime Session History Replay After Daemon Reconnect

## Problem

After a daemon/backend reconnect, an active Claude runtime session received a large backlog of historical chat events that should not have been delivered as fresh runtime input.

This is not an Activity UI issue. The failure is in runtime session message delivery: the daemon/runtime was fed historical `message.created` events, including messages authored by the same agent runtime.

Observed session:

- Agent: `glm2`
- Agent ID: `a29dd830-2993-4ccb-bb83-3c1fe425a671`
- Runtime session: `ea9e6334-ffd2-4ed8-9b0d-9e27d0cde236`
- Session file: `/Users/lee/.claude/projects/-Users-code-project-smallkhoj-agent-daemon-aaa-daemon--slock-runtimes-a29dd830-2993-4ccb-bb83-3c1fe425a671/ea9e6334-ffd2-4ed8-9b0d-9e27d0cde236.jsonl`

## Evidence From Session

The session contained 261 delivered `message.created` prompts.

- 205 were self-echo where `actor=a29dd830-2993-4ccb-bb83-3c1fe425a671`.
- 56 were non-self messages.
- 73 `eventSeq` values appeared more than once, for 146 duplicate deliveries.
- First delivered event in the session was `eventSeq=5956`, created at `2026-06-06T21:19:02.187913+00:00`, while the runtime session itself started on `2026-06-08`.
- Last sampled delivered event was `eventSeq=9988`, still a self-authored `#mac` message from glm2.

Target distribution:

- `#mac`: 168 events, 128 self-authored.
- `dm:@zy-ean`: 69 events, 59 self-authored.
- `#aaa`: 24 events, 18 self-authored.

High-frequency repeated content included:

- `Summarize this thread in 1-2 short, precise sentences...`
- `你好！有什么我可以帮你的吗？`
- glm2's own long `@glm3` chat replies about writing, `命运`, `灵魂`, `在场`, and eval discussion.

## Likely Root Cause

The most likely failure path is:

1. A daemon WebSocket connection starts without an explicit positive `eventLogCursor`.
2. Backend treats the missing/invalid/zero cursor as `0`.
3. Backend scans historical `event_records` from the beginning or from a stale point.
4. Events visible to agents on the same computer are expanded and sent to runtime.
5. Runtime delivery includes `message.created` records whose `actor_id` is the same agent, causing self-echo.
6. The daemon then feeds those historical/self events to Claude as user prompts.

There may also be deploy/runtime-code skew. The working tree already contains changes that appear intended to address this:

- Fresh daemon WS with no valid cursor starts at latest `EventRecord.seq`.
- Runtime-visible filtering excludes `message.created` where `record.actor_id == agent.id`.
- `thread.summary_updated` is filtered from runtime delivery.

The follow-up agent should verify whether those changes are complete, correct, tested, and actually loaded by the running backend/daemon.

## Scope

In scope:

- Daemon WebSocket initial cursor behavior.
- Backend daemon-control fanout of `EventRecord` rows.
- Runtime target-agent filtering and self-message filtering.
- Duplicate delivery/cursor advancement behavior when invisible or filtered events are scanned.
- Verification using API/WS/trace and the project WebDriver where browser-visible checks are needed.

Out of scope:

- Activity UI redesign.
- Re-enabling thread summary scheduler.
- Playwright-based verification.
- Cosmetic frontend changes.

## Requirements

- A fresh daemon WebSocket connection with no cursor, `eventLogCursor=0`, invalid cursor, or missing `activityCursor` must act as a live subscription and must not replay historical chat/event rows into runtime queues.
- A daemon WebSocket reconnect with an explicit positive cursor must resume from that cursor.
- A runtime must not receive its own `message.created` events as fresh input.
- Filtering self-authored or otherwise invisible events must still advance the daemon WebSocket cursor so the connection does not repeatedly rescan the same rows.
- Runtime should still receive new live messages from humans or other agents in visible channels/DMs after skipped self events.
- Thread summary events must not be reintroduced into runtime delivery unless intentionally requested by a current, targeted event flow.
- The implementation must be idempotent across reconnects and backend restarts.

## Acceptance Criteria

- Reproducing with the glm2-style scenario no longer feeds historical events such as `eventSeq=5956` into a newly reconnected runtime session.
- Sending a message as `glm2` does not produce a runtime prompt for `glm2`.
- Sending a human message to a channel/DM visible to `glm2` after reconnect is delivered once to `glm2`.
- If a self-authored message is followed by a human message, the human message is still delivered and the connection does not get stuck behind the skipped self event.
- `smallkhoj-trace summary --json` shows no repeating `Runtime message delivered from websocket` loop for old historical events after reconnect.
- New tests or smoke checks cover missing/zero/invalid cursor behavior and self-message filtering.

## Verification Notes

- Use `smallkhoj-trace` first for runtime/control-plane diagnosis.
- Use direct backend API/WS checks for this bug where possible; browser UI is not required for the core fix.
- If browser-visible behavior must be checked, use the project WebDriver harness: `/Users/code/project/smallkhoj/agent/daemon/webdriver/twd.py`
- Do not use Playwright for browser/UI verification in this repository.

