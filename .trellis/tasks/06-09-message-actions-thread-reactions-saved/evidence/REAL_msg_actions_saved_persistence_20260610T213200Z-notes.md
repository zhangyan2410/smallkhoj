# Message actions saved persistence update 2026-06-10T21:32:00Z

## What changed after prior reviewer packets

Older evidence correctly flagged two backend gaps:

* Save/bookmark was local React state only.
* Browser reaction auth needed public session endpoints.

Current state:

* Public reaction endpoints exist under `POST/DELETE /api/v1/messages/{message_ref}/reactions`.
* Saved/bookmark state is persisted through `POST /api/v1/saved`, `GET /api/v1/saved`, and delete routes.
* Chat bookmark button now writes through the saved-items API and reloads backend saved state.
* Homepage Saved surface renders persisted saved messages and opens the source context.

## Evidence references

* Saved persistence API/browser proof:
  `.trellis/tasks/06-11-06-11-saved-items-persistence/evidence/REAL_saved_items_20260610T213200Z-notes.md`
* Search/source proof:
  `.trellis/tasks/06-09-notifications-inbox-saved-search/evidence/REAL_attention_supervisor_20260610T211000Z-notes.md`
* Earlier message action proof:
  `.trellis/tasks/06-09-message-actions-thread-reactions-saved/evidence/REAL_msg_actions_20260610T191011Z-notes.md`

## Current verdict

PASS for the PRD acceptance criteria. The remaining "copy menu" idea is not in the acceptance checklist; the current copy button exists and was previously exercised.
