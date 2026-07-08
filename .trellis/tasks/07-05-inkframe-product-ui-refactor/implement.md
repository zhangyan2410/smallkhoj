# Implementation Plan: Inkframe Product UI Refactor

## Time Budget

Operator offered up to **12 hours**. This task should use that time to do a real
frontend refactor, not a thin demo transplant.

## Merged Child Tasks

This parent task is the implementation owner for the earlier Trellis tasks
below. They should not be treated as unrelated follow-ups during this pass:

- `07-02-chat-event-unread-indicators`: merged into Phase 3. Chat channel, DM,
  and thread unread/event indicators must use the same Inkframe sidebar/message
  primitives instead of a separate notification style.
- `07-04-ink-material-card-restore-resource`: merged into Phases 1 and 6 as the
  material-runtime prerequisite. Restore/resource lifecycle behavior from the
  demo must be preserved while productizing the background and chat/task
  material surfaces.

### User Scope Lock: 2026-07-06

The operator explicitly confirmed that the earlier Trellis task(s) must be done
together with this product refactor. Treat this as a scope lock, not a soft
reference:

Persistent scope-lock note:
`evidence/merged-scope-lock.md`.

- The parent refactor is not complete if `07-04-ink-material-card-restore-resource`
  regresses or remains demo-only. Product `MaterialSurface` must inherit the same
  keep/re-render restore, editable restored ink, discard cleanup, object URL
  lifecycle, and executable test expectations.
- The parent refactor is not complete if `07-02-chat-event-unread-indicators`
  remains a separate visual patch. Chat sidebar channel/DM attention state and
  thread-level unread markers must use the same Inkframe object primitives built
  for this refactor.
- If implementation time forces a cut, the cut must be explicit and narrow:
  server-side read cursor persistence may be deferred only if a tested local
  cursor adapter remains; cross-refresh ink persistence remains out of scope by
  product decision.

If implementation time runs short, the fallback is not to drop these tasks.
Instead:

- Keep the `07-02` frontend local read-cursor adapter and shared badges in this
  task, and explicitly defer only server-side cursor persistence.
- Keep the `07-04` executable demo/resource tests green, and explicitly defer
  only broader product memory/performance stress testing.

Suggested allocation:

| Phase | Time | Output |
|---|---:|---|
| 0. Preflight and inventory | 45 min | exact files, routes, current regressions |
| 1. Global background + material runtime extraction | 2.25 h | app desk background + reusable engine/resource wrapper |
| 2. Object language primitives | 2.0 h | shared Inkframe components |
| 3. Chat integration + unread task merge | 2.25 h | real chat page refactor + event indicators |
| 4. Task integration | 1.75 h | real task page refactor |
| 5. Mobile pass | 1.25 h | phone/tablet layouts |
| 6. Functional and material validation | 1.0 h | tests + `./twd` evidence |
| 7. Polish, docs, cleanup | 30 min | task notes, TODO split, final review |

Total: 12 hours.

## Phase 0: Preflight and Inventory

1. Confirm branch/worktree.
   - Expected worktree: `/Users/code/project/smallkhoj-inkframe-object-ui`
   - Expected branch: `codex/inkframe-object-ui`

2. Read required specs:
   - `.trellis/spec/frontend/index.md`
   - `.trellis/spec/frontend/component-guidelines.md`
   - `.trellis/spec/frontend/product-ui-style.md`
   - `.trellis/spec/frontend/quality-guidelines.md`
   - `.trellis/spec/guides/index.md`

3. Inventory current target files:
   - `frontend/app/chat/[channel]/channel-client.tsx`
   - `frontend/app/chat/[channel]/chat-sidebar.tsx`
   - `frontend/components/message-frame.tsx`
   - `frontend/components/markdown-message.tsx`
   - `frontend/app/tasks/page.tsx`
   - `frontend/components/task-board.tsx`
   - `frontend/components/task-dnd-board.tsx`
   - `frontend/components/task-list-panel.tsx`
   - `frontend/components/product-shell.tsx`
   - `frontend/components/product-shell-body.tsx`
   - `frontend/app/globals.css`
   - existing avatar/ui atoms.

4. Compare evidence demos:
   - `message-cards-ink.html`
   - `chat-message-frame-demo.html`
   - `task.html`
   - `interactive-material-demo.html`
   - avatar/message binding option files.

5. Write a short inventory note in this task directory if the current code has
   diverged from this plan.

## Phase 1: Global Background + Material Runtime Extraction

