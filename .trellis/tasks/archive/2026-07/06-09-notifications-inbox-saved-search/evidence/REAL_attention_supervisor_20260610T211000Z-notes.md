# REAL attention supervisor verification 2026-06-10T21:10:00Z

## Marker

`REAL_attention_supervisor_20260610T211000Z`

## Changes verified

* Added `GET /api/v1/search` to the public API for messages, tasks, members, channels, and files.
* Search results include actionable `href` values:
  * message -> `/chat/all?message=6c04ecc4-84b0-4479-8a3f-2fa69e383064`
  * file -> `/api/v1/attachments/b074ee9f-a8ab-4f01-8fb7-ae23a7a83584/download`
* Homepage search consumes `/api/v1/search` instead of only filtering SSR channel/member/task lists.
* Activity Inbox shows All/Messages filters and explicitly disabled Unread/Mentions controls with backend-gap titles.
* Saved surface now documents the missing saved-items persistence API instead of implying bookmarks already work.

## API evidence

Created marker message in `#all`:

* message id: `6c04ecc4-84b0-4479-8a3f-2fa69e383064`
* short id: `822c0fa0`
* content: `REAL_attention_supervisor_20260610T211000Z searchable message marker for attention inbox search`

Uploaded marker file:

* file id: `b074ee9f-a8ab-4f01-8fb7-ae23a7a83584`
* filename: `REAL_attention_supervisor_20260610T211000Z.txt`
* download URL: `/api/v1/attachments/b074ee9f-a8ab-4f01-8fb7-ae23a7a83584/download`

Search response:

```json
{
  "count": 2,
  "results": [
    {
      "type": "message",
      "href": "/chat/all?message=6c04ecc4-84b0-4479-8a3f-2fa69e383064",
      "channel": "#all"
    },
    {
      "type": "file",
      "href": "/api/v1/attachments/b074ee9f-a8ab-4f01-8fb7-ae23a7a83584/download",
      "channel": "#all"
    }
  ]
}
```

## Browser evidence

Project WebDriver (`agent/daemon/webdriver/twd.py`) was used, not Playwright.

* `REAL_attention_supervisor_20260610T211000Z-03-search-results-visible.png`
  * `/` with `?q=REAL_attention_supervisor_20260610T211000Z`
  * DOM contained `Results (2)`, the marker message, and the marker file.
* `REAL_attention_supervisor_20260610T211000Z-04-source-chat-message.png`
  * clicked the message result and landed on `/chat/all?message=6c04ecc4-84b0-4479-8a3f-2fa69e383064`
  * DOM assertion returned `{ "hasMarker": true, "messageNode": true }`.

## Quality gates

* `python3 -m py_compile backend/routers/public_api.py` passed.
* `npm run lint` passed.
* `npm run build` passed.

## Remaining gap

Saved-items persistence is not implemented in this slice. The UI now exposes this honestly as a backend follow-up requirement for:

* `POST /api/v1/saved`
* `GET /api/v1/saved`

Because the saved-items API does not exist yet, the PRD checkbox "Saved items surface shows saved marker message/task" remains incomplete.
