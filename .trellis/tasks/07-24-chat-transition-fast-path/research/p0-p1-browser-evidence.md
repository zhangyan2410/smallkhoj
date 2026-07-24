# P0 + P1 browser evidence (./twd)

Captured 2026-07-24 against a live `next dev` (Turbopack) on :3000 + backend on :8000,
authenticated via a freshly registered account (`e2e.fastpath@example.com`) on a personal
server. Channel `#e2e-fast-path` filled with 25 messages via the browser composer/proxy.

## P0 — scroll rail no longer re-renders the message list

Method: stamped `data-stamp-before` on all 25 `[data-testid^=message-]` rows, then
programmatically scrolled the container (scrollTop 600 → 1400 → 2400) and checked whether the
stamps survived (React re-creates DOM elements on re-render, which would drop the dataset).

Result:
- `stampsSurvived: 25 / 25`, `allStampsIntact: true` → **no message row was re-created during
  scroll** → `MessageFrame` did not re-render. Scroll progress no longer flows through
  `ChannelClient` root state.
- Scroll-rail active tick moved correctly with scroll position (bottom→11, 600→3, 1400→6,
  2400→10), `railVisible: "true"`. 12 ticks rendered.
- Verified both before and after removing the temporary probe.

## P1 — chat fetch deduplication

Method: temporary `console.log("[P1-PROBE] …")` inside `fetchChatMembers` / `fetchChatDms`,
counted lines in the `next dev` stdout during navigation.

**Critical finding during measurement** — `cache()` was NOT deduplicating on the first attempt:
single-pass direct `/chat/<channel>` load showed members=2, dms=2. Root cause: the helpers took
`headers` as a parameter, and `cache()` keys on argument **reference identity**. Each caller
(`layout.tsx`, `page.tsx`) called `serverApiHeaders()` which returns a **new** `Record` every
time → two different header objects → two cache reads → two network calls.

**Fix applied:** made the helpers **argument-less** — they build their own headers internally
via `cache()`-wrapped `currentAccount` / `getSessionToken` (per-request singletons). Now each
helper has no cache-key argument, so `cache()` dedupes unconditionally per pass.

Result after fix:

| Navigation | members calls | dms calls | (before fix) |
|---|---|---|---|
| direct `/chat/<channel>` (1 pass) | **1** | **1** | was 2 / 2 |
| full `/chat` → redirect → `/chat/<ch>` (2 passes) | **2** | **2** | was 4 / 4 |

The 2-pass count (2 each) is the theoretical minimum for `cache()`: a redirect forces two
server render passes, and `cache()` is per-pass. Within each pass the layout + page now share
exactly one call. members+dms dropped from 8 → 4 across the full navigation; total chat-entry
fetches dropped from 14 → ~8 (channels ×2 passes, cursors ×2, messages ×1, members ×2, dms ×2).

`chat/page.tsx` redirect path also fixed: it now fetches only `channels` + `dms` for the
redirect decision; `members` is fetched lazily only in the empty-state branch.
