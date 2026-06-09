# task review evidence

## Goal

Add a task evidence chain so tasks can carry proof: screenshots, trace snippets, API/DB checks, review notes, reopen reasons, and agent output links.

## Requirements

* Add evidence section to task detail.
* Define initial evidence data shape.
* Support evidence entries for screenshot path, trace path, API/DB proof, note, and reviewer decision.
* Connect real test SOP artifacts to tasks.
* Add review/reopen notes to status transitions where feasible.

## Acceptance Criteria

* [ ] Task detail shows evidence entries.
* [ ] A real test marker can be attached or referenced.
* [ ] Evidence is visible after refresh.
* [ ] Review status and reopen reason are captured or documented as backend follow-up.

## Real Test SOP

Use marker `REAL_task_evidence_<timestamp>`.

1. Create a task with marker.
2. Add evidence note/path.
3. Transition to in_review/done or reopen.
4. Verify UI and API persistence.
5. Save screenshots/API evidence.

## Context

* Tasks base task: `.trellis/tasks/06-09-tasks-board-list-filters/prd.md`
* Real SOP draft: `.trellis/tasks/06-09-product-maturity-gap-decomposition/real-test-sop-integration.md`
