# Quality Gate: Inkframe Material Runtime And Chat Event Persistence Optimization

## Scope Checked

This gate covers the current `codex/inkframe-object-ui` worktree state for:

- product material runtime extraction and lifecycle;
- `07-05` product UI refactor carry-over for the shell background, chat, task,
  mobile, and object-language constraints;
- chat/task/background static material integration;
- backend-owned chat channel/DM/thread read cursors;
- frontend unread/event reconciliation against backend cursor state;
- previous tasks folded into this task:
  - `07-05-inkframe-product-ui-refactor`;
  - `07-04-ink-material-card-restore-resource`;
  - `07-02-chat-event-unread-indicators`.

## Acceptance Review

| Requirement | Status | Evidence |
|---|---|---|
| `07-05` product refactor carry-over is part of this task | Pass by planning/evidence | `prd.md`, `design.md`, `implement.md`, `evidence/product-surface-audit.md` |
| Reusable production material runtime outside demo evidence | Pass | `frontend/components/inkframe/*`, `frontend/public/inkframe/ink-material-engine.js`, material tests |
| Kept resources restore/edit/discard lifecycle covered | Partial pass | Restore/resource unit coverage exists; real browser draw/keep/restore proof still pending because `./twd` has no connected tab |
| App background is shell-owned material surface | Pass | `AppDeskBackground`, `ProductShell`, `InkMaterialRuntimeScript`, object UI tests |
| Product pages share clean material-capable desk | Pass by code/test | object UI source tests; browser evidence pending |
| Chat/task surfaces avoid unbounded WebGL canvases | Pass | static chat/task mount tests; active canvas count test |
| Chat/task foreground material activation UX exists | Pass by code/test | `activeMaterialMessageId`, `activeMaterialTaskId`, material toggle source tests |
| Active draw/water modes call material APIs | Pass | `MaterialSurface` pointer handlers and source contract test |
| Private material URLs revoked on replace/discard/pagehide | Pass | resource tests and pagehide lifecycle source contract |
| Backend read cursor persistence for channel/DM/thread | Pass | model/DDL/service/API focused tests |
| Sidebar unread backed by backend cursor state | Pass | backend list projection + frontend merge tests |
| Thread marker backed by backend projection | Pass | root message thread unread projection + frontend helper tests |
| Realtime local unread remains fallback/optimistic overlay | Pass | `deriveChatUnreadView` uses max(local, server), duplicate replay test |
| Mobile and real browser checks | Pending | `./twd` reports no connected tabs |
| `mdast` direct dependency hygiene | Pass from earlier task pass | direct dependencies removed; transitive remark/react-markdown references remain expected |

## Verification Commands

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
- Tests: `119` pass / `0` fail.

Re-run on 2026-07-06 after the latest scope addendum:

- TypeScript: pass.
- ESLint: pass.
- Tests: `134` pass / `0` fail.

Re-run on 2026-07-06 after the app-background action contract and proof-runner
route/surface hardening:

- Frontend full test suite: `136` pass / `0` fail.
- Product proof-runner unit suite: `22` pass / `0` fail.
- TypeScript: pass.
- ESLint: pass.

Backend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py
```

Results:

- Cursor tests: `10` pass / `0` fail after the follow-up scope-kind regression
  test was added.
- Compile: pass.

Re-run on 2026-07-06 after the latest scope addendum:

- Cursor HTTP/Postgres suite: `55` pass / `0` fail.
- Compile: pass.

Repository hygiene:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Result: pass.

Re-run on 2026-07-06 after the latest scope addendum: pass.

Fresh verification before merge cleanup on 2026-07-06:

Frontend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
rtk env NODE_PATH=./node_modules BETTER_AUTH_SECRET=sk_better_auth_build_placeholder_min_32_chars AUTH_BRIDGE_SECRET=sk_auth_bridge_build_placeholder_min_32_chars npx next build
```

Results:

- TypeScript: pass.
- ESLint: pass.
- Frontend node tests: `148` pass / `0` fail.
- Next production build: pass with local placeholder auth secrets. Better Auth
  emitted a base URL warning because `BETTER_AUTH_URL` is not set in the local
  build environment.

Backend:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py
```

Results:

- Cursor HTTP/Postgres suite: `68` pass / `0` fail.
- Compile: pass.

Repository/tooling:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk node --test tools/twd-guard/twd-inkframe-proof.test.mjs
rtk git diff --check
rtk ./twd --compact tabs
```

