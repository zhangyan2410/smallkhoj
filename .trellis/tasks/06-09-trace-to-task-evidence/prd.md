# trace to task evidence

## Goal

Make `smallkhoj-trace` output usable as task evidence for review and debugging.

## Requirements

* Define a compact trace evidence format keyed by marker.
* Add command or documented workflow to capture trace summary into task evidence.
* Link trace evidence to task detail/evidence UI.
* Avoid dumping overwhelming logs into the product UI.
* Preserve raw file path for deep debugging.

## Acceptance Criteria

* [x] A marker trace can be saved under a task evidence directory.
* [x] Task evidence UI can reference the trace summary.
* [x] Raw trace remains available.
* [x] Human-readable summary is concise.

## Real Test SOP

Use marker `REAL_trace_evidence_<timestamp>`.

1. Trigger a marker workflow.
2. Run `./smallkhoj-trace summary --json`.
3. Save filtered trace evidence.
4. Attach/reference it from a task.
5. Save UI/API evidence.

## Context

* Trace tool: `smallkhoj-trace`
* Task evidence task: `.trellis/tasks/06-09-task-review-evidence/prd.md`
