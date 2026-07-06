# Ink material card restore and resource lifecycle

## Goal

Make `message-cards-ink` reliable for the currently open browser session:
when a user keeps ink on a message card, re-rendering that card must restore
the kept ink and allow continuing to draw; when a user discards ink, private
image resources must be released and the card must return to the shared initial
paper image.

This task is limited to the ink material demo and its tests. It does not change
the real SmallKhoj product frontend and does not introduce cross-refresh
persistence.

## Product Decisions

- Kept ink is session-only. Refreshing the page, closing the tab, or restarting
  the browser may lose ordinary kept ink.
- Kept ink must restore on the same page session when the same card is rendered
  again.
- Restored ink remains editable: after restore, the user can keep drawing on the
  same surface. Do not implement frozen/locked old ink layers.
- Do not store kept ink in the backend.
- Do not use `localStorage` for image persistence.
- Do not implement IndexedDB persistence in this task. IndexedDB Blob storage is
  the future direction only if cross-refresh persistence becomes a product
  requirement later.

## Confirmed Facts

- Existing handoff:
  `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/HANDOFF-restore-and-resource.md`
- Demo file:
  `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/message-cards-ink.html`
- Test file:
  `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/message-cards-ink.test.html`
- Shared engine:
  `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/ink-material-engine.js`
- Current architecture creates at most one active WebGL surface at a time.
- Current kept images are `dataURL` strings stored in DOM
  `style.backgroundImage` and `state.perCardBg`.
- `activateCard()` currently creates a new blank surface every time and does not
  restore the previously kept snapshot.
- `message-cards-ink.test.html` documents T15/T16/T17, but the actual executable
  assertions stop at T14.
- The engine already exposes `loadImage(img)` and `bakeSource(...)`; the
  handoff notes explain that `bakeSource()` filters out paper tone and restores
  true ink marks.

## Requirements

### R1: Restore Kept Ink On Re-Render

When a card has a kept private image and is activated again, the new surface
must load that image and bake the ink back into the active WebGL surface.

- Restoration must happen after `InkMaterial.create(...)` succeeds.
- Restoration must be guarded so an async image load cannot bake into a surface
  after the active card has changed.
- The initial shared paper image must not be baked as private ink.
- The restored card must remain editable; subsequent drawing and keep should
  include old and new ink.

### R2: Replace Long-Lived DataURL Storage With Managed Image Resources

Avoid using long-lived private `dataURL` strings for kept card images.

Preferred implementation:

- Capture canvas snapshots with `canvas.toBlob(...)`.
- Store private card images as `{ blob, objectUrl }` entries.
- Apply images to DOM with `url("blob:...")`.
- Load kept images into the engine through an `HTMLImageElement` whose `src` is
  the stored `objectUrl`.

The shared initial paper image may remain a single shared resource, but private
per-card kept images need explicit lifecycle management.

### R3: Release Private Image Resources

Private card image resources must be released when no longer needed.

- Replacing a kept image on the same card must revoke the previous private
  object URL.
- Discarding a card must revoke the card's private object URL and return the
  card to the shared initial paper image.
- Destroying/unloading the page must revoke all private object URLs.
- The implementation must not revoke the shared initial paper image while cards
  still use it.

### R4: Keep Global Surface Boundaries

The fix must preserve the existing global singleton behavior.

- At most one active surface exists at a time.
- Card activation still deactivates the previous card/desk.
- Desk behavior remains unchanged except where shared helper refactors are
  unavoidable.
- `ink-material-engine.js` must not be modified for this task.

### R5: Executable Tests, Not Screenshots

The implementation must add code-verifiable assertions to
`message-cards-ink.test.html`.

Required tests:

- T15: card A draw ink -> keep -> render again -> restored active surface has
  detectable ink before drawing a second time.
- T15b or equivalent: after restoration, drawing more ink and keeping again
  preserves both restored and newly drawn ink.
- T16: discarding a card returns it to the shared initial paper image and clears
  private card image state.
- T17: repeating render/draw/keep on the same card does not grow the per-card
  resource map.
- Resource lifecycle assertion: replacing or discarding a kept image calls
  `URL.revokeObjectURL(...)` for private object URLs. This can be verified
  through a test hook/counter rather than screenshot inspection.

## Out Of Scope

- No backend persistence.
- No `localStorage`.
- No IndexedDB implementation.
- No product frontend integration.
- No new visual design work.
- No change to `ink-material-engine.js`.
- No cross-refresh or cross-browser-session restoration.

## Acceptance Criteria

- [ ] Re-rendering a kept card restores prior ink into the new active surface.
- [ ] Restored ink is editable; drawing after restore and keeping again keeps the
      combined result.
- [ ] Dropping a card returns it to the shared initial paper image.
- [ ] Per-card kept resources do not grow when repeatedly keeping the same card.
- [ ] Private object URLs are revoked when replaced, discarded, or unloaded.
- [ ] Existing T1-T14 behavior remains green.
- [ ] New T15/T16/T17/resource lifecycle assertions are executable and green in
      `message-cards-ink.test.html`.
- [ ] Verification uses `twd`/browser code assertions, not screenshots.

## Review Plan

After another agent implements this task, Codex should perform code review and
test review against this PRD, with special attention to:

- async restore race guards;
- accidental baking of shared paper texture;
- object URL leaks;
- preserving singleton WebGL surface behavior;
- whether tests actually fail on the pre-fix implementation.
