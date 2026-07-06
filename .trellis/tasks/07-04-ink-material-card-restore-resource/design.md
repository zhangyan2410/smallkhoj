# Design: Ink material card restore and resource lifecycle

## Scope

This design applies only to:

- `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/message-cards-ink.html`
- `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/message-cards-ink.test.html`

Do not modify the shared engine file:

- `.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/ink-material-engine.js`

## Current Problem

The demo uses one active WebGL surface at a time. Keeping a card captures the
active canvas and stores the resulting image as a card background. Re-rendering
that same card later creates a fresh blank surface. Because the kept background
image is not loaded back into the fresh surface, the next keep can overwrite the
previously kept ink with a blank paper snapshot.

The same code also stores private snapshots as `dataURL` strings. That makes
memory ownership implicit and prevents explicit release.

## Proposed Runtime Model

Introduce a small image resource layer in `message-cards-ink.html`.

Suggested state shape:

```js
const state = {
  active: null,
  paperImage: null,        // shared initial image resource
  perCardImage: new Map(), // HTMLElement -> private image resource
  deskImage: null,
  contextCount: 0,
  revokedObjectUrlCount: 0 // test-observable counter
}
```

Suggested resource shape:

```js
{
  kind: 'shared-paper' | 'card-private' | 'desk-private',
  blob: Blob | null,
  objectUrl: string,
}
```

It is acceptable to keep compatibility helpers in the test API such as
`initialPaperImage()` and `backgroundOf(paper)` returning the currently applied
URL string, even if the internal representation becomes an object.

## Capture

Replace private long-lived `canvas.toDataURL(...)` snapshots with
`canvas.toBlob(...)`.

```js
function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
```

When keeping a card:

1. Capture active canvas to Blob.
2. Create `URL.createObjectURL(blob)`.
3. Revoke the previous private resource for that card if present.
4. Store the new resource in `state.perCardImage`.
5. Apply `paper.style.backgroundImage = url("<objectUrl>")`.

Because `canvas.toBlob(...)` is async, `deactivateCurrent(true)` may need to
become async internally or set a short pending state. The implementation must
avoid destroying the surface before capture completes if the canvas contents
would become unavailable. If the current canvas can be captured safely before
destroy, capture first, then destroy.

## Restore

When activating a card:

1. Create the new `InkMaterial` surface as today.
2. Mark it active.
3. Look up the card's private resource.
4. If present, create an `Image`, set `img.src = resource.objectUrl`, and on
   load call:

```js
surface.loadImage(img);
surface.bakeSource({ density: 0.9, wet: 0 });
```

Race guard:

```js
const token = {};
state.active = { kind: 'card', paper, surface, restoreToken: token };

img.onload = () => {
  if (!state.active || state.active.surface !== surface || state.active.restoreToken !== token) return;
  surface.loadImage(img);
  surface.bakeSource({ density: 0.9, wet: 0 });
};
```

Do not restore the shared paper image as private ink. Only restore
`state.perCardImage.get(paper)` entries that represent private card resources.

## Release

Provide helpers with one owner of release behavior:

```js
function revokeImageResource(resource) {
  if (!resource || resource.kind === 'shared-paper') return;
  if (resource.objectUrl) {
    URL.revokeObjectURL(resource.objectUrl);
    state.revokedObjectUrlCount++;
  }
}

function clearCardImage(paper) {
  const previous = state.perCardImage.get(paper);
  revokeImageResource(previous);
  state.perCardImage.delete(paper);
  applySharedPaper(paper);
}
```

On page unload:

```js
window.addEventListener('pagehide', revokeAllPrivateResources);
```

The test API should expose enough state to verify private resources are cleared
without relying on browser memory measurements.

## Test API Compatibility

Keep or replace the existing testing API with equivalent methods:

- `activeCount()`
- `contextCount()`
- `activate(paper)`
- `activateDesk()`
- `deactivate(paper, keep)`
- `deactivateDesk(keep)`
- `activeIs(paper)`
- `surfaceOf(paper)`
- `backgroundOf(paper)`
- `initialPaperImage()`
- `cardResourceCount()` or equivalent
- `revokedObjectUrlCount()` or equivalent
- `_state` for diagnostics

The exact names may differ, but tests must not need screenshots or manual
inspection.

## Verification Target

Run the test page through a local HTTP server and `./twd`.

Recommended local server:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/06-30-ink-wash-theme-exploration/evidence
python3 -m http.server 8771
```

Recommended URL:

```text
http://127.0.0.1:8771/message-cards-ink.test.html?v=<unique>
```

Use `twd` to open and query `window.__testResult`. If a tab is backgrounded,
bring it to front before relying on rAF/WebGL tests.
