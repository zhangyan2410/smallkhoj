# Implementation Plan / Spec / SOP

## Purpose

This file complements `prd.md`. Use it as the implementation handoff: plan, spec contracts, real-test SOP, and evidence expectations for the implementing/checking agent.

## Workstream

Platform

## Likely Scope

frontend auth routes, server-auth, backend auth/account/server models

## Plan

1. Read `prd.md`, this `info.md`, and every file listed in `implement.jsonl`.
2. Inspect the current implementation before editing; prefer existing local patterns over new abstractions.
3. Identify backend/API gaps explicitly instead of hiding them behind placeholder UI.
4. Implement the smallest coherent product slice that satisfies the PRD acceptance criteria.
5. Run lint/type-check and targeted tests for touched layers.
6. Run the Real Test SOP below and save evidence under `evidence/`.
7. Update `prd.md` acceptance checkboxes or add notes only when backed by evidence.
8. If a new contract or gotcha is discovered, update `.trellis/spec/` before finishing.

## Spec Contract

Auth/server spec: account session, login/logout, current server, route protection, dev-auth boundary.

Cross-cutting rules:

* SmallKhoj UI must use a cyan/blue product identity and must not copy Slock's brutal black-border/pink style.
* Browser/UI verification uses the project WebDriver `agent/daemon/webdriver/twd.py`, not Playwright.
* For browser-facing or runtime/control-plane behavior, real-test evidence is a required quality gate.
* Use unique markers so evidence cannot accidentally pass from stale data.
* Store generated proof in this task directory, preferably `evidence/REAL_<task>_<timestamp>-*`.

## Real Test SOP

Marker format:

```text
REAL_auth_multi_server_account_<YYYYMMDDHHMMSS>
```

Steps:

1. Start or confirm the local backend/frontend/daemon state needed by the PRD.
2. Open the local app with `twd.py` and drive the real visible workflow.
3. Verify the marker appears in the visible DOM using `scan --text` or `eval`.
4. Save a browser screenshot under `evidence/`.
5. Cross-check API state for created/changed resources.
6. Cross-check DB state when persistence or ownership is part of the contract.
7. Cross-check `./smallkhoj-trace summary` when daemon/runtime delivery is involved.
8. Write `evidence/REAL_auth_multi_server_account_<timestamp>-notes.md` with commands run, pass/fail, and remaining gaps.

## Evidence Checklist

* [ ] Browser screenshot saved.
* [ ] DOM/text assertion recorded.
* [ ] API or DB evidence recorded when relevant.
* [ ] Trace evidence recorded when runtime/daemon path is relevant.
* [ ] PRD acceptance criteria reviewed against the evidence.

## Dependencies / Sequencing

* Foundation tasks should run before deeper product surfaces when possible: `trellis-real-test-quality-gate`, `frontend-design-system-cyan-blue`, `frontend-product-shell-and-navigation`.
* Chat/Tasks/Members/Computers product surfaces should land before smaller refinements that depend on their layouts.
* Runtime/control-plane tasks should coordinate with existing daemon/backend WIP and must not revert unrelated dirty files.
