# Implementation Plan: Inkframe Material Runtime And Chat Event Persistence Optimization

## Scope Consolidation

This is one integrated task, not three parallel experiments.

Included Trellis scopes:

- Current task:
  `.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization`
- Previous product refactor umbrella:
  `.trellis/tasks/07-05-inkframe-product-ui-refactor`
- Previous material lifecycle task:
  `.trellis/tasks/07-04-ink-material-card-restore-resource`
- Previous chat event task:
  `.trellis/tasks/07-02-chat-event-unread-indicators`

The parent scope-lock note lives at:
`.trellis/tasks/07-05-inkframe-product-ui-refactor/evidence/merged-scope-lock.md`.

Latest operator scope addendum:
`.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/evidence/operator-scope-addendum.md`.

Handoff-friendly integrated plan:
`.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/evidence/integrated-execution-plan.md`.

The earlier `07-05` task is now a required product acceptance contract, not just
a reference document:

- Inkframe is the default product direction, not a side theme.
- The global product shell uses the clean dry-paper/desk background, and that
  background is material-capable by default on user-facing product pages.
- Chat and tasks are the first full refactor surfaces.
- Members, computers, settings, and product landing routes inherit the shared
  background and primitives where applicable.
- Mobile chat/task usability is part of the finish line.
- Visual guardrails remain binding: no pink/dark dirty background, no blanket
  tilted cards, no stamps on avatars, no decorative hover motion for objects
  that are not actually movable/actionable.

The earlier `07-04` task is now a required product contract:

- kept ink restores after the same card/message/task/background surface is
  rendered again;
- restored ink remains editable;
- discard returns to the owner default;
- replace/discard/unload revoke private object URLs;
- repeated keep does not grow private resource state.

The earlier `07-02` task is now a required backend-backed attention contract:

- channel and DM sidebar rows show unseen activity from real cursor state;
- thread markers on root messages show unseen replies;
- opening/viewing clears through backend cursor writes;
- local frontend unread state is only a fallback/optimistic overlay.

## Finish Line

SmallKhoj product pages use the Inkframe material workbench as the default
visual foundation. The previous `07-05` product refactor is materially visible
in the real app: chat and task surfaces are redesigned around the object
language, the global desk background is clean and material-capable across
product pages, WebGL material can be used without unbounded live canvases, and
chat unread/event attention state persists through backend-owned cursors.

Not building in this task:

- backend storage for large ink/background/image blobs;
- cross-browser-session persistence for arbitrary drawings;
- a general drawing app;
- a second long-lived theme beside Inkframe;
- full object redesign for every non-chat/task page beyond the shell background.

## Current State Snapshot

Already implemented in this worktree:

- `frontend/public/inkframe/ink-material-engine.js`
  copied from the validated demo engine.
- `frontend/components/inkframe/ink-material-engine.tsx`
  typed runtime wrapper and script loader.
- `frontend/components/inkframe/material-resource.ts`
  resource helper scaffold.
- `frontend/components/inkframe/material-surface-store.ts`
  active surface coordinator scaffold.
- `frontend/components/inkframe/material-surface-restore.ts`
  restore sequencing/token helper.
- `frontend/components/inkframe/material-surface.tsx`
  structural React surface with static/active-ish markup.
- `frontend/components/inkframe/app-desk-background.tsx`
  shell-owned material wrapper.
- Static material mount points in:
  - `frontend/components/message-frame.tsx`
  - `frontend/components/inkframe-object-ui.tsx`
  - `frontend/components/task-list-panel.tsx`
  - `frontend/components/task-dnd-board.tsx`
  - `frontend/components/task-board.tsx`
  - `frontend/app/chat/[channel]/channel-client.tsx`
- Direct `mdast` / `@types/mdast` dependencies removed from
  `frontend/package.json` / `frontend/package-lock.json`.

