# human debug workbench

## Goal

Create a human supervisor debug workbench that helps the user inspect a real workflow across browser DOM, API rows, database facts, trace lines, daemon sessions, and runtime messages by marker.

## Requirements

* Provide a marker-first debug flow.
* Show linked sections: browser evidence, API state, DB state, trace summary, daemon/runtime delivery, task evidence.
* Keep language low-density and guided for non-developer use.
* Integrate `smallkhoj-trace` and WebDriver evidence paths.
* Add SOP recipes for common flows: DM reply, channel message, task assignment, runtime restart.

## Acceptance Criteria

* [x] User can enter/search a marker and see linked evidence.
* [x] Workbench explains what to check next.
* [x] At least one real workflow is proven end-to-end.
* [x] Evidence can be attached to a Trellis/task record or copied into notes.

## Real Test SOP

Use marker `REAL_debug_workbench_<timestamp>`.

1. Run a DM or channel marker workflow.
2. Open debug workbench and search marker.
3. Verify browser/API/trace evidence appears.
4. Save screenshot and notes.

## Context

* Existing SOP: `docs/real-runtime-dm-reply-sop.md`
* Trace tool: `smallkhoj-trace`
* Real SOP draft: `.trellis/tasks/06-09-product-maturity-gap-decomposition/real-test-sop-integration.md`
