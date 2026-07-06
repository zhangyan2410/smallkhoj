# TaskRun Configurable Templates

## Goal

Build the first product-grade TaskRun model on top of the stabilized runtime evidence gate.

This slice introduces configurable TaskRun templates / role presets, editable by the user, and uses them in direct assignment so a task can start structured agent work automatically without falling back to one-off freeform prompts.

## Product Definition

### Task

A Task is the product object for work to be done.

It owns:

- goal/title/description
- source message/thread/channel when created from conversation
- status
- assignment plan
- aggregate result state

### TaskRun

A TaskRun is a long-lived, stateful runtime context for a task.

It is not a single invocation and must not be treated as "one request/one response". A TaskRun can loop through multiple turns, tool calls, intermediate outputs, memory writes, user inputs, review waits, and final artifacts.

A TaskRun finishing one provider turn does not necessarily mean the runtime context should be destroyed. Completion means the current task objective is satisfied, while the run remains resumable and inspectable unless explicitly archived/cancelled by product rules.

TaskRun state must be read through three separate lenses:

- objective state: whether the task goal is queued, running, waiting for input, blocked, completed, cancelled, or archived.
- runtime session state: whether the underlying daemon-managed runtime is starting, ready, busy, idle, errored, expired, or closed.
- participant state: whether each human/agent participant is assigned, active, waiting, done, handing off, or failed.

These states must not be collapsed into one boolean. In particular, `completed` only means the current output contract is satisfied. It does not mean the runtime session has been destroyed, the process evidence has disappeared, or the user cannot continue the run.

Follow-up rule:

- Clarification, small continuation, export, format conversion, and evidence review continue in the same TaskRun.
- A new objective, broader scope, or downstream task should create a derived TaskRun linked to the original.

A TaskRun owns:

- explicit task goal and scope
- assigned agent and template/role config
- runtime/workspace/session/context identity
- visible lifecycle status
- multiple turns and activity evidence
- multiple output references
- usage/context/tool summaries
- failure and waiting reasons
- resumability and audit trail

### TaskRun Turn

A TaskRun Turn is one runtime interaction inside a TaskRun.

MVP note: do not create a separate `task_run_turns` table in the first slice unless implementation proves it is required. Existing trace/ActivityLog stays the detailed activity source. TaskRun stores summaries and output references.

### TaskRun Output

TaskRun output is not limited to a channel message.

Supported output references should be modeled as structured metadata, even if MVP stores them in JSON first:

- channel message
- task summary
- memory entry
- file/artifact
- document/report
- slide deck/PPT
- image/video/audio
- external link

MVP must keep `outputMessageId` for compatibility, but it must not be considered the complete output model.

### TaskRun Template / Role Preset

A TaskRun Template is a reusable structured runtime configuration.

It is not a raw prompt box. Its value is that the role has stable behavior, tool access, skill access, memory access, and output expectations.

Templates can be edited by users, but the editable form should preserve structure so the product can display and validate what the role can do.

Role presets must not be coding-only. Coding roles such as architect, runner, and reviewer are examples, not the model. A role preset should describe a reusable capability package: instruction shape, allowed tools, skills, memory behavior, runtime constraints, loop policy, and output contract.

The product goal is to make TaskRun more useful than a freeform agent prompt. If the user only edits a large prompt text area, TaskRun loses its advantage over existing chat/runtime flows.

### TaskRun vs Subagent

A TaskRun is product-owned, visible, resumable, and tied to a task lifecycle, output contract, memory strategy, and control-plane state.

A subagent is runtime-owned delegation inside an agent session. It can be useful inside a TaskRun, but it does not replace TaskRun because it lacks product-level assignment, lifecycle, UI grouping, output references, and durable task memory.

## Confirmed Current State

- `TaskAssignment.role` is currently constrained to `leader | worker | reviewer | participant`.
- `services.task_runs._prompt_profile()` currently maps fixed roles to `task.leader`, `task.worker`, `task.reviewer`, `task.participant`.
- Creating a public task with an agent assignee already creates one `TaskAssignment` and one queued `TaskRun`.
- Updating task assignee through `PATCH /api/v1/tasks/{id}` currently does not create an assignment/run; this means the existing drag/drop assignment UI does not start runtime work yet.
- TaskRun already records:
  - `assignment_id`
  - `parent_run_id`
  - `runtime_workspace_id`
  - `workspace_session_id`
  - `runtime_session_id`
  - `context_session_id`
  - `prompt_profile`
  - usage/context/tool summaries
  - `output_message_id`
