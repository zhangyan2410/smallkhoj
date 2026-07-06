# Design: Inkframe Material Runtime And Chat Event Persistence Optimization

## Architecture Summary

This iteration has three related tracks:

1. **Product UI refactor completion**: carry the previous
   `07-05-inkframe-product-ui-refactor` PRD into the real app, with chat, tasks,
   and the global product background as the acceptance surface.
2. **Material runtime productization**: extract the validated demo engine and
   lifecycle into reusable frontend modules that real app surfaces can compose.
3. **Chat read/event persistence**: move unread/read cursor ownership from a
   local browser adapter to backend per-member state while preserving the
   frontend object-language badges added in `07-05`.

The tracks meet only at the UI composition layer. Material resources are
session-local browser resources; unread cursors are backend-owned metadata.
Do not mix them.

This design absorbs three earlier Trellis scopes. The umbrella product refactor
from `07-05-inkframe-product-ui-refactor` defines the user-visible target. The
material restore and resource lifecycle work from
`07-04-ink-material-card-restore-resource` becomes the production
`MaterialSurface` resource contract. The event/unread indicator work from
`07-02-chat-event-unread-indicators` becomes the product projection of
backend-owned read cursors.

The implementation should not let runtime plumbing outrun product quality. A
working WebGL component that leaves chat/task/background looking like the old
pink/dark or generic-card product UI does not satisfy this design.

## Product Surface Boundaries

The prior `07-05` PRD is applied with these boundaries:

- `ProductShell` owns the default clean Inkframe desk background for user-facing
  product pages.
- Chat and tasks receive the full object/material treatment in this pass.
- Members, computers, settings, and product landing routes receive the shared
  shell background and any shared primitives needed for consistency, but their
  full page-level object redesign is deferred.
- Operator/control pages that are not user-facing may remain plain unless they
  route through `ProductShell`.
- The old theme-switch/multiple-style idea is not a delivery target. Fallbacks
  are capability fallbacks, not parallel product styles.

## Frontend Material Runtime Boundaries

Proposed files:

- `frontend/components/inkframe/ink-material-engine.ts`
  - product module adapted from the demo engine;
  - no demo DOM assumptions;
  - WebGL capability checks;
  - typed surface API around the current public engine methods.

- `frontend/components/inkframe/material-resource.ts`
  - resource model and helpers;
  - object URL creation/revocation;
  - pagehide cleanup;
  - owner/tint metadata;
  - no backend/localStorage/IndexedDB persistence.

- `frontend/components/inkframe/material-surface.tsx`
  - React client wrapper;
  - active/static modes;
  - keep/discard/restore;
  - pointer mode and mobile scroll protection;
  - fallback rendering.

- `frontend/components/inkframe/material-surface-store.ts`
  - tiny per-workspace active-owner coordinator;
  - ensures one active surface per region;
  - not a general global state library.

- `frontend/components/inkframe/app-desk-background.tsx`
  - upgrade from static shell background to material-capable shell background;
  - remains mounted by `ProductShell`;
  - owns desk tint and fixed viewport static layer.

The shell background is the default product background strategy for pages inside
`ProductShell`: chat, tasks, members, computers, settings, and product landing
routes should share one clean dry-paper material desk. Per-route foreground
objects may differ, but the app should not drift back to old pink/dark/static
backgrounds route by route.

## Material Resource Contract

```ts
type MaterialOwnerKind =
  | "app-background"
  | "message"
  | "task"
  | "evidence"
  | "review";

type MaterialSurfaceMode =
  | "static"
  | "activating"
  | "active"
  | "keeping"
  | "discarding"
  | "error"
  | "fallback";

type MaterialResource = {
  id: string;
  ownerKind: MaterialOwnerKind;
  tint: "desk" | "paper" | "task" | "evidence" | "review" | string;
  sourceKind: "none" | "image" | "generated" | "ink-only";
  visualBlob?: Blob;
  visualObjectUrl?: string;
  restoreBlob?: Blob;
  restoreObjectUrl?: string;
  sourceBlob?: Blob;
  sourceObjectUrl?: string;
  createdAt: number;
};
```

Rules:

