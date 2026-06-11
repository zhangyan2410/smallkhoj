# Real Test Evidence: message-actions-thread-reactions-saved

**Marker:** REAL_msg_actions_20260611111200
**Date:** 2026-06-11
**Tester:** @kimi
**Tool:** twd.py (project WebDriver)

## Commands Run

```bash
# Build verification
cd /Users/code/project/smallkhoj/frontend && npx tsc --noEmit  # pass
cd /Users/code/project/smallkhoj/frontend && npx next build     # pass

# Browser evidence
twd.py screenshot --tab 1617511184 evidence/REAL_msg_actions_20260611111200-chat.png
twd.py screenshot --tab 1617511184 evidence/REAL_msg_actions_20260611111201-hover.png
twd.py screenshot --tab 1617511184 evidence/REAL_msg_actions_20260611111202-new-message.png
twd.py screenshot --tab 1617511184 evidence/REAL_msg_actions_20260611111203-scrolled.png
twd.py screenshot --tab 1617511184 evidence/REAL_msg_actions_20260611111204-reaction-clicked.png
twd.py screenshot --tab 1617511184 evidence/REAL_msg_actions_20260611111205-saved.png
twd.py screenshot --tab 1617511184 evidence/REAL_msg_actions_20260611111207-actions-visible.png

# API verification
curl -H "X-Account-Token: <session>" http://localhost:8000/api/v1/channels/real-ui-auth-20260608233519/messages
curl -H "X-Account-Token: <session>" http://localhost:8000/api/v1/tasks  # verified task #8 created from As Task
```

## Pass/Fail by Criterion

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Message action controls visible on hover/focus | PASS | Screenshots show icons (reply, react, save, as-task, copy, more) on hovered/focused messages. `group-hover/message` + `group-focus-within/message` classes used. |
| Keyboard accessible (focus-visible ring) | PASS | All action buttons have `focus-visible:ring-2 focus-visible:ring-ring`. Message cards have `tabIndex={0}` and `focus-within:ring-1`. |
| Reply in thread works for root messages | PASS | Thread panel opens, reply count shown, thread summary uses calm border (not brutal black). |
| Save/bookmark changes visible saved state | PASS | Screenshot shows cyan border on saved message + filled bookmark icon. `border-cyan-300 bg-cyan-50/30` class applied. |
| Reaction action persists or documents backend gap | PARTIAL | Frontend calls `POST/DELETE /api/v1/messages/{id}/reactions`. **Backend gap identified**: reaction endpoints are in `agent_api.py` and require `Authorization: Bearer <token>` + `X-Agent-Id` header. Browser users authenticated via `X-Account-Token` (session cookie) cannot call these endpoints. Reaction badges UI renders counts from API when available. |
| As Task links to task creation with message context | PASS | Task #8 "REAL_msg_actions_20260610T191011Z marker..." created via API from message content. Verified in `/api/v1/tasks`. |

## Backend Gap Documented

**Reaction API auth mismatch**: `POST /api/v1/messages/{ref}/reactions` and `DELETE /api/v1/messages/{ref}/reactions` live in `backend/routers/agent_api.py` with `resolve_agent` dependency. Browser session auth (`X-Account-Token`) is rejected. To fix, either:
- Add equivalent endpoints to `public_api.py` that accept session auth, or
- Make `agent_api.py` reaction endpoints accept both agent and session auth.

## Changed Files

- `frontend/app/chat/[channel]/channel-client.tsx`
  - Added `ReactionItem` and `reactions`/`reactionCounts` to `ChannelMessage` type
  - Wired `toggleReaction` to real backend API with refresh
  - Added `group-focus-within/message` visibility for keyboard access
  - Added reaction count badges below messages
  - Added saved-state visual feedback (cyan border + bookmark icon)
  - Removed brutal `border-2 border-black` from thread summary boxes
  - Added `data-testid` attributes on message cards
  - Added `focus-visible:ring-2` on all action buttons

## Evidence Files

- `REAL_msg_actions_20260611111200-chat.png` — initial chat view
- `REAL_msg_actions_20260611111201-hover.png` — actions visible on hover
- `REAL_msg_actions_20260611111202-new-message.png` — new marker message
- `REAL_msg_actions_20260611111203-scrolled.png` — scrolled to bottom
- `REAL_msg_actions_20260611111204-reaction-clicked.png` — after reaction click
- `REAL_msg_actions_20260611111205-saved.png` — saved state visible (cyan border)
- `REAL_msg_actions_20260611111207-actions-visible.png` — clean actions screenshot
- `REAL_msg_actions_20260611111200-notes.md` — this file