Already validated:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
rtk env NODE_PATH=./node_modules npx tsc --noEmit
```

Most recent recorded result: frontend lint pass, typecheck pass, `105` tests
pass.

Remaining high-risk gaps:

- `MaterialSurface` is not yet a full client lifecycle owner.
- Background edit/render/keep/discard is not wired to real runtime behavior.
- Product pages do not yet have full browser evidence with the material desk.
- Backend read cursors are not implemented.
- Frontend unread adapter is not reconciled against backend cursor state.

## 12 Hour Budget

The user explicitly allowed a deep pass. Use the full window for correctness,
not for decorative overreach.

| Phase | Budget | Main Output |
|---|---:|---|
| 0. Preflight and scope consolidation | 45 min | confirm dirty tree and fold `07-05`/`07-04`/`07-02` into one acceptance frame |
| 1. Product surface audit from `07-05` | 1 h | route/component matrix: shell background, chat, tasks, mobile, old-style leaks |
| 2. Material lifecycle completion | 2 h | real `MaterialSurface` client runtime and resource ownership |
| 3. Background material productization | 1.5 h | shell background active/static lifecycle across product pages, no tint drift |
| 4. Chat/task object refactor completion | 1.75 h | readable message/task/evidence surfaces using object language and material runtime |
| 5. Demo/product lifecycle regression | 1 h | `07-04` restore/resource behavior proven in tests |
| 6. Backend read cursor persistence | 1.75 h | channel/DM/thread cursor model/service/API/tests |
| 7. Frontend cursor reconciliation | 1 h | `07-02` badges backed by backend cursor state |
| 8. Mobile/performance/browser verification | 1.25 h | `./twd` evidence and resource sanity |
| 9. Review, docs, fixes | 1 h | quality gate, sub-agent review, final fixes |

If time slips, preserve this order:

1. Material lifecycle correctness.
2. Backend cursor correctness.
3. Browser/mobile proof.
4. Visual polish.

## Stateful Object Census

### Object: MaterialResource

Lifecycle owner: `frontend/components/inkframe/material-resource.ts`.

States:

| State | Meaning | Owner Action |
|---|---|---|
| `shared-default` | public/static owner default, not revoked per object | reuse only |
| `private-active` | Blob/object URL belongs to one owner surface | revoke on replace/discard |
| `replaced` | no longer current for owner | revoke all private URLs |
| `discarded` | owner returned to default | revoke private URLs |

Invariants:

- MR-1: shared defaults are never revoked by per-object discard.
- MR-2: private visual/restore/source URLs are revoked exactly once on replace.
- MR-3: discard removes the private resource from owner state.
- MR-4: repeated keep for the same owner leaves at most one current private
  resource.

Tests:

- `frontend/test/material-resource.test.ts`
- `frontend/test/material-surface.test.tsx`
- product or demo browser test for repeated keep/discard.

### Object: MaterialSurface

Lifecycle owner: `frontend/components/inkframe/material-surface.tsx`.

States:

| State | Entered By | Exit |
|---|---|---|
| `static` | first paint or after keep/discard | activate |
| `activating` | activation requested | active, fallback, error |
| `active` | runtime surface ready | keep, discard, deactivate, unmount |
| `keeping` | snapshot capture in progress | static with private resource |
| `discarding` | reset/revoke in progress | static with default resource |
| `fallback` | WebGL/capability failure | static CSS/object snapshot |
| `error` | runtime failure | fallback or static |

Invariants:

- MS-1: active mode creates at most one canvas per surface instance.
- MS-2: unmount destroys/deactivates runtime surface.
- MS-3: async restore cannot bake into a stale surface after owner changes.
- MS-4: mobile pointer capture is disabled until explicit active draw/water
  mode.
- MS-5: fallback still renders readable product UI.

Tests:

- activation creates runtime only when mode enters active path;
- restore token cancellation;
- unmount cleanup;
- static lists contain no active canvas by default;
- mobile/pointer data attributes show no capture in static mode.

### Object: ActiveSurfaceCoordinator

Lifecycle owner: `frontend/components/inkframe/material-surface-store.ts`.

Regions:

- `app-background`
- `chat-main`
- `task-main`

Invariants:

- ASC-1: one active foreground surface per region.
- ASC-2: activating a new owner awaits or safely calls previous owner
  deactivation.
- ASC-3: app background active edit mode must not steal foreground scroll or
  composer input outside explicit edit mode.

Tests:

- activating B deactivates A in same region;
- background and foreground can coexist only when pointer modes do not conflict;
- stale record cleanup on unmount.

### Object: ChatReadCursor

Lifecycle owner: backend service plus database model.

Scopes:

- channel cursor;
- DM cursor;
- thread/root-message cursor.

Invariants:

- RC-1: cursor is scoped by server/workspace and member.
- RC-2: writes are monotonic; older message/event seq cannot move a cursor
  backward.
- RC-3: opening/viewing a channel/DM/thread writes the matching scope only.
- RC-4: realtime pending unread state is derived from cursor plus new events,
  not stored as a second source of truth.
- RC-5: refresh reconciles from backend and preserves cleared read state.

Tests:

- backend service/API tests for monotonic upsert and scoping;
- frontend utility/component tests for backend cursor + realtime pending merge;
- real browser test that an unread badge clears and stays cleared after refresh.

## Phase 0: Preflight And Carry-Over

1. Confirm branch and dirty tree.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git branch --show-current
rtk git status --short
```

