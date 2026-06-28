# Initial release Feishu raw event loop handler

## Goal

Add a service-level Feishu raw event handler that normalizes a Feishu message payload, dispatches it through the gateway, starts the Feishu-Jira TaskRun loop, sends the accepted reply, and records structured failures for the future long-connection worker.

## Background

The release backend now has the core pieces:

- `services.feishu_adapter` normalizes and dispatches Feishu messages into gateway events/routes/sessions.
- `services.release_loop` starts the Jira lookup -> Message/Task/TaskRun path.
- `services.feishu_reply_orchestration` sends accepted and terminal Feishu replies.
- `services.task_run_writeback` handles TaskRun terminal Jira write-back.

The missing backend entry boundary is a single handler that the future Feishu long-connection worker can call with a raw Feishu event payload. Without this, production worker code would have to manually stitch together dispatch, release-loop, reply, and failure handling.

## Requirements

- **R1: Raw event normalization.** Accept a raw Feishu event payload and normalize it through `normalize_feishu_message`.
- **R2: Gateway dispatch.** Dispatch the normalized message through `dispatch_feishu_message` using configured server/connector/bot context.
- **R3: Accepted loop start.** For accepted `jira_analysis` outcomes, start the release loop with injected Jira dependencies.
- **R4: Accepted Feishu reply.** After local TaskRun state is created, send the accepted Feishu reply with injected Feishu dependencies.
- **R5: Duplicate/drop passthrough.** Duplicate, unknown, unaddressed, no-route, and disabled-route outcomes must not start release-loop work.
- **R6: Failure evidence.** Jira lookup or release-loop failures after an external event has been claimed must mark the external event failed with stable failure details.
- **R7: Structured outcome.** The handler returns a structured outcome containing dispatch status, release result, accepted reply result, and failure details.
- **R8: Testability.** Unit tests use fake sessions and monkeypatched services; no real Feishu/Jira network calls.
- **R9: Boundary.** The handler must not own WebSocket/SDK reconnection or daemon/runtime execution.

## Acceptance Criteria

- [ ] Accepted raw Feishu message dispatches, starts the release loop, and sends accepted reply.
- [ ] Duplicate/drop dispatch outcomes return without release-loop or accepted-reply calls.
- [ ] Release-loop failure marks the linked external event failed and returns a structured failed outcome.
- [ ] Accepted-reply failure returns a structured accepted-with-reply-failed outcome without rolling back local release-loop state.
- [ ] Tests prove raw payload normalization is used.
- [ ] Tests prove no daemon/runtime execution helpers are imported.
- [ ] Existing Feishu/Jira/gateway/TaskRun tests still pass.

## Notes

- This task creates the business handler for a long-connection worker. The actual SDK/WebSocket supervisor remains a later deployment/runtime child.