- `/control/integration` already shows recent TaskRun rows and hides long ids by default.
- Daemon currently treats the provider `result` event as TaskRun completion for the active run; long-lived loop semantics need an explicit completion policy before this behavior can change safely.
- Runtime activity must remain trace/ActivityLog style; do not add a runtime-activity table in this slice.

## Implementation Decision For This Slice

Use one TaskRun as one durable runtime context/session for v1. A TaskRun may have many runtime turns, but retry/fallback attempts are not split into separate sessions in this slice.

This slice keeps `single_turn_result` as the implemented completion policy. That policy is a compatibility mode: the daemon may mark a TaskRun completed when the provider emits a result event. It must not be presented as the full long-lived loop behavior. Future loop policies should treat provider result events as turn boundaries unless the run output contract is satisfied.

Current backend slice implements:

- `task_run_templates` table and built-in seed templates.
- Structured role presets stored in template JSON.
- Template CRUD API.
- Template snapshot fields on `TaskAssignment` and `TaskRun`.
- Single direct assignment auto-start through task creation or `POST /api/v1/tasks/{taskId}/assignments`.
- `parallel` only; `manual start` and `sequential` return explicit 400 until implemented.
- Daemon formatting of template snapshots into assigned-task runtime prompts.
- Frontend template selection in task creation and a control-plane template editor page.

Not yet implemented in this slice:

- multi-assignment `assignments[]` in task creation
- true `task_run_turns` persistence
- true multi-turn loop lifecycle where a provider result only completes a turn

## Requirements

### R1. Template CRUD

Users can create, view, update, and disable TaskRun templates.

Template fields:

- `id`
- `name`
- `slug`
- `description`
- `category`
- `systemInstruction`
- `toolPolicy`
- `skillPolicy`
- `memoryPolicy`
- `outputPolicy`
- `runtimePolicy`
- `startPolicy`
- `visibility`
- `status`
- `createdBy`
- `createdAt`
- `updatedAt`

MVP can seed built-in templates, but user-created/customized templates must be stored in the database.

### R1.1 Role Preset Shape

A template may contain or reference one or more role presets.

MVP may implement role presets as structured JSON inside `task_run_templates` if that reduces schema risk, but the API shape must keep role preset fields explicit:

- `roleKey`
- `displayName`
- `purpose`
- `instructionTemplate`
- `toolPolicy`
- `skillPolicy`
- `memoryPolicy`
- `outputPolicy`
- `runtimePolicy`
- `loopPolicy`
- `contextPolicy`
- `editableFields`

The implementation should not continue relying on the current hard-coded `leader | worker | reviewer | participant` role set as the product model.

The implementation should also avoid making `Prompt Profile by Role` a hard-coded product taxonomy. Profiles can be derived from role preset keys or policy snapshots, but the durable product contract is the structured role preset.

### R2. Structured Template Policies

Templates must include structured policies instead of only freeform prompt text.

`toolPolicy` should describe:

- allowed tool groups
- denied tool groups
- whether write-capable Slock commands are allowed
- whether shell/code execution is allowed
- whether browser/UI tools are allowed

`skillPolicy` should describe:

- recommended skills
- required skills
- denied skills
- whether the runtime may choose additional skills

`memoryPolicy` should describe:

- readable scopes: channel, thread, task, run
- writable scopes: task, run, channel memory
- whether final summaries should be written to memory
- context risk threshold for recommending memory compaction or summary
- how channel/fuse memory is used for durable task context

`outputPolicy` should describe:

- expected output types
- whether multiple outputs are allowed
- final output requirement
- whether channel message is required

`runtimePolicy` should describe:

- preferred runtime type/provider/model if any
- whether default agent runtime is acceptable
- context isolation requirement

`startPolicy` should describe:

- `autoStart` default true for this slice
- future manual start support
- execution mode default

`loopPolicy` should describe:

- completion behavior
- maximum automatic turns if any
- awaiting-input behavior
- retry behavior
- whether a provider result completes the whole run or only a turn

### R3. Direct Assignment Uses Templates

When a user assigns a task directly to an agent, the assignment must bind:

- assignee
- template
- execution mode
- start policy

The created TaskRun must snapshot the chosen template into the run context so later template edits do not rewrite historical runs.

Snapshot fields:

- `templateId`
- `templateSlug`
- `templateVersion` or `templateUpdatedAt`
- prompt/profile name used by the runtime
- policies used by the run

MVP storage can use JSON fields where schema churn would otherwise be high, but the API contract must be explicit.

### R4. Auto Start First

Direct assignment starts automatically in the first version.

Manual start is out of scope for MVP but must be represented as a later `startPolicy` option so the API will not need to be redesigned.

Expected MVP behavior:

- task created with agent assignment -> assignment is active -> TaskRun is queued immediately.
- task assigned after creation -> TaskRun is queued immediately.
- if runtime is not ready, TaskRun remains queued/dispatched with visible evidence issues rather than silently disappearing.

### R5. Configurable Execution Strategy

Multi-agent direct assignment must have an execution strategy.

Accepted first backend slice:

- `parallel`: one direct assignment queues its TaskRun immediately.

Designed but not implemented in first backend slice:

- `sequential`: queue the first TaskRun; later runs wait for previous completion.
- `assignments[]`: create multiple direct assignments/runs in one request.

Later strategies:

- `review_after_each`
- `leader_planned`
- `manual_gate`

The strategy belongs to the task assignment plan, not to global runtime state.

### R6. TaskRun Is Stateful Loop

TaskRun status must represent a continuing runtime context, not just a single response.

MVP status interpretation:

- `queued`: run exists but has not reached runtime.
- `dispatched`: daemon/runtime delivery has happened.
- `running`: TaskRun is active and may include multiple turns.
- `awaiting_input`: runtime explicitly needs user/tool/review input.
- `paused`: desired product state, may be introduced in this slice if schema work is low risk; otherwise document as next.
- `completed`: run has finished its current task objective, but records remain resumable/auditable.
- `failed`: runtime or gate failure with reason.
- `cancelled`: stopped by user/system.

If `paused` is not implemented in MVP, APIs must not pretend pause exists.

### R7. Product Grouping View

TaskRun needs a grouped product view, not only a flat runtime table.

Minimum grouping levels:

- task
- assignment plan / execution strategy
- task runs
- visible outputs and current state

The primary UI should show human-readable labels, status, progress, output summaries, usage/context/tool counts, and waiting/failure reasons. Long ids, raw tokens, and session strings belong in expandable debug detail only.

### Open Product Decision: State Anchor

The next design decision is what owns the long-lived runtime identity:

- one TaskRun has one durable runtime conversation/session and multiple turns
- or one TaskRun is an umbrella over multiple runtime sessions/attempts

This blocks the exact backend model for turns, resume, completion, and context isolation.

Decision for v1: one TaskRun owns one durable runtime conversation/session and multiple turns. Attempts/retries may be added later under the TaskRun without changing the product definition.

MVP completion policy:

- Existing/backward-compatible task runs may keep `single_turn_result`, where provider result completes the run.
- Template-based TaskRuns must snapshot a `completionPolicy`.
- If true multi-turn run semantics are not implemented in the first code pass, the API/UI must clearly label template runs as `single_turn_result` compatible mode rather than implying full loop support.
- If multi-turn loop is implemented, provider result should complete a turn, not necessarily the whole TaskRun.

### R7. Outputs Are Multi-Reference

TaskRun must move toward multiple output references.

MVP may keep:

- `outputMessageId` for primary channel message
- `contextSummary.outputs` or `contextSummary.outputRefs` for additional outputs

But serializer should expose a stable `outputs` array shape if feasible:

```json
[
  {
    "type": "message",
    "title": "Final report",
    "refId": "...",
    "isFinal": true,
    "createdAt": "..."
  }
]
```

### R8. Control Integration Group View

`/control/integration` must show TaskRun groups by task.

For each task group, show:

- task number/title
- execution strategy
- assignments/runs
- template names
- run status
- runtime/workspace summary
- output summary
- usage/context/tool evidence
- evidence issues

