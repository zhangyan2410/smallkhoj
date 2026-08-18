# Hook Guidelines

> Rules for reusable client-side behavior in `frontend/hooks/` and route-local
> client helpers.

SmallKhoj currently uses React/Next primitives directly. There is no React Query,
SWR, or Zustand in the web frontend. Hooks should therefore stay small and
purpose-built: reusable browser behavior belongs in hooks; server data loading
belongs in server components/actions or API helpers.

---

## Where Hook Logic Goes

| Logic | Location | Example |
| --- | --- | --- |
| Reusable browser behavior | `frontend/hooks/use-*.ts` | `use-resizable-panel.ts` |
| Route-local context/helper used by one route | colocated under `frontend/app/<route>/` | `app/chat/chat-data-context.tsx` |
| Server data loading | server component/page helper or `lib/control-plane.ts` | `apiGet`, `apiPost` |
| One-off UI state | local `useState` in the client component | dialog open state |

Promote logic to `hooks/` only when at least two surfaces need it, or when the
behavior is complex enough that keeping it inline obscures the component.

---

## Required Patterns

### Browser globals are mount-only

Hooks must be SSR/hydration-safe. Do not read `window`, `document`,
`localStorage`, layout sizes, or media queries during render. Use a stable default
for the first render, then read browser state in `useEffect`.

```tsx
// Correct: first render is deterministic; localStorage is read after mount.
const [stored, setStored] = useState(defaultWidth)

useEffect(() => {
  const raw = window.localStorage.getItem(storageKey)
  setStored(clamp(Number(raw) || defaultWidth))
}, [storageKey, defaultWidth, clamp])
```

### Persistent UI preferences must be explicit

Only durable user preferences belong in `localStorage`, for example panel width
or theme preference. Store them under namespaced keys such as
`smallkhoj.tasks.listWidth`. Do not store API data, task data, member data, or
runtime events in `localStorage`.

### Pointer/keyboard behavior is part of the hook contract

Reusable interaction hooks must expose both pointer and keyboard handlers when
the UI has a keyboard-accessible affordance. `useResizablePanel` returns
`onPointerDown` and `onKeyDown`; the consuming separator must set
`role="separator"`, `aria-orientation`, `aria-label`, and `tabIndex={0}`.

### High-frequency telemetry stays out of component state

Scroll/pointer progress and other per-frame telemetry must never enter
component root state. This was the P0 regression source in
`07-24-chat-transition-fast-path`: every `scroll` event re-rendered the whole
`ChannelClient` tree and the message list.

Rules (reference implementation: `ChatScrollRail` in
`app/(app)/chat/[channel]/message-list.tsx`):

- Keep DOM-derived values in refs and write them straight back to the DOM as
  `data-*` attributes or CSS custom properties (`rail.dataset.visible = ...`,
  `tick.dataset.active = ...`). CSS consumes the attributes; React never sees
  the updates.
- One rAF-merged subscription per concern: a single `onScrollOrResize`
  handler does `cancelAnimationFrame(frame); frame = requestAnimationFrame(update)`,
  with the `scroll` listener registered `{ passive: true }`.
- No dual subscription: do not register the same concern through both a JSX
  prop (`onScroll={...}`) and `addEventListener("scroll", ...)` — handlers
  double-fire and lifecycles diverge. Pick one owner per event.
- The observer effect's dependency array must not include `messages.length`
  (or any frequently-changing data): subscribe once against stable refs
  (`[scrollContainerRef]`), and let the ResizeObserver notice content growth —
  re-subscribing per message recreates listeners and re-triggers telemetry on
  every arrival. (Deliberate exceptions like scroll-to-bottom on new messages
  are separate effects with their own contract.)

### Hooks should not hide route context

If a hook needs a route-specific id or current selection, pass it in as an
argument. Do not have reusable hooks parse `window.location` or assume a route
shape. Route-local providers such as chat data may use `usePathname()` because
they are colocated with that route.

---

## Data Fetching

SmallKhoj frontend server data currently flows through:

- server components and server actions in `frontend/app/**`
- `apiGet` / `apiPost` / `apiPut` / `apiPatch` / `apiDelete` in
  `frontend/lib/control-plane.ts`
- `revalidatePath()` after server-side mutations
- `RealtimeRefresh` for SSE-driven route refreshes

Do not introduce a client fetch/cache library for a one-off page. If the app
adopts React Query or another cache later, update `state-management.md` and this
file first so server/client ownership remains clear.

---

## Common Mistakes

- Reading `localStorage` in `useState(() => ...)` for a server-rendered client
  component, causing hydration mismatch.
- Keeping pointer resize logic inside a page instead of using
  `useResizablePanel`, causing each surface to drift.
- Creating a global store for one route's tab/filter/dialog state.
- Returning freshly allocated objects from a context/hook value without
  `useMemo`, causing unnecessary child re-renders.

