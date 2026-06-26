# REAL_trellis_real_test_quality_gate_20260609134207 Evidence

## Scope

- Task: `06-09-trellis-real-test-quality-gate`
- Marker: `REAL_trellis_real_test_quality_gate_20260609134207`
- Routes: `/`

## Browser Evidence

- Screenshot: `evidence/REAL_trellis_real_test_quality_gate_20260609134207-login-or-home.png`
- WebDriver command:
  - `python agent/daemon/webdriver/twd.py goto --url-match 127.0.0.1:3000 http://127.0.0.1:3000/`
  - `python agent/daemon/webdriver/twd.py scan --text --url-match 127.0.0.1:3000 --wait 2`
- Visible DOM proof included:
  - `SmallKhoj`
  - `Product workbench`
  - `Search`
  - `Chat`
  - `Tasks`
  - `Members`
  - `Computers`
  - `Activity`
  - `Settings`

## API / DB Evidence

- Not required for this documentation-first gate task. Product-shell API evidence is saved under the shell task evidence directory.

## Runtime / Trace Evidence

- Trace file: `evidence/REAL_trellis_real_test_quality_gate_20260609134207-trace.txt`
- `./smallkhoj-trace summary` showed backend and frontend available. Daemon JSON-RPC health returned `405`, which is recorded but not blocking for this documentation/frontend gate task.

## Result

Pass for this task scope:

- `.trellis/workflow.md` requires real-test evidence for browser/runtime/control-plane work.
- Frontend quality guidelines require `twd.py` browser evidence.
- Backend runtime guidelines require browser/API/DB/trace cross-checks when runtime/control-plane behavior is product-facing.
- `docs/real-test-sop-template.md` exists and is linked from frontend/backend guidance and the runtime DM SOP.