Results:

- Proof-runner unit suite: `13` pass / `0` fail.
- `git diff --check`: pass.
- `./twd --compact tabs`: no connected tabs
  (`{"ok": true, "tabs": [], "count": 0}`), so no browser/mobile acceptance is
  claimed.

WebDriver:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./twd --compact tabs
```

Result remains blocked by no connected browser tab:

```json
{"ok": true, "tabs": [], "count": 0}
```

## Review

Peer review ran through Trellis channel:

- Channel: `cr-07-06-inkframe-material-runtime`
- Worker: `check-codex`
- Result: `done`

Review fixed:

- exact unread message counts for channel/DM instead of global sequence deltas;
- server-scoped thread cursor projection;
- backend-projected root message thread unread fields;
- frontend backend-projection precedence;
- non-additive local unread overlay.

Main session then fixed the two remaining material runtime issues:

- active pointer handlers now call draw/water engine APIs;
- private resources have pagehide lifecycle cleanup.

Second peer review ran through Trellis channel after the `07-05` carry-over
scope was made explicit:

- Channel: `cr-07-06-inkframe-material-runtime-followup`
- Worker: `check-codex-2`
- Result: `done`

Second review fixed:

- channel/DM read cursor scope-kind validation;
- stale sidebar server unread projection after cursor write;
- stale thread unread projection after thread cursor write.

Main session then fixed the remaining non-mechanical UX gap:

- chat messages now expose a hidden-toolbar paintbrush toggle that activates
  exactly one foreground message material surface;
- task board/list/detail surfaces now expose a paintbrush toggle that activates
  exactly one foreground task material surface;
- toggles stop pointer/key propagation so they do not also select or drag tasks.

Additional completed child scopes recorded after the latest continuation:

- `07-06-inkframe-proof-runner-product-shell-route-sweep`
  - product-shell background route sweep covers `/chat`, `/tasks`, `/members`,
    `/computers`, and `/settings`.
- `07-06-07-06-inkframe-app-background-material-action-contract`
  - background action normalization now makes `activate`, `draw`, `water`,
    `keep`, `discard`, and `static` explicit and test-covered.
- `07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract`
  - proof runner now checks inner `MaterialSurface` metadata for the app
    background, not only the outer shell wrapper.
- `07-06-07-06-07-06-inkframe-background-image-resource-readability`
  - app background/image resource contract now distinguishes ProductShell routes
    from auth entry surfaces and preserves desk owner/tint/source metadata.
- `07-06-inkframe-material-source-image-fidelity-contrast`
  - MaterialSurface, AppDeskBackground, ProductShellBody, and the proof runner
    now expose selectors for visual/restore/source channel presence, background
    source mode, and foreground contrast ownership.
- `07-06-07-06-chat-read-cursor-last-read-seq-input-hardening`
  - `POST /api/v1/chat/read-cursors` now has explicit `lastReadSeq` input
    validation, stable HTTP 400 errors for invalid values, and preserved
    monotonic behavior for valid channel/DM/thread cursor writes.
- `07-06-chat-read-cursor-request-body-scope-hardening`
  - `POST /api/v1/chat/read-cursors` now rejects non-object JSON bodies and
    present non-object `scope` values with stable HTTP 400 errors before any
    route-level `.get(...)` access or database writes, while preserving the
    existing top-level thread fallback request shape.

Carry-over scope map:

- `evidence/carry-over-scope-map.md` records why the earlier `07-05`, `07-04`,
  and `07-02` Trellis tasks are executed as one delivery in this task instead
  of being treated as disconnected follow-ups.

## Remaining Risk

The remaining product-evidence gap is real browser/true-device validation.
`./twd serve` starts, but `./twd --compact tabs` still returns:

```json
{"ok": true, "tabs": [], "count": 0}
```

Therefore this gate does not claim browser/mobile proof yet, and screenshots or
in-app browser captures are not acceptance evidence for this merge. The next
operator or agent with a connected WebDriver tab or preview URL should run:

- chat sidebar unread clear and refresh preservation;
- root message thread marker clear and refresh preservation;
- chat/task/background material surfaces visible and readable;
- active material draw/water interaction on one foreground surface;
- 390px mobile no-horizontal-overflow checks.

## Decision

Code-level quality gate passes for lint/type/unit/build/focused backend review.

For this merge, the user accepts the current code-level gate with browser and
true-device UX acceptance deferred. Screenshots remain supplemental visual
context only, not delivery certification.
