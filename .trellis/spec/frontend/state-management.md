# State Management

> How frontend state is owned, persisted, and refreshed.

SmallKhoj's web frontend is intentionally simple today: server data is fetched
through Next server components/actions and `lib/control-plane.ts`; client state
is local React state or route-local context. Do not add a global state layer
unless the state crosses routes and cannot be represented by URL/search params,
server data, or a small provider.

---

## State Categories

| Category | Owner | Examples | Persistence |
| --- | --- | --- | --- |
| Server state | backend API + server components | tasks, members, computers, channels, activity | backend database |
| URL state | route/search params | selected member, selected computer, current tab/filter | browser URL |
| Local UI state | client component | dialog open, composer text, hover/expanded local controls | memory only |
| Durable preference | browser preference layer | theme, resizable panel width | namespaced `localStorage` |
| Route-local shared state | colocated provider | chat channel/dm/member data | memory only |

---

## Required Patterns

### Server state stays server-owned

Server-fetched data must be refreshed by `revalidatePath()` after server actions,
or by the existing realtime refresh path when runtime events arrive. Do not copy
server data into local component state just to filter, sort, or render it.

> **`router.refresh()` vs. the shell chrome:** `router.refresh()` re-fetches the
> current route's server components but does **not** rebuild layouts higher in the
> tree. Because the workbench chrome (rail + background) lives in `app/(app)/layout.tsx`,
> a `router.refresh()` (used by `RealtimeRefresh`, the composer after send, the
> computer-connect poller) refreshes route data without tearing down the shell — so
> realtime-driven refreshes no longer cause a visible "workbench reload." Do not move
> chrome back into a per-page component, or `router.refresh()` will start rebuilding it.
>
> **`cache()` keying (server dedupe):** React's `cache(fn)` dedupes by **argument
> reference identity**, not deep equality. Helpers that take an object built fresh
> per caller (e.g. `serverApiHeaders()`) will NOT dedupe across layout↔page. Make
> data-fetch helpers argument-less and resolve auth inside them via `cache()`-wrapped
> `currentAccount()`/`getSessionToken()`. See `app/chat/chat-server-fetches.ts`.

### URL state is the source of truth for shareable selection

If a user can bookmark or refresh a view and should keep the same selection, use
the URL. Examples: selected task/member/computer, tab key, filters. Normalize
query-string values with small helpers such as `searchValue()` instead of
handling `string | string[] | undefined` repeatedly in JSX.

### Local state is for ephemeral interaction only

Use local `useState` for UI mechanics that should reset on navigation, such as
dialog open state, draft text, temporary error text, drag state, or optimistic
button disabled state.

### Durable preferences must be hydration-safe

For preferences stored in `localStorage`, render a deterministic default first
and read the stored value after mount. This prevents the "server rendered width X
but client rendered width Y" class of hydration bugs.

### Route-local providers are allowed but must stay local

Use a route-local context when several siblings under one route need the same
stable derived data. Keep the provider colocated under `app/<route>/` and do not
promote it to a global provider unless another route genuinely needs it.

---

## When To Add Global State

Only add a global store if all are true:

1. The state is client-only.
2. Multiple unrelated routes need to read or update it.
3. It cannot be represented by URL state or a persisted preference.
4. Server ownership would be wrong or too slow for the interaction.

If a global store is introduced later, document its ownership, persistence, and
reset rules here before using it broadly.

---

## Wrong vs Correct

### Wrong

Copy `tasks` from a server component into a client global store, mutate it
locally, then hope `revalidatePath("/tasks")` eventually fixes drift.

### Correct

Keep tasks server-owned, send mutations through server actions or API helpers,
call `revalidatePath("/tasks")`, and use local state only for the dialog or
pending affordance.

---

## Scenario: Bounded Cursor Consumption and Shared Browser Realtime

### 1. Scope / Trigger

- Trigger: adding a cursor-paginated list consumer, mounting a realtime subscriber, changing active Server/account scope, or projecting `task.*` browser events.

### 2. Signatures

- Generic traversal: `fetchAllCursorPages<T>(fetchPage, {maxPages?}) -> Promise<T[]>`.
- Task traversal: `fetchAllTaskPages<T>(fetchPage, options?) -> Promise<T[]>` using `limit=200`.
- Transport owner: `RealtimeTransportOwner`.
- Provider: `RealtimeProvider({serverId})` mounted by `app/(app)/layout.tsx` (the app shell layout; ProductShell is body-only since the 07-24 fast-path work).
- Subscriber hook: `useRealtimeSubscription(callback)`.
- Task invalidation event: `smallkhoj:tasks-invalidated`.

### 3. Contracts

