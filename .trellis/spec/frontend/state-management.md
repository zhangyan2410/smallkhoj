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