Do not show long ids/tokens/session strings in the main view.

### R9. Product Task Surface Entry Point

The product task page should expose the minimal direct assignment controls needed to use templates:

- choose agent
- choose template
- choose execution strategy if multiple assignments
- create/start automatically

Drag and drop can come later. The first version may use forms/menus.

Existing drag/drop assignment must not remain a silent assignee-only patch once this feature claims direct assignment. Either:

- route drag/drop through the new assignment/start API using the default template, or
- keep drag/drop visually separate and label it as owner assignment only until the runtime-starting flow is wired.

### R10. Prompt Injection Uses Template Snapshot

Daemon runtime prompt formatting must receive and display template context in a stable way:

- template name/slug
- purpose
- structured policies
- output expectations
- memory rules

This must not be only freeform text appended to the user message.

## Non-Goals

- Full leader orchestration.
- Drag/drop assignment UI.
- Automatic context compression below hard risk thresholds.
- New runtime activity table.
- Full artifact generation pipeline for PPT/video.
- Replacing channel memory/FUSE design.
- Treating TaskRun as coding-only.
- Exposing raw IDs/tokens/session strings in main UI.

## Data Model Direction

### New Table: `task_run_templates`

Proposed columns:

- `id UUID primary key`
- `slug VARCHAR unique`
- `name TEXT not null`
- `description TEXT`
- `category VARCHAR`
- `system_instruction TEXT not null`
- `tool_policy JSONB default {}`
- `skill_policy JSONB default {}`
- `memory_policy JSONB default {}`
- `output_policy JSONB default {}`
- `runtime_policy JSONB default {}`
- `start_policy JSONB default {}`
- `role_presets JSONB default []`
- `visibility VARCHAR`
- `status VARCHAR`
- `created_by UUID null`
- `created_at`
- `updated_at`

### `task_assignments` Additions

Preferred:

- `template_id UUID null`
- `template_snapshot JSONB default {}`
- `role_key VARCHAR null`
- `role_snapshot JSONB default {}`
- `execution_strategy VARCHAR default 'parallel'`
- `run_order INTEGER null`

If migration risk is too high for the first pass, store this in a JSON compatibility field only after explicitly documenting the compromise. Do not hide it in arbitrary `Task.data` without serializer support.

### `task_runs` Additions

Preferred:

- `template_id UUID null`
- `template_snapshot JSONB default {}`
- `role_key VARCHAR null`
- `role_snapshot JSONB default {}`
- `completion_policy VARCHAR default 'single_turn_result'`
- `output_refs JSONB default []`

Alternative MVP:

- Store snapshot under `context_summary.template`.
- Store output refs under `context_summary.outputs`.

The preferred schema is better for querying and UI. The alternative is acceptable only for an initial thin slice.

## API Direction

### Template APIs

- `GET /api/v1/task-run-templates`
- `POST /api/v1/task-run-templates`
- `PATCH /api/v1/task-run-templates/{id}`
- `POST /api/v1/task-run-templates/{id}/disable`

MVP can keep role presets nested under template APIs. If role presets need independent reuse in the implementation, add:

- `GET /api/v1/role-presets`
- `POST /api/v1/role-presets`
- `PATCH /api/v1/role-presets/{id}`

### Task Creation / Assignment APIs

Existing task creation should accept:

```json
{
  "assignments": [
    {
      "assignee": "agent-name",
      "template": "researcher",
      "runOrder": 1
    }
  ],
  "executionStrategy": "parallel",
  "autoStart": true
}
```

Assignment after task creation should use a runtime-starting endpoint, not plain task patch:

- `POST /api/v1/tasks/{taskId}/assignments`

Manual run start can be added later:

- `POST /api/v1/task-runs/{runId}/start`

Backward compatibility:

- existing `assignee` continues to work.
- if `assignee` is present and no template is supplied, use a default general template.

### Serializer Additions

Task response should include:

- `assignments[]`
- `runs[]`
- aggregate `runSummary`
- execution strategy

TaskRun response should include:

- `template`
- `outputs[]`
- `loopState` or clear status semantics

## UX Direction

### Template Management

Initial page can live under management/control:

- `/control/taskrun-templates`

