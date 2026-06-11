# REAL saved items verification 2026-06-10T21:32:00Z

## Marker

`REAL_attention_supervisor_20260610T211000Z`

## Implemented contracts

* Added `saved_items` persistence with account/member scope and uniqueness on `(account_id, item_type, item_id)`.
* Added public endpoints:
  * `GET /api/v1/saved`
  * `POST /api/v1/saved`
  * `DELETE /api/v1/saved/{id}`
  * `DELETE /api/v1/saved?itemType=...&itemId=...`
* Supported saved item types: `message`, `task`, `file`.
* Homepage Saved card renders real saved entries with source links.
* Chat message bookmark action now writes through `/api/v1/saved` and reloads saved state from the backend.

## API evidence

Saved marker message:

```json
{
  "created": true,
  "saved": {
    "itemType": "message",
    "itemId": "6c04ecc4-84b0-4479-8a3f-2fa69e383064",
    "href": "/chat/all?message=6c04ecc4-84b0-4479-8a3f-2fa69e383064"
  }
}
```

Duplicate save returned `created: false` with the existing saved item.

List response after browser save:

```json
{
  "count": 1,
  "saved": [
    {
      "id": "df728118-fc63-4dd7-ae7c-4467a972ddd8",
      "itemType": "message",
      "itemId": "6c04ecc4-84b0-4479-8a3f-2fa69e383064",
      "title": "REAL_attention_supervisor_20260610T211000Z searchable message marker for attention inbox search",
      "href": "/chat/all?message=6c04ecc4-84b0-4479-8a3f-2fa69e383064"
    }
  ]
}
```

Delete-by-target response during API smoke:

```json
{
  "removed": true,
  "id": "011bf115-9946-41f1-87e2-2d3a3a910b11"
}
```

## Browser evidence

Project WebDriver (`agent/daemon/webdriver/twd.py`) was used.

* `REAL_saved_items_20260610T213200Z-01-chat-saved-marker.png`
  * Browser opened `/chat/all?message=6c04ecc4-84b0-4479-8a3f-2fa69e383064`.
  * Clicked the target message's `Save message` button.
  * API list immediately showed one saved message row.
* `REAL_saved_items_20260610T213200Z-03-home-saved-marker-fixed.png`
  * Browser opened `/`.
  * DOM contained the saved marker in the Saved card.
* `REAL_saved_items_20260610T213200Z-04-saved-source-message.png`
  * Clicked the Saved card marker.
  * Browser landed on `/chat/all?message=6c04ecc4-84b0-4479-8a3f-2fa69e383064`.
  * DOM assertion returned `{ "hasMarker": true }`.

## Quality gates

* `python3 -m py_compile backend/models/slock.py backend/models/seed.py backend/routers/public_api.py`
* `npm run lint`
* `npm run build`

## Notes

Server-rendered homepage fetches must pass the current session token into `apiGet`; SSR fetches do not automatically forward browser cookies to the backend API.
