# Inkframe Material Source Image Fidelity And Foreground Contrast Proof

## Goal

Harden the next Inkframe frontend slice: when the app background or a material
surface is seeded from an image, SmallKhoj must preserve the distinction between
source color, editable restore ink, and static visual snapshot while keeping
foreground chat/task/product content readable.

This task is a child of:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization
```

It follows the completed background resource contract:

```text
.trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability
```

## User Value

The user likes the material direction because it can make SmallKhoj feel like a
real handmade AI workbench rather than a generic CSS theme. The next risk is
that imported/rendered images become muddy, lose color/source fidelity, or make
foreground messages/tasks unreadable.

The product should be able to put a rendered image or ink material behind the
workspace without turning the UI into a dirty wash.

## Confirmed Decisions

- WebGL material is core product direction for chat/task/background, not a tiny
  decoration.
- Product pages should inherit the clean material-capable desk background.
- Background images are expected later.
- Large material/image blobs must not be persisted in backend, localStorage, or
  IndexedDB in this iteration.
- Material resources are session-local browser resources.
- Foreground readability wins over artistic background effects.
- Auth entry routes `/login` and `/join/[token]` are clean dry-paper entry
  surfaces, not ProductShell navigation routes.

## Requirements

### R1. Preserve Three Image Channels

Material image handling must keep these channels conceptually and technically
separate:

- `visual`: static display snapshot used when inactive;
- `restore`: editable ink/material map loaded into the engine when reactivated;
- `source`: original/source-color image used for visual/color fidelity.

Tests must reject collapsing these channels into one URL/blob unless explicitly
documented as a shared default resource.

### R2. Protect Source Color Fidelity

For image-seeded resources, source color must remain available separately from
the restore map. Restore should not become the only source of truth for color.

This is a contract task, not a final perceptual image-quality algorithm task.
The minimum proof is source-level and unit-level evidence that image resources
carry separate `sourceObjectUrl` / `sourceBlob` and that restore loads before
source/color composition.

### R3. Foreground Contrast Contract

The shell must expose a stable foreground readability contract for image/material
backgrounds:

- foreground regions are above the app background layer;
- content panels use paper/sheet surfaces instead of transparent text directly
  on the background;
- chat message text, task cards, sidebars, and header do not rely on the global
  background color for readability;
- future background image mode has explicit data/style hooks for contrast
  review.

### R4. No New Blob Persistence

Do not introduce backend, localStorage, IndexedDB, or service-worker persistence
for large ink/image/material blobs.

Allowed:

- session-local `Blob`;
- session-local object URL;
- pagehide cleanup;
- source/unit tests that simulate image resources.

### R5. Browser-Proof Readiness

If no `./twd` tab is connected, this task must still improve future browser
proof readiness by adding selectors/data hooks that the proof runner can later
assert.

The task must not claim visible browser proof unless `./twd` can actually see a
connected tab.

## Acceptance Criteria

- [ ] Tests prove image resources preserve distinct visual/restore/source
      channels for app-background and at least one foreground material owner.
- [ ] Tests prove restore loads/bakes before source-color composition for
      image resources.
- [ ] Tests or source assertions prove foreground regions have readable paper
      surfaces over image/material backgrounds.
- [ ] Tests reject backend/localStorage/IndexedDB blob persistence in the
      relevant material/background components.
- [ ] Data hooks for future browser proof identify background source mode and
      foreground contrast ownership.
- [ ] Focused frontend material/background tests pass.
- [ ] TypeScript passes if production code changes.
- [ ] `git diff --check` and `task.py validate` pass.
- [ ] A check worker reviews the slice, or self-review is recorded if worker
      startup fails.
- [ ] `./twd` browser proof is either captured or recorded as `blocked_no_tab`.

## Out Of Scope

- Final perceptual image-processing algorithm tuning.
- Backend/image persistence.
- localStorage/IndexedDB image persistence.
- Full UI controls for selecting/uploading background images.
- Redesigning chat/task visual language again.
- Claiming mobile/browser visual acceptance without connected WebDriver.
