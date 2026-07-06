# computers product detail and runtime lifecycle

## Goal

Upgrade Computers into a product-grade operational surface for daemon connection, runtime availability, agent workspaces, reconnect, workspace scan, and runtime lifecycle controls.

## Requirements

* Add selected-computer sidebar/detail layout.
* Show OS, daemon version, update availability if available, machine ID, lease, heartbeat, detected runtimes.
* Show runtime installed/not-installed/unknown states where backend data supports them.
* Show agents on this computer with runtime, online/stopped status, and explanatory text.
* Add workspace scan entry point.
* Preserve connect and reconnect command flows.
* Add stop/restart/kill/reconcile lifecycle controls where backend supports them; document backend follow-up where missing.
* Add delete safety language and constraints.

## Acceptance Criteria

* [x] Computers page can select a computer and render detail.
* [x] Connect/reconnect commands still work and hide machine tokens from browser.
* [x] Agent workspace rows show status, runtime, pid/session/cwd where available.
* [x] Lifecycle controls are visible only when supported or clearly disabled with reason.
* [x] Real WebDriver + API/trace evidence verifies at least one connect/reconnect or runtime status path.

## Real Test SOP

Use marker `REAL_computers_<timestamp>`.

1. Open `/computers`.
2. Select an existing computer.
3. Verify runtimes and workspaces are visible.
4. Generate reconnect command and verify command is visible but no long-lived machine token is exposed.
5. If daemon is running, cross-check `smallkhoj-trace summary`.
6. Save screenshots/API/trace evidence under `evidence/`.

## Context

* Existing code: `frontend/app/computers/page.tsx`
* Parent research: `.trellis/tasks/06-09-product-maturity-gap-decomposition/research/slock-product-surface.md`
* Runtime spec: `.trellis/spec/backend/runtime-slock-integration.md`
* Frontend specs: `.trellis/spec/frontend/`