- A frontend that requires the full task collection follows `nextCursor` until null; it must not silently treat the first bounded page as complete.
- Traversal has a finite page bound, URL-encodes cursors, rejects repeated cursors, and preserves typed item shapes without `any`.
- One authenticated account/active-Server scope owns one physical SSE fetch. Subscribers share the transport and high-water state.
- Scope change increments the generation, stops/aborts the old transport, clears high-water marks, and ignores stale callbacks. The final subscriber/unmount closes the physical stream.
- Task events project to task-data invalidation. `TaskBoard` refetches every bounded task page and reapplies channel/creator/assignee/status filters. Unrelated events do not cause a task refetch.
- `RealtimeRefresh` may still refresh a route for explicitly accepted non-task events; it must not turn every event into an unspecified full-page refresh.
- This contract does not claim that every server-rendered task summary/list/detail region becomes client-live. Broad server/client decomposition requires a separate architecture task.
- SSE disconnects reconnect automatically with capped exponential backoff: `delayMs = Math.min(1000 * 2 ** Math.min(attempt, 5), 30000)` in `connectRealtimeEvents` (`lib/realtime-events.ts`), and `attempt` resets to 0 after every successful connect. Do not add manual "reconnect" UI or unbounded retry loops for the transport.
- Adding a realtime event type requires a page-by-page audit of every `RealtimeRefresh` `eventTypes` list. Lesson: `member.created` shipped without being subscribed on `/members`, so roster updates silently missed the route. When a new event type lands, grep all `<RealtimeRefresh eventTypes={...}>` consumers and update each affected route deliberately.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| `nextCursor` is null/absent | Stop and return accumulated items. |
| Cursor repeats | Throw `Cursor pagination repeated cursor`; never loop. |
| Page count exceeds bound | Throw the bounded traversal error. |
| Second subscriber mounts in same scope | Reuse the existing physical transport. |
| Auth/Server scope changes | Abort old generation and start at most one new transport when subscribers exist. |
| Stale old-generation event arrives | Ignore it. |
| `task.*` event arrives | Emit targeted task invalidation and refetch task pages once per owner high-water decision. |

### 5. Good/Base/Bad Cases

- Good: a 205-item runtime returns 200 items plus a cursor, then 5 items; `/tasks` renders item 204 and reports the full initial collection.
- Good: TaskBoard, task memory, chat, and route refresh subscribers share one established backend SSE socket.
- Base: no subscriber is mounted; owner retains scope metadata but opens no transport.
- Bad: every `RealtimeRefresh` or feature component calls `connectRealtimeEvents` directly.
- Bad: `apiGet('/api/v1/tasks')` once, or a recursive page loop with no repeated-cursor/page-bound guard.

### 6. Tests Required

- Unit: three-page merge, null termination, cursor encoding, repeated cursor, page bound, and invalid bound.
- Static consumer inventory: every full-task consumer imports/uses the shared task traversal and only the provider creates a physical transport.
- Owner lifecycle: multiple subscribers/one factory call, scope abort, stale callback rejection, last unsubscribe, and dispose.
- Projection: task events target task invalidation; unrelated events are ignored or use their explicit route projection.
- Runtime/UI: real PostgreSQL/API with more than 200 tasks, `./twd` tail-item assertion, one stable ESTABLISHED SSE socket, and one marker application.

### 7. Wrong vs Correct

#### Wrong

```tsx
useEffect(() => connectRealtimeEvents(...), []) // repeated in every leaf
const { tasks } = await apiGet('/api/v1/tasks') // silently first page only
```

#### Correct

```tsx
<RealtimeProvider serverId={session.server.id}>{children}</RealtimeProvider>
const tasks = await fetchAllTaskPages((path) => apiGet(path, emptyPage))
```

---

## Scenario: Domain × Scope Unread Activity Layer

### 1. Scope / Trigger

- Trigger: adding unread/"unseen" indicators for any domain, wiring a new domain into notifications, or touching the shared browser-realtime unread counters (tasks `07-30-realtime-activity-indicators`, `07-30-background-notifications`).

### 2. Signatures

- Store: `frontend/lib/activity-unread-state.ts` — `ActivityUnreadStore`, `markActivityUnread`, `clearActivityUnreadMarked`, `resetActivityUnreadHighWaterMarked`, `activityUnreadKeysForEvent`, `activityUnreadSeqForEvent`, `activityUnreadClearKeysForPath`.
- Chat-domain key derivation: `frontend/lib/chat-unread-state.ts` — `chatScopeKeys`, `chatEntityKeys`, `chatReadCursorRequestForEntity`.
- Current-view registry: `frontend/lib/current-chat-view.ts` — `setCurrentChatView`, `currentChatChannelId`.
- Notification mapping: `frontend/lib/background-notifications.ts` — `planNotificationForEvent`, `offerThrottledNotification`, `flushThrottledNotifications`; preferences in `frontend/lib/notification-preferences.ts`.
- Presentation primitives: `EventBadge` (`components/inkframe-object-ui.tsx`), `ActivityDot` / `ActivityCountBadge` / `ActivityIndicator` (`components/activity-indicator.tsx`), fed by `hooks/use-activity-indicator.ts`.

