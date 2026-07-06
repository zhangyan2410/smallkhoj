# Design: Inkframe Product UI Refactor

## Architecture Summary

The refactor has three layers:

1. **Inkframe app background runtime**: a shared product-shell background that
   every product page receives by default. It supports clean static desk
   rendering, optional active WebGL editing, keep/restore, background images,
   and capability fallback.
2. **Inkframe material runtime**: reusable client-side material engine wrapper
   built from the validated demo. It owns WebGL lifecycle, keep/restore
   resources, image-to-ink fidelity, static snapshots, fallback, and mobile
   pointer mode.
3. **Inkframe object components**: product primitives that express messages,
   task tickets, evidence paper, review marks, sidebar entity items, avatar
   frames, tool strips, and material controls.
4. **Chat/task page composition**: route code composes these primitives with real
   SmallKhoj data and events. Pages do not hand-roll object styling.

This avoids the failure mode from earlier iterations: visual ideas copied into
many pages as local CSS, producing mismatched avatars, member items, message
papers, task cards, and controls.

## Proposed File Boundaries

Exact names may change during implementation, but the ownership should stay
similar.

### Layer 0: tokens and global material utilities

- `frontend/app/globals.css`
  - Inkframe default background tokens.
  - Paper/desk/ink/seal/mineral tokens.
  - Foreground-surface opacity/contrast tokens for content over material/image
    backgrounds.
  - Static material utility classes only if truly app-wide.
  - No route-specific selectors.

### Layer 1: atoms

- `frontend/components/ui/card.tsx`
- `frontend/components/ui/panel.tsx`
- `frontend/components/ui/avatar.tsx`
- `frontend/components/ui/button.tsx`
- `frontend/components/ui/form.tsx`

These may receive token-backed updates only when the visual primitive must
change globally. They must not know about messages, tasks, evidence, or WebGL.

### Layer 2: Inkframe product primitives

New or consolidated files:

- `frontend/components/inkframe/app-desk-background.tsx`
  - Global app background mounted from `ProductShell` or app layout.
  - Provides clean static dry-paper/desk background for every product page.
  - Can activate WebGL background rendering/editing where enabled.
  - Owns fixed viewport static layer, not `body.backgroundImage`.
  - Supports future background image import with visual/restore/source
    resources.
  - Exposes a small state/control API for chat/task controls and settings.

- `frontend/components/inkframe/material-surface.tsx`
  - Client component wrapper for active/static WebGL material.
  - One active runtime per surface owner.
  - Supports `inactive`, `active`, `keep`, `discard`, `restore`.
  - Supports source image import for future chat/task evidence use.
  - Provides static snapshot display.
  - Handles mobile pointer capture mode.

- `frontend/components/inkframe/ink-material-engine.ts`
  - Productized engine module copied/adapted from evidence demo.
  - No direct DOM assumptions about the demo.
  - No backend persistence.

- `frontend/components/inkframe/material-resource.ts`
  - Resource model:
    - `visualObjectUrl` for static display;
    - `restoreObjectUrl` for ink/fixed restore;
    - `sourceObjectUrl` for color/source restore;
    - revoke helpers;
    - pagehide cleanup.

- `frontend/components/inkframe/object-frame.tsx`
  - Common physical object shell.
  - Variants: `message`, `task-ticket`, `evidence`, `review`, `memory-note`,
    `sidebar-entity`, `tool-base`.
  - Encodes border/shadow/paper/tint/tilt rules through variants.

- `frontend/components/inkframe/chat-message-object.tsx`
  - Message paper composition.
  - Author strip, timestamp, hidden actions, message body, optional thread/task
    marker.
  - Short/long density behavior.

- `frontend/components/inkframe/task-ticket-object.tsx`
  - Task ticket surface.
  - State material mapping.

- `frontend/components/inkframe/evidence-surface.tsx`
  - Evidence paper; keeps the good tilted hover/art surface behavior from the
    demo but not as a generic card style.

- `frontend/components/inkframe/review-markup.tsx`
  - Review annotation/stamp behavior; restricted to review semantics.

- `frontend/components/inkframe/sidebar-entity-item.tsx`
  - Shared channel/DM/member-style sidebar item vocabulary.
  - Supports avatar slot, title, subtitle, status dot, unread indicator, hover,
    active, disabled.

- `frontend/components/inkframe/avatar-frame.tsx`
  - Avatar wrapper/frame only.
  - Default option B from avatar exploration.
  - No stamp on avatar.
  - Status dot unobstructed, left/right placement explicit.

