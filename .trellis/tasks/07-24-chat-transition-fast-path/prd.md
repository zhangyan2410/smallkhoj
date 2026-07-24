# Chat transition fast path: dedupe fetches + scroll rail + shell persistence

## Goal

Eliminate the "加载工作台 / loading workbench" flash and general choppiness when
switching pages, especially into and within chat. Make normal-speed navigation feel
smooth; keep a graceful state only when a transition is genuinely slow.

## Root cause (corrected, verified)

This task supersedes an earlier misdiagnosis. Record it so a future session does not
repeat the mistake:

- **Earlier (wrong) claim:** "WebGL ink background re-init on every route change is the
  main cost." **Falsified.** The global `AppDeskBackground` and the chat desk
  `MaterialSurface` both default to `mode="static"`; in static mode no `<canvas>` is
  mounted (`material-surface.tsx:500-502`) and the main effect early-returns before
  `runtime.create` (`material-surface.tsx:351-356`). The activation event
  `APP_DESK_MATERIAL_EVENT` has **zero dispatchers** in the entire frontend (only a
  listener exists). The chat desk activates only via 4 explicit button clicks
  (`channel-client.tsx:1367/1377/1388/1399`). **WebGL cost on the route-transition path
  is exactly zero.** Do not blame WebGL again without a profile showing otherwise.

The verified root causes, ordered by contribution:

1. **Chat scroll-rail regression (P0)** — commit `35325e9` ("add chat scroll rail").
   `messageScrollState` lives in `useState` at the `ChannelClient` root
   (`channel-client.tsx:322`); the message list is an inline `messages.map` at line 1610
   with no `React.memo` in the render path. Every qualifying scroll write re-renders the
   entire message list. Aggravated by: the JSX `onScroll` (line 1606) is **unthrottled**
   while the `addEventListener("scroll")` (line 392) is only rAF-coalesced — scroll is
   subscribed twice. The effect also depends on `messages.length` (line 405), so each new
   message tears down and rebuilds the observers.

2. **Chat fetch duplication + double-hop (P1)** — entering chat fires ~14 backend
   requests across 2 serial server round-trips with heavy duplication:

   | Endpoint | `/chat` render | `/chat/<ch>` render | Total |
   |---|---|---|---|
   | `/api/v1/channels` | page + layout | layout | 3 |
   | `/api/v1/dms` | page + layout | layout + [channel] | 4 |
   | `/api/v1/members` | page + layout | layout + [channel] | 4 |
   | `/api/v1/chat/read-cursors` | layout | layout | 2 |
   | `/api/v1/channels/<ch>/messages` | — | [channel] | 1 |
   | **Total** | 7 | 7 | **14** |

   - `chat/page.tsx` redirect decision needs only `channels` + `dms`; `members` is
     fetched then discarded on the redirect path.
   - `[channel]/page.tsx` re-fetches `members` + `dms` that the layout already fetched;
     `ChannelClient` consumes them as props and **does not read `ChatDataProvider`**
     (only `chat-sidebar.tsx` does), so the re-fetch is truly redundant.
   - During these round-trips the chat shell ("聊天工作台" title, `chat-sidebar.tsx:84`)
   renders over a half-empty main area — this is the literal "加载工作台" page the user sees.

3. **Per-page ProductShell rebuild (P2)** — commit `60aa0ba` bound the workbench shell
   (icon rail + header + background) to each page rather than a shared layout. DOM is
   rebuilt per navigation. Not expensive on its own, but stacked on the auth+fetch blank
   window it reads as "the workbench reloading." URL is unaffected by the route-group fix.

## In scope

### P0 — Fix the chat scroll rail

1. Scroll progress/visibility must NOT enter React state at the `ChannelClient` root.
   Drive the `ChatScrollRail` via a ref + direct DOM writes (`data-active`/`data-near` or
   a CSS variable / `style` mutation), or move the rail into a small isolated client
   component that owns its own state.
2. Remove the `messages.length` dependency from the observer effect; `ResizeObserver`
   already covers content-height changes.
