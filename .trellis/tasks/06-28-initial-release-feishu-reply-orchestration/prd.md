# Initial release Feishu reply orchestration

## Goal

Orchestrate Feishu accepted/result/failure replies from the existing inbound outcome, TaskRun lifecycle state, and Feishu outbound reply primitive while preserving mappings and failure evidence.

## Background

The release parent requires a Feishu task-entry loop that can send accepted/running/result/failure responses. Current slices provide:

- Feishu inbound adapter and accepted `jira_analysis` outcome.
- Feishu -> Jira -> Message/Task/TaskRun start service.
- TaskRun terminal hook and Jira write-back.
- Feishu outbound text reply primitive.

The missing slice is an orchestration layer that decides when and how to call the Feishu reply primitive from accepted outcomes and terminal TaskRun state.

## Requirements

- **R1: Accepted reply.** After a Feishu `jira_analysis` command is accepted and local TaskRun state is created, send a concise Feishu confirmation tied to the source chat/message.
- **R2: Terminal result reply.** When a Feishu-originated TaskRun completes, send the output message content back to Feishu.
- **R3: Terminal failure reply.** When a Feishu-originated TaskRun fails or is cancelled, send a concise failure/cancelled reason back to Feishu.
- **R4: Mapping and idempotency.** Successful Feishu replies must create external mappings; repeated terminal handling must skip duplicate Feishu replies.
- **R5: Failure evidence.** Feishu reply failures must be structured and must not erase or roll back TaskRun/Jira/local state.
- **R6: Mapping-driven discovery.** Terminal replies discover Feishu context from linked `ExternalEvent` and normalized source fields instead of adding Feishu-specific columns.
- **R7: Dependency injection.** HTTP client/config for Feishu are injected; no real network calls in tests.
- **R8: Boundary.** The orchestration must not own the long-connection receive loop and must not execute daemon/runtime work.

## Acceptance Criteria

- [ ] Accepted reply uses Feishu source `chatId` and `messageId` from the accepted event and maps `external_event -> feishu message`.
- [ ] Completed TaskRun reply uses output message content when available and maps `task_run -> feishu message`.
- [ ] Failed/cancelled TaskRun reply uses `failure_reason` or a fallback failure text and maps `task_run -> feishu message`.
- [ ] Existing `task_run -> feishu message` mapping makes terminal orchestration skip without another HTTP send.
- [ ] Missing Feishu source context returns a structured skipped result.
- [ ] Feishu send failure returns a structured failed result and keeps local TaskRun state intact.
- [ ] Tests prove the orchestration service does not import daemon/runtime execution helpers.
- [ ] Existing Feishu, Jira, gateway, TaskRun, and release-loop tests still pass.

## Notes

- This task is service-level orchestration. Production long-connection worker wiring remains a later child.
