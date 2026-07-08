# Follow-Up Review Brief

Please re-check the P1 route-level `/tasks` material activation issue you found.

## Fix Implemented

- Added `frontend/components/task-material-state.tsx`.
- Wrapped `/tasks` in `TaskMaterialStateProvider`.
- Changed `TaskDndBoard` so the real route uses `TaskBoard` for both board and
  list views instead of a route-local static list.
- Passed shared `activeMaterialTaskId` and `toggleTaskMaterial` from
  `TaskDndBoard` into `TaskBoard`.
- Wrapped route-level `TaskDetail` in `TaskRouteDetailMaterialFrame`, which:
  - uses the same shared task material state;
  - exposes `data-slot="task-material-toggle"`;
  - renders active/static `TaskMaterialSurface` based on the selected task id.
- Updated `product-surface-audit.md`.
- Added/updated tests in `frontend/test/task-board-hydration.test.tsx` and
  `frontend/test/material-surface.test.tsx`.

## Verification After Fix

Frontend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
```

Result:

- TypeScript: pass.
- ESLint: pass.
- Frontend tests: `120` pass / `0` fail.

Backend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_server_account_membership.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py
```

Result:

- `36` pass / `0` fail.
- Compile: pass.

Repo:

```bash
rtk git diff --check
```

Result: pass.

## Browser Status

`./twd --compact tabs` still returns:

```json
{"ok": true, "tabs": [], "count": 0}
```

Do not require browser proof in the follow-up because the blocker is still no
connected tab. Please confirm whether the route-level `/tasks` code-level gap
you found is now fixed, and identify any remaining non-browser P1/P2 issues.

