# Initial release TaskRun write-back hook design

## Design Principles

- TaskRun lifecycle state is the local source of truth.
- External write-back is a side effect with best-effort delivery and explicit evidence.
- Router code should stay transport-oriented; provider routing belongs in services.
- The first hook can be synchronous inside the lifecycle request, but it must not make local completion depend on Jira success.

## Proposed Boundary

Add a backend service module, tentatively `backend/services/task_run_writeback.py`.

Responsibilities:

- Decide whether a TaskRun status should trigger write-back.
- Discover linked external event and Jira issue mapping for the TaskRun.
- Detect whether a Jira comment mapping already exists for the TaskRun.
- Resolve Jira connector and injected credentials through a small dependency object.
- Call `release_loop.write_back_task_run_to_jira`.
- Mark linked external event completed or writeback_failed when available.
- Return a structured result for logs/tests/future UI.

The service should not:

- Start daemon/runtime work.
- Construct Feishu messages.
- Store raw secrets.
- Assume every TaskRun originated from Feishu.

## Lifecycle Integration

`services.task_runs.update_task_run_lifecycle` already updates TaskRun status and flushes. To keep this service reusable, do not move Jira behavior inside it.

The route `routers.agent_api.update_task_run_lifecycle_endpoint` can call the write-back service after `update_task_run_lifecycle` returns a run and before final commit. The write-back service catches provider failures and returns an outcome, so the endpoint still commits the local TaskRun update.

Later, the same service can be called from a queue worker after commit without changing provider logic.

## Idempotency

Use `ExternalMapping`:

- `local_type="task_run"`, `local_id=<run.id>`, `external_type="comment"` means Jira write-back already happened.
- If present, return `skipped` with reason `already_written_back`.

The existing unique pair constraint also protects duplicate mappings if a race still occurs.

## Issue Discovery

Preferred path:

1. Find linked external event where `ExternalEvent.task_run_id == run.id`.
2. Find local mapping for `local_type="task"`, `local_id=event.task_id`, `external_type="issue"`, `provider="jira"`.
3. Load the task by `run.task_id`.
4. Load the Jira connector by the mapping connector id.

Fallback path:

- If no event exists, list local mappings for `local_type="task"`, `local_id=run.task_id` and choose the Jira issue mapping.

## Credentials

This task keeps credentials injectable:

```python
@dataclass
class TaskRunWritebackDependencies:
    jira_http_client: Any | None = None
    jira_credentials_resolver: Callable[[ExternalConnector], Awaitable[dict[str, str] | None] | dict[str, str] | None] | None = None
```

If dependencies are absent or resolver returns no credentials, return `skipped` with a stable reason. Do not read committed config fields for tokens.

## Outcomes

Return a dataclass such as:

- `status`: `not_applicable`, `skipped`, `written`, `failed`
- `reason_code`: stable machine-readable code
- `reason`: human-readable text
- `mapping`: Jira comment mapping when written

Stable codes:

- `TASK_RUN_WRITEBACK_NON_TERMINAL`
- `TASK_RUN_WRITEBACK_ALREADY_WRITTEN`
- `TASK_RUN_WRITEBACK_NO_JIRA_ISSUE`
- `TASK_RUN_WRITEBACK_NO_JIRA_CONNECTOR`
- `TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS`
- `TASK_RUN_WRITEBACK_JIRA_FAILED`
- `TASK_RUN_WRITEBACK_WRITTEN`

## Testing Plan

- Unit-test the write-back service with fake sessions and fake HTTP clients.
- Unit-test idempotent skip when a comment mapping already exists.
- Unit-test non-terminal skip.
- Unit-test Jira failure gets captured and linked external event becomes `writeback_failed`.
- Unit-test router calls the hook for terminal updates and still commits when the hook fails.
- Run targeted backend tests, then full backend pytest.
