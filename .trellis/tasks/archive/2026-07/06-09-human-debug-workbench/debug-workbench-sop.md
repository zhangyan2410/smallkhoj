# Human Debug Workbench SOP

## Marker-First Flow

1. Create or copy a unique marker such as `REAL_debug_workbench_YYYYMMDDTHHMMSSZ`.
2. Open `/daemon?marker=<marker>`.
3. Use linked evidence results to jump to source chat/task/file records.
4. Run `./smallkhoj-trace summary --json` and save raw trace under the active task evidence directory.
5. Use the database SOP when API and UI disagree.

## What To Check Next

* Browser: does the source record render where the link points?
* API: does `/api/v1/search?q=<marker>` return the same source record?
* DB: does the marker appear in `messages`, `tasks`, or `event_records`?
* Daemon/runtime: does `smallkhoj-trace summary` show related daemon events or explain their absence?
* Trellis: is the screenshot, raw trace, and concise note saved under `.trellis/tasks/<task>/evidence/`?

## Evidence Run

Marker: `REAL_debug_workbench_20260610T220300Z`

Evidence:

* `evidence/REAL_debug_workbench_20260610T220300Z-01-marker-workbench.png`
* `evidence/REAL_debug_workbench_20260610T220300Z-search.json`
* linked DB SOP: `../06-09-database-observation-sop/db-observation-sop.md`
* linked trace SOP: `../06-09-trace-to-task-evidence/trace-evidence-sop.md`
