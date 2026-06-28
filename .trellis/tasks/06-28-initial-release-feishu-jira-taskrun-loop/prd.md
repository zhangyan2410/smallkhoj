# Initial release Feishu Jira TaskRun loop

## Goal

Wire the first service-level vertical loop for the 7-15 release:

`Feishu accepted jira_analysis command -> Jira issue lookup -> SmallKhoj message/task/TaskRun state -> TaskRun result -> Jira comment write-back`

This child should turn the previously built pieces into an executable backend orchestration boundary without requiring real Feishu credentials, real Jira credentials, frontend UI, or deployment.

## Dependencies

- Parent task: `.trellis/tasks/06-28-07-15-initial-release/`.
- Depends on integration gateway foundation commit `e3a1a65`.
- Depends on Jira REST MVP commit `8591b10`.
- Depends on Feishu message entry adapter commit `f50285c`.

## Requirements

- **R1: Accepted Feishu command input.** Consume only accepted `FeishuDispatchOutcome` with command kind `jira_analysis`.
- **R2: Jira issue context.** Use `services.jira_rest.fetch_jira_issue` to obtain issue key, summary, status, description, and URL.
- **R3: Local work creation.** Create a SmallKhoj channel message and task owned by the Feishu route/channel context.
- **R4: TaskRun boundary.** Create TaskRun through `services.task_runs.create_task_assignment_and_run`; do not execute daemon/runtime work directly.
- **R5: Mapping.** Persist mappings for local task/run to Jira issue/comment through the integration gateway/Jira mapping helpers.
- **R6: Result write-back.** Provide a service operation that appends TaskRun output/failure evidence to Jira as a comment.
- **R7: Failure preservation.** Jira lookup or comment failures must leave local external event/TaskRun state inspectable and not erase local output.
- **R8: Testability.** Unit tests must use fake HTTP clients and fake sessions; no real Feishu/Jira network calls.

## Scope

- Backend orchestration service.
- Tests for accepted command -> Jira issue -> local task/run state.
- Tests for TaskRun output -> Jira comment mapping.
- Failure-code propagation tests.

## Out Of Scope

- Real Feishu long-connection worker process.
- Frontend evidence UI.
- Daemon runtime execution itself.
- Jira webhook ingestion.
- Deployment/domain work.

## Acceptance Criteria

- [ ] Non-accepted or non-Jira Feishu outcomes are rejected with stable local errors.
- [ ] Accepted `jira_analysis` outcome performs Jira issue lookup and builds a task title/description from normalized issue context.
- [ ] Local message/task/TaskRun creation happens through existing SmallKhoj model and TaskRun helper boundaries.
- [ ] The orchestration links the external event to local message/task/run ids.
- [ ] Jira issue mapping and Jira comment mapping are persisted through gateway/Jira helpers.
- [ ] Jira comment write-back uses TaskRun output/failure text and preserves local output on write-back failure.
- [ ] Tests prove the orchestration service does not import daemon/runtime execution helpers.
- [ ] Existing Feishu, Jira, gateway, and TaskRun tests still pass.
