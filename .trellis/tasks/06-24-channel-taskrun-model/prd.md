# 06-24 Channel TaskRun Model

## Goal

Stabilize the control-side integration gate before expanding the channel TaskRun product model.

The gate must show whether a daemon-managed runtime can actually start, receive an assigned task, use Slock tools, post a result, and report enough TaskRun evidence for a human to judge the flow without reading raw ids or tokens.

## Scope Completed In This Slice

- `/control/integration` is a management/control page, separate from product chat UI.
- TaskRun serializer exposes concise lifecycle evidence:
  - stale/running status
  - runtime workspace binding
  - output message presence
  - token/context/tool summaries
  - missing-evidence issue codes
- Daemon reports TaskRun running activity from real stream-json tool_use/tool_result events.
- Daemon reports completed TaskRun summaries with:
  - token usage
  - context window
  - context occupancy
  - tool use/result counts
  - output message id extracted from Slock send results
- Runtime warmup uses the generated project `.slock/slock` wrapper path, avoiding global `slock` shadowing and `MISSING_TOKEN`.
- Backend task-run timestamps are timezone-aware to avoid false stale classification.
- Postgres NOTIFY payloads are compacted for oversized public events while SSE/in-memory subscribers still receive the full event.
- Daemon WebSocket connections include `daemonId`; backend WS activity no longer renews a conflicting unexpired daemon lease.
- Context occupancy fallback excludes `cacheReadInputTokens`; cache reads stay visible as token evidence but do not count as current context pressure.

## Real Validation

### Foundation and Runtime

- Backend: `http://127.0.0.1:8000`
- Frontend: `http://127.0.0.1:3000/control/integration`
- Daemon proxy: `http://127.0.0.1:3457`
- Runtime: Claude Code through `ccs-claude MiniMax MiniMax-M3`
- Project workspace: `/Users/code/project/smallkhoj-channel-taskrun-model`

### Task #8

Marker: `REAL_RUNTASK_CONTEXT_WINDOW_20260624220755`

Result:

- completed
- output message present
- tool use/result counts: 13/13
- `contextWindow`: 200000
- evidence issues: none

Finding:

- the first completed run after context-window extraction still showed `contextOccupancyRatio=1.74466` because fallback `knownTokens` included cache reads.

### Task #9

Marker: `REAL_RUNTASK_CONTEXT_OCCUPANCY_FIX_20260624221725`

Result after fix and daemon restart:

- completed
- output message present
- tool use/result counts: 5/5
- input tokens: 11474
- output tokens: 1934
- cache read tokens: 213066
- total tokens: 226474
- context known tokens: 13408
- context window: 200000
- context occupancy ratio: 0.06704
- context over threshold: false
- evidence issues: none

This proves the gate now separates billing/cache evidence from context-pressure evidence.

## Screenshots

- `evidence/REAL_control_integration_foundation_20260624.png`
- `evidence/REAL_control_integration_runtime_ready_20260624.png`
- `evidence/REAL_control_integration_taskrun_stale_20260624.png`
- `evidence/REAL_control_integration_task9_context_occupancy_20260624.png`

## Follow-Up: Packaging / Launch Preflight

Observed risk:

- starting a daemon from the daemon package directory without an explicit project workspace created a secondary workspace under `agent/daemon/aaa-daemon`.
- old daemon leases can temporarily block a correctly started daemon from registering.
- before the WS daemonId fix, conflicting WS activity could keep extending the old lease.

Required follow-up:

- add a packaging/launch preflight that validates the resolved workspace path, generated wrapper path, proxy port, daemonId, and active lease before reporting runtime-ready.
- surface launch/preflight failures as explicit control-plane states, not as ambiguous runtime warmup failures.
- keep machine tokens and raw credentials out of UI and committed evidence.

## Follow-Up: TaskRun Model

Current conclusion:

- Message and Task are separate. A message may become/as a task, but TaskRun owns execution lifecycle.
- TaskRun is not just a subagent call. Its value is product-visible assignment, lifecycle, evidence, workspace/runtime binding, context/session scope, and auditability.
- Runtime activity should remain trace/ActivityLog style; do not add a separate runtime activity table for TaskRun rows.

Open model questions for the next slice:

- leader-assigned channel task: human picks a leader, leader decomposes and delegates
- direct assignment channel task: human drag/drops one or more agents onto task work
- independent TaskRun context/session boundaries vs reused daemon-managed AgentWorkspace
- per-run prompt profile and whether worker/leader/reviewer should have distinct runtime instructions
- aggregate task-level metrics from runs: total token usage, context risk, tool counts, output status