Later product placement can be decided after the management flow works.

Template editor sections:

- identity: name/category/description
- purpose/instructions
- tools
- skills
- memory
- outputs
- runtime/start policy

### Task Direct Assignment

Initial product UI can be in `/tasks` create form:

- agent selector
- template selector
- execution strategy selector
- optional "add another assignment"

Default:

- one assignment
- auto start
- parallel

### Control Integration

Add task-grouped view:

```text
Task #12
  strategy: parallel
  template: Research Analyst
  run: @agent-a running, context 12%, tools 3
  template: Presenter
  run: @agent-b queued, waiting for previous run if sequential
```

## Acceptance Criteria

- [ ] A user can create a TaskRun template with structured tool/skill/memory/output/runtime/start policies.
- [ ] A user can edit an existing template.
- [ ] Built-in/default template exists for backward-compatible single-assignee task creation.
- [ ] Creating a task with direct assignment and template creates TaskAssignment and TaskRun records automatically.
- [ ] Existing `assignee` task creation still works and uses the default template.
- [ ] Multi-assignment task creation supports at least `parallel` strategy.
- [ ] Sequential strategy is either implemented or explicitly returns a clear unsupported error; it must not silently behave as parallel if the API claims it is sequential.
- [ ] TaskRun stores a template snapshot so later template edits do not alter historical run semantics.
- [ ] Template snapshot includes role/tool/skill/memory/output/runtime/loop policies, not only instruction text.
- [ ] TaskRun runtime prompt includes template purpose and policies.
- [ ] Direct assignment after task creation uses a new assignment/start path or is explicitly not claimed as runtime-starting.
- [ ] `/control/integration` shows task-grouped runs with template names and evidence summaries.
- [ ] `/tasks` or a management page exposes enough UI to create/edit templates and use one in direct assignment.
- [ ] Tests cover template CRUD, backward compatibility, assignment-to-run creation, snapshot behavior, and serializer output.
- [ ] Real validation creates a task using a custom template and confirms a real daemon-managed runtime receives the template context and posts an output.

## Test Plan

### Backend Unit Tests

- template create/update/disable validation
- default template seed/fallback
- existing task creation with `assignee` still creates one run
- task creation with `assignments[]` creates multiple assignments/runs
- template snapshot is copied to assignment/run
- editing template after run creation does not mutate old run snapshot
- unsupported execution strategy returns clear 400

### Daemon Tests

- formatted TaskRun prompt includes template name/policies/output expectations
- runtime delivery preserves `contextSessionId`
- default template prompt remains compatible with existing task events

### Frontend Tests / Build Checks

- template editor renders without raw ids as primary UI
- task create form can select template and strategy
- `/control/integration` groups runs by task and shows template labels
- lint/build pass

### Real Gate

Create a custom template, assign a task to a MiniMax/Claude Code runtime, and verify:

- TaskRun is created automatically
- template snapshot appears in API response
- daemon prompt receives template context
- output message is posted
- usage/context/tool evidence appears in `/control/integration`

## Open Design Questions

### Q1. Where should template editing live first?

Recommended answer: start under `/control/taskrun-templates`.

Why: this is still management/control functionality and will likely need debugging visibility. Product UI can consume templates from `/tasks` without making the full editor product-facing yet.

Trade-off: putting it directly in `/tasks` is more product-like, but increases UI complexity before the model is stable.

### Q2. Should sequential execution be implemented in MVP or rejected clearly?

Recommended answer: implement data shape now; if runtime scheduling is too large, reject `sequential` with a clear error in the first code pass rather than pretending it works.

Why: user asked for configurable strategy, but a fake sequential mode would damage trust.

### Q3. Should template presets be server-global or user-owned?

Recommended answer: support built-in global templates plus user-created templates. MVP can scope custom templates to the local server/account.

Why: built-ins make onboarding usable; user-owned edits make it flexible.

## Implementation Notes

- Do not add a runtime activity table.
- Avoid hard-coding role names in DB constraints going forward.
- Preserve existing TaskRun evidence gate behavior.
- Keep raw ids in collapsible details only.
- Do not read or commit `.dev-pids` token/credential files.
- Update `.trellis/spec/backend/runtime-slock-integration.md` after implementation with the final template contract.