- `visualObjectUrl` is the inactive display snapshot.
- `restoreObjectUrl` is the editable ink/fixed restore map.
- `sourceObjectUrl` is the color/source fidelity asset.
- Replacing a resource revokes every private URL on the old resource.
- Discarding revokes private URLs and restores the owner default.
- Restoring loads restore first, bakes ink/fixed, then loads source for live
  color composite.
- Restore must be guarded by an activation token so stale async image loads
  cannot bake into a new active surface.
- Material resources are session-local. Do not store visual/restore/source blobs
  in backend, `localStorage`, or IndexedDB in this iteration.

## Active Surface Coordinator

The coordinator is a small owner registry, not a broad global store:

```ts
type MaterialWorkspaceRegion = "app-background" | "chat-main" | "task-main";

type ActiveSurfaceRecord = {
  region: MaterialWorkspaceRegion;
  ownerId: string;
  ownerKind: MaterialOwnerKind;
  deactivate: (keep: boolean) => Promise<void>;
};
```

Rules:

- Activating a surface in a region first deactivates the previous active surface
  in that region.
- App background may be active at the same time as one foreground region only
  if pointer capture modes cannot conflict.
- Inactive message/task/evidence objects show snapshots or CSS paper only.

## Chat Integration

The existing `MessageFrame`/`MessagePaper` object remains the readability shell.
`MaterialSurface` is a layer inside or behind message paper when a message is
material-enabled.

Chat rules:

- long messages remain stable, not strongly tilted;
- message actions stay hidden by default;
- material controls appear near the message, not detached at full-row right;
- task references stay normal messages with future navigation;
- thread unread marker remains tied to the thread affordance.

## Task Integration

Task page uses material only where it clarifies state:

- active/running task can become wetter or more visibly alive;
- review surfaces can animate a mark/stamp, but stamps stay semantic;
- done tasks can settle/fade through static snapshot treatment;
- evidence surfaces may remain the good tilted physical papers, with optional
  active material only when useful.

## Backend Read Cursor Model

Add backend-owned per-member read cursors. Exact storage should follow current
database conventions after inspecting backend schema, but the domain contract is:

```ts
type ChatReadCursorScope =
  | { kind: "channel"; channelId: string }
  | { kind: "dm"; dmMemberId: string }
  | { kind: "thread"; rootMessageId: string };

type ChatReadCursor = {
  memberId: string;
  scope: ChatReadCursorScope;
  lastSeenMessageId?: string;
  lastSeenEventId?: string;
  lastSeenAt: string;
  updatedAt: string;
};
```

Expected API shape:

- `GET /api/v1/chat/read-cursors`
  - returns cursors for the current member and server.
- `POST /api/v1/chat/read-cursors`
  - upserts one cursor after viewing a channel, DM, or thread.
- Chat sidebar/channel payloads may include derived unread state if that is
  cheaper than deriving in the frontend.

Rules:

- read cursor state is per member;
- cursors are scoped to the active server/workspace;
- cursor writes are idempotent and monotonic;
- older cursors must not overwrite a newer last-seen value;
- realtime events can update frontend pending state, but refresh must reconcile
  from backend state.
- unread/event badges are derived from cursor state plus newer messages/events;
  they are not decorative counters and should not persist as a second stored
  unread-count source.

## Migration / Compatibility

- Keep the local unread adapter as a fallback while backend endpoints roll out.
- When backend cursors are available, the frontend uses them as the source of
  truth and local pending state only for optimistic realtime events not yet
  reconciled.
- If WebGL runtime fails, surfaces fall back to static Inkframe snapshots/CSS
  paper and product workflows remain usable.

## Risks

| Risk | Mitigation |
|---|---|
| WebGL contexts grow with message count | active-surface coordinator + tests |
| Stale async restore writes to wrong surface | activation token guard |
| Object URLs leak | centralized resource revoke helper + tests |
| Background image hurts readability | foreground paper opacity/contrast tokens |
| Mobile canvas steals scroll | explicit edit mode before pointer capture |
| Read cursors race under realtime writes | monotonic backend upsert + tests |
| Local adapter diverges from backend | backend becomes source of truth after load |

## Rollback

- Material runtime can be disabled by capability/fallback flag, leaving static
  Inkframe object UI from `07-05`.
- Backend read cursor endpoints can be ignored by frontend fallback if they fail,
  but server tests must pass before shipping backend persistence as default.
