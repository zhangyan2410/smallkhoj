# runtime provider expansion

## Goal

Expand runtime provider UX and backend/daemon support beyond Claude Code, including Codex CLI, Kimi CLI, OpenCode, Antigravity, Pi, and custom runtimes where feasible.

## Requirements

* Inventory detected runtime names and install states.
* Add provider selection UI for agent creation/edit.
* Map provider -> daemon runtime driver/config.
* Show unavailable providers with install guidance.
* Verify at least one non-Claude provider path or create precise follow-up tasks.

## Acceptance Criteria

* [ ] Provider choices align with detected runtimes.
* [ ] Agent creation can select supported providers.
* [ ] Unsupported providers are clearly disabled/explained.
* [ ] Backend/daemon contract for provider config is documented.

## Real Test SOP

Use marker `REAL_provider_<timestamp>`.

1. Open Members create agent flow.
2. Select available provider.
3. Create marker agent or dry-run if backend blocks.
4. Verify workspace runtime config in API/trace.
5. Save evidence.

## Context

* Runtime provider existing task: `.trellis/tasks/06-07-agent-runtime-provider-selection/prd.md`
* Runtime spec: `.trellis/spec/backend/runtime-slock-integration.md`
