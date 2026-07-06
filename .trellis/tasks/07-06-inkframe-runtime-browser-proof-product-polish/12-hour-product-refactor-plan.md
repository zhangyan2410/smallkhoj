# 12-Hour Inkframe Product Refactor Plan

## Finish Line

SmallKhoj uses Inkframe as the default product UI language on real product
routes, not as a demo skin. Chat and tasks are the first fully productized
surfaces. Every user-facing product page gets the clean dry-paper desk
background, while chat/task get foreground material interaction, unread/event
states, and mobile-proof layout.

This is a consolidation task, not a fresh isolated polish pass. The earlier
Trellis tasks listed below are required acceptance surfaces for this plan. A
later agent must not mark this task done by proving only the newest backend or
browser-proof slice while leaving the earlier product-refactor, material
restore/resource, or unread/event contracts as "future work".

This plan intentionally includes the previous Trellis work:

| Included task | Role in this plan | Must preserve |
|---|---|---|
| `07-05-inkframe-product-ui-refactor` | Umbrella product UI contract | Inkframe default, global clean background, chat/task full polish, mobile |
| `07-04-ink-material-card-restore-resource` | Material runtime lifecycle contract | keep/restore editable ink, discard/revoke, no backend/local persistence |
| `07-02-chat-event-unread-indicators` | Chat attention contract | channel/DM/thread unread marks, clear after viewed, no root-message count as primary signal |
| `07-06-inkframe-material-runtime-chat-events-optimization` | Existing implementation base | material runtime wrapper, read cursor backend, chat/task activation hooks |
| `07-06-inkframe-runtime-browser-proof-product-polish` | Current execution shell | real browser proof, mobile proof, product-surface audit, review |
| `07-06-07-06-inkframe-selector-driven-twd-proof-runner` | Canonical browser proof tool | `./twd` no-tab honesty, selector groups for shell/chat/task/material/unread, evidence JSON/Markdown |

## Product Decisions

- WebGL material is core infrastructure for chat/task/background, not a small
  decorative experiment.
- The app background should be an Inkframe material surface by default on every
  user-facing product route.
- Every user-facing route must inherit a material-capable app desk background,
  even when that route does not yet receive full object-level redesign.
- Chat and task are the only pages that need full object-level refinement in
  this pass; members, computers, settings, login/join get the shared background
  and obvious old-style cleanup only.
- Background render/keep/restore is an app-desk owner concern. It must not
  accidentally reuse chat message paper tint, chat snapshot sizing, or
  document-height background behavior after the user renders or keeps it.
- Future background images are part of the product direction. This pass does
  not need a full image management UI, but the background resource model must
  already preserve source/visual/restore separation and keep foreground content
  readable over rendered or image-derived material.
- Large ink/image blobs are session-only. Do not persist them to backend,
  `localStorage`, or IndexedDB in this pass.
- Background image support should be designed in now, but real image management
  can remain scoped to the existing material import path unless already present.
- The app must remain usable when WebGL is unavailable, reduced motion is
  preferred, or mobile disables active material drawing.
- Do not keep multiple long-lived product themes. Old product style is replaced
  if this passes; fallback is capability-driven only.

## Non-Goals

- No full drawing app.
- No backend storage of rendered ink/image blobs.
- No cross-refresh persistence for material surfaces.
- No full object redesign of members/computers/settings beyond shared surface
  consistency.
- No decorative stamps on avatars or unrelated controls.
- No hover lift/drift unless that object is actually movable/actionable and the
  destination/operation is clear.

## Stateful Object Census

These objects have lifecycle risk and must be tested as state machines, not as
static CSS.

