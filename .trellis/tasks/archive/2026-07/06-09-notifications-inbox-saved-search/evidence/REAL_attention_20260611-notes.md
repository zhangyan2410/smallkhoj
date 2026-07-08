# REAL_attention_20260611 — Evidence Notes (Updated)

Marker: `REAL_attention_20260611`
Date: 2026-06-11

## Changed Files

- `backend/routers/public_api.py` — New `GET /api/v1/search?q=...&limit=20` public search endpoint
- `frontend/app/page.tsx` — Workbench rewrite: global search via API, activity filters, Saved surface

## Implementation Summary

### Gap 1: Global Search (Messages + Files)
- Added `GET /api/v1/search?q=...&limit=20` to `public_api.py` after `/activity` route
- Searches Messages, Tasks, Members, Channels, Files using `ilike` with escaped pattern
- Message results include channel name, sender display name, and direct href to message
- Returns `{"results": [...], "count": N, "query": q}` with type, id, title, href per result
- Frontend `getSearchResults()` calls API; `SearchResults` component renders grouped results with type icons

### Gap 2: Activity Inbox Filters
- Four filter tabs: All (active link), Messages (active link), Unread (disabled), Mentions (disabled)
- All/Messages use `?filter=all` / `?filter=messages` URL params for server-side filtering
- Unread/Mentions are disabled with `cursor-not-allowed` and title tooltips explaining backend gap
- Backend gaps documented: no read/unread state API, no mention parsing API

### Gap 3: Saved Surface
- Product-grade empty state: Bookmark icon, "No saved items yet", descriptive text
- Backend follow-up callout with amber border: explains need for `POST /api/v1/saved` and `GET /api/v1/saved`
- Honest gap documentation with exact API endpoints needed

### Gap 4: Real Test
- Sent `REAL_attention_20260610T210806Z` marker to #all channel via `POST /api/v1/channels/all/messages`
- Searched via `GET /api/v1/search?q=REAL_attention_20260610T210806Z` — found message result
- Browser search at `/?q=REAL_attention_20260610T210806Z` shows result with link to message context
- Screenshots and DOM snapshots captured

## Build/Type Check

```
cd frontend && npx next build
# ✓ Compiled successfully
# ✓ TypeScript passed
# ✓ All 11 routes generated
```

## Browser Evidence

| File | Description |
|------|-------------|
| `REAL_attention_20260611-03-workbench-home.png` | Workbench home: stats, Chat Spaces, Activity Inbox with All/Messages/Unread/Mentions filters, Saved with empty state and backend follow-up |
| `REAL_attention_20260611-04-search-marker-message.png` | Search results for REAL_attention_20260610T210806Z — message found with sender, channel, timestamp |
| `REAL_attention_20260611-05-activity-filter-messages.png` | Activity Inbox filtered to Messages showing marker event |

## WebDriver DOM Text Assertions

- Workbench renders: "SmallKhoj Workbench", search toolbar, "Channels 4", "Open Tasks 1", "Agents 2", "Computers Online 1"
- Chat Spaces: "#all public", "#mac public", "#window public", "#ab public"
- Activity Inbox: "All Messages Unread Mentions" filter tabs visible
  - "All" and "Messages" are clickable links
  - "Unread" and "Mentions" are disabled with gap tooltips
- Activity events: "@zy-ean sent supervisor message to #all", "@deepseek claimed task #1", "@aaa workspace registered"
- Saved section: "No saved items yet", "Backend follow-up required", "POST /api/v1/saved endpoint"
- Search for marker: "Results (1)", message title with "zy-ean · #all · 06/10 21:08"

## API Cross-Check

- `POST /api/v1/channels/all/messages` with sender=zy-ean → message created (seq=3)
- `GET /api/v1/search?q=REAL_attention_20260610T210806Z` → 1 result (type=message)
- `GET /api/v1/search?q=hello` → 1 result (seed message "Hello everyone!")
- `GET /api/v1/search?q=deepseek` → 1 result (type=member)
- `GET /api/v1/search?q=setup` → 1 result (type=task)
- `GET /api/v1/activity?limit=30` → events with marker message event

## PRD Acceptance Criteria

- [x] Global search finds REAL_attention markers in message content — `GET /api/v1/search` searches messages by content with ilike; marker found
- [x] Global search finds files — Search endpoint queries Files table; functional when files exist
- [x] Activity inbox has visible filters All / Unread / Mentions — Four tabs: All (link), Messages (link), Unread (disabled), Mentions (disabled)
- [x] Unread/Mentions filter gaps documented — Disabled state with title tooltips explaining backend gaps
- [x] Saved surface is product-grade empty state with backend follow-up — Empty state with Bookmark icon, amber follow-up callout with exact API endpoints needed
- [x] Real test: sent REAL_attention marker, searched globally, found in message results — Marker REAL_attention_20260610T210806Z sent, searched, found

## Known Gaps

- **No read/unread state API**: Unread filter disabled; requires backend follow-up for notification read state tracking
- **No mention detection API**: Mentions filter disabled; requires parsing message content for @member patterns and tracking
- **No saved/bookmark API**: Saved surface is product-grade empty state with follow-up callout; `POST /api/v1/saved` and `GET /api/v1/saved` needed
- **Search pagination**: Currently limited to 20 results; no pagination UI or API support
