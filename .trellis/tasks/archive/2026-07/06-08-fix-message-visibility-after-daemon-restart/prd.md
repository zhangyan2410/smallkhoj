# fix: DM and channel messages missing after daemon restart

## Goal

Find and fix why messages sent after restarting the daemon, including `kimi1` DMs and `testthread` channel messages, are persisted or delivered but not shown in the frontend.

## What I Already Know

- The previous task fixed DM thread reply routing for `glm2` and verified it with WebDriver plus database checks.
- The user restarted the daemon after that fix, then sent fresh messages.
- The user observed that `kimi1` DM messages and `testthread` channel messages do not appear in the frontend.
- This is a cross-layer bug candidate spanning daemon event delivery, backend persistence/API serialization, and frontend message fetching/rendering.
- Follow-up trace investigation showed the persisted user messages are visible through API/DB, but agent replies are absent because the daemon can replay historical `message.created` events into runtimes after restart and exhaust model quota before new messages are handled.

## Assumptions

- The backend and frontend local dev stack are available on the current machine.
- The missing messages may still exist in the database or event log even if the UI does not render them.
- The fix should preserve the existing single-level thread and reply-safe DM target contracts.

## Requirements

- Diagnose whether the missing messages are absent from persistence, absent from API responses, or filtered/rendered incorrectly by the frontend.
- Fix the first broken boundary without regressing DM thread behavior.
- Prevent daemon WebSocket initial connections from replaying historical chat into Claude/Kimi/GLM when no valid positive cursor is supplied.
- Use real WebDriver/browser verification for the user-visible behavior, not only the automated E2E suite.
- Add or update automated coverage where it can catch the discovered regression.
- Update Trellis specs if the investigation finds a contract that was missing or underspecified.

## Acceptance Criteria

- [x] Fresh `kimi1` DM messages sent after daemon restart appear in the DM UI.
- [x] Fresh `testthread` channel messages sent after daemon restart appear in the channel UI.
- [x] Restarted daemons do not push historical `message.created` rows to runtimes unless reconnecting with an explicit positive cursor.
- [x] Restarted daemons do not push historical `thread.summary_requested` rows into runtime queues unless reconnecting with an explicit positive cursor.
- [x] Automatic thread summary scheduling does not retry the same unanswered thread/reply-count in a loop.
- [x] Thread replies still appear in the thread panel and not the root timeline.
- [x] Verification includes database/API inspection and a WebDriver run against the local app.
- [x] Relevant lint/type/test checks pass.

## Verification Notes

- API/DB inspection showed `testthread` has `hi can see it ？` plus `glm4` and `glm3` replies, and the `kimi1` DM has `ni hao` plus a `kimi1` reply.
- Playwright browser verification opened `/chat/testthread` and the `kimi1` DM route; both pages rendered the expected messages and agent replies.
- Added focused Playwright regression coverage for daemon WebSocket initial connections with no cursor, `eventLogCursor=0`, and invalid cursor; those connections no longer receive historical `message.created` rows, while a new live message still delivers over the same WS path.
- Extended the same regression to historical `thread.summary_requested` rows so daemon restart-style connections cannot push old summary requests into model queues.
- Current backend process does not have `THREAD_SUMMARY_SCHEDULER_ENABLED=true`; however, the database contained 26 historical `thread.summary_requested` rows, including repeated requests for the same thread short ids on 2026-06-07 between 22:03 and 22:12 UTC. The scheduler is now capped to a small batch and skips same-`replyCount` unanswered retries.
- Checks run: `python -m py_compile backend/routers/agent_api.py`, `NODE_PATH=./node_modules npx playwright test ../e2e/management-flow.spec.ts -g "daemon websocket starts at latest event"`, `npm run lint`, and `git diff --check`.

## Out of Scope

- Redesigning Slock Control Plane behavior beyond the specific visibility bug.
- Broad trace-log optimization, which is tracked separately in `06-08-optimize-trace-logs-dm-thread-flow`.

## Technical Notes

- Relevant specs:
  - `.trellis/spec/backend/runtime-slock-integration.md`
  - `.trellis/spec/backend/threading-contracts.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`
- Expected frontend channel roots query: `GET /api/v1/channels/{channel}/messages?threadMode=roots`.
- DM APIs keep raw routing names internally but must expose human-facing peer/display metadata.