| Object | Lifecycle owner | State | Events | Invariants |
|---|---|---|---|---|
| App desk background | `ProductShell` + `AppDeskBackground` | `static`, `active`, `kept`, `fallback` | route mount, activate, paint, water, import image, keep, discard, pagehide, WebGL failure | one shell-owned background; background tint never becomes chat-card tint; fixed viewport coordinates; no document-height drift |
| Chat message material | `ChannelClient` | inactive static, active draw, kept static, fallback | hover/focus toolbar, toggle material, draw/water, keep, collapse/re-render, switch active message | at most one active material message in `chat-main`; inactive messages do not own canvases; long messages stay readable |
| Task material | `TaskBoard` | inactive static, active draw, kept static, fallback | select task, toggle material, drag attempt, draw/water, keep, switch active task | at most one active task material in `task-main`; material toggle must not trigger select/drag/navigation |
| Material image resources | `material-resource` helpers/store | shared source, private object URL, revoked | snapshot, replace, discard, pagehide, unmount | private object URLs are revoked; repeated keep overwrites one resource key; shared paper source is not revoked prematurely |
| Material restore payload | `material-surface-restore` | no restore, visual snapshot, editable restore map, source-color restore | activate, load image, bake source, async cancel, WebGL failure | async restore cannot bake into a stale surface; restored ink remains editable; source image fidelity is not degraded to black-only marks |
| Read cursors | backend + `use-chat-unread-store` | unknown, server projected, optimistic local, cleared | message created, channel open, DM open, thread open, API success/failure | backend cursor is authoritative when present; local overlay does not double count; cursor scope is server/member/channel/DM/thread correct |
| Sidebar entity item | chat sidebar | quiet, unread, active, hover/focus | realtime event, click/open, cursor clear | channel and DM share event grammar; unread badge belongs to the row, not page chrome |
| Avatar object | `AvatarObject` / member avatar primitive | human, agent, online/offline/running | status update, render in message/sidebar/member | same prefab class across placements; agent identity frame does not cover status dot; no red stamp on avatar |

## Invariants To Test

| ID | Invariant | Verification |
|---|---|---|
| INV-1 | User-facing routes never show the old pink/dark dirty background. | CSS/source audit plus browser screenshots/DOM computed style where `./twd` is connected |
| INV-2 | Background keep/restore preserves desk tint and viewport alignment. | material runtime unit test plus browser visual/DOM evidence |
| INV-2b | Every user-facing product route mounts the same material-capable desk owner, not route-local background variants. | product shell/source audit plus route DOM marker checks |
| INV-2c | Background image/source restore remains owner-separated from chat/task paper surfaces. | material resource/restore tests with owner metadata and source-color fixture |
| INV-3 | Chat/task inactive lists do not create unbounded canvases. | component test counts `data-slot="material-canvas"` before activation |
| INV-4 | Only one active foreground material surface exists per workspace region. | component test and `./twd` DOM assertion after toggling two objects |
| INV-5 | Re-rendering a kept material surface restores editable ink. | material restore test using `loadImage`/`bakeSource` path |
| INV-6 | Discard/replacement/pagehide revokes private object URLs. | resource lifecycle unit tests with revoke counter |
| INV-7 | Imported image visual fidelity uses source-color restore/snapshot rather than black-only ink degradation. | engine/material restore test with colored source fixture |
| INV-8 | Chat message actions are hidden by default and appear adjacent to the message, not full-row right. | component test plus browser hover/focus assertion |
| INV-9 | Long agent messages use stable readable paper/notebook treatment; short messages may tilt only subtly. | component snapshot/source test plus visual review |
| INV-10 | Channel, DM, and thread unread state clears only after the relevant view is opened. | backend cursor tests plus frontend store tests |
| INV-11 | Mobile chat/task have no horizontal overflow and primary controls are not clipped at 390px. | `./twd` viewport DOM assertions when connected; CSS/layout source fallback if disconnected |
| INV-12 | Browser acceptance cannot pass when no `./twd` tab is connected. | `tools/twd-guard/twd-inkframe-proof` returns `blocked_no_tab` with exit code `2` and writes evidence instead of passing |

## Architecture

### Product Shell

`frontend/components/product-shell.tsx` should be the owner of the global desk
environment. Product pages should not each invent a background. The shell should
render:

- a fixed viewport Inkframe desk layer;
- route content above it;
- capability fallback if WebGL/reduced-motion/mobile constraints require static
  rendering;