Expected:

- branch is `codex/inkframe-object-ui`;
- dirty tree is expected and must not be reset.

2. Read task docs.

```bash
rtk sed -n '1,260p' .trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/prd.md
rtk sed -n '1,320p' .trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/design.md
rtk sed -n '1,420p' .trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/implement.md
rtk sed -n '1,320p' .trellis/tasks/07-05-inkframe-product-ui-refactor/prd.md
rtk sed -n '1,260p' .trellis/tasks/07-04-ink-material-card-restore-resource/prd.md
rtk sed -n '1,260p' .trellis/tasks/07-02-chat-event-unread-indicators/prd.md
```

3. Read required specs before code edits.

```bash
rtk sed -n '1,220p' .trellis/spec/frontend/component-guidelines.md
rtk sed -n '1,220p' .trellis/spec/frontend/hook-guidelines.md
rtk sed -n '1,220p' .trellis/spec/frontend/state-management.md
rtk sed -n '1,220p' .trellis/spec/frontend/quality-guidelines.md
rtk sed -n '1,220p' .trellis/spec/backend/index.md
rtk sed -n '1,260p' .trellis/spec/backend/database-guidelines.md
rtk sed -n '1,260p' .trellis/spec/backend/event-delivery-contracts.md
rtk sed -n '1,260p' .trellis/spec/guides/cross-layer-thinking-guide.md
```

4. Inspect current implementation anchors.

```bash
rtk rg -n "MaterialSurface|MaterialResource|AppDeskBackground|chat-unread|last_read_seq|message.created|rootMessages|ChannelMember" frontend backend .trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization
```

## Phase 1: Product Surface Audit From 07-05

Purpose: prevent the implementation from becoming only a runtime/backend patch.
The user-facing `07-05` product refactor is part of this task.

