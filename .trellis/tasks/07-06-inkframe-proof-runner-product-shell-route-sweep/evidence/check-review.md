# Check Review

Date: 2026-07-06

## Scope

Review target:

```text
.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep
```

Changed files:

```text
tools/twd-guard/twd-inkframe-proof.mjs
tools/twd-guard/twd-inkframe-proof.test.mjs
```

The task extends the selector-driven `./twd` Inkframe proof runner so the
product-shell background contract is checked across:

- `/chat`
- `/tasks`
- `/members`
- `/computers`
- `/settings`

## Prior Check-Agent Finding

A check worker reviewed the task and found one test-strength issue:

```text
The product-shell route test checked that required selectors existed, but did
not assert that each route-level selector required minCount === 1.
```

The worker fixed `tools/twd-guard/twd-inkframe-proof.test.mjs` so the route
sweep test now asserts both:

- each required product-shell selector exists for every product route;
- each required selector has `minCount === 1`.

This matters because a selector manifest entry with `minCount: 0` would not
prove that the route must render the shell background contract.

## Main-Session Recheck

Commands run after the review fix:

```bash
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
```

Result:

```text
11 passed
```

```bash
rtk node --test tools/twd-guard/*.test.mjs
```

Result:

```text
20 passed
```

```bash
rtk ./twd --compact tabs
```

Result:

```json
{"ok": true, "tabs": [], "count": 0}
```

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep \
  --account zy-ean \
  --json
```

Result:

```json
{
  "ok": false,
  "status": "blocked_no_tab",
  "jsonPath": "/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/evidence/twd-inkframe-proof.json",
  "markdownPath": "/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep/evidence/twd-inkframe-proof.md"
}
```

```bash
rtk git diff --check
```

Result: pass.

```bash
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-inkframe-proof-runner-product-shell-route-sweep
```

Result: pass.

## Review Result

No remaining blocking issue found for this proof-runner readiness slice.

The route sweep is ready for a future connected-tab run. Browser/mobile
acceptance is still intentionally pending because `./twd` currently reports no
connected tabs.

## Residual Risk

This task proves the proof runner's selector manifest and no-tab behavior. It
does not prove the real routes render correctly in a browser. That proof remains
blocked until `./twd --compact tabs` returns at least one connected tab.