Goal: productize the validated demo behavior and make the app background a
default renderable Inkframe material across product pages.

1. Create `frontend/components/inkframe/` if it does not exist.

2. Extract/adapt material engine:
   - Copy the current `ink-material-engine.js` behavior into a module usable by
     Next client components.
   - Preserve:
     - higher source texture fidelity;
     - image-to-ink source/restore/visual separation;
     - fixed viewport desk static layer;
     - tint-aware keep/restore;
     - one active surface lifecycle.
   - Avoid importing demo-only DOM selectors.

3. Add `material-resource` helpers:
   - create visual/restore/source resources;
   - revoke all private URLs;
   - pagehide cleanup;
   - no backend/localStorage/IndexedDB persistence.

4. Build `AppDeskBackground`.
   - mount from `ProductShell` or the nearest shared app shell;
   - every product page gets clean dry-paper/desk background;
   - uses fixed viewport static layer;
   - can activate WebGL rendering/editing by default where controls are exposed;
   - supports background image source/restore/visual resources;
   - stores owner tint as `desk`;
   - never uses `body.backgroundImage` for kept material;
   - foreground pages render above it with stable z-index.

5. Build `MaterialSurface`:
   - props for owner kind (`desk`, `message`, `task`, `evidence`);
   - tint;
   - mode;
   - static visual;
   - active canvas;
   - keep/discard/restore;
   - optional image import;
   - fallback.

6. Fix the known background bug in product form:
   - render/keep background;
   - kept background remains desk tint, not chat/message tint;
   - kept background stays viewport-aligned after scroll;
   - imported background image keeps visual/source/restore resources.

7. Preserve demo tests:
   - keep evidence tests green;
   - if moved into product tests, keep old demo test as reference until product
     coverage exists.

Checkpoint:

- Every product page can show the Inkframe app desk background.
- A standalone product component can render the material desk and pass
  keep/re-render behavior.

## Phase 2: Object Language Primitives

Goal: stop visual drift by defining product-level object prefabs.

1. Add `ObjectFrame`.
   - variants:
     - `message`
     - `message-long`
     - `task-ticket`
     - `evidence`
     - `review`
     - `sidebar-entity`
     - `memory-note`
   - props:
     - `density`
     - `state`
     - `movable`
     - `active`
     - `selected`
     - `interactive`

2. Add `AvatarFrame`.
   - default avatar frame = option B from exploration.
   - no stamp on avatar.
   - status dot remains visible.
   - supports human/agent variants without changing the prefab structure.

3. Add `SidebarEntityItem`.
   - used by chat channels, DMs, and future member rows.
   - slots:
     - avatar/icon;
     - title;
     - subtitle;
     - status;
     - unread/event indicator;
     - actions if needed.

4. Add `ChatMessageObject`.
   - short/long layout;
   - author/time/actions;
   - markdown content;
   - hidden toolbar reveal.

5. Add task/evidence/review primitives.

Checkpoint:

- Components can be rendered in isolation with representative states.
- No one-off route-local black bordered cards for these roles.

## Phase 3: Chat Integration + Unread Task Merge

Goal: make real chat use Inkframe object UI and absorb
`07-02-chat-event-unread-indicators`.

Hard inclusion note: `07-02-chat-event-unread-indicators` is not a separate
later polish task for this refactor. Its visual primitive, sidebar entity rows,
chat header replacement, and thread-level unread marker must be implemented as
part of the chat object-language pass here. If backend persistence is deferred,
the implementation must still include a named local read-cursor adapter and a
documented server-persistence follow-up.

1. Replace current message frame composition with `ChatMessageObject`.

2. Fix message typography:
   - paragraph rhythm;
   - code blocks;
   - paths;
   - mentions;
   - timestamps;
   - agent long output readability.

3. Fix actions/toolbars:
   - hidden by default;
   - appear near message, not full-row right;
   - tap-to-show on mobile.

4. Replace channel/DM sidebar row visuals with `SidebarEntityItem`.

5. Unread/event indicator from `07-02-chat-event-unread-indicators`:
   - remove/demote `rootMessages` / `{count} 条根消息` as the primary header
     status;
   - add shared `EventBadge` / `UnreadMark` primitive;
   - channel rows show unseen activity;
   - DM rows show the same class of unseen activity;
   - root messages show thread-level unseen replies near the thread affordance;
   - opening/viewing channel/DM/thread clears attention state;
   - use real event/read cursor state if available;
   - if server persistence is too large, implement a local read-cursor adapter
     and write the server read-cursor follow-up explicitly.

