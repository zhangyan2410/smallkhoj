# Real Test SOP Integration Draft

## Purpose

Make real browser/runtime verification a normal Trellis quality gate for product-facing SmallKhoj work. Automated tests remain necessary, but they are not enough for bugs and features that span browser UI, backend APIs, daemon delivery, database rows, and runtime replies.

## When Required

A task must include a real test SOP when it touches any of:

* frontend browser workflow
* chat, DM, thread, task, file, reminder, member, computer, or runtime UI
* daemon connect/register/heartbeat/control commands
* agent message/task delivery
* runtime lifecycle start/stop/restart/reconnect
* user-visible debugging/observability

## Required Tools

Use the project WebDriver:

```bash
python /Users/code/project/smallkhoj/agent/daemon/webdriver/twd.py tabs
python /Users/code/project/smallkhoj/agent/daemon/webdriver/twd.py goto --url-match 127.0.0.1:3000 http://127.0.0.1:3000/
python /Users/code/project/smallkhoj/agent/daemon/webdriver/twd.py scan --text --url-match 127.0.0.1:3000
python /Users/code/project/smallkhoj/agent/daemon/webdriver/twd.py screenshot --url-match 127.0.0.1:3000 <task-dir>/evidence/<marker>.png
```

Use `smallkhoj-trace` for runtime/control-plane flow:

```bash
./smallkhoj-trace summary
./smallkhoj-trace summary --json
```

Use API/database checks where relevant.

Do not use Playwright for browser/UI verification in this repository.

## Evidence Contract

Each real test run should create a unique marker:

```text
REAL_<task-slug>_<YYYYMMDDHHMMSS>
```

The task directory should contain:

* `evidence/<marker>-browser.png`
* `evidence/<marker>-trace.txt` or `.json`
* `evidence/<marker>-api.json` when API state matters
* `evidence/<marker>-db.txt` when database state matters
* `evidence/<marker>-notes.md` with a concise pass/fail summary

## SOP Template For Child Tasks

```markdown
## Real Test SOP

Marker: `REAL_<task>_<timestamp>`

1. Start or confirm backend/frontend/daemon state.
2. Open the local app with `twd.py`.
3. Drive the exact browser workflow using visible controls.
4. Verify the visible DOM contains the marker and expected user-facing state.
5. Cross-check API or DB state for the resource created/changed.
6. Cross-check `smallkhoj-trace` when daemon/runtime delivery is involved.
7. Save screenshot and trace/API/DB evidence under `evidence/`.
8. Record result in `evidence/<marker>-notes.md`.

Pass condition:

* Browser-visible behavior is correct.
* Backend/API/DB state agrees with the browser.
* Runtime/daemon trace agrees when applicable.
* No stale marker or unrelated previous run is used as proof.
```

## Trellis Workflow Change Needed

Recommended updates:

* Add real-test SOP as a required check in `.trellis/workflow.md` Phase 2.2 / Phase 3.1 for browser/runtime tasks.
* Add a frontend quality guideline that `twd.py` evidence is required for user-visible workflows.
* Add a backend/runtime guideline that cross-layer runtime bugs require browser + API/DB + trace proof when the user-facing surface is involved.
* Seed child task PRDs with a `Real Test SOP` section.
