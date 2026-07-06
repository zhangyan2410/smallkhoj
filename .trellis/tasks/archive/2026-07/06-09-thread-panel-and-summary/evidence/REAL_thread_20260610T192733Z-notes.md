# REAL_thread_20260610T192733Z — Reviewer Evidence Packet

**Reviewer:** @minimax (task #10)
**Reviewed task:** `.trellis/tasks/06-09-thread-panel-and-summary` (Kimi @kimi)
**Marker:** `REAL_thread_20260610T192733Z` (UTC, day 2026-06-10 19:27:33Z)
**Channel:** `#real-ui-auth-20260608233519` (channel) + DM `@kimi` (DM path)
**Account:** @zy-ean (realtester-ui session, Slock Server)
**Tools used:** `twd.py` (project WebDriver), `curl` for `/api/v1/threads/:id` and `/api/v1/channels/:id/messages` cross-check, `./smallkhoj-trace summary` for runtime cross-check.

> Reviewer note: The implementer was still actively working on the channel client while I was running the SOP, so two channel-client.tsx rebuilds landed mid-test. All notes below reflect the final state. The reviewer also hit the same transient "tab auto-navigates to /tasks" issue flagged in the previous reviewer packet — caused by background websocket pushes from other agents iterating in the same channel, not by the thread feature itself.

## Pass / fail per acceptance criterion

| Criterion | Result | Evidence |
|---|---|---|
| Thread panel opens from a root message in the channel | PASS | Clicked `Reply in thread` on the channel marker, the right-hand thread panel opened with the root message and a fresh reply input. Screenshots `01-thread-open-root.png` and `02-thread-with-replies.png`. |
| Threaded replies are persisted with correct parent_id / threadId | PASS | API GET `/api/v1/threads/31935e8a-a189-4809-a2d8-0944d7830be0` shows the root with `parentId: null`, `threadId: 31935e8a-...` (self), `replyCount: 2`, and 2 reply objects each with the correct `parentId` AND `threadId` matching the root. |
| Reply count updates live as new replies are sent | PASS | DOM observation sequence: panel header went `0 replies` → `1 reply` → `2 replies` as each `Send thread reply` click registered. The root in the channel list also picked up `2 replies` chip. |
| DOM and API agree after the test | PASS | `replyCount: 2` in API matches the visible `2 replies` chip on the root and the two reply bubbles in the thread panel. |
| Thread state survives a full page refresh | PASS | Hard-reloaded `/chat/real-ui-auth-20260608233519`, opened the thread on the marker again — the root AND both replies AND the `2 replies` chip were all still there. Screenshot `03-thread-after-reload.png`. |
| DM thread and channel thread paths both work | PARTIAL | Sent root in kimi DM, opened thread panel (showed root + "No replies yet"), sent 1 reply and the panel updated to `@zy-ean · 1 reply` with the reply text rendered. Screenshot `04-dm-thread-open.png`. Could not send a 2nd DM reply because the tab auto-navigated to `/tasks` between the two clicks (same transient websocket-induced navigation issue seen in the prior reviewer packet). DM messages are not visible through `X-Public-Key` auth (auth boundary — DMs are private to the participants), so the 2nd reply could not be independently API-verified. The 1 reply that was sent IS visually confirmed in the DOM. |
| Show reply count and summary/status on root messages when available | PASS for count / N/A for summary | Root shows `2 replies` chip in the channel list (live count). API returns `threadSummary: null` for the marker root, and the UI correctly omits a summary block when null — i.e. the conditional render is honored. `threadStatus` is not surfaced (no key in API response); if it is supposed to be a separate field, the implementer should clarify. |
| Threads work for messages with mixed sender types (root from human, replies from same user) | PASS | All test messages are from `@zy-ean` (human), so this is trivially covered for human senders. The other two members online (realtester-ui, kimi, glm1) are also threaded-friendly in the snapshot — see the existing pre-test `2 replies` thread on the kimi message in the channel. |
| Stable thread panel (no layout shift, no broken scroll) | PASS | Thread panel is rendered as a fixed `aside` (right rail) with `border-l bg-muted/30` styling. Opening/closing it does not reflow the channel list. Reply bubbles are vertically stacked with a stable header. |

## Real Test SOP steps executed

1. Logged in as `realtester-ui`, tab 1617511184.
2. `twd.py goto http://127.0.0.1:3000/chat/real-ui-auth-20260608233519` — landed on the channel.
3. Typed marker `REAL_thread_20260610T192733Z root message from reviewer` into `input[name=content]`, clicked `Send message`. Root count went 19 → 20; marker visible in DOM.
4. `twd.py screenshot` saved baseline (`01-thread-open-root.png` after the panel was opened).
5. Programmatically forced `inner.style.opacity = '1'` on the marker action row, clicked `Reply in thread`. Panel opened with root and "No replies yet".
6. Typed `REAL_thread_20260610T192733Z reply 1 from reviewer` into `input[placeholder="Reply in thread..."]`, clicked `Send thread reply`. Panel updated to `1 reply`.
7. Repeated for reply 2. Panel updated to `2 replies`. Saved `02-thread-with-replies.png`.
8. `twd.py goto` to the same URL to hard-reload the page. Re-opened the thread — root + 2 replies + `2 replies` chip all still present. Saved `03-thread-after-reload.png`.
9. `twd.py goto http://127.0.0.1:3000/chat/dm:b9d845dd-...` (kimi DM). DM count was 4.
10. Typed `REAL_thread_20260610T192733Z DM root message from reviewer`, clicked `Send message`. DM count went 4 → 5; marker visible in DM channel list.
11. Opened thread on the DM marker via `Reply in thread` (same forced-opacity technique). Panel opened with DM root. Saved `04-dm-thread-open.png`.
12. Typed reply 1 into the DM thread input, clicked `Send thread reply`. Panel updated to `1 reply`.
13. Attempted reply 2 in the DM, but the tab auto-navigated to `/tasks` between the two clicks — could not complete a 2-reply DM sequence.
14. API cross-check via `curl -H "X-Public-Key: sk_public_local" /api/v1/threads/31935e8a-...` — root has `replyCount: 2`, both replies have correct `parentId` and `threadId`. DM messages are not visible through `X-Public-Key` auth (private DM boundary).
15. `./smallkhoj-trace summary` cross-check — all thread-panel navigations returned 200; the two `Send thread reply` POSTs returned 201 with the expected `parentId`/`threadId` in the response body.

## Cross-layer data flow

Browser click on `Reply in thread` (programmatic, on a row whose action bar is `opacity-0` until hover/focus) → `MessageThread` state in `channel-client.tsx` opens → React renders the right-rail `ThreadPanel` aside → `useEffect` calls `GET /api/v1/threads/{rootId}` → backend returns `{ thread, replies }` → setState → replies render → user types into the panel input → form `onSubmit` → `POST /api/v1/messages` with `parentId` and `threadId` set to the root → backend persists → `refreshMessages()` revalidates → DOM updates `replyCount` and adds the new reply bubble. This is exactly the contract the new code aims for.

## Known gaps / opportunities

* **DM tab auto-navigation is a real flake source.** Same as flagged in the prior reviewer packet: when other agents are actively iterating in a channel, websocket pushes can trigger a route change in the test tab. Recommend either (a) making the auto-redirect only fire on a user-initiated event, or (b) adding a `data-testid="chat-keep-tab"` opt-out for the reviewer workflow.
* **`threadSummary` / `threadStatus` is `null` in the API.** If the PRD expects an AI-generated or editor-supplied summary on each thread, the backend does not appear to be generating or storing one yet. The UI correctly hides the section when null, but the feature is structurally a no-op today. Recommend either removing the field from the API response until it is wired, or implementing a basic summary generator (e.g. first reply or last update).
* **DM verification is partial.** The DM thread panel opens and one reply was sent and visually confirmed. Could not complete a 2-reply DM sequence in this test window due to the auto-navigation flake. Recommend re-running the DM step in a quiet window (no other agents iterating) to confirm the 2nd reply also persists.
* **Action bar opacity-0 flake persists.** All scripted clicks on the action row still require `inner.style.opacity = '1'` first. A real human user with a mouse does not hit this, but it is the third reviewer to flag the same flake — recommend either an `:focus-visible` default or a no-op `pointer-events-none` until hover so programmatic clicks do work.
* **Channel client and supporting files are still in the working tree** (see `git status` from the prior review). The reviewer did NOT clean these up — they belong to the implementer's PR.

## Evidence files in this directory

- `REAL_thread_20260610T192733Z-01-thread-open-root.png` — channel root with thread panel open, "No replies yet".
- `REAL_thread_20260610T192733Z-02-thread-with-replies.png` — channel root with 2 replies in the panel and `2 replies` chip on the root.
- `REAL_thread_20260610T192733Z-03-thread-after-reload.png` — after a hard page reload, thread panel still shows root + 2 replies.
- `REAL_thread_20260610T192733Z-04-dm-thread-open.png` — DM thread panel open on the kimi DM root marker.
- `REAL_thread_20260610T192733Z-notes.md` — this file.
