# Product Surface Audit

Date: 2026-07-06

This audit records what is proven by current source/tests and what still needs
real `./twd` browser evidence. It intentionally does not treat screenshots or
source tests as a substitute for browser/mobile proof.

## Browser Status

`./twd` is available, but no browser tab is connected.

Commands tried:

```bash
rtk ./twd --compact tabs
rtk ./twd serve
rtk ./twd --compact tabs
```

Observed blocker:

```json
{"ok": true, "tabs": [], "count": 0}
```

See `browser-proof.md` for the full command log.

## Code-Level Validation

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
- Frontend tests: `119` pass / `0` fail.

Backend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py
```

Result:

- Cursor tests: `10` pass / `0` fail.
- Backend compile: pass.

Repository whitespace:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result: pass.

## Surface Matrix

| Surface | Current status | Evidence | Remaining browser proof |
|---|---|---|---|
| Global product shell | Code-level pass | `ProductShell` renders `AppDeskBackground`; `app-desk-background.tsx` exposes `data-region="app-desk-background"`, `data-material-owner="app-background"`, and `data-material-tint="desk"`; frontend tests include `Inkframe background contract has one shell owner` | Screenshot/DOM computed-style check on at least one product route |
| `/chat` entry | Code-level pass, browser pending | Full frontend tests pass; tests cover chat object taxonomy, message material toggle, unread key derivation, cursor writes, and Markdown `<marker>` escaping | Authenticated route load, toolbar hidden/default, hover/focus reveal, one active message material canvas |
| `/chat/[channel]` | Code-level pass, browser pending | `ChannelClient` source exposes `data-slot="message-material-toggle"`; tests cover one active foreground message surface and backend cursor write requests | Toggle two real messages and assert one active message canvas in `chat-main`; mobile 390px no horizontal overflow |
| `/tasks` | Code-level pass, browser pending | `TaskBoard` source exposes `data-slot="task-material-toggle"` in board/list/detail paths; `TaskDndBoard` now reuses `TaskBoard` for the real `/tasks?view=list` route branch instead of a static route-local list; route sidebar/dialog detail is wrapped in `TaskRouteDetailMaterialFrame`; `TaskMaterialStateProvider` shares `activeMaterialTaskId` between route list/board/detail. Tests cover one active foreground task material surface, hydration, and route-level shared material activation. | Toggle two real tasks and assert one active task canvas in `task-main`; mobile 390px no clipped controls |
| `/members` | Code-level pass for shared object language | Frontend tests cover avatar prefab consistency, status dot top-right, agent avatar generated fallback, and user-facing product surfaces avoiding route-local legacy color blocks | Browser screenshot/DOM check that route inherits desk background and avatar status dot is not obstructed |
| `/computers` | Code-level pass for shared object language | Frontend tests include `ComputerInkstone uses a local status object instead of a full-width bottom rail`; global product surface test passes | Browser screenshot/DOM check that route inherits desk background and computer object is not rendered as an old full-width rail |
| `/settings` | Code-level pass for background inclusion | Product surface tests include user-facing route legacy color audit; settings route is part of current modified product pages | Browser screenshot/DOM check that settings inherits desk background and controls remain usable |
| `/` product landing/dashboard route | Code-level pass, browser pending | Route composes `ProductShell`, so it inherits `AppDeskBackground` and the clean workbench desk shell. | Browser screenshot/DOM check that the dashboard route inherits the desk background and has no route-local legacy background |
| `/login` | Code-level pass for dry-paper entry surface | Frontend tests include `Login and join entry surfaces keep the dry-paper object language` | Browser screenshot/DOM check unauthenticated route background |
| `/join` | Code-level pass for dry-paper entry surface | Frontend tests include `Login and join entry surfaces keep the dry-paper object language` | Browser screenshot/DOM check invite route background |
| Chat mobile 390px | Not proven | No connected `./twd` tab is available; source uses `min-w-0`, `overflow-x-hidden`, and responsive shell offsets, but this is only code-level inference. | `./twd` viewport/DOM assertion for no horizontal overflow and no clipped primary controls |
| Task mobile 390px | Not proven | No connected `./twd` tab is available; source uses responsive grids and shell scroll owners, but this is only code-level inference. | `./twd` viewport/DOM assertion for no horizontal overflow and no clipped primary controls |
| Control/operator pages | Deferred by product scope | Plan explicitly excludes internal control pages from full object-desk product polish unless they affect shared runtime/build | No product polish proof required in this pass, but build/lint/tests must stay green |

## Requirement Mapping

| Requirement | Evidence status |
|---|---|
| Clean Inkframe desk background is the default product foundation | Code-level pass; browser pending |
| Chat/task foreground material activation exists | Code-level pass for chat and actual `/tasks` board/list/detail route branches; browser pending |
| Static lists do not create unbounded active canvases | Code-level pass through material/message/task tests |
| One active foreground material surface per region | Code-level pass through material store and message/task tests |
| Restore/resource lifecycle does not leak private object URLs | Code-level pass through material resource tests |
| Source-color image restore path exists | Code-level pass through material restore tests |
| Channel/DM/thread unread state uses real cursor model | Code-level pass through frontend unread tests and backend cursor tests |
| `rootMessages` is not the primary attention mechanism | Code-level pass through unread/event tests and source audit; browser pending |
| Mobile 390px chat/task layout | Not proven; requires connected `./twd` tab |
| Real browser chat/task DOM assertions | Not proven; blocked by no connected tab |

## Next Browser Checklist

When a browser tab is connected to `./twd`, run:

```bash
rtk ./tools/twd-guard/twd-open /chat
rtk ./tools/twd-guard/twd-open /tasks
```

Then save evidence for:

- `data-region="app-desk-background"` exists and is fixed behind content.
- Chat message toolbar is hidden by default and visible on hover/focus.
- Clicking `data-slot="message-material-toggle"` activates exactly one message
  material canvas.
- Clicking another message toggle deactivates the previous active message.
- Task toggle activation creates exactly one active task material canvas.
- Chat and task at 390px have no horizontal overflow and no clipped primary
  controls.
