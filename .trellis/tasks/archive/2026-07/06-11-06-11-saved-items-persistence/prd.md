# saved items persistence endpoint

## Goal

Implement real saved/bookmarked item persistence so the attention layer can show saved messages, tasks, and files instead of a backend-gap placeholder.

## Requirements

* Add authenticated public endpoints for saved items:
  * `POST /api/v1/saved`
  * `GET /api/v1/saved`
  * `DELETE /api/v1/saved/{id}` or equivalent unsave route.
* Support saving at least messages, tasks, and files.
* Return enough source context for each saved item to open the original message/task/file.
* Make saved state account/member scoped.
* Update the homepage Saved card to render real saved entries.
* Add save/unsave actions from the relevant product surfaces where already designed.

## Acceptance Criteria

* [x] A real marker message can be saved through the UI or API.
* [x] `/` Saved surface shows the marker.
* [x] Clicking the saved marker opens the original source context.
* [x] Saved state persists after page reload.
* [x] Duplicate saves are idempotent or return a clear conflict.
* [x] Project WebDriver evidence and API evidence are stored under `evidence/`.

## Parent Gap

This is the backend follow-up for `.trellis/tasks/06-09-notifications-inbox-saved-search/prd.md`, where global search and source-opening are verified but saved-items persistence is intentionally left incomplete.
