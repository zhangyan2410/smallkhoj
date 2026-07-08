# RunTask Productivity Smoke - 2026-06-24

## Scope

This smoke test verifies whether a daemon-managed `RunTask` can do useful work on a non-trivial assignment, not just echo a marker.

The test intentionally used a complex research task:

- Compare task/run/group-work models across `/Users/code/project/multica`, `/Users/code/project/clowder-ai`, and current SmallKhoj TaskRun design.
- Read local files only.
- Produce a durable report at `.trellis/tasks/06-19-channel-task-workspace-optimization/evidence/reference-task-model-research-20260624.md`.
- Send a Chinese summary to `#33` containing marker `RUNTASK_RESEARCH_TASK_MODEL_202606241900`.

## Environment

Current branch stack:

- Worktree: `/Users/code/project/smallkhoj-channel-taskrun-model`
- Branch: `codex/06-24-channel-taskrun-model`
- Backend: `http://127.0.0.1:8100`
- Daemon proxy: `http://127.0.0.1:3458`
- Database: `smallkhoj-test-db` on port `55432`
- Runtime: `claude_code` through `ccs-claude MiniMax MiniMax-M3`
- Agent: `@3333`
- Channel: `#33`

Task:

- Task id: `fc765e6c-4057-4cf3-8726-d3534bfbf132`
- Task number: `#4`
- Marker: `RUNTASK_RESEARCH_TASK_MODEL_202606241900`
- Prompt profile: `task.worker`

## Result

The complex RunTask was productive.

Observed final task state:

```json
{
  "number": 4,
  "status": "in_review",
  "runs": [
    {
      "status": "completed",
      "startedAt": "2026-06-24T03:00:55.561086+00:00",
      "completedAt": "2026-06-24T03:09:09.218291+00:00",
      "outputMessageId": null,
      "tokenUsage": {
        "source": "provider-stream-json"
      },
      "contextUsage": {},
      "failureCode": null,
      "failureReason": null,
      "promptProfile": "task.worker"
    }
  ]
}
```

Runtime final result event:

```json
{
  "subtype": "success",
  "duration_ms": 493632,
  "duration_api_ms": 767509,
  "num_turns": 46,
  "total_cost_usd": 5.00946,
  "usage": {
    "input_tokens": 45177,
    "cache_read_input_tokens": 1249553,
    "output_tokens": 13236
  }
}
```

## Productive Work Evidence

The daemon logs showed real runtime activity before completion:

- `thinking_tokens` stream events.
- `TaskCreate` subtasks for reading multica, clowder-ai, SmallKhoj TaskRun design, writing the report, and sending the summary.
- `Bash` and `Read` tool calls against all three local repositories.
- `TaskUpdate` calls as internal subtasks advanced.
- `slock message send --target "#33"` sent the final Chinese summary.
- `slock task update --channel "#33" --number 4 --status in_review` moved the product task to review.
- Runtime `result` stream event reported success after 46 turns.

Generated output:

- `.trellis/tasks/06-19-channel-task-workspace-optimization/evidence/reference-task-model-research-20260624.md`
- 221 lines, about 23 KB.
- Includes required sections: summary, evidence paths, comparison tables, recommendations, risks/to-verify.
- Cites 12 grouped evidence paths in the report tables:
  - 11 multica references.
  - 10 clowder-ai references.
  - 12 SmallKhoj references.

Channel output:

- Initial progress message: short id `903cc743`.
- Final completion summary: short id `3859bf25`.
- Final summary included the marker `RUNTASK_RESEARCH_TASK_MODEL_202606241900`.

## Findings

### 1. Do not synthesize `running`

The user expectation is correct: daemon should not blindly backfill `running` just because a prompt was queued.

For this task, backend `TaskRun.status` remained `dispatched` for most of the 493 second runtime, even while daemon logs clearly showed productive work. The better control-plane signal is not a synthetic status transition. It is derived runtime activity:

- `thinking_tokens`
- `assistant` `tool_use`
- `user` `tool_result`
- `system task_progress`
- `system task_notification`
- outbound Slock message/tool activity
- final runtime `result`

The integration gate should surface those as "正在执行 / 有产出" even if the lifecycle row is still `dispatched`.

### 2. TaskRun status jumped from `dispatched` to `completed`

The final row was `completed`, but the polling timeline saw only:

```text
queued -> dispatched -> completed
```

It did not expose a stable `running` interval at the backend TaskRun level during the long research phase.

This is acceptable as a smoke-test result only because daemon runtime activity was visible in logs. It is not sufficient for the control UI or integration gate.

### 3. Output message was not backfilled

The runtime sent a final channel summary, but `TaskRun.outputMessageId` remained `null`.

Observed final channel summary:

```text
shortId: 3859bf25
sender: @3333
marker: RUNTASK_RESEARCH_TASK_MODEL_202606241900
```

Expected future behavior:

- The run should link to one or more output messages.
- Single `outputMessageId` is likely too narrow for long tasks; `output_message_ids[]` or a task-run evidence table is a better shape.

### 4. Token usage exists in runtime result but is not normalized onto `TaskRun`

Runtime result exposed detailed usage:

- `input_tokens`: `45177`
- `cache_read_input_tokens`: `1249553`
- `output_tokens`: `13236`
- `num_turns`: `46`
- `total_cost_usd`: `5.00946`

The persisted TaskRun only showed:

```json
{
  "tokenUsage": {
    "source": "provider-stream-json"
  },
  "contextUsage": {}
}
```

This means the gate cannot yet assert token/context behavior from the backend API alone. It still needs daemon logs to prove this run's cost and context characteristics.

### 5. Complex runtime work can be silent for long windows

There was a long quiet gap after the runtime prepared to write the report. Later it resumed, wrote/sent output, and completed.

Gate implication:

- "No backend status change for 30-60 seconds" is not enough to fail a complex RunTask.
- "No runtime activity events past stall timeout" is a better failure signal.
- The gate should distinguish "quiet but runtime still alive" from "daemon heartbeat only, no runtime stream events past timeout".

## Conclusion

This RunTask smoke passes the productivity bar:

- It completed a useful research task.
- It produced a durable report.
- It posted a human-readable Chinese channel summary.
- It changed product task status to `in_review`.
- It did not modify unrelated code.

The smoke also confirms the next integration-control work:

1. Runtime activity events must be first-class TaskRun progress evidence.
2. `running` should be derived from actual runtime activity, not blindly backfilled.
3. TaskRun output evidence must link final channel messages and report files.
4. Token/context usage must be normalized from runtime result events onto TaskRun.
5. The control UI should show concise Chinese summaries by default and hide long ids/tokens unless expanded.