### Layer 3: pages

- `frontend/components/product-shell.tsx`
  - Mount `AppDeskBackground` so every page gets the Inkframe desk foundation.
  - Keep foreground regions above the material layer.
  - Avoid per-route duplicated background DOM.

- `frontend/app/chat/[channel]/channel-client.tsx`
  - Compose `ChatMessageObject`, `SidebarEntityItem`, material workspace.
  - Keep data/event behavior.

- `frontend/app/chat/[channel]/chat-sidebar.tsx`
  - Replace divergent channel/DM rows with `SidebarEntityItem`.

- `frontend/app/tasks/page.tsx` and task components
  - Compose task tickets/evidence/review primitives.

Pages must not define the object visual language directly.

## App Background Contract

### Ownership

The app background is a shell-owned material, not owned by chat messages or task
cards.

```ts
type AppDeskBackgroundState = {
  mode: "static" | "active" | "keeping" | "fallback";
  tint: "desk";
  resource?: MaterialResource;
  imageSource?: MaterialResource;
  editable: boolean;
};
```

Rules:

- Every product page renders above the same background layer vocabulary.
- The background has two layers:
  - fixed static visual layer;
  - fixed active WebGL canvas layer.
- `body.backgroundImage` must not be used for kept background images.
- Route content scrolls above the fixed layer.
- Foreground object surfaces must carry enough opacity/texture contrast to be
  readable over future background images.
- Background image import uses the same `visual/restore/source` resource model.
- No backend persistence in this task; background state is session-local unless
  a later product decision changes that.

### Background image risks and mitigations

| Risk | Mitigation |
|---|---|
| Busy image makes messages unreadable | Foreground object surfaces use paper opacity/tint tokens and optional wash veil |
| Background keep shifts with scroll | Fixed viewport static layer only |
| Background tint becomes message paper tint | Resource stores owner tint; restore uses owner tint |
| Imported image becomes blurry | Source texture resolution decoupled from dye grid |
| Imported image loses color after keep | Preserve source image resource and visual snapshot |
| Mobile drawing steals scroll | Explicit edit mode before pointer capture |
| Memory grows from huge images | Cap source texture, revoke URLs, no persistence |

## Material Runtime Contract

### Runtime states

```ts
type MaterialSurfaceMode =
  | "static"
  | "activating"
  | "active"
  | "keeping"
  | "discarding"
  | "error"
  | "fallback";
```

### Resource model

```ts
type MaterialResource = {
  visualBlob?: Blob;
  visualObjectUrl?: string;
  restoreBlob?: Blob;
  restoreObjectUrl?: string;
  sourceBlob?: Blob;
  sourceObjectUrl?: string;
  tint: "desk" | "paper" | string;
  sourceKind?: "none" | "image" | "generated" | "ink-only";
  ownerKind?: "app-background" | "message" | "task" | "evidence" | "review";
};
```

Rules:

- `visualObjectUrl` is for inactive static display.
- `restoreObjectUrl` is for restoring ink/fixed fields.
- `sourceObjectUrl` is for color/source fidelity after image import.
- Restore must load restore first, bake into ink/fixed, then load source for
  composite color.
- Restore-only loads must not leave a fake source canvas behind.
- Replacing/discarding revokes all private URLs.
- No backend/localStorage/IndexedDB persistence in this task.

### Context model

- The product must never create one permanent WebGL context per message/task.
- The app background may have one active WebGL context when the user explicitly
  activates background editing/rendering.
- Chat workspace can have one active object surface in addition to the app
  background only if interaction requires it. Prefer one active owner at a time.
- Task workspace can have one active material surface at a time.
- Inactive objects use snapshots/static CSS.

### Background/desk tint

The demo bug to preserve against:

- After rendering/painting the background and keeping it, the static background
  changed into the chat/card tint.

Design fix:

- The material resource stores tint/source owner.
- Desk/background uses a fixed viewport static layer.
- Card/message uses object-local paper tint.
- Keep/restore chooses tint by owner, never by a global default.

## Object Language Map

| Product concept | Physical object | WebGL? | Motion | Notes |
|---|---|---:|---|---|
| Chat message | paper sheet / notebook page | optional active | short slight tilt, long stable | readable body first |
| Thread marker | folded corner / tab | no in phase 1 | subtle | navigation later |
| Task | ticket / docket | active in task page | state-based | not same as message paper |
| Evidence | tilted evidence paper | optional active | hover lift if movable | keep current good demo behavior |
| Review | markup/stamp/annotation | mostly static | stamp can animate | only review semantics |
| Memory | small note | static | low | future page |
| Channel/DM/member row | sidebar entity item | static | hover only if clickable | unified item prefab |
| Avatar frame | framed portrait token | static | no stamp | status dot unobstructed |
| Computer | tool base / device plaque | static phase 1 | low | outside main scope |
| Settings | control tray / panel | static | minimal | outside main scope |

