# Inkframe Material Runtime And Chat Event Persistence Optimization

## Goal

Run the second optimization iteration as the implementation vehicle for
`07-05-inkframe-product-ui-refactor`: turn the validated WebGL ink material demo
into a real reusable product runtime for chat/task/background surfaces, complete
the Inkframe product UI refactor where it affects chat/task/background, and
replace the frontend-only chat unread adapter with backend-owned read/event
cursor persistence.

This task starts after the frontend-first Inkframe pass is usable. The user wants
the product to keep moving toward the artistic material workbench, not retreat to
a conservative static theme.

This task is also the consolidation point for the earlier Trellis work that was
planned separately:

- `07-05-inkframe-product-ui-refactor` is the umbrella product/UI contract. It
  must be treated as part of this delivery, not as a separate future design
  note. Chat, task, and the global product background are the acceptance surface.
- `07-04-ink-material-card-restore-resource` is no longer only a demo cleanup;
  its restore/resource lifecycle guarantees must be preserved when the material
  engine moves into SmallKhoj product pages.
- `07-02-chat-event-unread-indicators` is no longer only a frontend visual
  badge pass; its event/unread language must be backed by backend read cursors
  in this iteration.

## User Value

SmallKhoj should feel like an AI collaboration workbench where the material is
alive and meaningful:

- the app background can be rendered, painted, kept, restored, and later receive
  imported images without tint/resource drift;
- chat messages and task/evidence surfaces can opt into WebGL material behavior
  without creating one permanent WebGL context per object;
- unread/event attention state follows the user across refreshes/devices instead
  of existing only in one browser session.

## Confirmed Facts

- Current worktree: `/Users/code/project/smallkhoj-inkframe-object-ui`
- Current branch: `codex/inkframe-object-ui`
- Previous parent task:
  `.trellis/tasks/07-05-inkframe-product-ui-refactor`
- Latest scope clarification:
  `.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/evidence/operator-scope-addendum.md`
- The parent task is not informational only. It is the product acceptance frame
  for this implementation pass: default Inkframe background, chat refactor, task
  refactor, mobile usability, and object-language consistency must be judged
  against that PRD.
- Relevant child scopes already merged into the parent:
  - `.trellis/tasks/07-02-chat-event-unread-indicators`
  - `.trellis/tasks/07-04-ink-material-card-restore-resource`
- Validated material demo files:
  - `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/ink-material-engine.js`
  - `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/message-cards-ink.html`
  - `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/message-cards-ink.test.html`
- Current material regression result after the 07-05 quality pass:
  `PASS 52 / FAIL 0`.
- Current app has:
  - shell-owned `AppDeskBackground`;
  - Inkframe object primitives;
  - local frontend chat unread/read-cursor adapter;
  - chat/task desktop and mobile browser checks.
- Current app does not yet have:
  - a reusable production `MaterialSurface` component extracted from the demo;
  - backend-owned read cursors for channel/DM/thread unread state;
  - broad product memory/performance stress tests for material resources.
- `07-05` sub-agent review found and fixed one frontend local unread replay
  issue: realtime events with `seq <= current.lastSeq` no longer inflate local
  unread counts.
- `07-05` sub-agent review noted `mdast` appears unused/deprecated in the
  current checked frontend code. This should be verified during dependency
  hygiene, but it is not part of the core material/backend cursor work.

## Product Requirements

### R0. Complete The Previous Product Refactor Scope Where It Intersects This Pass

Treat `07-05-inkframe-product-ui-refactor` as the user-facing umbrella scope for
this work. The runtime/backend work is only successful if it lands inside the
real product UI:

- Inkframe replaces the old default product visual direction for pages mounted
  in `ProductShell`.
- Chat and tasks are the primary refined pages, not only places where a runtime
  component happens to mount.
- Members, computers, settings, and product landing routes receive the shared
  clean material-capable desk background, but their full object-level redesign
  remains out of scope unless required for chat/task consistency.
- The demo visual decisions that the user approved remain binding:
  clean dry-paper desk, no pink/dark dirty background, no decorative stamps on
  avatars, no blanket tilting, and hover motion only for actionable/movable
  objects.

### R1. Productize The Material Runtime

Create a reusable product runtime from the demo engine so chat, tasks, evidence,
and the app background can use the same lifecycle model.

The runtime must support:

- one active WebGL surface per workspace region unless explicitly justified;
- inactive surfaces displayed as static snapshots;
- activate / draw / inject water / keep / discard / restore;
- owner-aware tint (`desk`, `message`, `task`, `evidence`, `review`);
- visual / restore / source resources for image-to-ink and future background
  image import;
- resource revocation on replace, discard, and page unload;
- fallback when WebGL is unavailable or reduced-motion/low-power rules apply.

The `07-04` lifecycle behavior is part of this requirement, not optional demo
debt: kept ink must restore into a newly activated surface, restored ink must
remain editable, private object URLs must be revoked, and repeated keep on the
same owner must not grow resource state.

### R2. Make App Background A Real Material Surface

The global desk background should not be only a static CSS layer. It should have
the same material lifecycle as other surfaces while remaining shell-owned.

Expected behavior:

- static background remains clean dry paper by default;
- background can be activated in an explicit edit/render mode;
- drawing and water injection are possible when active;
- keep produces a fixed viewport static resource;
- discard returns to clean desk;
- background images can later be imported as source/restore/visual resources;
- foreground surfaces remain readable over image/material backgrounds.
- the background component owns the material lifecycle even when a page starts
  in calm static dry-paper mode.

