# Plan 008 (Direction): Durable SmallKhoj-owned Work Item + dispatch queue

> **Executor instructions**: This is a **design plan** for the highest-value
> next capability. It explicitly does NOT implement the feature — per
> `.trellis/tasks/07-13-agent-runtime-capability-matrix/core-conclusion.md`,
> implementing it without a follow-on task is forbidden. The deliverable
> is a design document + API contract + open-questions list for operator
> sign-off, scoped to be picked up as a separate Trellis task. Read the
> plan fully before starting.

## Status

- **Priority**: P3 (high product value, but gated on a design decision)
- **Effort**: L (multi-week build; this plan produces only the design)
- **Risk**: HIGH (touches daemon delivery, message semantics, provider
  adapter boundaries)
- **Depends on**: none for the design; the eventual build depends on plans
  001 (tests) and 004 (Alembic, for the new persistence)
- **Category**: direction
- **Planned at**: commit `47848e8`, 2026-07-19

## Why this matters

`@`-mentioning a busy agent today relies on the model remembering to poll
(`slock message check`). The approved capability-matrix conclusion names
this as the single validated direction:

> `@`-mentions to a busy agent must become a durable SmallKhoj-owned Work
> Item with scheduler-managed wait/wake/retry — not a message the model is
> expected to notice. `slock message check` can remain a context-completion
> tool, but can no longer be the only correct path for an actionable `@`.

(`.trellis/tasks/07-13-agent-runtime-capability-matrix/core-conclusion.md:17-29, 54, 57-67`)

The public API currently has no `/work-items`, `/queue`, or
dispatch-attempt concept (only `GET/POST/PATCH /tasks` at
`backend/routers/public_api.py:2389-3028`). The Work Item is the
documented next build, it is evidence-backed, and it is unstarted. This
plan produces the design that the eventual Trellis build task will consume.

## Current state

- `backend/routers/public_api.py:2389-3028` — task routes (GET list, GET
  one, POST create, PATCH update, POST assignment). No queue or
  dispatch-attempt concept.
- `backend/models/slock.py` — `Task` model exists; no `WorkItem` or
  `DispatchAttempt` table.
- `.trellis/tasks/07-13-agent-runtime-capability-matrix/core-conclusion.md`
  — the approved conclusion; explicitly names the Work Item as "后续路线
  （本任务不实施）" item 1, i.e. must be a separate task.

## Scope

**In scope for THIS plan** (design only):

- A design document at `.trellis/tasks/07-13-.../work-item-design.md`
  covering: Work Item schema, dispatch-attempt lifecycle, scheduler
  algorithm, API contract, idempotency rules, and the `delivery_uncertain`
  terminal state.
- An open-questions list requiring operator decisions before build.

**Out of scope** (the build, deferred to a separate Trellis task):

- Any code change to `backend/routers/public_api.py`,
  `backend/models/slock.py`, or scheduler code.
