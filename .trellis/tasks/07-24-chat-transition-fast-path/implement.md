# Implement — Chat transition fast path

Ordered execution plan. Run validation after each numbered group. Each group is an
independent rollback point. P0 and P1 are the primary value; P2 is the large-blast-radius
follow-through (do it last, and only if P0+P1 review is clean).

> **Platform note:** this is an inline (ZCode) task. Shell commands run through `rtk`.
> Browser-facing verification uses the project WebDriver wrapper `./twd` (not Playwright,
> not `twd.py` directly). See `.trellis/spec/frontend/quality-guidelines.md`.

## Pre-flight

- [ ] Confirm clean working tree except this task's artifacts: `rtk git status --porcelain`
- [ ] Read `prd.md` and `design.md` (this dir) end to end.
- [ ] Load frontend specs: `.trellis/spec/frontend/{index,directory-structure,component-guidelines,state-management,quality-guidelines}.md`

## Group P0 — Fix chat scroll rail (lowest risk, highest chat-internal win)

Files: `app/chat/[channel]/channel-client.tsx`, `app/chat/[channel]/chat-scroll-rail.tsx`
(extract or new), `app/globals.css` (rail CSS vars only if needed).

1. [ ] Extract `ChatScrollRail` into a self-contained client component that accepts the
      scroll-container ref (Option A in design). It owns ONE rAF-coalesced scroll +
      ResizeObserver listener and writes `--rail-progress` + `data-active` directly to its
      DOM — no `useState`, no props for progress/visible.
2. [ ] In `channel-client.tsx`: remove root `messageScrollState` useState (line 322) and
      the `updateMessageScrollRail` callback (345-366).
3. [ ] Remove the unthrottled JSX `onScroll={updateMessageScrollRail}` (line 1606).
4. [ ] Remove the duplicate `addEventListener("scroll")` block OR fold it into the rail's
      own listener (lines 381-401) — the rail now subscribes itself.
5. [ ] Drop `messages.length` from the observer effect deps (line 405); keep only
      `[activeTab]` (and stable refs). ResizeObserver covers content changes.
6. [ ] Render `<ChatScrollRail scrollContainerRef={messageScrollRef} />` where the rail
      currently sits (line 1571).
7. [ ] Add CSS for `var(--rail-progress)` / `[data-active]` in `globals.css` only if the
      existing `.sk-chat-scroll-rail` rules referenced the old props.

**Validate P0:**
- [ ] `rtk bun run typecheck` (frontend)
- [ ] `rtk bun run lint`
- [ ] `./twd`: open a long chat thread, scroll continuously — confirm no jank. Add a
      temporary `data-render-count` increment in `MessageFrame` and confirm it does NOT
      increase during scroll (remove the probe before commit).
- [ ] Send/receive a message while scrolled mid-list — confirm the rail updates and the
      observers are not torn down.

**Rollback:** `git checkout -- app/chat/[channel]/channel-client.tsx app/chat/[channel]/chat-scroll-rail.tsx app/globals.css`

## Group P1 — Dedupe chat fetches (medium risk)

Files: `app/chat/page.tsx`, `app/chat/layout.tsx`, `app/chat/[channel]/page.tsx`, new
`app/chat/chat-server-fetches.ts`.

1. [ ] Create `app/chat/chat-server-fetches.ts` exporting React-`cache()`-wrapped helpers:
      `fetchChatChannels(headers)`, `fetchChatDms(headers)`, `fetchChatMembers(headers)`,
      `fetchReadCursors(headers)`. Each does the existing `fetch(..., { cache: "no-store" })`
      + json parse. `cache()` makes same-pass calls collapse to one network request.
2. [ ] Refactor `app/chat/layout.tsx` (25-38) to call these helpers instead of inline fetch.
3. [ ] Refactor `app/chat/[channel]/page.tsx` (56-63): replace the inline `members`/`dms`
      fetches with `fetchChatMembers`/`fetchChatDms` (cache hits the layout's call in the
      same pass). Keep the `messages` fetch as-is.
4. [ ] `app/chat/page.tsx`: fetch only `channels` + `dms` for the redirect decision
      (49-53). Move the `members` fetch into the empty-state branch (around line 60) so it
      only runs when no channel and no dm exist.
5. [ ] Verify `ChannelClient` still receives correct `initialAllMembers`/`initialDms` shapes.

**Validate P1:**
- [ ] `rtk bun run typecheck` + `rtk bun run lint`
- [ ] `./twd` Network: navigate `/` → `/chat`; count `/api/v1/*` requests. Target ≤ 6
      (down from 14). Confirm no duplicate `/members` or `/dms` in the same pass.
