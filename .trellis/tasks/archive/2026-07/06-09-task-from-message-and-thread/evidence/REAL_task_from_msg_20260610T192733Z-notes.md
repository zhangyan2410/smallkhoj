# REAL_task_from_msg_20260610T192733Z — Reviewer Evidence Packet

**Reviewer:** @minimax (task #10)
**Reviewed task:** `.trellis/tasks/06-09-task-from-message-and-thread` (Kimi @kimi)
**Marker:** `REAL_task_from_msg_20260610T192733Z` (UTC, day 2026-06-10 19:27:33Z)
**Channel:** `#real-ui-auth-20260608233519` (channel path) + DM context (deferred — see thread packet)
**Account:** @zy-ean (realtester-ui session, Slock Server)
**Tools used:** `twd.py` (project WebDriver), `curl` for `/api/v1/tasks` cross-check, `./smallkhoj-trace summary` for runtime cross-check.

> Reviewer note: This PRD ("task from message and thread") overlaps with the `06-09 message actions` PRD where the `As Task` button was originally introduced. I tested both the **channel-root** path and the **thread-reply** path independently with two distinct markers.

## Pass / fail per acceptance criterion

| Criterion | Result | Evidence |
|---|---|---|
| User can create a task from a channel message | PASS | Sent `REAL_task_from_msg_20260610T192733Z from-channel-marker` in the channel, clicked the `As Task` (CheckSquare / `aria-label="Create task from message"`) button on it. The button transitioned to `text-emerald-600` immediately. `GET /api/v1/tasks?limit=50` confirms **Task #13** (`e7e59e2b-dddf-4f77-9941-7bb8acf99809`) was created with `title = "REAL_task_from_msg_20260610T192733Z from-channel-marker"`, `channel = #real-ui-auth-20260608233519`, `messageId = c9a901aa-...`, `status = todo`. |
| User can create a task from a DM/thread context | PASS for thread reply, PARTIAL for DM | Sent a reply `REAL_task_from_msg_20260610T192733Z thread-reply-marker` in the channel thread (under the root above), clicked `As Task` on the reply. **Task #15** (`4357119b-3225-4fcc-a6c6-87bb2d190f9a`) was created with `messageId = 7864a751-...` (the reply) and `data.source.threadId = c9a901aa-...` (the root), so the thread context is preserved. DM-context test was deferred to the REAL_thread packet (which already PARTIAL'd DM because of the websocket navigation flake); the `As Task` button on a DM message is the same React handler, so the path is structurally covered, but I did not run a fresh DM end-to-end. |
| The resulting task links back to source | PASS | `data.source` payload includes `type: "message"`, `channel: "#real-ui-auth-20260608233519"`, `channelId: "3748ce7f-..."`, `messageId`, `messageShortId`, AND `threadId`. The same fields are mirrored to top-level `messageId` and `channel` on the task object for backward compatibility. |
| Source link opens the correct conversation/thread | PASS | Task detail panel (`/tasks?view=board&task=<id>`) renders an `Open #real-ui-auth-20260608233519` link with `href = /chat/real-ui-auth-20260608233519?thread=<rootId>&message=<sourceId>`. Clicking it loads the channel with the thread panel open AND the source message in scope. Verified for both Task #13 (channel root → channel-only) and Task #15 (thread reply → thread + reply context). |
| Pre-fill title/description/source channel/message/thread | PASS | Title is the message content (truncated at 80 chars by the input). Description is `"Created from #real-ui-auth-20260608233519 message."` for channel-root and `"Created from #real-ui-auth-20260608233519 thread reply."` for thread reply. `data.evidence.notes = ["Created from chat message."]`. |

## Real Test SOP steps executed

1. Logged in as `realtester-ui`, tab 1617511184.
2. `twd.py goto http://127.0.0.1:3000/chat/real-ui-auth-20260608233519` — landed on the channel (21 root messages).
3. `twd.py input` typed `REAL_task_from_msg_20260610T192733Z from-channel-marker`, `twd.py click` on `Send message`. Screenshot `01-channel-marker.png`. Marker visible in DOM.
4. Forced `inner.style.opacity = '1'` on the marker action row, clicked `Create task from message`. The button transitioned to `text-emerald-600`. Screenshot saved in step 6.
5. `twd.py goto http://127.0.0.1:3000/tasks` — opened the Tasks page. Confirmed **Task #13** appears in the `待办` (Todo) column with `#real-ui-auth-20260608233519 · 37919c5f` source line. Screenshot `02-tasks-board.png`.
6. `twd.py goto http://127.0.0.1:3000/tasks?view=board&task=e7e59e2b-...` — opened the Task Detail panel. The Source section shows `Open #real-ui-auth-20260608233519` linking to `/chat/real-ui-auth-20260608233519?thread=c9a901aa-...&message=c9a901aa-...`. The Evidence section is populated with the `["Created from chat message."]` note and an `Add Evidence` form. Screenshot `03-task-detail-source.png`.
7. `twd.py goto` to that source link. Channel loaded with the marker message in the DOM. Screenshot `04-source-link-opens-channel.png`.
8. `twd.py goto http://127.0.0.1:3000/chat/real-ui-auth-20260608233519` — back to the channel. Opened the thread on the marker (programmatic opacity lift + click). Screenshot `05-thread-reply-marker.png`.
9. Sent `REAL_task_from_msg_20260610T192733Z thread-reply-marker` as a thread reply (via `Reply in thread` form, React-native value setter, then `Send thread reply`). Reply appeared in the panel.
10. Located the reply bubble in the thread panel (`aside[aria-label="Thread"] > div.group/message`), forced the action bar opacity, clicked `Create task from message` on the reply. Button transitioned to `text-emerald-600`.
11. `twd.py goto http://127.0.0.1:3000/tasks?view=board&task=4357119b-...` — Task #15 detail. The Source link is `/chat/real-ui-auth-20260608233519?thread=c9a901aa-...&message=7864a751-...` — both the thread id AND the reply message id are passed. Clicking it opens the channel with the thread panel open AND the reply in scope. Screenshot `06-source-link-thread-open.png`.
12. API cross-check via `curl -H "X-Public-Key: sk_public_local" /api/v1/tasks?limit=50` — both Task #13 and Task #15 are present with the expected `data.source` payloads (channel, channelId, messageId, messageShortId, threadId).
13. `./smallkhoj-trace summary` cross-check — POST `/api/v1/tasks` calls returned 201 with full source/evidence; subsequent `GET /api/v1/tasks` included both new tasks.

## Cross-layer data flow

Browser click on `Create task from message` (a row whose action bar is `opacity-0` until hover/focus, lifted programmatically for the test) → `handleCreateTaskFromMessage(message)` in `channel-client.tsx:339` → `createTaskFromContent(message.content, message.id)` → `POST /api/v1/tasks` with `title` = message content, `description` = `"Created from <channel> message."` (or `thread reply.` for replies), `data: { source: { type, channel, channelId, messageId, messageShortId, threadId }, evidence: { notes, links } }` → backend persists → response includes the task id → React sets `taskMessageIds` (idempotency guard) and `taskLinks[messageId] = taskId` (so the message can show a task pill in future iterations) → the button re-renders with `text-emerald-600`. On the Tasks page, the same task is rendered from `GET /api/v1/tasks` and the `Source` section builds the `Open <channel>` link from `data.source` and `data.messageId`/`data.threadId`.

## Known gaps / opportunities

* **The "task link chip" on the source message is not yet rendered.** After `As Task` succeeds, the button shows the emerald state but the message does NOT show a "linked task → #13" chip. The `taskLinks` state map is set in React but not consumed by the message render. Recommend either (a) rendering a small "📌 #13" chip in the message header when `taskLinks[messageId]` is set, or (b) at minimum scrolling/focusing to the new task on `/tasks`.
* **The Tasks board view shows the source as a static string (`#channel · shortId`), not a link.** The PRD says "Click source link and verify original message" — that link is in the **Task Detail** side-panel, not in the board card. For reviewer users it would be more discoverable to make the board card's source line clickable too.
* **Threaded task title does not show the thread context.** Task #15's title is just the reply text. The PRD says "Pre-fill title/description/source channel/message/thread" — the thread IS in `data.source.threadId` but the title does not surface "from thread on …". Minor; user can read the source link.
* **Evidence form is unstyled / unfocused.** The `Add Evidence` form in the Task Detail panel renders as raw Tailwind inputs with no helper text. A reviewer who lands on the panel cold will not know what kind of evidence to add. Recommend a one-line example or a placeholder like "Note or path to screenshot".
* **DM `As Task` path not independently re-verified.** Same DM flake (auto-navigation) prevented a clean DM-only test. Structurally the handler is the same so this is likely fine, but flagged for completeness.
* **Channel client and supporting files are still in the working tree** (see `git status` from the prior review). The reviewer did NOT clean these up — they belong to the implementer's PR.

## Evidence files in this directory

- `REAL_task_from_msg_20260610T192733Z-01-channel-marker.png` — channel with the from-channel-marker root, As Task button visible (with opacity forced).
- `REAL_task_from_msg_20260610T192733Z-02-tasks-board.png` — Tasks board showing Task #13 in the Todo column with source line.
- `REAL_task_from_msg_20260610T192733Z-03-task-detail-source.png` — Task Detail panel for Task #13, Source link visible.
- `REAL_task_from_msg_20260610T192733Z-04-source-link-opens-channel.png` — channel loaded from clicking the source link.
- `REAL_task_from_msg_20260610T192733Z-05-thread-reply-marker.png` — thread panel with the from-thread-reply-marker reply.
- `REAL_task_from_msg_20260610T192733Z-06-source-link-thread-open.png` — channel loaded from the Task #15 source link, thread panel open.
- `REAL_task_from_msg_20260610T192733Z-notes.md` — this file.
