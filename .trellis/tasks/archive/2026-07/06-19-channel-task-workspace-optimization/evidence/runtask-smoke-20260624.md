# RunTask Smoke Evidence - 2026-06-24

## Environment

- Current branch: `codex/06-24-channel-taskrun-model`
- Current worktree: `/Users/code/project/smallkhoj-channel-taskrun-model`
- Existing user-visible stack on `8000/3000/3457` was not current branch code:
  - backend process cwd: `/Users/code/project/smallkhoj-06-23-integration-foundation-gate-context-compression/backend`
  - daemon process cwd: `/Users/code/project/smallkhoj-06-23-integration-foundation-gate-context-compression/agent/daemon/aaa-daemon`
- Isolated current-branch stack used for final smoke:
  - backend: `http://127.0.0.1:8100`
  - daemon proxy: `http://127.0.0.1:3458`
  - database: `smallkhoj-test-db` on `55432`
  - runtime provider/model: `MiniMax / MiniMax-M3`
  - agent: `@3333`
  - channel: `#33`

## Old Stack Finding

Task created against the old `8000` stack:

- marker: `RUNTASK_OK_20260624183512`
- task: `#2`
- assignee: `@gate-observer`
- runtime result: task moved `todo -> in_progress -> in_review`
- TaskRun result: `runs: []`
- lifecycle endpoint probe: `POST /internal/agent-api/task-runs/.../lifecycle -> 404`

Conclusion: the old stack can run the legacy task flow, but it is not a valid TaskRun gate because it is not running this branch's backend.

## Current Branch TaskRun Creation

Task created against `8100` before daemon delivery:

- marker: `RUNTASK_CURRENT_BRANCH_CREATE_202606241840`
- task: `#2`
- assignee: `@3333`
- TaskRun created: yes
- initial run status: `queued`
- prompt profile: `task.worker`
- context session present: yes
- workspace reference present: yes
- context scope: `task`
- trigger type: `task_created`

Conclusion: current branch creates `TaskAssignment + TaskRun` for assigned agent tasks.

## Current Branch Runtime Delivery

Task created against `8100` with current-branch daemon connected on `3458`:

- marker: `RUNTASK_OK_20260624184130`
- task: `#3`
- assignee: `@3333`
- initial run: `queued`
- observed lifecycle:
  - `5s`: `dispatched`
  - `60s`: task status `in_review`
  - `65s`: TaskRun `completed`
- channel output:
  - sender: `@3333`
  - content: `RUNTASK_OK_20260624184130`
- final TaskRun fields:
  - status: `completed`
  - startedAt: present
  - completedAt: present
  - runtimeSessionId: present
  - workspaceSessionId: present
  - contextSessionId: present
  - tokenUsage: `{ "source": "provider-stream-json" }`
  - contextUsage: `{}`
  - outputMessageId: `null`
  - failure: none

Conclusion: current branch TaskRun delivery works end-to-end through daemon/runtime/message output.

## Issues Exposed

### `running` state can be skipped

The run went `queued -> dispatched -> completed`, without visible `running`.

Observed cause from code:

- daemon reports `running` only when `runtime.driver.sendUserMessage(...)` returns `true`.
- Claude runtime returns `false` when the runtime is busy and queues the message.
- The queued message later reaches stdin and executes, but daemon does not report `running` at that later write point.

Expected gate behavior:

- Once a queued TaskRun prompt is actually written to runtime stdin, report `running`.

### `outputMessageId` is not backfilled

The agent sent the marker message and `/internal/agent-api/send` returned `messageId`, but TaskRun final state kept `outputMessageId: null`.

Observed cause from code:

- daemon completion report sends token usage and session/context ids.
- daemon does not associate the runtime's `slock message send` response message id with `activeTaskRunId`.

Expected gate behavior:

- For a TaskRun that sends a final channel/task message, store that message id as `outputMessageId`, or store a structured output/evidence reference.

### Token/context evidence is still partial

Final TaskRun only had `tokenUsage.source = provider-stream-json`; token counts and context usage were absent.

Expected gate behavior:

- Keep this as warning, not hard failure, until provider/session context denominator is reliable.
