# Validation

Date: 2026-07-06

## Scope

Task:

```text
.trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract
```

Changed files:

```text
tools/twd-guard/twd-inkframe-proof.mjs
tools/twd-guard/twd-inkframe-proof.test.mjs
```

## Red Test

Added required inner app-background material surface selectors to the product
shell route test.

Command:

```bash
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
```

Expected failure before implementation:

```text
/chat must check inner material owner
```

This proved the existing runner checked the outer app-background wrapper but not
the inner `MaterialSurface` owner.

## Implementation

Extended `buildProductShellChecks()` so every route in
`PRODUCT_SHELL_PROOF_ROUTES` now checks:

```text
[data-inkframe-surface="material"][data-inkframe-owner-kind="app-background"][data-inkframe-owner-id="global-desk"]
[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-tint="desk"]
[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-mode="static"]
[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-pointer-capture="false"]
```

Each selector has `minCount: 1`.

## Checks

Focused proof-runner test:

```bash
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
```

Result:

```text
13 passed
```

All twd guard tests:

```bash
rtk node --test tools/twd-guard/*.test.mjs
```

Result:

```text
22 passed
```

The extra two tests came from check-agent hardening:

- explicit `ok: false, code: "NO_TAB"` payloads classify as `blocked_no_tab`;
- pretty-printed no-tab JSON payloads are parsed rather than collapsed into a
  generic failure.

Proof runner:

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract \
  --account zy-ean \
  --json
```

Result:

```json
{
  "ok": false,
  "status": "blocked_no_tab",
  "jsonPath": "/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract/evidence/twd-inkframe-proof.json",
  "markdownPath": "/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract/evidence/twd-inkframe-proof.md"
}
```

Main-session re-run after the check-agent sandbox temporarily wrote
`failed_twd` evidence restored the expected current evidence:

```text
status: blocked_no_tab
tabsResult: {"ok": true, "tabs": [], "count": 0}
```

Diff whitespace:

```bash
rtk git diff --check
```

Result: pass.

Trellis context:

```bash
rtk python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract
```

Result: pass.

## Browser Evidence Status

The generated evidence is intentionally:

```text
blocked_no_tab
```

with:

```json
{"ok": true, "tabs": [], "count": 0}
```

No browser/mobile acceptance is claimed. This slice improves the future
connected-tab route sweep.

## Acceptance Mapping

- Inner app-background material surface selectors exist for every product shell
  route: covered by `product shell proof routes assert background owner, tint,
  and pointer contract`.
- Each required inner material selector uses `minCount === 1`: covered by the
  same test.
- Static mode and pointer false are required: covered by route selectors and
  generated evidence JSON.
- No-tab behavior preserved: covered by runner output and no-tab tests.