Every primary product page mounted inside `ProductShell` should receive the same
clean material-capable desk background. Pages that are not user-facing operator
controls may stay plain, but the product app should not have one route with the
demo desk and another route with the old pink/dark/static background.

### R3. Integrate MaterialSurface Into Chat And Task Where It Helps

Use WebGL material meaningfully in the first product surfaces:

- chat messages can opt into active material behavior through one active message
  surface at a time;
- task/evidence/review surfaces can opt into material behavior without making
  the whole board heavy;
- hover/motion continues to mean movable/actionable, not decoration;
- short/long message readability rules stay intact;
- task tickets, evidence paper, and review markup stay visually distinct.

Do not create one always-live WebGL context per message, task, or evidence item.

### R4. Preserve And Extend Material Demo Guarantees

The production runtime must preserve the demo guarantees already proven by
`message-cards-ink.test.html`:

- re-rendering a kept surface restores prior ink;
- restored ink remains editable;
- discard returns the surface to the shared/owner default;
- repeated keep does not grow per-surface private resource state;
- private object URLs are revoked on replace/discard/unload;
- image-to-ink keeps visual/source/restore resources distinct.

### R5. Backend-Owned Chat Read/Event Cursors

Replace the frontend-only unread adapter with backend-owned read/event cursors.

Minimum product model:

- per-member per-channel read cursor;
- per-member per-DM read cursor;
- per-member per-thread/root-message read cursor;
- realtime `message.created` updates derive unread state from cursors;
- opening/viewing channel, DM, or thread writes the corresponding read cursor;
- frontend local adapter remains only as a transition/fallback layer.

This is backend state, not a durable browser preference.

The old total-message/root-message count is not the product signal. The
frontend event badges from `07-02` should become projections of real read
cursor state: channel rows, DM rows, and thread affordances show unseen activity
and clear after the corresponding entity is viewed.

### R6. Preserve Mobile Usability

Material interaction on mobile must be deliberate:

- page scroll wins by default;
- drawing/water mode captures pointer only after explicit activation;
- chat composer remains usable;
- task controls remain reachable;
- no horizontal overflow at 390px;
- fallback/static mode remains acceptable on low-power or WebGL-unavailable
  mobile browsers.

### R7. Evidence And Performance Gates

This task must prove both behavior and resource shape:

- code/unit tests for material resource lifecycle;
- executable browser test for material restore/keep/discard;
- browser checks for chat/task/background active/static behavior;
- backend/API tests for read cursor persistence and clearing;
- mobile browser checks;
- targeted memory/resource sanity check for repeated activate/keep/discard, not
  a vague screenshot-only claim.

### R8. Dependency Hygiene Around Markdown Work

Verify whether `mdast` is actually needed after the MarkdownMessage invalid-tag
fix. If it is unused, remove the direct dependency and update lockfiles through
the project package manager. If it is needed by pending markdown work, document
the owning import and reason.

## Non-Goals

- Cross-refresh persistence of arbitrary ink drawings unless explicitly backed
  by product requirements.
- Backend storage of large ink/background image blobs in this iteration.
- Turning SmallKhoj into a general drawing app.
- Refactoring every page into full object-level WebGL.
- Adding a new global client state library.
- Long-lived parallel themes.

## Acceptance Criteria

- [ ] A reusable production material runtime/component exists outside the demo
      evidence directory.
- [ ] The previous `07-05-inkframe-product-ui-refactor` acceptance surface is
      covered for this pass: product shell background, chat page, task page,
      mobile checks, and object-language constraints.
- [ ] The earlier `07-04` demo restore/resource lifecycle is either still green
      in the evidence demo or covered by equivalent product-level tests.
- [ ] The app background is a shell-owned material surface with active/static
      lifecycle and owner tint preserved after keep/restore.
- [ ] The same clean material-capable desk background is applied through the
      product shell to chat, tasks, members, computers, settings, and landing
      product routes, without regressing mobile readability.
- [ ] Chat can activate at most one message/material surface at a time and
      restore kept ink without losing readability.
- [ ] Tasks/evidence/review can use the material runtime without creating
      unbounded WebGL contexts.
- [ ] Material resource tests prove visual/restore/source separation, object URL
      revocation, editable restore, discard, and repeated keep behavior.
- [ ] The existing material demo regression remains green, or is replaced by an
      equivalent product-level executable regression with the same coverage.
- [ ] Backend read cursor persistence exists for channel, DM, and thread/root
      message attention state.
- [ ] The earlier `07-02` unread/event indicator behavior is backed by backend
      cursor state instead of only local browser decoration.
- [ ] Opening/viewing channel/DM/thread clears unread state through backend
      cursor writes, and refresh preserves the cleared state.
- [ ] Realtime `message.created` continues to update visible active chat state
      and out-of-scope entity attention.
- [ ] Mobile chat/task/background checks pass at 390px width with no horizontal
      overflow and no accidental canvas scroll capture.
- [ ] Real browser evidence is captured with `./twd` when a connected tab is
      available; any fallback browser evidence is explicitly labeled.
- [ ] The implementation includes a clear rollback path: static Inkframe
      snapshots remain usable if WebGL fails.
- [ ] `mdast` direct dependency is either removed as unused/deprecated or
      documented with a concrete owning import/reason.

## Open Product Questions

None blocking for planning. Recommended defaults:

- Ink/background state is session-local for now.
- Backend stores only unread/read cursor metadata, not ink image blobs.
- The next backend work starts with read cursors because that is small,
  product-correct state; large material persistence remains deferred.
