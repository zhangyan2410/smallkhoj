# Plan 022: RealtimeRefresh — replace router.refresh() with targeted refetch (FRONTEND-03)

## Status
- **Priority**: P3, Effort: M, Risk: LOW–MED
- **Depends on**: plan 001 (DONE)
- **Category**: performance / frontend

## Why this matters
`RealtimeRefresh` (mounted on `app/page.tsx` for 5 event types) calls `router.refresh()` on every matching event (150ms debounce). `router.refresh()` re-fetches ALL 7 dashboard endpoints (channels, members, tasks, computers, activity, savedItems, searchResults) and re-renders the whole server-component tree. Any chat message sent anywhere triggers a full dashboard re-fetch — render waterfall + bundle cost. The chat path already uses `applyHighWater` + in-place update; the dashboard does not.

## Current state
`frontend/components/realtime-refresh.tsx`:
```tsx
onEvent: (event) => {
  if (!eventTypesRef.current.has(event.type)) return
  const decision = applyHighWater(highWaterRef.current, event)
  if (decision.action === "drop") return
  if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
  refreshTimerRef.current = window.setTimeout(() => {
    router.refresh()  // <-- full refetch of all 7 dashboard endpoints
    refreshTimerRef.current = null
  }, 150)
}
```

Mounted on `app/page.tsx:~319` for 5 event types: `member.status.updated`, `message.created`, `task.created`, `task.updated`, `member.updated`.

## Scope
**In scope**:
- `frontend/components/realtime-refresh.tsx` — replace `router.refresh()` with a configurable per-event refetch callback.
- `frontend/app/page.tsx` — pass targeted refetch handlers (or accept a narrower scope).

**Out of scope**: backend; converting all dashboard cards to client components (larger refactor, TDA-05 territory).

## Approach options (pick one with the operator if uncertain; default to A)

### Option A — Event-type → route-segment mapping (narrowest)
Map each event type to a `router.refresh()` of a SPECIFIC route segment, not the whole tree:
```tsx
const ROUTE_FOR_EVENT: Record<string, string> = {
  "task.created": "/tasks",
  "task.updated": "/tasks",
  "message.created": "/",  // sidebar preview — keep narrow
  "member.status.updated": "/members",
  "member.updated": "/members",
}
```
Then refresh only that segment. Requires the dashboard to be split into route segments (partial — `app/page.tsx` is one route today). May not be feasible without structural changes; in that case fall back to B.

### Option B — Targeted client-side refetch per card (recommended default)
Convert the dashboard cards most affected by realtime events (tasks, activity) to client components that own their data fetching. Pass an `onEvent` callback from RealtimeRefresh down to each card; each card calls its own `fetch()` and merges via `applyHighWater` (same pattern as channel-client.tsx).

Cards that don't subscribe keep server-rendering as-is. RealtimeRefresh becomes a pub/sub bus, not a global refresh trigger.

### Option C — Narrow eventTypes + keep router.refresh()
Simplest: drop `message.created` from the dashboard's eventTypes (chat sidebar isn't on the dashboard) and keep `router.refresh()` only for member/task changes. Reduces noise but doesn't fix the architectural issue.

## Steps (Option B — recommended)

### Step 1: Read current page.tsx structure
Open `frontend/app/page.tsx` and identify which cards render from which fetches. Note: this plan does NOT split the whole page — only the cards subscribed to realtime events (tasks card, activity card if present).

### Step 2: Refactor RealtimeRefresh into an event bus
Change RealtimeRefresh to accept an `onEvent: (event) => void` prop instead of always calling `router.refresh()`:
```tsx
export function RealtimeRefresh({ eventTypes, onEvent }: { eventTypes: string[]; onEvent?: (event: RealtimeEvent) => void }) {
  ...
  onSSEEvent: (event) => {
    if (!eventTypesRef.current.has(event.type)) return
    const decision = applyHighWater(...)
    if (decision.action === "drop") return
    onEvent?.(event)  // subscriber decides what to do
  }
}
```
Backward-compat: if `onEvent` is undefined, fall back to `router.refresh()` (preserves existing behavior for any other mount points).

### Step 3: Convert tasks card (and activity if practical) to client component
The tasks card becomes a client component that owns its data fetching and subscribes to events:
```tsx
"use client"
function TasksCard() {
  const [tasks, setTasks] = useState<Task[]>([])
  useEffect(() => { fetchTasks().then(setTasks) }, [])
  return <RealtimeRefresh eventTypes={["task.created", "task.updated"]} onEvent={() => fetchTasks().then(setTasks)} />
}
```
Other cards stay server-rendered.

### Step 4: Verify
- `cd frontend && bun run build` → exit 0
- `./twd` screenshot — dashboard loads, sending a task update triggers tasks card refresh only (not all 7 endpoints)

## Done criteria
- [ ] `grep -n "router.refresh" frontend/components/realtime-refresh.tsx` either gone OR only in the backward-compat fallback branch.
- [ ] At least one dashboard card converted to a client component with targeted refetch.
- [ ] `cd frontend && bun run build` exits 0.
- [ ] `cd frontend && bun run lint` exits 0.

## STOP conditions
- The dashboard cards share state in a way that prevents independent client conversion — fall back to Option C (narrow eventTypes) and report.
- RealtimeRefresh has other mount points that depend on `router.refresh()` semantics — keep the backward-compat fallback, don't break them.
- Converting cards reveals hydration mismatches (server/client data divergence) — report; may need Suspense + loading skeleton first (plan 021).

## Maintenance notes
- The long-term fix is converting ALL dashboard cards to client components with `applyHighWater` incremental updates (same as chat path). This plan does the highest-leverage ones; the rest can be incremental.
- Reviewer scrutiny: confirm `router.refresh()` calls dropped meaningfully (check with browser devtools network tab if practical).
