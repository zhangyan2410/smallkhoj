# Review Brief

Active task: .trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract

Please review the app background material action contract hardening slice.

Diff scope:

```text
frontend/components/inkframe/app-desk-background.tsx
frontend/test/material-surface.test.tsx
.trellis/tasks/07-06-07-06-inkframe-app-background-material-action-contract/
```

Focus on bugs and missing tests, not style preferences.

Check these product contracts:

- `resolveAppDeskMaterialAction` is an appropriate exported source contract.
- The action matrix is correct:
  - `activate` -> active / none
  - `draw` -> active / draw
  - `water` -> active / water
  - `keep` -> keeping / none
  - `discard` -> discarding / none
  - `static` -> static / none
- Pointer capture remains true only for explicit draw/water background editing.
- The background stays `app-background/global-desk/desk` and does not drift to
  message/card tint.
- The slice does not introduce backend, `localStorage`, or IndexedDB persistence
  for material resources.
- The evidence honestly records `./twd` no-tab as no browser acceptance.

Validation already run in the main session:

```text
frontend focused material/object tests: 43 passed
frontend typecheck: pass
frontend full tests: 136 passed
frontend lint: pass
git diff --check: pass
task.py validate: pass
./twd --compact tabs: {"ok": true, "tabs": [], "count": 0}
```

Return findings with file/line references. If you self-fix anything, report it.