3. Eliminate the double scroll subscription (unthrottled JSX `onScroll` vs rAF
   `addEventListener`). Keep a single rAF-coalesced path.

### P1 — Remove chat fetch duplication and the double-hop

1. `chat/page.tsx` redirect: fetch only `channels` + `dms`; fetch `members` lazily only
   when the empty-state branch actually renders.
2. `[channel]/page.tsx`: stop re-fetching `members` + `dms`. Consume the data the layout
   already put in `ChatDataProvider` (make `ChannelClient` read `useChatData()`), OR wrap
   the shared fetch in React `cache()` for same-pass dedupe.
3. Optional: give the chat rail link a stable `chatHref` pointing at `/chat/<firstChannel>`
   so clicking the brand does not double-hop through `/chat`.

### P2 — Persist the product shell chrome (optional follow-through)

1. Move `InkMaterialRuntimeScript` + `AppDeskBackground` + the icon rail out of
   `ProductShell` into a shared `app/(app)/layout.tsx` (Next route group; URL unchanged).
2. Derive the rail's active highlight from `usePathname()` instead of a per-page `active`
   prop.
3. Keep `/login` and `/join/[token]` outside the shell group (no auth requirement, no rail).

## Out of scope

- Do **not** add `loading.tsx` — it converts the flash into a visible loading screen,
  which is the wrong direction for the normal-speed case.
- Do **not** pre-warm or keep-alive WebGL — default is `static`, interaction-gated only.
- Do **not** touch `router.refresh()` / SSE semantics — they are unrelated to the flash
  (confirmed: once P2 lands, `router.refresh()` only refreshes route server components and
  does not rebuild the persistent chrome).

## Acceptance criteria

- [ ] **P0:** scrolling a long chat thread no longer re-renders the message list on each
      scroll tick (verifiable: React DevTools profiler shows `MessageFrame` children are
      not re-rendered during scroll; or a `data-render-count` probe stays flat). New
      messages arriving do not tear down/rebuild scroll observers.
- [ ] **P1:** entering `/chat` from `/` issues ≤ 6 backend requests total (down from 14),
      with no duplicated `/members` or `/dms` fetch. Verified via `./twd` Network capture
      counting requests on `/` → `/chat` navigation.
- [ ] **P1:** `ChannelClient` no longer re-fetches members/dms; it consumes
      `ChatDataProvider` (or a `cache()`-wrapped shared fetch). Empty-state branch still
      renders correctly when no channels/dms exist.
- [ ] **P2:** the icon rail + background persist across `/` ↔ `/tasks` ↔ `/chat`
      navigation (DOM nodes are not unmounted; visible via DevTools Elements persistence
      or a mount-counter). `/login` and `/join/[token]` still render without the shell.
- [ ] `./twd` records a `tasks → chat → members` transition comparison as evidence.
- [ ] Frontend lint, typecheck, and tests pass; the updated inkframe shell test contract
      (`test/inkframe-object-ui.test.tsx`, `test/material-surface.test.tsx`) passes.
- [ ] No regression in chat send/receive, read cursors, or channel switching.

## Dependencies and stop conditions

- Depends on: existing `ChatDataProvider` contract (`app/chat/chat-data-context.tsx`);
  the chat layout's 4 fetches remain the source of truth for channels/dms/members/cursors.
- **Stop** if making `ChannelClient` read `ChatDataProvider` breaks the channel page's
  SSR (server components cannot call client `useContext`) — fall back to React `cache()`
  server-side dedupe instead.
- **Stop** if the P2 route-group move breaks auth redirect behavior for any route
  (re-evaluate before proceeding).
- **Stop** rather than weakening a lint/test/build rule solely to obtain green status.

## Notes

- Earlier abandoned task: `07-24-page-transition-shell-persistence` (archived — was seeded
  on the wrong "WebGL is the cost" premise before measurement). Its plan to lift the shell
  survives here as P2.
- P2 is the highest-risk, largest-blast-radius piece. If review surface is a concern, P0+P1
  can ship first and P2 follows once the user confirms smoothness is still insufficient.
