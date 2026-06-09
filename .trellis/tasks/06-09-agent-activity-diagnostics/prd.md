# agent activity diagnostics

## Goal

Build a human-readable activity diagnostics panel for agents that summarizes runtime state, recent actions, tool calls, errors, and message/task delivery.

## Requirements

* Add Activity tab content for agent detail.
* Summarize runtime lifecycle: starting, running, idle, thinking, stopped, failed.
* Show recent messages/tasks delivered to the agent.
* Show recent runtime output/tool/action events with timestamps.
* Link to trace/debug evidence when available.
* Keep raw logs behind expandable details.

## Acceptance Criteria

* [ ] Agent Activity tab renders meaningful status without raw-log overload.
* [ ] Recent lifecycle and delivery events are visible.
* [ ] Errors/stopped states show human-readable explanations.
* [ ] Trace links or references are available when relevant.

## Real Test SOP

Use marker `REAL_activity_<timestamp>`.

1. Trigger a message/task to an agent.
2. Open Members -> agent -> Activity.
3. Verify marker appears in activity or trace-linked evidence.
4. Cross-check `smallkhoj-trace summary`.
5. Save screenshots/trace evidence.

## Context

* Members task: `.trellis/tasks/06-09-members-agent-profile-tabs/prd.md`
* Runtime spec: `.trellis/spec/backend/runtime-slock-integration.md`
