# Real Test SOP Template

Use this template for SmallKhoj tasks that change browser-visible product behavior, daemon/runtime delivery, or control-plane state.

## Marker

Use one unique marker per run:

```text
REAL_<task-slug>_<yyyyMMddHHmmss>
```

Example:

```text
REAL_chat_product_surface_20260609143012
```

## Evidence Directory

Save evidence under the task that is being verified:

```text
.trellis/tasks/<task-dir>/evidence/
```

Recommended file names:

```text
REAL_<marker>-notes.md
REAL_<marker>-desktop.png
REAL_<marker>-mobile.png
REAL_<marker>-api.json
REAL_<marker>-db.txt
REAL_<marker>-trace.json
```

## Browser Proof

Use the project WebDriver harness. Do not use Playwright for repository UI verification.

```bash
python agent/daemon/webdriver/twd.py --compact tabs
python agent/daemon/webdriver/twd.py goto --url-match 127.0.0.1:3000 http://127.0.0.1:3000/
python agent/daemon/webdriver/twd.py scan --text
```

Record:

- Route opened.
- Unique marker used.
- Visible DOM text that proves the workflow happened.
- Screenshot path saved under `evidence/`.

## API / DB Cross-Check

For UI workflows that create or mutate backend state, record at least one API or DB proof.

Examples:

```bash
curl -sS http://127.0.0.1:8000/api/v1/tasks
curl -sS http://127.0.0.1:8000/api/v1/channels
```

When DB state matters, use marker-first observation: search for the marker, then follow IDs to related rows. Keep the evidence short and human-readable.

## Runtime / Trace Cross-Check

For daemon, runtime, agent reply, or control-plane delivery, also record trace evidence:

```bash
./smallkhoj-trace summary
./smallkhoj-trace summary --json
```

The trace evidence should prove the marker reached the expected daemon/runtime path, not merely that the services were running.

## Pass / Fail Notes

Create one notes file with this shape:

```markdown
# REAL_<marker> Evidence

## Scope

- Task:
- Route(s):
- Marker:

## Browser Evidence

- Screenshot:
- Visible DOM proof:

## API / DB Evidence

- API file:
- DB notes:

## Runtime / Trace Evidence

- Trace file:
- Runtime evidence:

## Result

Pass or fail. If fail, list the exact gap and the next fix.
```

## Quality Gate

A task is not complete when real behavior is required but evidence is missing. If automated tests pass and real browser/runtime evidence fails, treat the task as failing and keep fixing.