- [ ] Empty-state: temporarily point at a server with no channels/dms (or use a fresh
      account) — confirm the empty chat page still renders `<DmStarter>` correctly.

**Rollback:** `git checkout -- app/chat/`

## Group P2 — Persist shell chrome via route group (highest risk, largest surface)

Do this LAST, only after P0+P1 review is clean. Blast radius: 8 call sites + 2 tests + 2 specs.

1. [ ] Create `app/(app)/layout.tsx`: `requireCurrentAccount()` + render
      `<InkMaterialRuntimeScript />` + `<AppDeskBackground />` + the new `AppRail` (client,
      derives active from `usePathname()`) around `{children}`. Keep the `sm:ml-14` content
      offset and the `sk-workbench-desk` wrapper semantics.
2. [ ] Create `components/app-rail.tsx` (client): the icon rail + `ServerSwitcher`, active
      link from `usePathname()` (map: `/`→search, `/chat`→chat, `/tasks`→tasks, `/members`→
      members, `/computers`→computers, `/control/*`→control, `/daemon`→activity, `/settings`→
      settings-bottom-link). Reuse the existing `railItems` + translations.
3. [ ] Move routes into the group (URLs unchanged): `app/{page.tsx,tasks,members,computers,
      settings,control,daemon,dm,chat}` → `app/(app)/...`. Leave `app/login`,
      `app/join/[token]` at top level.
4. [ ] Slim `components/product-shell.tsx`: remove `InkMaterialRuntimeScript`,
      `AppDeskBackground`, the rail, `getTranslations("nav")`, and the `session`/`active`
      props. It becomes a body-only wrapper around `ProductShellBody`.
5. [ ] Update all 7 page call sites + `chat/layout.tsx`: drop the now-removed props
      (`session`, `active`); keep `title`/`description`/`actions`/`list`/`listConfig`/
      `sidebar`/`className`/`mainScrollable`. Pages still call `currentAccount()` (not
      require) for their own data; the (app) layout gates auth.
6. [ ] `chat/layout.tsx`: remove the ProductShell chrome render; keep `ChatDataProvider` +
      fetches + `<ChatSidebar/>` passed to a slimmed shell's `list`.

**Validate P2:**
- [ ] `rtk bun run typecheck` + `rtk bun run lint` + `rtk bun run test`
- [ ] Update `test/inkframe-object-ui.test.tsx`: retarget the "exactly one
      AppDeskBackground/InkMaterialRuntimeScript" assertion to `app/(app)/layout.tsx`;
      update the route→shellOwner map (routes no longer own the shell).
- [ ] Update `test/material-surface.test.tsx` product-shell-anchored assertions.
- [ ] `./twd`: navigate `/` ↔ `/tasks` ↔ `/chat` ↔ `/members`; confirm the rail and
      `.sk-app-desk-background` persist (mount-count probe stays at 1). Confirm `/login`
      and `/join/[token]` render WITHOUT the shell/rail.
- [ ] Confirm auth redirect still works: hit an authed route with no session cookie →
      redirects to `/login`.

**Rollback:** `git checkout -- app/ components/product-shell.tsx components/app-rail.tsx test/`

## Phase 3 — Finish

- [ ] **3.3 Spec update (required):**
      - `.trellis/spec/frontend/component-guidelines.md` — "one rail, in ProductShell" →
        "one rail, in `app/(app)/layout.tsx`; ProductShell is body-only".
      - `.trellis/spec/frontend/directory-structure.md` — update `product-shell.tsx`
        description + document the `(app)` layout and `app-rail.tsx`.
      - `.trellis/spec/frontend/state-management.md` — note `router.refresh()` refreshes
        route server components but not the persistent (app) chrome.
      - Record the "WebGL was misdiagnosed as the cost; it is static and never activates
        on route transitions" lesson in the relevant spec (component-guidelines or a
        perf note) so it is not repeated.
- [ ] **3.4 Commit:** batched per group (P0, P1, P2, spec) — present plan, get one-shot
      confirmation. No push.
- [ ] **3.5** Remind user to run `/trellis:finish-work`.

## Validation commands (SmallKhoj frontend)

```bash
rtk bun run typecheck     # frontend type-check
rtk bun run lint          # frontend lint
rtk bun run test          # frontend unit/component tests
./twd ...                 # browser-facing UI evidence (project WebDriver wrapper)
```
