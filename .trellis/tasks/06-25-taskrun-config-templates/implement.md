# TaskRun Configurable Templates Implementation Plan

## Phase 0: Prep

- [x] Read PRD and design.
- [x] Resolve the TaskRun state-anchor decision before continuing backend implementation.
- [x] Reconcile any already-written template CRUD/schema code with the updated long-lived TaskRun model.
- [x] Read specs:
  - `.trellis/spec/backend/runtime-slock-integration.md`
  - `.trellis/spec/backend/database-guidelines.md`
  - `.trellis/spec/frontend/quality-guidelines.md`
  - `.trellis/spec/frontend/product-ui-style.md`
- [ ] Keep `.dev-pids/*` out of git and output.

## Phase 1: Backend Template Model

TDD first.

Decision: v1 uses one TaskRun as one durable runtime session/conversation with multiple turns.

- [x] Add failing tests for template CRUD/service behavior.
- [x] Add `TaskRunTemplate` ORM model.
- [x] Add startup DDL/seed support in `backend/models/seed.py`.
- [x] Add default built-in templates.
- [x] Add serializer helpers.
- [x] Add public API routes:
  - `GET /api/v1/task-run-templates`
  - `POST /api/v1/task-run-templates`
  - `PATCH /api/v1/task-run-templates/{id}`
  - `POST /api/v1/task-run-templates/{id}/disable`

Validation:

```bash
cd backend
PYTHONPATH=. .venv/bin/pytest tests/test_task_runs.py -q
```

## Phase 2: Assignment And Run Snapshot

- [x] Add tests for legacy `assignee` fallback using default template.
- [x] Add tests for task assignment endpoint with template snapshot.
- [ ] Add tests for `assignments[]` task creation. Deferred; first backend slice supports one direct assignment.
- [x] Add tests proving template edits do not mutate existing TaskRun snapshot through run snapshot fields.
- [x] Extend `create_task_assignment_and_run()` to accept template and execution metadata.
- [x] Extend task serializers to expose run template summaries.
- [x] Thread template snapshot into TaskRun schema and `context_summary`.
- [x] Implement single-assignment `parallel` strategy.
- [x] For `sequential`, return a clear 400. Do not fake parallel.

Added in this slice:

- `POST /api/v1/tasks` accepts `template`, `roleKey`, `executionStrategy`, and `autoStart` for the single legacy assignee path.
- `POST /api/v1/tasks/{taskId}/assignments` creates one direct assignment and queues one TaskRun.
- `autoStart=false` and non-`parallel` execution strategy return 400.

Validation:

```bash
cd backend
PYTHONPATH=. .venv/bin/pytest tests/test_task_runs.py tests/test_public_events.py -q
```

## Phase 3: Daemon Template Prompt

- [x] Add daemon tests for template snapshot formatting.
- [x] Extend runtime message normalization to carry template info from event details.
- [x] Render template block into `formatRuntimeIncomingMessage()`.
- [x] Preserve current TaskRun lifecycle reporting.
- [ ] Keep `single_turn_result` labeled as compatibility behavior; do not imply full TaskRun loop completion semantics.

Validation:

```bash
cd agent/daemon/aaa-daemon
npm run build
npm test -- --test-name-pattern "task run|runtime delivery|template"
```

## Phase 4: Frontend Management UI

- [x] Add template list/editor page under `/control/taskrun-templates`.
- [x] Keep UI management-oriented and compact.
- [x] Avoid long ids in the main view.
- [x] Add `/tasks` assignment form fields for template.
- [ ] Add `/tasks` visible strategy selector. Deferred unless needed for first slice because backend supports only explicit `parallel`.
- [ ] Add `/control/integration` task-grouped run view with template labels.

Validation:

```bash
cd frontend
npm run lint
npm run build
```

## Phase 5: Real Runtime Gate

Use MiniMax/Claude Code runtime.

- [x] Start backend/frontend/daemon if needed.
- [x] Create, update, and disable a custom template through the API smoke path.
- [x] Create a task with direct assignment using a seeded template.
- [x] Verify TaskRun is created and auto-starts.
- [x] Verify daemon prompt receives template context.
- [x] Verify runtime posts a channel output.
- [x] Verify `/control/integration` shows grouped TaskRun with runtime evidence.
- [x] Save WebDriver screenshot under task evidence.
- [x] Verify `/control/taskrun-templates` renders the seeded templates and editor controls.
- [x] Verify `/tasks` renders the TaskRun template selector.

Use project WebDriver `./twd`, not Playwright, for UI evidence.

## Rollback Points

- If template table creates too much schema risk, fallback to `context_summary.template` for MVP but keep API response stable.
- If `/tasks` form becomes too large, ship template management + API + control integration first, then add product form in a follow-up.
- If sequential scheduling is not implemented, return explicit 400 and keep PRD acceptance updated.

## Completion Gate

- [x] Backend tests pass.
- [x] Daemon build/tests pass.
- [x] Frontend lint/build pass.
- [x] Real runtime gate passes.
- [x] Spec updated with final template contract.
- [ ] Changes committed on `codex/06-24-taskrun-config-templates`.

Latest verification:

- `backend`: `PYTHONPATH=. .venv/bin/pytest tests/test_task_runs.py tests/test_public_events.py tests/test_daemon_control.py -q` -> 75 passed.
- `agent/daemon/aaa-daemon`: `npm test -- --test-name-pattern "task run template"` -> TypeScript build passed, 154 tests passed.
- `frontend`: `npm run lint` -> passed.
- `frontend`: `npm run build` -> passed; build includes `/control/taskrun-templates`.
- WebDriver evidence:
  - `.trellis/tasks/06-25-taskrun-config-templates/evidence/taskrun-templates.png`
  - `.trellis/tasks/06-25-taskrun-config-templates/evidence/tasks-template-selector.png`
- API smoke:
  - created, updated, and disabled `real-taskrun-template-20260625004904`.
- Real runtime gate:
  - reconnected `integration-gate-mac` daemon with a fresh connect ticket.
  - started `@gate-minimax` Claude Code runtime through MiniMax.
  - created task `#3 REAL_TASKRUN_AUTOSTART_20260625005429` with `template=research-analyst`, `roleKey=researcher`, `autoStart=true`.
  - TaskRun `77c7e2ab-eae3-477d-9a80-9edf874739e8` reached `completed`, with output message `83ce8704`, 7 tool calls, token/context evidence, and no evidence issues.
  - `/control/integration` displayed the completed TaskRun and usage evidence.
