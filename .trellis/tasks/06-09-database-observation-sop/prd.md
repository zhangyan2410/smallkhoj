# database observation sop

## Goal

Create a low-density DB observation SOP so the human supervisor can inspect SmallKhoj PostgreSQL state with DBX/PostgreSQL while debugging product workflows.

## Requirements

* Document local database connection info and safe read-only habits.
* Provide table-by-table observation recipes for servers, members, computers, workspaces, channels, messages, tasks, events, activity logs.
* Use marker-first debugging: search a unique marker in messages/tasks/events, then follow IDs.
* Explain what each result means in product language.
* Avoid overwhelming schema dumps.

## Acceptance Criteria

* [ ] SOP doc exists and is linked from the parent/debug workbench task.
* [ ] User can follow a marker from browser message to DB row to event record.
* [ ] SOP clearly separates safe read-only observation from mutation.

## Real Test SOP

Use marker `REAL_db_observe_<timestamp>`.

1. Create marker through browser.
2. Query marker in DBX/PostgreSQL.
3. Cross-check browser and API state.
4. Save notes/screenshots under `evidence/`.

## Context

* Existing SOP: `docs/real-runtime-dm-reply-sop.md`
* Debug task: `.trellis/tasks/06-09-human-debug-workbench/prd.md`
