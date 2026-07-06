# Implementation Plan: Inkframe TWD Evidence And HTTP Cursor Harness

## Phase 0. Preflight

1. Confirm worktree and task tree.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
rtk python3 -m json.tool .trellis/tasks/07-05-inkframe-product-ui-refactor/task.json >/tmp/07-05-task.json
```

2. Read parent and prior-loop evidence.

```bash
rtk sed -n '1,260p' .trellis/tasks/07-05-inkframe-product-ui-refactor/prd.md
rtk sed -n '1,260p' .trellis/tasks/07-06-inkframe-browser-mobile-backend-hardening/evidence/browser-connectivity.md
rtk sed -n '1,260p' .trellis/tasks/07-06-inkframe-browser-mobile-backend-hardening/evidence/backend-route-flow.md
```

## Phase 1. `./twd` Connectivity

1. Check tabs.

```bash
rtk ./twd --compact tabs
```

2. Check bridge/frontend/backend.

```bash
rtk lsof -nP -iTCP:18765 -sTCP:LISTEN
rtk lsof -nP -iTCP:18766 -sTCP:LISTEN
rtk lsof -nP -iTCP:3000 -sTCP:LISTEN
rtk lsof -nP -iTCP:8000 -sTCP:LISTEN
```

3. If no tab and Chrome is not running, ask before launching Chrome. Do not
launch Chrome silently.

Evidence file:

```text
evidence/twd-connectivity.md
```

## Phase 2. Browser/Mobile Proof

Run only after a connected tab exists.

Authenticate/open:

```bash
rtk ./tools/twd-guard/twd-auth zy-ean
rtk ./tools/twd-guard/twd-open /chat
rtk ./tools/twd-guard/twd-open /tasks
```

Save evidence:

```bash
rtk ./twd --compact eval --url-match 127.0.0.1:3000/chat "return {...}" \
  > .trellis/tasks/07-06-07-06-inkframe-twd-evidence-http-cursor-harness/evidence/chat-browser-proof.json
rtk ./twd --compact eval --url-match 127.0.0.1:3000/tasks "return {...}" \
  > .trellis/tasks/07-06-07-06-inkframe-twd-evidence-http-cursor-harness/evidence/tasks-browser-proof.json
```

Capture screenshots where useful:

```bash
rtk ./twd screenshot --url-match 127.0.0.1:3000/chat \
  .trellis/tasks/07-06-07-06-inkframe-twd-evidence-http-cursor-harness/evidence/screenshots/chat-desktop.png
rtk ./twd screenshot --url-match 127.0.0.1:3000/tasks \
  .trellis/tasks/07-06-07-06-inkframe-twd-evidence-http-cursor-harness/evidence/screenshots/tasks-desktop.png
```

Mobile evidence should include DOM measurements at 390px. Use `./twd cdp` if
the extension supports viewport emulation; otherwise document the exact blocker.

## Phase 3. Backend HTTP Harness

1. Inspect existing backend test app/auth patterns.

```bash
rtk rg -n "ASGITransport|AsyncClient|TestClient|session|smallkhoj_session|current_account|active_server|X-Server-Id" backend/tests backend
```

2. Add a failing HTTP test file or extend `backend/tests/test_chat_read_cursors.py`.

Preferred file if the harness is new:

```text
backend/tests/test_chat_read_cursors_http.py
```

3. Implement the smallest reusable auth/server fixture required.

4. Keep handler-level tests. The new HTTP tests should sit above them, not
replace them.

## Phase 4. Validation

Frontend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
```

Backend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py tests/test_server_account_membership.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py
```

Repo:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

## Phase 5. Review

Create a Trellis channel review:

```bash
rtk trellis channel create cr-07-06-inkframe-twd-evidence-http-cursor-harness \
  --task .trellis/tasks/07-06-07-06-inkframe-twd-evidence-http-cursor-harness \
  --by codex-main \
  --cwd /Users/code/project/smallkhoj-inkframe-object-ui
```

Review focus:

- browser evidence truthfulness;
- whether Chrome launch permission was respected;
- full HTTP read-cursor route-flow coverage;
- no fake persistence for material blobs;
- no new visual direction.