1. Create or update the task evidence route matrix:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/evidence/product-surface-audit.md
```

Required rows:

- `/chat` and `/chat/[channel]`
- `/tasks`
- `/members`
- `/computers`
- `/settings`
- product landing/dashboard routes mounted by `ProductShell`
- mobile `390px` chat
- mobile `390px` tasks

Each row records:

- whether it uses `ProductShell`;
- whether old pink/dark/dirty background remains;
- whether the clean desk background is visible;
- whether WebGL/background activation is possible or intentionally hidden;
- whether chat/task object surfaces meet the `07-05` visual guardrails;
- whether mobile has overlap or horizontal overflow.

2. Inspect for old style leaks:

```bash
rtk rg -n "pink|rose|purple|slate|gradient|background|theme|rotate|tilt|stamp|seal|shadow" frontend/app frontend/components frontend/messages
```

Do not blindly delete matches. Classify them:

- real old-style leak;
- legitimate semantic color/status;
- unrelated dependency/test fixture;
- deferred non-chat/task page.

3. Record the product acceptance checklist in the evidence file before changing
visual code. This becomes the comparison target for later `./twd` proof.

## Phase 2: Material Lifecycle Completion

### Files

Modify:

- `frontend/components/inkframe/material-surface.tsx`
- `frontend/components/inkframe/material-surface-restore.ts`
- `frontend/components/inkframe/material-resource.ts`
- `frontend/components/inkframe/material-surface-store.ts`
- `frontend/components/inkframe/ink-material-engine.tsx`
- `frontend/app/globals.css`

Tests:

- `frontend/test/material-surface.test.tsx`
- `frontend/test/material-surface-restore.test.ts`
- `frontend/test/material-resource.test.ts`
- `frontend/test/material-surface-store.test.ts`
- `frontend/test/ink-material-engine.test.ts`

### Steps

1. Add failing tests for `MaterialSurface` active lifecycle:
   static mode renders no canvas, active mode creates a canvas container,
   keep calls snapshot/resource replacement, discard restores default, unmount
   destroys/deactivates.

2. Add failing tests for pointer modes:
   static mode does not capture pointer, draw mode captures only after explicit
   activation, water mode is opt-in.

3. Implement client-only lifecycle inside `MaterialSurface`:
   load runtime, create surface from canvas, call restore helper, expose
   controlled `mode`/callbacks, cleanup on unmount.

4. Implement keep path:
   snapshot canvas to `Blob`, create visual/restore/source resource as
   appropriate, call `replaceMaterialResource`, return static mode.

5. Implement discard path:
   call `discardMaterialResource`, clear private resource, return owner default.

6. Implement capability fallback:
   if runtime is unavailable or canvas creation fails, render static product
   layer and surface `data-mode="fallback"`.

7. Run focused tests.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx test/material-surface-restore.test.ts test/material-resource.test.ts test/material-surface-store.test.ts test/ink-material-engine.test.ts
```

Expected: all focused material tests pass.

## Phase 3: Background Material Productization

### Files

Modify:

- `frontend/components/inkframe/app-desk-background.tsx`
- `frontend/components/product-shell.tsx`
- `frontend/components/product-shell-body.tsx`
- `frontend/app/globals.css`
- product route files only if they bypass `ProductShell`.

Tests:

- `frontend/test/material-surface.test.tsx`
- add or extend an app-shell/background test if current test harness supports
  rendering the product shell.

### Steps

1. Add test assertions that `ProductShell` mounts one shell-owned background
   with:
   - `ownerKind="app-background"`
   - `ownerId="global-desk"`
   - `region="app-background"`
   - `tint="desk"`.

2. Ensure the background default is the clean demo dry-paper color/texture, not
   the old pink/dark background.

3. Wire the background as material-capable by default across user-facing product
   pages. The static visible default may remain calm dry paper, but the shell
   background component must own the same material lifecycle as other surfaces.

4. Wire an explicit background edit/render mode.
   Initial acceptable entry may be a hidden/testable control or dev-only hook,
   but production code must support:
   - activate;
   - draw;
   - water;
   - keep;
   - discard.

5. Fix the known tint/resource drift:
   after background keep/restore, the background must remain `desk` tint and
   must not take on chat/message paper tint.

6. Apply the material-capable desk through shell composition so chat, tasks,
   members, computers, settings, and landing product routes share the same
   background language.

7. Keep operator/control pages out of scope if they are not user-facing product
   UI.

8. Run focused tests and typecheck.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx test/inkframe-object-ui.test.tsx
rtk env NODE_PATH=./node_modules npx tsc --noEmit
```

## Phase 4: Chat And Task Material Integration

### Files

Modify:

- `frontend/components/message-frame.tsx`
- `frontend/app/chat/[channel]/channel-client.tsx`
- `frontend/components/inkframe-object-ui.tsx`
- `frontend/components/task-list-panel.tsx`
- `frontend/components/task-dnd-board.tsx`
- `frontend/components/task-board.tsx`
- `frontend/app/globals.css`

Tests:

- `frontend/test/material-surface.test.tsx`
- `frontend/test/inkframe-object-ui.test.tsx`
- existing chat unread/message tests.

### Steps

1. Keep static material layers for ordinary list rendering:
   chat lists and task boards must not create a live WebGL context per item.

2. Add one-active-surface integration:
   chat message activation uses `region="chat-main"`;
   task/evidence/review activation uses `region="task-main"`.

3. Preserve chat readability:
   short messages may have slight handmade offset;
   long messages stay stable;
   toolbar remains hidden by default and close to the message.

4. Preserve task/evidence/review distinction:
   material layer should not make all objects identical;
   evidence paper and review markup stay different visual species.

5. Add tests that representative chat/task lists contain bounded active canvas
   count.

6. Add tests that active message/task switching deactivates the previous owner
   in the same region.

7. Run focused frontend tests.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/material-surface.test.tsx test/inkframe-object-ui.test.tsx test/chat-unread-state.test.ts
```

