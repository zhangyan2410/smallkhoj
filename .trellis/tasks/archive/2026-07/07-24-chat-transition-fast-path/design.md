# Design — Chat transition fast path

Technical design for the three work items in `prd.md`. All line numbers reference the
current source (pre-change) and are verified.

## P0 — Chat scroll rail: keep progress out of React state

### Current state (verified)

`channel-client.tsx`:

- `322` `const [messageScrollState, setMessageScrollState] = useState({ progress: 0, visible: false })`
- `317` `messageScrollRef` (DOM ref, fine)
- `345-366` `updateMessageScrollRail` — computes progress/visible, calls the setter with a
  `< 0.005` dedup guard (only a throttle, not a real guard).
- `1606` JSX `onScroll={updateMessageScrollRail}` — **unthrottled**, synchronous setState.
- `381-386` `ResizeObserver` → rAF → setter.
- `387-393` `addEventListener("scroll", onScrollOrResize)` rAF path (second subscription).
- `373-405` effect, deps `[activeTab, messages.length, updateMessageScrollRail]`.
- `1571` `<ChatScrollRail progress={messageScrollState.progress} visible={messageScrollState.visible} />`
- `1610` inline `messages.map(...)` — no `React.memo` anywhere in the file.

### Design

Move the rail into its own small client component that owns its own DOM-mutation-based
state, OR keep it in place but stop routing through React state:

**Option A (preferred): isolate `ChatScrollRail` as a self-contained client component.**

- `ChatScrollRail` accepts the scroll container ref (or an id) instead of `progress`/`visible`.
- Inside `ChatScrollRail`, a `useEffect` attaches ONE rAF-coalesced scroll + ResizeObserver
  listener and writes directly to its own DOM via refs / CSS custom properties:

  ```ts
  // inside ChatScrollRail
  const railRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const scroller = scrollContainerRef.current
    if (!scroller) return
    let frame = 0
    const update = () => {
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const progress = max > 0 ? scroller.scrollTop / max : 0
      const visible = max > 8
      const el = railRef.current
      if (el) {
        el.style.setProperty("--rail-progress", String(progress))
        el.dataset.active = visible ? "true" : "false"
      }
    }
    const onScrollOrResize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update) }
    scroller.addEventListener("scroll", onScrollOrResize, { passive: true })
    const ro = new ResizeObserver(onScrollOrResize)
    ro.observe(scroller)
    update()
    return () => { cancelAnimationFrame(frame); scroller.removeEventListener("scroll", onScrollOrResize); ro.disconnect() }
  }, [scrollContainerRef])
  ```

- The rail's visual is driven by `var(--rail-progress)` (a `scaleY`/`top` transform) and
  `[data-active="true"]` (visibility) in CSS — no React re-render at all.
- `ChannelClient` no longer holds `messageScrollState`, no longer passes progress/visible
  props, and the JSX `onScroll` (1606) is removed (the rail subscribes itself).

