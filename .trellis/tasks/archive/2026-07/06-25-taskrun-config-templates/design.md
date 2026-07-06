# TaskRun Configurable Templates Design

## Architecture Summary

This slice adds a structured template layer between TaskAssignment and TaskRun.

```text
Task
  owns goal and aggregate plan

TaskAssignment
  binds agent + template + execution strategy to the task

TaskRun
  owns long-lived runtime context and snapshots the template used to start it

Daemon runtime
  receives TaskRun event with template snapshot and formats stable runtime guidance
```

## Core Decisions

### 1. TaskRun Is A Long-Lived Runtime Context

TaskRun should not be modeled as a single invocation. Existing TaskRun rows already carry runtime/session/context identity and lifecycle status, so the first implementation should extend them rather than replace them.

Detailed turn/activity history remains in trace/ActivityLog. TaskRun stores the product-facing summary and output references.

V1 state anchor: one TaskRun owns one durable runtime session/conversation. Multiple turns happen inside that context. Retry/fallback attempts can be modeled later without making the initial TaskRun a generic workflow envelope.

TaskRun state is intentionally split:

```text
TaskRun objective state
  queued | running | awaiting_input | blocked | completed | failed | cancelled | archived

Runtime session state
  starting | ready | busy | idle | error | expired | closed

Participant state
  assigned | active | waiting | done | handoff | failed
```

`completed` belongs to the objective state. It means the current output contract is satisfied. It does not imply the runtime session is closed or that future input must create a new run.

Same-run continuation should cover clarification, small edits, exports, evidence review, and format conversion. A derived TaskRun should be created when the user changes the objective or starts downstream work from the completed result.

### 2. Templates Are Structured Role Presets

Templates must not become raw prompt blobs.

The product-facing model is:

```text
TaskRunTemplate
  identity
  instruction
  toolPolicy
  skillPolicy
  memoryPolicy
  outputPolicy
  runtimePolicy
  startPolicy
```

The daemon prompt can render these policies into text, but the source of truth stays structured JSON.

Role presets are capability packages, not a fixed coding taxonomy. `architect`, `runner`, and `reviewer` can be built-ins, but the model must also support research, planning, operations, media generation, writing, QA, and user-defined domain work without changing database constraints.

The editable surface should expose structured knobs first. A freeform instruction field is allowed, but it must not be the only meaningful control.

### 3. Snapshot At Assignment / Run Creation

Template edits must affect future runs only.

When an assignment/run is created:

- assignment records selected template identity and snapshot
- run records the same snapshot
- daemon receives the run snapshot, not a live template lookup

This preserves auditability and avoids historical run drift.

### 4. Auto Start First

Direct assignment creates queued runs immediately.

Manual start will be a future `startPolicy` mode. MVP should keep the API shape ready but only implement `autoStart=true`.

Existing drag/drop assignment currently patches `Task.assignee_id` only. It must not be treated as runtime-starting direct assignment until it calls the new assignment/start service.

### 5. Strategy Belongs To The Task Plan

Execution strategy is not daemon-global.

MVP:

- `parallel`: create/queue the direct-assignment run immediately.
- `sequential`: either implement waiting runs explicitly or reject with 400. It must not silently behave as parallel.

### 6. Completion Policy Gates Long-Lived Loop Semantics

Current daemon behavior marks an active TaskRun completed when the provider emits a `result` event.

That behavior is compatible with `completionPolicy="single_turn_result"`, but not with a long-lived loop where provider result only finishes one turn.

MVP must make this explicit:

- legacy/default runs can use `single_turn_result`.
- template snapshots include `completionPolicy`.
- if multi-turn loop is implemented, provider result creates/updates turn evidence and the run remains `running` or `awaiting_input` until output policy is satisfied.
- if multi-turn loop is not implemented in the first pass, UI/API must not imply full loop behavior.

Current branch status: `single_turn_result` is implemented as the first policy. It is a compatibility policy, not the final TaskRun loop model.

### 7. TaskRun Does Not Equal Subagent

TaskRun is product/control-plane state:

- assigned to a task
- visible in grouped UI
- governed by template/policy snapshots
- tracks lifecycle, outputs, context, usage, tools, memory, and failure reasons
- can resume or wait for input as part of product workflow

Subagents are runtime-internal delegation. A TaskRun may ask a runtime to create subagents, but that remains implementation detail unless surfaced as activity evidence. This is the main advantage over relying only on subagents.

### 8. Memory And Output Are First-Class

Channel/fuse memory is part of the TaskRun design. A long task should not depend only on current model context.

TaskRun should be able to produce several output references:

- channel message
- memory entry
- file/artifact
- report/document
- slides/video/image/link

`completed` should mean the output contract is satisfied, not that all process evidence is collapsed into one message.

Context compaction should not be eagerly triggered by TaskRun itself in normal product flow. The working rule is to let Claude Code handle normal context behavior, surface context risk around the configured threshold, and only use checkpoint/memory extraction before forced compaction when context occupancy becomes high.

## Data Model

### Preferred Schema

Add `TaskRunTemplate` model/table:

```python
class TaskRunTemplate(Base):
    __tablename__ = "task_run_templates"

    id
    slug
    name
    description
    category
    system_instruction
    tool_policy
    skill_policy
    memory_policy
    output_policy
    runtime_policy
    start_policy
    visibility
    status
    created_by
    created_at
    updated_at
```

Extend `TaskAssignment`:

```text
template_id
template_snapshot
role_key
role_snapshot
execution_strategy
run_order
```

Extend `TaskRun`:

```text
template_id
template_snapshot
role_key
role_snapshot
completion_policy
output_refs
```

### Compatibility Option

If schema churn is too high during the first pass:

- store run snapshot in `TaskRun.context_summary.template`
- store outputs in `TaskRun.context_summary.outputs`

But API serializer should still expose stable `template` and `outputs` fields so the UI does not depend on storage details.

## API Design

### Template API

```http
GET /api/v1/task-run-templates
POST /api/v1/task-run-templates
PATCH /api/v1/task-run-templates/{id}
POST /api/v1/task-run-templates/{id}/disable
```

Validation:

- slug unique
- name required
- systemInstruction required
- policies must be JSON objects
- status in `active | disabled`
- visibility in `builtin | user | server`

### Task Creation

Existing shape remains valid:

```json
{
  "channel": "#33",
  "creator": "zy-ean",
  "assignee": "agent",
  "title": "Do work"
}
```

New shape:

```json
{
  "channel": "#33",
  "creator": "zy-ean",
  "title": "Do work",
  "executionStrategy": "parallel",
  "autoStart": true,
  "assignee": "agent-a",
  "template": "research-analyst",
  "roleKey": "researcher"
}
```

Rules:

- `assignee` without `template` maps to one assignment using the default template.
- `template` can be a template id or slug.
- `roleKey` selects a role preset from the template. If omitted, the first preset is used.
- first backend slice supports only one direct assignment.
- `assignments[]` is designed but not implemented yet.
- non-agent assignees do not auto-start runtime runs in MVP.
- `autoStart=false` and `executionStrategy!="parallel"` return explicit 400 until implemented.

### Assignment After Task Creation

Do not overload plain task update for runtime-starting assignment.

Add:

```http
POST /api/v1/tasks/{taskId}/assignments
```

This endpoint creates `TaskAssignment` and, when `autoStart=true`, queues the corresponding `TaskRun`.

First backend slice supports:

```json
{
  "actor": "zy-ean",
  "assignee": "agent-a",
  "template": "research-analyst",
  "roleKey": "researcher",
  "executionStrategy": "parallel",
  "autoStart": true
}
```

Existing `PATCH /api/v1/tasks/{taskId}` may continue to update owner/status fields, but it should not be described as TaskRun direct assignment unless it uses the same service.

## Daemon Contract

Task runtime events should include template snapshot data in event details.

Daemon formatting should add a stable block:

```text
TaskRun Template
- Name:
- Purpose:
- Tool policy:
- Skill policy:
- Memory policy:
- Output expectations:
```

Do not place secrets, raw tokens, or full session ids in this block.

## Frontend Design

### `/control/taskrun-templates`

Management surface for template CRUD.

Sections:

- template list
- identity editor
- instruction editor
- policy editors
- disabled/builtin indicators

### `/tasks`

MVP direct assignment fields:

- add assignment
- select agent
- select template
- execution strategy

Auto-start should be implicit for now.

### `/control/integration`

Add task-grouped TaskRun view.

Group row:

- task number/title
- strategy
- run count
- aggregate status

Run row:

- agent
- template
- status
- output
- usage/context/tool evidence

Keep raw ids/tokens/session strings out of the primary display. Show readable names and counts first; provide ids only in expandable technical detail.

## Design Questions Still Open

### State Anchor

Need one product decision before continuing implementation:

```text
Option A: TaskRun owns one durable runtime session/conversation and many turns.
Option B: TaskRun owns a workflow envelope and may contain multiple runtime sessions/attempts.
```

Recommendation: use Option A for the first product version. It preserves context isolation, makes resume behavior understandable, and keeps TaskRun visibly different from a one-off subagent call. Add attempts later only for retry/fallback.

Decision: accepted for v1.

## Migration / Seed

Startup seed must create built-in templates idempotently.

Minimum built-ins:

- `general-task-runner`
- `research-analyst`
- `planner`
- `reviewer`

Names should be product-neutral, not coding-only.

## Risks

- Hard-coded DB role check constraints currently block flexible role names.
- Frontend `/tasks` is server-rendered; adding rich assignment editing may require a client component.
- Existing daemon event formatting only knows `promptProfile`; template snapshot must be threaded through normalized runtime messages.
- Sequential strategy needs scheduling semantics; if not implemented carefully, it will lie.

## Validation Strategy

Run focused tests first:

- backend task/template tests
- daemon event formatting tests
- frontend lint/build

Then real gate:

- create custom template
- create assigned task using template
- ensure TaskRun snapshot appears
- ensure daemon prompt receives template block
- ensure runtime posts result
- verify `/control/integration` group view