## Phase 5: Preserve `07-04` Restore/Resource Regression

### Files

Reference:

- `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/message-cards-ink.html`
- `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/message-cards-ink.test.html`
- `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/ink-material-engine.js`

Product tests:

- `frontend/test/material-resource.test.ts`
- `frontend/test/material-surface-restore.test.ts`
- `frontend/test/material-surface.test.tsx`

### Steps

1. Decide whether the evidence demo remains as executable regression or is
   superseded by product tests.

Default: keep the demo regression while product tests mature.

2. Ensure the following assertions exist somewhere executable:
   - draw -> keep -> re-render -> restored ink exists before new drawing;
   - restored ink can be edited and kept again;
   - discard returns to shared default;
   - repeated keep on same owner does not grow the current resource map;
   - replace/discard/unload revoke private object URLs.

3. If demo test is still used, run it through `./twd` rather than screenshots.

4. If product tests replace the demo, document the coverage mapping in
   `quality-gate.md`.

## Phase 6: Backend Read Cursor Persistence

### Discovery Anchors

Inspect before coding:

- `backend/models/slock.py`
- `backend/models/seed.py`
- `backend/routers/public_api.py`
- `backend/services/public_events.py`
- `backend/services/thread_summary.py`
- `backend/tests/`

Known fact to verify:

- `ChannelMember.last_read_seq` already exists and may satisfy channel/DM
  cursor storage.

### Candidate Files

Modify or create:

- `backend/models/slock.py`
- `backend/models/seed.py`
- `backend/services/chat_read_cursors.py`
- `backend/routers/public_api.py`
- backend test file under `backend/tests/`

### Steps

1. Inspect backend package/test command.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk ls
rtk rg -n "pytest|uv run|ChannelMember|last_read_seq|class Message|parent_id|seq|/channels|/dms|threads" pyproject.toml tests models routers services
```

2. Write failing service tests first:
   - channel cursor monotonic update;
   - DM cursor monotonic update;
   - thread/root-message cursor monotonic update;
   - member/server scoping;
   - older cursor ignored.

3. Implement storage:
   - reuse `ChannelMember.last_read_seq` for channel/DM if it matches existing
     channel membership semantics;
   - add a thread cursor table/model if no existing table covers per-member
     root-message cursor state.

4. Add seed/migration DDL following existing project conventions.

5. Implement service functions:
   - load current member cursors;
   - upsert cursor after view;
   - derive unread/read state from message seq or event seq.

6. Add API endpoints in `public_api.py` after confirming route prefix:
   - read cursors for current member/server;
   - upsert cursor for one scope.

7. Add API tests:
   - cursor writes are scoped to authenticated/current member;
   - writes are idempotent and monotonic;
   - refresh/read endpoint returns persisted cursor.

8. Run backend focused tests.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk uv run pytest <focused-test-path>
```

Use the exact backend command discovered in step 1 if different.

## Phase 7: Frontend Cursor Reconciliation

### Files

Modify:

- `frontend/lib/chat-unread-state.ts`
- `frontend/hooks/use-chat-unread-store.ts`
- `frontend/app/chat/chat-data-context.tsx`
- `frontend/app/chat/[channel]/chat-sidebar.tsx`
- `frontend/app/chat/[channel]/channel-client.tsx`
- `frontend/messages/en.json`
- `frontend/messages/zh-CN.json`

Tests:

- `frontend/test/chat-unread-state.test.ts`
- add component tests if current harness supports sidebar/channel rendering.

### Steps

1. Add frontend API helper/types for backend read cursors.

2. Load backend cursors with channel/DM/chat data.

3. Treat backend cursor state as source of truth after successful load.

4. Keep the local unread adapter as optimistic overlay only:
   realtime `message.created` may mark pending attention until backend cursor
   catches up.

