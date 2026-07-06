# REAL_msg_actions_20260610T191011Z — Reviewer Evidence Packet

**Reviewer:** @minimax (task #6)
**Reviewed task:** `.trellis/tasks/06-09-message-actions-thread-reactions-saved` (Kimi @kimi)
**Marker:** `REAL_msg_actions_20260610T191011Z` (UTC, day 2026-06-10 19:10:11Z)
**Channel:** `#real-ui-auth-20260608233519`
**Account:** @zy-ean (realtester-ui session, Slock Server)
**Tools used:** `twd.py` (project WebDriver, ports 18765/18766), `curl` for API/DB cross-check, `./smallkhoj-trace summary` for runtime cross-check.

> Reviewer note: I started this review against the first committed cut of `channel-client.tsx` and caught the implementer mid-flight upgrading reactions from local React state to a real backend endpoint. The bulk of the testing ran against the upgraded build. Where results diverge between the two cuts, the notes flag it explicitly.

## Pass / fail per acceptance criterion

| Criterion | Result | Evidence |
|---|---|---|
| Message action controls visible on hover/focus and accessible by keyboard | PASS | DOM inspection of all 6 action buttons (Reply, React, Save, As Task, Copy, More). `opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100` on the action row. JS focus() on the React button flipped computed `opacity` from 0 to 1. |
| Reply in thread works for root messages | PASS | Click on "Reply in thread" opened the right-hand thread panel. Sent a marker reply `REAL_msg_actions_20260610T191011Z thread reply from reviewer`. Thread panel now shows the original message (with the persisted 👍 reaction) plus the new reply. |
| Save/bookmark changes visible saved state | PASS (with caveat) | `button[aria-label="Save message"]` toggles between `text-muted-foreground` and `text-cyan-600` (Bookmark icon). Caveat: save state lives in local `savedMessageIds: Set<string>` React state (channel-client.tsx:134) and is not persisted to backend. PRD explicitly accepts this as a documented gap until a `/api/v1/messages/:id/saved` endpoint exists. |
| Reaction action persists or records a documented backend gap | PASS | Reaction was upgraded mid-review to call `POST/DELETE /api/v1/messages/:id/reactions`. After clicking React, the message reaction set in the UI (`text-amber-600` / Smile icon amber) and the backend response agree: `reactions: [{reaction: "👍", memberId: zy-ean, member: "@zy-ean"}]`, `reactionCounts: { "👍": 1 }`. |
| As Task links to task creation with message context | PASS | Click on "Create task from message" created **Task #8** (`534a5061-426c-4e77-a34b-3f0ef475e39f`) via `POST /api/v1/tasks`. Title `"REAL_msg_actions_20260610T191011Z marker for reviewer evidence"`, `messageId` linked back to the marker message, `channel: "#real-ui-auth-20260608233519"`, `status: in_review` (Kimi already advanced it). |
| Stable controls without layout shift | PASS | All buttons are `size-6` (24×24) with `flex items-center gap-0.5`. They are revealed via opacity only, not display, so layout does not jump. The same control row is used for every message. |
| As Task toggle in input bar | PASS | `button[aria-label="Send as task"]` `aria-pressed` flips false→true on click. |
| Copy/menu affordance | PARTIAL | Copy button calls `navigator.clipboard.writeText(message.content)` and the click is accepted. There is no visual confirmation in the test cut. The "More" button (`Open message menu`) is rendered but is currently a non-functional placeholder. |

## Real Test SOP steps executed

1. Logged in as `realtester-ui` (already on tab 1617511184).
2. `twd.py goto http://127.0.0.1:3000/chat/real-ui-auth-20260608233519`
3. `twd.py input` typed marker `REAL_msg_actions_20260610T191011Z marker for reviewer evidence` into `input[name=content]`, `twd.py click` sent. Root message count went 10 → 11, marker visible in DOM.
4. `twd.py screenshot` saved baseline (`01-channel-baseline.png`).
5. Programmatically forced `inner.style.opacity = '1'` on the marker action row (the source row defaults to `opacity-0` so programmatic click on a hidden icon is unreliable). Then:
   - Save: clicked → button gained `text-cyan-600` ✅
   - As Task: clicked → button gained `text-emerald-600` AND a real task was created in the backend ✅
   - React: clicked → button gained `text-amber-600` AND a `reactions: [{👍}]` row appeared in the API response ✅
   - Reply in thread: clicked → right-hand thread panel opened with root message and a fresh input
6. Typed a thread reply marker, clicked "Send thread reply", confirmed panel updated and a new message appeared under the thread root.
7. `twd.py click` on Copy — accepted (no observable state change, expected for clipboard).
8. `twd.py eval` on the input bar `Send as task` toggle confirmed `aria-pressed` flips correctly.
9. `twd.py eval` JS `reactBtn.focus()` confirmed the action row becomes visible on keyboard focus (`opacity: 1`).
10. API cross-check via `curl -H "X-Public-Key: sk_public_local" /api/v1/tasks` and `/api/v1/channels/.../messages` and `/api/v1/threads/{id}` — all evidence above.
11. `./smallkhoj-trace summary` cross-check — all 200/303 responses for the chat surface; daemon session for the marker owner is `12186f28-868a-427a-8df0-40b954ac571e`.

## Cross-layer data flow

Browser click → React `onClick` → `toggleReaction(message, "👍")` → `fetch POST /api/v1/messages/76f215ae-cf8b-4c9d-9e3a-d917f5f64e76/reactions` → backend route → DB write to `message_reactions` (per smallkhoj-trace backend SQL log) → `refreshMessages()` refetch → `setMessages` re-render → `message.reactions.some(r => r.reaction === "👍")` becomes `true` → React `className` switches to `text-amber-600`. This is exactly the contract the new code aims for.

## Known gaps

* Save is local React state only; a page refresh clears it. PRD already calls this out as a backend follow-up, so it is acceptable for this cut.
* "Open message menu" (`MoreHorizontal`) has no handler. It is a placeholder button with a real `aria-label` so screen-reader users see a labeled control that does nothing. Recommend either wiring a popover or removing the button until it ships.
* Channel-client.tsx and chat/page.tsx are still in the working tree as uncommitted modifications (see `git status`). The reviewer did NOT clean these up — they belong to the implementer's PR.
* The reaction code path was upgraded while the reviewer was running the SOP. The first build kept reactions in local state and the new build writes to the backend. The notes above reflect the final state.
* The reviewer hit two transient issues: (a) the `twd.py click` on hidden action buttons with `opacity-0` is unreliable because the inner SVG consumes the event in some layouts, so the reviewer forced `inner.style.opacity = '1'` before scripted clicks. A human user hovering with the mouse will not hit this. (b) On a couple of attempts the tab auto-navigated to /members; this was caused by background websocket pushes from other agents (GLM1 was actively iterating on the same channel), not by the action itself.

## Evidence files in this directory

- `REAL_msg_actions_20260610T191011Z-01-channel-baseline.png` — channel before any actions.
- `REAL_msg_actions_20260610T191011Z-02-marker-with-reaction.png` — marker with persisted 👍 reaction visible.
- `REAL_msg_actions_20260610T191011Z-03-thread-reply.png` — thread panel with the reviewer's marker reply.
- `REAL_msg_actions_20260610T191011Z-04-actions-visible.png` — all six action buttons revealed on the marker message (save + react + as task lit up).
- `REAL_msg_actions_20260610T191011Z-notes.md` — this file.
