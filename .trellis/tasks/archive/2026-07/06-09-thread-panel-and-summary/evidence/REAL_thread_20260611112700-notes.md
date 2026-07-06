# Real Test Evidence: thread-panel-and-summary

**Marker:** REAL_thread_20260611112700
**Date:** 2026-06-11
**Tester:** @kimi
**Tool:** twd.py (project WebDriver)

## Commands Run

```bash
# Build verification
cd /Users/code/project/smallkhoj/frontend && npx tsc --noEmit  # pass
cd /Users/code/project/smallkhoj/frontend && npx next build     # pass

# Marker message sent via API
curl -H "X-Account-Token: <session>" \
  -H "Content-Type: application/json" \
  -d '{"content":"REAL_thread_20260611112700 testing thread panel and task from message"}' \
  http://localhost:8000/api/v1/channels/real-ui-auth-20260608233519/messages

# Thread reply sent via API
curl -H "X-Account-Token: <session>" \
  -H "Content-Type: application/json" \
  -d '{"content":"REAL_thread_20260611112700 thread reply","parent_id":"<root-id>"}' \
  http://localhost:8000/api/v1/channels/real-ui-auth-20260608233519/messages

# API verification
curl -H "X-Account-Token: <session>" \
  http://localhost:8000/api/v1/threads/<message-id>
```

## Pass/Fail by Criterion

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Thread panel opens for root messages | PASS | Clicking reply icon on root message opens right-side thread panel. `activeThreadId` state managed. |
| Reply count visible in thread header | PASS | Header shows "{sender} · N replies". Updated after reply added. |
| Thread replies persist and render | PASS | API-sent reply appears in thread panel immediately after `refreshThread()`. |
| `/api/v1/threads/{id}` agrees with DOM | PASS | API returns `replyCount`, `replies[]`, `threadSummary` matching visible panel. |
| Keyboard accessible (focus ring, tabIndex) | PASS | Message cards have `tabIndex={0}`, action buttons have `focus-visible:ring-2`. |
| Thread summary badge renders when available | PASS | Summary box with `border-sky-200 bg-sky-50/60` shown when API returns `threadSummary.summary`. |
| Clean visual design (no brutal borders) | PASS | Thread summary uses calm sky border, not `border-2 border-black`. |

## Changed Files

- `frontend/app/chat/[channel]/channel-client.tsx`
  - Thread panel header enhanced with sender name + reply count
  - Added `threadSummary` badge with sky-themed styling
  - Hardened `createTaskFromContent` to include `messageId` in `data.source`
  - Removed placeholder More menu button

## Evidence Files

- `REAL_thread_20260611112701-message.png` — marker message in chat
- `REAL_thread_20260611112702-thread-open.png` — thread panel opened
- `REAL_thread_20260611112703-thread-with-reply.png` — thread with API reply
- `REAL_thread_20260611112704-thread-panel.png` — full thread panel view
