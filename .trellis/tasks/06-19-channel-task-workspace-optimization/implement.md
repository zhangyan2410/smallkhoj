# Channel TaskRun Implementation Plan

## Scope

Implement the TaskRun foundation needed before reworking V3 channel group task validation.

This task should proceed in bounded slices:

1. Backend persistence and API visibility.
2. Runtime delivery and daemon lifecycle updates.
3. Control/integration UI visibility.
4. V3 gate rewrite against Task/TaskAssignment/TaskRun evidence.

## Phase 1: Backend Foundation

- [x] Add `TaskAssignment` ORM model.
- [x] Add `TaskRun` ORM model.
- [x] Add TaskRun helper service for assignment/run creation.
- [x] Ensure assigned public task creation creates TaskRun.
- [x] Ensure agent-created delegated tasks create TaskRun.
- [x] Include `runs` in public and agent task serializers.
- [x] Add `taskRunId` to task-created activity/event details when a run is created.
- [x] Preserve independent `context_session_id`; do not reuse workspace `session_id` as the run context identity.

Validation:

```bash
cd backend
PYTHONPATH=. uv run pytest tests/test_task_runs.py -q
PYTHONPATH=. uv run pytest -q
```

## Phase 2: Runtime Delivery

- [ ] Decide whether `task.created` remains the runtime-actionable event for the first migration or whether daemon should receive `task_run.created`.
- [ ] If keeping `task.created`, include `taskRunId` in runtime prompt formatting and trace evidence.
- [ ] If adding `task_run.created`, update backend event aliases, visibility, daemon actionable gate, prompt formatting, and browser-safe public event scope.
- [ ] Add daemon-side run lifecycle reporting:
  - dispatched
  - running
  - completed
  - failed
  - cancelled
- [ ] Store runtime session/context/token usage against TaskRun when available.
- [ ] Keep workspace heartbeat/activity out of runtime prompt delivery.

## Phase 3: Control and Product UI

- [ ] Task detail shows TaskRun timeline.
- [ ] Control/integration surface shows:
  - TaskRun status
  - assignee/role
  - workspace/session/context ids
  - prompt profile
  - token/context usage
  - failure code/reason
- [ ] Direct drag assignment creates assignment + TaskRun.
- [ ] Leader/coordinator flow shows parent task and child task/run relationships.

## Phase 4: V3 Gate

- [ ] Update V3 gate to verify:
  - source message
  - product task
  - assignment
  - TaskRun
  - target agent
  - workspace/session/context evidence
  - worker output or failure classification
  - review state
- [ ] Replace vague failures with TaskRun-specific classifications:
  - `TASK_RUN_MISSING`
  - `TASK_RUN_TARGET_MISMATCH`
  - `TASK_RUN_WORKSPACE_MISSING`
  - `TASK_RUN_RUNTIME_NOT_READY`
  - `TASK_RUN_CONTEXT_USAGE_MISSING`
  - `TASK_RUN_OUTPUT_MISSING`

## Risk Notes

- Do not make TaskRun a generic log for every runtime action in the first implementation.
- Do not make a new physical workspace for every TaskRun by default.
- Do not reuse model context/session blindly across unrelated TaskRuns.
- Do not let runtime completion automatically set product task status to `done`.
- Do not deliver TaskRun telemetry back into runtime prompts unless it is explicitly actionable work.
