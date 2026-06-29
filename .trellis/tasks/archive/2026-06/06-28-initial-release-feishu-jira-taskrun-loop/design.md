# Feishu Jira TaskRun loop design

## Boundary

This child is service-level orchestration. It calls existing services but does not own network workers, UI, or daemon execution.

Input:

- `FeishuDispatchOutcome(status="accepted", command.kind="jira_analysis")`

Output:

- local message/task/TaskRun records;
- external mappings to Jira issue/comment;
- structured result object for later Feishu reply wiring.

## Service Shape

Recommended module:

`backend/services/release_loop.py`

Recommended operations:

- `start_feishu_jira_analysis(...)`
- `write_back_task_run_to_jira(...)`

The service should accept injected Jira HTTP client and credentials so tests are deterministic.

## Local Work Creation

Use existing models:

- `Message`: records the Feishu-originated request in the routed channel.
- `Task`: stores title/description with Jira source metadata in `Task.data`.
- `TaskRun`: created via `create_task_assignment_and_run`.

Task title:

```text
Analyze JIRA-123: <summary>
```

Task data should include:

- source provider `feishu`;
- Jira issue key/url/status;
- external event id;
- Feishu message/chat ids.

## Write-Back

`write_back_task_run_to_jira` should build a concise comment from:

- task title;
- TaskRun status;
- output message/content or failure reason;
- SmallKhoj evidence ids where available.

It should call `append_jira_comment`, then `map_jira_comment`.

## Failure Handling

Stable local error codes:

- `RELEASE_LOOP_FEISHU_OUTCOME_NOT_ACCEPTED`
- `RELEASE_LOOP_UNSUPPORTED_COMMAND`
- `RELEASE_LOOP_ROUTE_CHANNEL_MISSING`
- `RELEASE_LOOP_ASSIGNEE_MISSING`
- `RELEASE_LOOP_JIRA_LOOKUP_FAILED`
- `RELEASE_LOOP_JIRA_WRITEBACK_FAILED`

Jira service errors should be wrapped or propagated with their original code in `cause_code`.

## Runtime Boundary

The service may create TaskRun state. It must not:

- call daemon control directly;
- call runtime provider APIs;
- start local processes;
- bypass `create_task_assignment_and_run`.