- optional shell-level background activation/import hooks, but no noisy global
  drawing toolbar in the normal product chrome.

The shell background and foreground cards must use separate material owner
metadata. A kept background should restore with `owner="desk"` / desk tint, not
with chat paper tint.

### Material Runtime

`MaterialSurface` remains the React boundary for runtime ownership:

- inactive surfaces render a static visual snapshot or static paper fallback;
- active surfaces own the canvas and pointer capture;
- active canvas is created only after explicit activation;
- restoration is guarded by token/owner so async loads cannot bake into stale
  surfaces;
- resources are registered through `material-resource` and revoked by lifecycle
  helpers.

The plan should avoid one permanent WebGL context per message/card. A page can
have many static material objects, but only one active foreground material per
region.

### Chat

Chat uses object vocabulary:

- `AvatarObject`: same prefab for sidebar/member/message placements.
- `MessagePaper`: standard message sheet.
- `MessagePaper data-variant="notebook"`: long agent output with stable reading
  treatment; paging is real only if content overflows the page model.
- `MessageToolStrip`: hidden by default, shown near author/message on hover or
  focus. Paint/material toggle lives here.
- `EventBadge`: shared unread/event mark for channels, DMs, and thread markers.

Thread/task references inside chat remain normal messages in this pass. Future
navigation can attach to the same object without embedding full task panels in
chat.

### Tasks

Tasks use distinct objects:

- `TaskMaterialSurface`: task ticket/docket, not the same visual species as
  message paper.
- `EvidenceSurface`: proof sheet, hover lift only when it opens/moves to a real
  target.
- `ReviewMarkup` / `ReviewStamp`: review state and actions, not avatar
  decoration.

Task material toggle must be local to task controls and must stop pointer/key
propagation so it does not select, drag, or navigate the task.

### Backend Read Cursors

The backend remains responsible for persisted read/unread state:

- channel/DM sidebar state derives from backend projected unread fields;
- active channel/DM/thread writes the cursor;
- frontend local state is only an optimistic overlay or fallback;
- unread counts use actual newer messages, not `latestSeq - lastReadSeq`, due
  to global sequence gaps.

## 12-Hour Execution Schedule

### Phase 0: Preflight And Scope Lock (0:00-0:45)

1. Confirm branch, dirty tree, active task.
2. Read current specs and carry-over task docs.
3. Write one short progress entry listing exactly which older Trellis tasks are
   included.
4. Do not pull, merge, push, reset, or commit.

Carry-over lock:

- `07-05-inkframe-product-ui-refactor` remains the umbrella product acceptance
  frame: default Inkframe desk background, chat/task full polish, mobile, and
  background image/material readiness.
- `07-04-ink-material-card-restore-resource` remains the material lifecycle
  contract: session-only keep/restore, editable restored ink, discard/revoke,
  repeated keep without resource growth, and no backend/local persistence for
  large blobs.
- `07-02-chat-event-unread-indicators` remains the attention/event contract:
  channel/DM/thread unread marks backed by real cursor state, not low-value
  root-message counts or decorative badges.
- `06-30-ink-wash-theme-exploration` remains the visual language reference for
  object names and constraints, but the implementation target is now the real
  product code rather than the evidence-only demo.