6. Integrate chat material workspace:
   - uses global `AppDeskBackground`, not route-local duplicate background;
   - material activation controls if appropriate;
   - static fallback.

7. Ensure `MarkdownMessage` no longer emits raw invalid tags such as `<marker>`.

Checkpoint:

- Real chat page is usable and visibly Inkframe.
- No toolbar overlap.
- Short and long messages both look intentional.

## Phase 4: Task Integration

Goal: task page gets its own object vocabulary, not copied chat paper.

1. Refactor task list items into task tickets.

2. Refactor main task detail into `TaskMaterialSurface`.

3. Add/replace evidence display with `EvidenceSurface`.

4. Add/replace review UI with `ReviewMarkup`.

5. Map states:
   - running;
   - review;
   - done;
   - blocked;
   - idle.

6. Avoid overuse:
   - not every task item tilted;
   - not every panel same black-bordered rectangle;
   - stamps only where semantically review/confirmation.

Checkpoint:

- Task page has distinct task/evidence/review objects.
- States are visually distinguishable without hurting scanability.

## Phase 5: Mobile Pass

Goal: mobile is part of the deliverable, not a cleanup afterthought.

1. Chat mobile:
   - sidebar drawer/sheet/top switcher;
   - message list full width;
   - composer accessible;
   - actions tap-reveal;
   - no text overflow;
   - no controls hidden behind viewport edge.

2. Task mobile:
   - ticket/detail/evidence/review stack or tabs;
   - stable material surface dimensions;
   - thumb-sized controls;
   - no drag/canvas conflict with scroll.

3. WebGL mobile rule:
   - default page scroll wins;
   - explicit edit/draw mode captures pointer;
   - reduced motion / WebGL unavailable shows static Inkframe.

Checkpoint:

- Browser checks pass at phone and tablet widths.

## Phase 6: Validation

### Code checks

Run relevant frontend checks, adjusted to project scripts:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
npm run lint
npm test -- --runInBand
```

If exact scripts differ, inspect `frontend/package.json` and use the repo's
actual commands.

### Material tests

Run the existing material demo test:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
TWD_PORT=28765 ./twd --compact goto --url-match 127.0.0.1:8771 \
  "http://127.0.0.1:8771/message-cards-ink.test.html?v=$(date +%s)"
```

Then query `window.__testResult`. Expected: all green.

Do not run the long memory/perf stress test unless the task specifically asks
for resource/memory verification.

### Real app browser evidence

Use `./twd`, not Playwright.

Required browser evidence:

- global background:
  - a non-chat page shows the same clean Inkframe desk background;
  - background layer is fixed and below product content;
  - background keep/re-render preserves desk tint;
  - if a background image test hook exists, image source/restore/visual state is
    present.

- `/chat/...` desktop:
  - message list visible;
  - message actions reveal;
  - sidebar entity items visible;
  - unread/event indicator visible in a seeded or test state;
  - no toolbar overlap;
  - material background visible.

- `/chat/...` mobile width:
  - sidebar collapsed;
  - composer usable;
  - long message readable;
  - actions reachable.

- `/tasks` desktop:
  - task tickets;
  - evidence surface;
  - review markup;
  - state variants.

- `/tasks` mobile width:
  - no overflow;
  - controls reachable;
  - evidence/review accessible.

- WebGL material:
  - activate;
  - draw/ink;
  - keep;
  - re-render;
  - tint/background preserved.

## Phase 7: Polish and Cleanup

1. Remove demo-only text from product UI.

2. Keep evidence demo files only where they serve as test/reference.

3. Update this task with:
   - implementation notes;
   - known follow-ups;
   - unresolved decisions;
   - screenshots/snapshots paths if generated.

4. Split child tasks if needed:
   - event/unread backend integration;
   - member/computer/settings Inkframe expansion;
   - long-term persistence if later requested;
   - mobile drawing tool refinement if static fallback ships first.

## Definition of Done

- Chat and tasks are refactored to Inkframe as default UI.
- WebGL material engine is productized enough for chat/task, not left as static
  evidence demo only.
- Demo background/tint bug is fixed in product integration.
- Image-to-ink fidelity path is preserved.
- Mobile chat/task usable.
- Tests and `./twd` evidence recorded.
- No major component duplication introduced.
- No permanent unbounded WebGL contexts.
- Follow-up tasks written for any intentionally deferred data/event work.