- Any migration (the build task will produce the Alembic migration via
  plan 004's workflow).

## Steps

### Step 1: Re-read the capability matrix conclusion and gather constraints

Read in full:

- `.trellis/tasks/07-13-agent-runtime-capability-matrix/core-conclusion.md`
  — the approved direction and its explicit non-goals.
- `.trellis/tasks/07-13-agent-runtime-capability-matrix/prd.md` — the PRD's
  R7 constraint forbidding implementation without a follow-on task.
- The current `@`-mention path: `backend/routers/public_api.py:1995`
  (`_parse_mentions`) and how a mention becomes (or fails to become) an
  actionable notification to the mentioned agent's daemon.
- The existing reminder scheduler (`backend/services/reminder_scheduler.py`)
  as the closest existing pattern for a scheduler-managed retry loop.

**Verify**: produce a constraints brief listing every "must not" and
"must" from the conclusion doc, with exact line citations. Any design
that violates a constraint is rejected before being written up.

### Step 2: Draft the Work Item schema and lifecycle

Propose (do not implement):

- **`WorkItem` table** fields: `id`, `server_id`, `target_agent_id`,
  `source_message_id` (the `@`-mention), `payload` (JSONB), `status`
  (`pending` → `queued` → `submitted` → `terminal_observed` |
  `delivery_uncertain`), `created_at`, `next_attempt_at`,
  `attempt_count`, `last_attempt_at`.
- **`DispatchAttempt` table**: `id`, `work_item_id`, `attempt_number`,
  `submitted_at`, `adapter` (e.g. `feishu`, `daemon-direct`),
  `adapter_message_id`, `observed_terminal_at`, `outcome`.
- **Scheduler algorithm**: poll `WorkItem` rows where
  `status='queued' AND next_attempt_at <= now()`, submit to the target
  agent's adapter, record a `DispatchAttempt`, advance
  `next_attempt_at` with exponential backoff. After N attempts without
  observing a terminal state, mark `delivery_uncertain` and surface to
  the operator.
- **API contract**: `POST /api/v1/work-items` (create from a mention),
  `GET /api/v1/work-items?agent_id=...` (list), `GET /api/v1/work-items/{id}`
  (detail with dispatch history), `POST /api/v1/work-items/{id}/observations`
  (record a terminal observation from an adapter callback).
- **Idempotency rules**: a mention creates at most one WorkItem per
  (target_agent, source_message); retried submissions record new
  DispatchAttempts on the same WorkItem.

### Step 3: Write the open-questions list

At minimum, surface for operator decision:

1. Does a WorkItem replace the existing mention→notification path, or run
   alongside it during a transition period?
2. What is N (max attempts before `delivery_uncertain`)? Per adapter or
   global?
3. Does `delivery_uncertain` block subsequent mentions to the same agent,
   or just surface as a warning?
4. Where does the scheduler live — the existing
   `reminder_scheduler_loop`, a new `work_item_scheduler_loop`, or the
   daemon?
5. How does this interact with plan 004's Alembic baseline — is WorkItem
   the first migration on top of baseline?

**Verify**: operator signs off on the design (or defers specific
questions). The signed-off design becomes the input to a new Trellis task
that does the actual build.

## Done criteria

- [ ] `.trellis/tasks/07-13-agent-runtime-capability-matrix/work-item-design.md`
      exists with: schema, lifecycle, scheduler algorithm, API contract,
      idempotency rules.
- [ ] The design violates none of the conclusion doc's "must not" items
      (verified against the constraints brief from Step 1).
- [ ] The open-questions list has operator answers (or explicit "deferred
      to build task") for each question.
- [ ] A new Trellis task stub exists (e.g.
      `.trellis/tasks/<date>-durable-work-item/prd.md`) referencing the
      design doc as its input — the build is NOT in this plan.
- [ ] No source code modified.
- [ ] `plans/README.md` status row for plan 008 updated to DONE (or
      BLOCKED if the operator deferred the design decision).

## STOP conditions

- The conclusion doc at `.trellis/tasks/07-13-.../core-conclusion.md` does
  not exist or contradicts the plan's premise — STOP and report; the
  entire plan is grounded in that doc's authority.
- The operator wants to start building before the design is signed off —
  refuse and point at R7 (forbids implementation without a follow-on
  task); the design IS the deliverable here.
- Step 1 reveals that the current `@`-mention path already does something
  the design would duplicate (e.g. an existing untracked queue) — report
  and reconcile before drafting.

## Maintenance notes

- **This is a design plan, not a build plan.** Its success is measured by
  the quality of the signed-off design doc, not by shipped code.
- The eventual build task will be large (multi-week); sequence it after
  plan 004 (Alembic) so the WorkItem/DispatchAttempt tables are real
  migrations, not raw DDL.
- **Reviewer scrutiny**: the `delivery_uncertain` state is the most
  important design decision — it is the correctness property that
  distinguishes "the scheduler forgot" from "the scheduler gave up and
  told you." Get its semantics right before any code.