### 3. Contracts

- Unread state is a domain × scope two-level key store, persisted at `smallkhoj.activity.unread.v1`: entity keys `chat:{channel|dm}:id|name:<v>` plus aggregate keys `task:all` and `activity:all`. A new domain means a new prefix in this store — never a parallel store.
- Counters are incremented by SSE events (tracker in `components/activity-unread-tracker.tsx`). Chat-key dedup uses the in-channel `messageSeq` high-water mark (`activityUnreadSeqForEvent`), NOT the global event `seq`: global seq is a cross-scope DB identity, so a per-key global-seq high-water makes legal new messages in sibling channels eat each other. Aggregate keys (`task:all`/`activity:all`) keep the global `seq`.
- Entering a route clears aggregate keys only (`activityUnreadClearKeysForPath`: `/tasks` → `task:all`, `/daemon` → `activity:all`). The chat domain is never cleared wholesale by route — chat clears per-entity keys plus server read-cursor calibration (`chatReadCursorRequestForEntity`).
- "Currently viewing" is decided by `scope.id` via the `current-chat-view` registry (`currentChatChannelId() === event.scope.id`), not by name matching: a DM's `scope.name` is the internal `dm:{idA}-{idB}` form and never equals the routable `/chat/<handle>` name. Name comparison is valid only for channels.
- SSE catch-up (reconnect/epoch change) invalidates local chat high-water marks (`resetActivityUnreadHighWaterMarked`): stale watermarks silently swallow replayed events; recounting and letting entity-entry clear + read-cursor calibration absorb overcounts beats undercounting.
- Presentation primitives are stateless: `EventBadge` / `ActivityIndicator` receive only display props (`hasUnread`/`count`) and never subscribe to events; subscription lives in the hook. Any new domain integrating unread indicators must reuse this layer and its primitives — building a second unread store/event system is forbidden.
- Notification side (`background-notifications.ts`): no notification when the relevant route is visible AND the document is focused; replayed events are dropped via the shared realtime epoch/seq high-water decision (`decision.action === "drop"`); same-scope notifications fold into one within `NOTIFICATION_THROTTLE_WINDOW_MS = 30_000`; a denied `Notification.permission` degrades silently (tracker returns before planning, no error, no nagging); clicks navigate through the plan's `href` mapping — DM/mention → `/chat/<name>`, task → `/tasks?task=<id>`, memory → `/chat/<name>` | `/tasks?task=<id>` | `/daemon` by scope.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Same message replays on same chat key | `seq <= highWater` skips increment; count unchanged. |
| New message in channel B while channel A has a higher global seq | Chat keys use `messageSeq`, so the event counts. |
| User enters `/tasks` | `task:all` cleared; chat keys untouched. |
| User views the DM they have open | `currentChatChannelId() === scope.id` → no increment (name match would fail). |
| SSE catch-up replays chat events | Chat-key high-water reset first; replays count again. |
| Route visible + document focused | No system notification for that event. |
| Second notification for same scope within 30s | `queued`; flushed later as one folded "N new" notification. |
| `Notification.permission !== "granted"` | Tracker exits silently; no error surfaced. |

### 5. Good/Base/Bad Cases

- Good: a `tasks` domain lands by adding `task:all` increments in `activityUnreadKeysForEvent` and an unread indicator on a real consumer — zero new stores. (Current state: the rail icon badge — `ActivityIndicator` on `AppRail` — is temporarily offline pending count-semantics fixes; see the restore note in `app-rail.tsx`. The state layer and the chat sidebar's per-entity unread are live; restore rail integration only after the count semantics are fixed.)
- Good: chat badge survives reload via `localStorage` and reconciles with server `unreadCount` (max of local and server).
- Base: notification permission denied; unread badges still work, notifications silently off.
- Bad: a feature builds its own `localStorage` unread counter with its own change event.
- Bad: dedup keyed on global event `seq` for chat, or "viewing" decided by comparing a DM's `scope.name` to the route segment.

### 6. Tests Required

- Unit: multi-key increment dedup, high-water reset on catch-up, clear-on-path projection, own-message suppression, DM-id current-view suppression.
- Unit: notification planning matrix (visible+focused, mention-only for channels, own events, throttle offer/flush).
- Cross-tab: store change event (`smallkhoj:activity-unread`) updates mounted consumers without remount (today's live consumer: chat-sidebar entity badges; rail `AppRail` integration is pending its restore — see §5 note).

### 7. Wrong vs Correct

#### Wrong

```ts
localStorage.setItem("myfeature.unread", String(n)) // parallel store
if (event.scope.name === routeSegment) return []   // DM never matches
```

#### Correct

```ts
markActivityUnread(storage, window, activityUnreadKeysForEvent(event, {
  pathname, currentMemberIds, currentChatChannelId: currentChatChannelId(), chatScopeKeys,
}))
```
