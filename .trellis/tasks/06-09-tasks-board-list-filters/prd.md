# tasks board list filters and evidence

## Goal

Upgrade Tasks from create/update forms into a mature work-management surface with board/list views, filters, task detail, source links, and review evidence.

## Requirements

* Implement board view grouped by todo/in_progress/in_review/done/closed.
* Implement list view for scanning.
* Add filters for channel, creator, assignee, and status.
* Show channel and task number on task cards.
* Show source message/thread where available.
* Add task detail drawer/page with title, description, status, assignee, source, activity/evidence.
* Define initial evidence storage model: task `data`, files, activity logs, or documented follow-up if backend change is needed.
* Preserve create/update task functionality.

## Acceptance Criteria

* [ ] Board and list view can be toggled.
* [ ] Filtering changes visible tasks correctly.
* [ ] A task created from UI appears in board/list with correct status and channel.
* [ ] Status transition is reflected in UI and API.
* [ ] Evidence section exists, even if first version stores only links/notes.
* [ ] Real WebDriver evidence captures board/list and API verification.

## Real Test SOP

Use marker `REAL_tasks_<timestamp>`.

1. Create a task with marker in title.
2. Verify it appears in TODO board and list.
3. Change status to IN REVIEW.
4. Verify API returns the updated status.
5. Add or attach evidence note if implemented.
6. Save screenshots/API evidence under `evidence/`.

## Context

* Existing code: `frontend/app/tasks/page.tsx`
* Parent research: `.trellis/tasks/06-09-product-maturity-gap-decomposition/research/slock-product-surface.md`
* Frontend specs: `.trellis/spec/frontend/`