Commands:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
rtk python3 ./.trellis/scripts/task.py current
rtk sed -n '1,260p' .trellis/spec/frontend/component-guidelines.md
rtk sed -n '1,260p' .trellis/spec/frontend/quality-guidelines.md
rtk sed -n '1,260p' .trellis/spec/frontend/state-management.md
```

### Phase 1: Failing/Strengthened Tests First (0:45-2:00)

Add tests before broad UI edits.

Frontend targets:

- `frontend/test/material-surface.test.tsx`
- `frontend/test/material-resource.test.ts`
- `frontend/test/material-surface-restore.test.ts`
- `frontend/test/chat-unread-state.test.ts`
- `frontend/test/task-board-hydration.test.tsx`
- a product shell/background test if one exists or can be added cheaply.

Required red/strengthened assertions:

- background owner preserves desk tint after keep/restore;
- static product pages render the desk background marker;
- chat inactive messages create zero active canvases;
- toggling two messages leaves one active message canvas;
- task material toggle stops propagation and leaves one active task canvas;
- private material resources revoke on replace/discard/pagehide;
- colored imported source restores with source-color visual path;
- local unread overlay does not double count backend unread projection.
- `./twd --compact tabs` no-tab JSON with nonzero exit is classified as
  `blocked_no_tab`, not as a generic tool failure or pass.

### Phase 2: Material Runtime Hardening (2:00-3:30)

Files:

- `frontend/components/inkframe/material-resource.ts`
- `frontend/components/inkframe/material-surface-store.ts`
- `frontend/components/inkframe/material-surface-restore.ts`
- `frontend/components/inkframe/material-surface-lifecycle.ts`
- `frontend/components/inkframe/material-surface.tsx`
- `frontend/public/inkframe/ink-material-engine.js` only if absolutely required.

Implementation:

1. Add owner/tone metadata to resources if missing.
2. Separate visual snapshot, editable restore map, and source-color image
   restore so imported images do not collapse into black-only marks.
3. Ensure background resources use desk tint and fixed viewport coordinates.
4. Ensure discard and pagehide revoke private resources.
5. Preserve one active region owner.

Checks:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-resource.test.ts test/material-surface-restore.test.ts test/material-surface.test.tsx
```

### Phase 3: Global Background Productization (3:30-5:00)

Files:

- `frontend/components/product-shell.tsx`
- `frontend/components/product-shell-body.tsx`
- `frontend/components/inkframe/app-desk-background.tsx`
- `frontend/app/globals.css`
- route pages under `frontend/app/*/page.tsx` only where they bypass the shell.

Implementation:

1. Make the clean dry-paper desk the default user-facing background.
2. Remove or override old pink/dark/dirty route backgrounds.
3. Keep control/operator-only pages out of user-facing polish if they are not
   product surfaces.
4. Add `data-region="app-desk-background"` and stable selectors for `./twd`.
5. Keep shell background fixed to viewport.
6. Ensure foreground paper/card opacity protects readability if future
   background images are active.
7. Prove that keeping/rendering the background preserves `owner="desk"` (or the
   production equivalent) and cannot fall back to message/chat tint.
8. Verify every user-facing page mounted through the product shell receives the
   same background marker, including members, computers, settings, login/join,
   and the product dashboard.

Checks:

- source audit for old pink/dark background tokens;
- `./twd` screenshots if connected;
- CSS layout sanity for desktop and 390px.

### Phase 4: Chat Product Surface (5:00-7:15)

Files:

- `frontend/app/chat/[channel]/channel-client.tsx`
- `frontend/app/chat/[channel]/chat-sidebar.tsx`
- `frontend/app/chat/chat-data-context.tsx`
- `frontend/components/message-frame.tsx`
- `frontend/components/markdown-message.tsx`
- `frontend/components/inkframe-object-ui.tsx`
- `frontend/app/globals.css`
- `frontend/messages/en.json`
- `frontend/messages/zh-CN.json`

Implementation:

1. Replace root-message count foregrounding with useful conversation/unread
   metadata.
2. Keep `MessageToolStrip` hidden by default and local to the message.
3. Put material toggle inside the tool strip.
4. Use readable paragraph rhythm for long agent output.
5. Apply notebook treatment only to long/agent output where it improves
   scanning; do not tilt all messages.
6. Use `EventBadge` for channel/DM/sidebar/thread unread state.
7. Preserve Markdown safety: no raw `<marker>` React warning regression.
8. Keep task messages as normal messages with future navigation hooks.

Checks:

- message actions hidden/default source/component test;
- unread derivation/clear tests;
- `./twd` chat hover/focus/toggle checks if connected;
- mobile 390px no overflow.

### Phase 5: Task Product Surface (7:15-8:45)

Files:

- `frontend/app/tasks/page.tsx`
- `frontend/components/task-board.tsx`
- `frontend/components/task-dnd-board.tsx`
- `frontend/components/task-list-panel.tsx`
- `frontend/components/inkframe-object-ui.tsx`
- `frontend/app/globals.css`

Implementation:

1. Make task tickets visually distinct from chat messages.
2. Keep evidence/review/memory treatments separate.
3. Add or verify task material toggles in board, list, and selected detail.
4. Stop propagation from material controls.
5. Use restrained state material:
   - review more marked;
   - done settled/faded but readable;
   - blocked denser/darker locally;
   - running active only where meaningful.
6. Verify mobile task layout stacks without clipping.

Checks:

- task board hydration tests;
- source test for no nested interactive toggle inside task button/link;
- `./twd` task toggle and mobile assertions if connected.

### Phase 6: Backend Cursor Hardening (8:45-9:45)

Files:

- `backend/tests/test_chat_read_cursors.py`
- `backend/routers/public_api.py`
- `backend/services/chat_read_cursors.py`
- `backend/services/thread_summary.py`
- `backend/models/slock.py`

Implementation:

1. Keep backend as the source of persisted read/unread truth.
2. Add route-flow tests where the test harness supports authentication.
3. Otherwise strengthen router/service focused tests and document the harness
   limitation.
4. Cover monotonic writes, server/member scoping, DM/channel kind rejection, and
   actual unread counts with global sequence gaps.

Checks:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py
```

### Phase 7: Real Browser And Mobile Proof (9:45-11:00)

Use only project WebDriver:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./twd --compact tabs
```

If a tab is connected:

```bash
rtk ./tools/twd-guard/twd-open /chat
rtk ./tools/twd-guard/twd-open /tasks
```

Run the canonical selector proof runner before screenshot-only evidence:

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

If it returns `blocked_no_tab`, stop browser acceptance and record the blocker.
Do not replace this with screenshot-only proof.

Evidence to save under `evidence/`:

- chat desktop screenshot;
- task desktop screenshot;
- chat 390px screenshot or DOM assertion;
- task 390px screenshot or DOM assertion;
- DOM JSON proving one active message surface after toggles;
- DOM JSON proving one active task surface after toggles;
- DOM JSON proving no horizontal overflow on chat/task mobile.

If no tab is connected, record the exact `./twd` output. Do not claim browser
evidence. Continue with all source/test checks.

### Phase 8: Full Verification And Review (11:00-12:00)

Commands:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsc --noEmit
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
```

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py models/slock.py models/__init__.py models/seed.py services/chat_read_cursors.py services/thread_summary.py
```

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git diff --check
```

Then run a Trellis channel review focused on:

- Does the implementation truly include `07-05`, `07-04`, and `07-02`?
- Is browser evidence truthful?
- Are chat/task readable and mobile-safe?
- Are material resources lifecycle-safe?
- Are unread cursors server/member scoped?
- Did the patch avoid unrelated broad rewrites?

## Product Surface Audit Matrix

| Route/surface | Required result this pass |
|---|---|
| `/chat` and `/chat/[channel]` | Full Inkframe chat surface, message material toggle, event badges, mobile proof |
| `/tasks` | Full Inkframe task surface, task material toggle, state/evidence/review distinction, mobile proof |
| `/members` | Shared desk background, avatar prefab consistency where touched, no old dirty background |
| `/computers` | Shared desk background; computer object can remain later-polish unless old style breaks consistency |
| `/settings` | Shared desk background; settings controls usable; language/preference controls belong here |
| `/login` and `/join` | No old pink/dark dirty background; auth usability preserved |
| Control/operator-only pages | Do not spend product-polish time unless they break shared runtime or build |

## Review Exit Criteria

The task is ready for review only when:

- all code-level tests above pass;
- browser proof is either captured or the no-tab blocker is recorded exactly;
- product-surface audit has pass/fail/deferred rows;
- prior task acceptance items are mapped and not silently dropped;
- no claim depends on screenshots alone when a DOM/test assertion is possible.
