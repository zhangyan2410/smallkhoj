# Validation: Inkframe Selector Driven TWD Proof Runner

Date: 2026-07-06

## Commands Run

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
```

Result: passed.

- 9 tests passed.
- Covered no-tab classification, nonzero `./twd` no-tab exit parsing,
  selector manifest groups, stable `data-inkframe-*` selector usage, evidence
  path safety, project `./twd` command construction, DOM count script shape, and
  forbidden browser-launch / external browser-framework source checks.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk node --test tools/twd-guard/*.test.mjs
```

Result: passed.

- 18 tests passed.
- Confirms the new proof runner did not regress existing `twd-auth`,
  `twd-open`, and `twd-eval` guard helper behavior.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result: passed.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner
```

Result: passed.

- `implement.jsonl`: 4 entries valid.
- `check.jsonl`: 4 entries valid.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./twd --compact tabs
```

Result:

```json
{"ok": true, "tabs": [], "count": 0}
```

The command exits nonzero in this no-tab state, so the runner explicitly parses
the JSON payload before treating the condition as blocked. This prevents the
known no-tab state from being mislabeled as a generic WebDriver failure.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner \
  --account zy-ean \
  --json
```

Result: exited with code `2` and wrote blocked evidence:

```json
{
  "ok": false,
  "status": "blocked_no_tab",
  "jsonPath": "/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner/evidence/twd-inkframe-proof.json",
  "markdownPath": "/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner/evidence/twd-inkframe-proof.md"
}
```

## Evidence Files

- `evidence/twd-inkframe-proof.json`
- `evidence/twd-inkframe-proof.md`

Current status is intentionally `blocked_no_tab`. No browser or mobile product
acceptance is claimed until a connected `./twd` tab exists.

## Notes

- The runner uses `./twd --compact tabs` as the first gate.
- The runner does not launch Chrome.
- The runner does not use external browser E2E tooling.
- With a connected tab, it will use the existing `tools/twd-guard` route/eval
  flow to open `/chat` and `/tasks`, then count grouped `data-inkframe-*`
  selectors for product shell, chat desktop/mobile, chat unread, task
  desktop/mobile, and material state.