**Why Option A:** it removes the root `useState`, removes BOTH subscriptions (the
unthrottled JSX handler goes away with the prop), and removes `messages.length` from the
effect deps (the rail's effect deps are just the stable ref). The message list never
re-renders due to scroll.

**Fallback Option B:** if isolating the component is too invasive, keep `ChatScrollRail`
inline but (1) replace the `useState` with a `useRef` holding the rail DOM node, (2) have
`updateMessageScrollRail` mutate `ref.current.style` / dataset directly, (3) delete the
unthrottled JSX `onScroll`, (4) drop `messages.length` from the effect deps. Same outcome,
less file movement.

### Risks

- The rail currently also re-measures on new messages (the `messages.length` dep). With
  Option A the `ResizeObserver` on the scroller covers content-height changes, so this is
  preserved — verify the rail updates after a new message arrives.

---

## P1 — Chat fetch dedupe + remove double-hop

### Current state (verified)

- `app/chat/page.tsx:49-53` — `Promise.all` of `channels`, `dms`, `members` (all
  `cache: "no-store"`). Redirect at `67-73` needs only channels/dms; `members` feeds
  `<DmStarter agents>` only in the empty-state branch (`75-130`).
- `app/chat/layout.tsx:25-30` — `Promise.all` of `channels`, `dms`, `members`,
  `read-cursors` → `ChatDataProvider`.
- `app/chat/[channel]/page.tsx:56-63` — `Promise.all` of `messages`, `members`, `dms`.
  `ChannelClient` consumes `initialAllMembers`/`initialDms` as props (`84-85`), seeded
  into state at `281/283`. **Does not call `useChatData()`** (only `chat-sidebar.tsx:35`
  does).

### Design

**Step 1 — `chat/page.tsx` redirect fetches only what the redirect needs.**

- Move the `members` fetch inside the empty-state branch (lazy): only fetch it when no
  channel and no dm exist. The redirect path (`firstChannel` / `firstDm`) uses only
  `channels` + `dms`.
- Result: `/chat` redirect render drops from 3 → 2 fetches.

**Step 2 — `[channel]/page.tsx` stops duplicating members/dms.**

Two viable approaches; pick by SSR constraint:

- **(a) React `cache()` server-side dedupe (preferred, SSR-safe).** Wrap the member/dm
  fetch helpers in `cache()` (`import { cache } from "react"`). Within a single render
  request pass, the layout's call and the page's call hit the same memoized result, so the
  second call is a cache hit (no extra network). This needs no change to `ChannelClient`
  and keeps the page's prop-passing intact. Requires the layout and page to call the SAME
  cached function (extract `fetchMembers(serverApiHeaders)` / `fetchDms(...)` into a shared
  module, e.g. `app/chat/chat-server-fetches.ts`).
- **(b) Have `ChannelClient` read `ChatDataProvider`.** Cleaner conceptually but
  `ChannelClient` is a client component and the page is a server component: the page would
  still need to pass members/dms as props for the initial SSR render (client context is not
  available during SSR of the server component). So this does not actually remove the page
  fetch on its own — pair it with (a). Use (a) as the primary.

> **Cache-key pitfall (discovered during P1 evidence, 2026-07-24):** `cache(fn)` keys on
> **argument reference identity**, not deep equality. The first implementation passed
> `headers` (a `Record<string,string>`) as the helper argument; since each caller runs
> `serverApiHeaders()` and gets a NEW object, layout and page produced two different header
> references → cache miss → 2 network calls per pass instead of 1. **Fix: make the helpers
> argument-less** — they build their own headers internally from `cache()`-wrapped
> `currentAccount` / `getSessionToken` (per-request singletons). Measured result: single-pass
> `/chat/<channel>` went from members=2/dms=2 to members=1/dms=1; full redirect path went
> from members=4/dms=4 to members=2/dms=2. Do not reintroduce arguments to these helpers
> without first confirming the argument is referentially stable across all callers in a pass.

**Step 3 (optional) — stable chat entry link.** If the rail's chat link points to
`/chat` (which then redirects), we can point it at `/chat/<firstChannel>` once the
channel list is known. This is only possible from the client after mount, so it is a
client-side enhancement (`useMemo` over the data provider), not a server change. Low
priority; skip if it adds client complexity.

### Resulting request count

After P1 (using `cache()` dedupe), `/` → `/chat` → `/chat/<ch>`:

| Endpoint | Count | Note |
|---|---|---|
| `/channels` | 2 (page + layout, different passes; `cache()` can't cross renders) | needed |
| `/dms` | 1 (layout + [channel] dedupe to 1 per pass) | `cache()` |
| `/members` | 1 (lazy in page only when empty-state; else layout+[channel] dedupe) | `cache()` |
| `/read-cursors` | 1 | layout only |
| `/messages` | 1 | channel page only |
| **Total** | **~5-6** | down from 14 |

(`cache()` dedupes within one render pass; the `/chat` render and the `/chat/<ch>` render
are separate passes, so channels is fetched once per pass = 2. members/dms called by both
layout and [channel] within the SAME `/chat/<ch>` pass collapse to 1.)

### Risks

- `cache()` is per-request; confirm the layout and page execute in the same request
  (they do — nested layouts and pages render in one server pass). If they ever split
  (e.g. partial prerendering), dedupe silently no-ops and we're back to duplication but
  not broken. Acceptable.
- `ChannelClient` uses members/dms for peer display in messages; confirm the deduped data
  shape is identical.

---

## P2 — Persist the product shell chrome (route group)

### Current state (verified)

- `components/product-shell.tsx:84-85` mounts `<InkMaterialRuntimeScript />` +
  `<AppDeskBackground />`; `87-136` the icon rail; all inside each page's `<main>`.
- `app/layout.tsx` (root) holds only `<html>/<body>` + `NextIntlClientProvider` + theme
  script — no shell.
- 8 `ProductShell` call sites (7 pages + `chat/layout.tsx`).
- Public routes `/login`, `/join/[token]` must stay shell-free and auth-free.
- Test contract: `test/inkframe-object-ui.test.tsx:270-275` asserts `AppDeskBackground` /
  `InkMaterialRuntimeScript` appear exactly once in `product-shell.tsx`; `:341-362` asserts
  each product route renders through `ProductShell`.
- Spec: `component-guidelines.md:183` "one rail, in ProductShell";
  `directory-structure.md:28` describes `product-shell.tsx` as "icon rail + three-column
  body".

### Design

**New `app/(app)/layout.tsx`** — the authenticated shell. Moves into it:

- `requireCurrentAccount()` (once; pages stop calling it redundantly — but pages still
  need `session` for their own data, so they keep a `currentAccount()` call; only the
  layout's call gates auth/redirect).
- `<InkMaterialRuntimeScript />` + `<AppDeskBackground />`.
- The icon rail, extracted as a client component `AppRail` that derives `active` from
  `usePathname()` (precedent: `server-switcher.tsx` already uses `usePathname`).

**Route moves** (URLs unchanged — route groups are URL-less):

- `app/page.tsx` → `app/(app)/page.tsx`
- `app/tasks/`, `app/members/`, `app/computers/`, `app/settings/`, `app/control/`,
  `app/daemon/`, `app/dm/`, `app/chat/` → under `app/(app)/`
- `/login`, `/join/[token]` stay at top level.

**`ProductShell` slimmed:** remove `InkMaterialRuntimeScript`, `AppDeskBackground`, the
rail, `getTranslations("nav")`, and the `session`/`active` props (now owned by the rail in
the (app) layout). `ProductShell` becomes a thin wrapper around `ProductShellBody`
(header title/description/actions + three-column body). Pages pass only
`title`/`description`/`actions`/`list`/`listConfig`/`sidebar`/`className`/`mainScrollable`/`children`.

**`chat/layout.tsx`:** keeps `ChatDataProvider` + its 4 fetches + `<ChatSidebar/>` as the
`list`; no longer renders shell chrome (the (app) layout already does).

**WebGL singleton safety:** `materialSurfaceCoordinator` keys surfaces by
`(region, ownerId)` and dedupes; moving `AppDeskBackground` to root keeps it single-mount
**only if** the render is removed from `product-shell.tsx`. Double-mounting would collide
on the `app-background`/`global-desk` key. The test-contract update enforces "exactly one,
now in `app/(app)/layout.tsx`".

**Stacking:** `.sk-app-desk-background` is `position: fixed; z-index: 0`; desk content is
`relative z-10`. The shell wrapper's opaque `--paper` background must not occlude the fixed
background. Existing code already works this way (background is a `z-0` sibling, content
`z-10`); verify with `./twd` after the move.

### Test + spec updates (Phase 3.3)

- `test/inkframe-object-ui.test.tsx`: retarget the "exactly one AppDeskBackground /
  InkMaterialRuntimeScript" assertions from `product-shell.tsx` to `app/(app)/layout.tsx`;
  update the route→shellOwner mapping (routes no longer each own the shell).
- `test/material-surface.test.tsx`: update any `product-shell.tsx`-anchored assertions.
- `.trellis/spec/frontend/component-guidelines.md`: "one rail, in ProductShell" → "one
  rail, in `app/(app)/layout.tsx`; ProductShell is now body-only."
- `.trellis/spec/frontend/directory-structure.md`: update the `product-shell.tsx`
  description and document the `(app)` layout.
- `.trellis/spec/frontend/state-management.md`: note that `router.refresh()` refreshes
  route server components but does not rebuild the persistent (app) chrome.

### Risks

- Largest blast radius: 8 call sites + 2 test files + 2 spec docs. Type-check will catch
  broken imports from the route-group move immediately.
- Auth redirect: if `requireCurrentAccount()` in `(app)/layout.tsx` interferes with any
  route's expected redirect, stop (per stop-condition) and re-evaluate.
- Rollback: all changes are additive (new layout) + a slim + file moves; `git checkout`
  reverts wholesale.

---

## Verification measures

- **P0:** React DevTools profiler during chat scroll — `MessageFrame` subtree must not
  re-render. A `data-render-count` probe (increment in `MessageFrame` body) staying flat
  during scroll is conclusive.
- **P1:** `./twd` Network capture on `/` → `/chat` navigation; count `/api/v1/*` requests
  (target ≤ 6, down from 14). Confirm no duplicate `/members` or `/dms`.
- **P2:** DevTools Elements — the rail `<nav data-region="icon-rail">` and
  `.sk-app-desk-background` nodes persist (not unmounted/remounted) across
  `/` ↔ `/tasks` ↔ `/chat`. A mount-count probe on `AppDeskBackground` staying at 1 across
  navigation is conclusive.
- All: lint + typecheck + tests green; `./twd` `tasks → chat → members` transition
  comparison recorded as evidence.