## Chat Design Details

- Message layout:
  - author/avatar column or compact header, depending viewport.
  - actions hidden by default.
  - actions appear near the message, not justified to the full row.
  - long messages are not aggressively tilted.
  - markdown typography gets deliberate paragraph rhythm.

- Message content:
  - `@mention` color must move away from the current hard-to-read color.
  - paths/code get special treatment but remain readable.
  - avoid `<marker>` raw markdown tag rendering issue.

- Sidebar:
  - channels and DMs share the `SidebarEntityItem` primitive.
  - unread/event indicators replace meaningless total message counts.
  - click/view clears unread state when real event plumbing exists.
  - if backend event work is not ready, implement visual contract and leave data
    integration behind a clear TODO/task split.

## Chat Unread/Event Design

This design absorbs `07-02-chat-event-unread-indicators`.

### Data model

Preferred product model:

```ts
type ReadCursor = {
  scope: "channel" | "dm" | "thread";
  id: string;
  lastSeenMessageId?: string;
  lastSeenEventId?: string;
  lastSeenAt?: string;
};

type AttentionState = {
  unread: boolean;
  count?: number;
  latestAt?: string;
  severity?: "normal" | "mentioned" | "assigned";
};
```

Implementation can start with a frontend adapter if backend persistence is too
large for the first pass, but the visual primitives must not hard-code fake
badges.

### Visual placement

- Channel/DM attention sits inside `SidebarEntityItem`.
- Thread attention sits on or next to the root message's thread affordance.
- The chat header should not foreground total root-message count.
- Opening/viewing clears attention state when data is visible.

## Task Design Details

- Task page gets:
  - task list as tickets;
  - main task material surface;
  - evidence surface;
  - review markup surface.
- State mapping:
  - `running`: active/wet/ink presence if user-visible;
  - `review`: marked/raised/stamped;
  - `done`: settled/faded/solidified;
  - `blocked`: denser/darker/held;
  - `idle`: dry paper.
- Avoid all states looking like same black-bordered card.

## Mobile Design

### Chat mobile

- Single-column primary view.
- Sidebar becomes drawer/sheet or top switcher.
- Composer is fixed/sticky only if it does not cover messages.
- Message actions:
  - tap message reveals actions;
  - no hover-only dependency;
  - long press can be added later but not required.
- Material drawing:
  - explicit "edit material" mode before canvas captures touch;
  - normal scroll is default.

### Task mobile

- Task list and detail should not both compete for width.
- Use tabs/segmented controls for ticket/evidence/review.
- Critical actions remain reachable with thumb-friendly controls.
- WebGL active region should have stable aspect/height.

### Fallback mobile rule

If WebGL performance or touch behavior is unstable on mobile during
implementation, ship the same Inkframe visual language with static snapshots and
explicitly defer mobile drawing. Do not break mobile reading/navigation for the
sake of canvas interaction.

## Testing Strategy

- Unit/component tests:
  - object variants render expected slots/classes;
  - avatar frame does not obscure status dot;
  - message actions hidden/revealed states;
  - markdown does not emit raw `<marker>`.

- Material evidence tests:
  - keep/re-render restores desk tint and viewport position;
  - image-to-ink restores visual/source/restore resources;
  - object URLs revoked on replace/discard;
  - no unbounded WebGL context growth.

- Browser checks through `./twd`:
  - desktop chat;
  - mobile chat;
  - desktop task;
  - mobile task;
  - material activation/keep/re-render on chat/task.

## Risks

- **Scope creep into all pages**: keep acceptance to chat/task.
- **Performance**: avoid per-card contexts; rely on snapshot/active owner.
- **Readability loss**: material texture must not lower text contrast.
- **Mobile touch conflict**: drawing requires explicit mode.
- **Component drift**: all object visuals must go through primitives.
- **Resource leaks**: all private object URLs must be owned/revoked.
- **Theme confusion**: no long-lived multi-theme fork.

## Rollback Shape

- Keep productized Inkframe components isolated under `components/inkframe`.
- Refactor chat/task by composition, not irreversible global hacks.
- If WebGL blocks final integration, static Inkframe components can still ship
  while material activation is guarded behind capability detection.
