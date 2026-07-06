# Review Brief: Inkframe Runtime Browser Proof Product Polish

Active task:

```text
.trellis/tasks/07-06-inkframe-runtime-browser-proof-product-polish
```

Worktree:

```text
/Users/code/project/smallkhoj-inkframe-object-ui
branch: codex/inkframe-object-ui
```

## Review Goal

Review the current uncommitted work against the consolidated task. This task
now includes:

- `07-05-inkframe-product-ui-refactor`
- `07-04-ink-material-card-restore-resource`
- `07-02-chat-event-unread-indicators`
- `07-06-inkframe-material-runtime-chat-events-optimization`
- current browser/product polish task

Do not commit, push, pull, merge, or reset.

## Key Product Standard

Inkframe is intended to become the default product UI language for real
SmallKhoj product routes. Chat and tasks are the first full product surfaces.
The material runtime is core infrastructure for chat/task/background, not just
a decorative demo.

But browser proof must stay truthful:

- `./twd` is required for real browser/mobile claims.
- Current `./twd` status has no connected tabs.
- Do not mark browser/mobile acceptance as proven unless you can actually run
  `./twd` DOM/screenshot assertions.

## Verification Already Run

Frontend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
```

Results:

- TypeScript: pass.
- ESLint: pass.
- Frontend tests: `119` pass / `0` fail.

Backend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py
```

Results:

- Cursor tests: `10` pass / `0` fail.
- Backend compile: pass.

Repo whitespace:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result: pass.

## Browser Evidence Status

Commands tried:

```bash
rtk ./twd --compact tabs
rtk ./twd serve
rtk ./twd --compact tabs
```

Result while master was running:

```json
{"ok": true, "tabs": [], "count": 0}
```

The temporary master process was stopped. Browser/mobile proof remains pending
because no browser tab/extension client is connected.

## Review Focus

Please check:

1. Does the current diff genuinely satisfy the code-level portions of the
   consolidated task?
2. Are any broad browser/mobile claims overstated given the `./twd` blocker?
3. Is `product-surface-audit.md` truthful and complete enough for the current
   evidence state?
4. Are the material resource lifecycle tests and implementation enough to cover
   `07-04` keep/restore/discard/revoke/session-only requirements?
5. Are chat unread/event cursor tests and implementation enough to cover `07-02`
   without fake local decoration?
6. Are there any serious design regressions in chat/task/background object
   language, especially old dirty/pink background, over-tilting, nested
   interactive elements, or disconnected toolbars?
7. If you find small mechanical issues, fix them directly. For product judgment
   or browser-only gaps, report them clearly.