5. Write cursor on view:
   - opening channel writes channel cursor after messages are visible;
   - opening DM writes DM cursor after messages are visible;
   - opening thread writes thread cursor after replies are visible.

6. Keep event badge primitive shared:
   channel rows, DM rows, and thread affordances use the same attention grammar.

7. Remove or demote total root-message count as primary header signal.

8. Run frontend unread tests.

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk env NODE_PATH=./node_modules npx tsx --test test/chat-unread-state.test.ts
```

## Phase 8: Mobile, Browser, Resource, And Performance Verification

### Frontend Static Checks

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
rtk env NODE_PATH=./node_modules npx tsc --noEmit
```

### Backend Static Checks

Use discovered backend command, likely:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk uv run pytest
```

### Browser Checks

Use project wrapper, not raw Playwright:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./twd --help
```

Required real-browser evidence:

- chat desktop:
  - clean desk background is present;
  - message material slots exist;
  - activating a message creates one active material surface;
  - keep/restore preserves readability;
  - unread channel/DM badge clears through backend cursor write.
- task desktop:
  - task/evidence/review material slots exist;
  - no unbounded active canvases in board/list rendering;
  - selected task/detail remains readable.
- product shell route sweep:
  - chat, tasks, members, computers, settings, product landing route all use the
    same clean material-capable desk background.
- mobile 390px:
  - no horizontal overflow;
  - chat composer usable;
  - task controls reachable;
  - static background does not steal scroll;
  - drawing/water captures pointer only after explicit edit mode.

### Resource Sanity

Add test hooks or instrumentation sufficient to prove:

- active WebGL surface count stays bounded during repeated
  activate/draw/keep/discard;
- private object URL count returns to baseline after discard/unmount;
- repeated keep replaces the previous private resource for the same owner;
- background keep does not change owner tint from `desk` to `paper/message`.

Do not rely on screenshots for this. Screenshots can show visual result, but the
resource claim needs code-level counters/assertions.

## Phase 9: Review, Quality Gate, And Finish

1. Write `quality-gate.md` in the task directory with:
   - PRD acceptance matrix;
   - mapping from `07-04` acceptance criteria to product/demo tests;
   - mapping from `07-02` acceptance criteria to backend/frontend tests;
   - exact command results;
   - `./twd` evidence paths;
   - known residual risks and rollback.

2. Dispatch a check/review agent through Trellis channel.

Minimum review prompt:

```text
Active task: .trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization

Review the integrated Inkframe material runtime + chat read cursor work.
Prioritize bugs and missing tests. Pay special attention to:
- MaterialSurface lifecycle and stale async restore races;
- object URL revocation and repeated keep/discard resource bounds;
- one active WebGL surface per region;
- background tint/resource drift after keep/restore;
- backend read cursor monotonicity and member/server scoping;
- frontend cursor reconciliation with realtime message.created;
- mobile scroll/pointer capture regressions.
Return findings with file/line references and severity.
```

3. Fix review findings.

4. Update specs if implementation crystallizes a durable convention:
   - material surface ownership/fallback;
   - backend chat read cursor invariants;
   - product shell background rule.

5. Commit only after full checks and review fixes pass.

## Rollback Points

- Material runtime fallback:
  if WebGL activation fails, leave static Inkframe paper/background in place.
- Background edit mode:
  if active background mode is unstable, keep shell background static but do not
  remove the clean material-capable shell layer.
- Chat/task active surfaces:
  if foreground active surfaces are unstable, leave static material layers and
  keep the coordinator/resource tests.
- Backend cursors:
  if cursor API needs another backend pass, frontend may keep the local adapter
  as fallback, but the backend tests must remain the target before merge.

## Implementation Notes For Future Agents

- Do not store large ink/image blobs in backend.
- Do not add `localStorage` for material images in this iteration.
- Do not put stamps/seals on avatars or cover status dots.
- Do not tilt every independent object.
- Hover motion means actionable/movable; decorative-only lift should be avoided.
- The clean demo dry-paper desk is the desired background direction; avoid
  pink/dark/dirty water-wash defaults.
- `frontend/public/inkframe/ink-material-engine.js` is a copied/generated engine
  asset; lint exceptions there are acceptable if documented.
