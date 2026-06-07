# Frontend Protocol Interactions And Clean E2E Data

## Goal

Make the frontend a usable control surface for the backend protocol set, so human users can exercise the important public and agent-control workflows from the browser instead of relying on curl, Slock CLI, or hidden test paths. Also keep the local database usable for manual review by removing stale `e2e-*` test data.

## What I Already Know

* The user saw the Computers page form fail to create a computer.
* Browser/network reproduction showed the form submitted as native `GET /computers?name=...`; no `POST /api/v1/computers/credential` was sent.
* Direct backend `POST /api/v1/computers/credential` works and creates a computer plus machine api key.
* Current frontend pages include home, chat, daemon, members, tasks, computers, and settings.
* Backend public API currently exposes channels, messages, tasks, computers, activity, files, reminders, members, computer credentials, agent creation, channel membership, and DM creation.
* Backend agent API exposes daemon registration/heartbeat, send/history/search/events, reactions, tasks, channel join/leave, threads, reminders, upload/attachments, profile/avatar, integrations, activity, and heartbeat.
* Local database e2e cleanup was completed on 2026-06-06: removed `e2e-*` computers, members, channels, messages, tasks, workspaces, api keys, activity/event records, and related join rows.

## Assumptions

* The first implementation pass should prioritize browser interaction for backend protocols that a human supervisor needs during development and manual testing.
* Agent-only API surfaces should be visible and testable where useful, but the UI should not turn into a raw Swagger clone.
* The Computers credential form/hydration issue is in scope because it blocks an existing frontend interaction.

## Open Questions

* Resolved: this task focuses implementation on `/api/v1/*` public supervisor workflows first. `/internal/agent-api/*` should be covered by a route-to-UI matrix and lightweight diagnostic/read-only surfaces where useful, but full agent CLI parity is out of scope for this pass.

## Requirements

* Treat the PRD as complete enough for implementation; refine scope only when route audit reveals a concrete missing public supervisor workflow.
* Fix the Computers page credential generation flow so clicking the button sends the backend `POST /api/v1/computers/credential`, renders the generated command/key, and refreshes or clearly exposes the new computer state.
* Add frontend interactions for important public backend protocols that are currently missing or incomplete:
  * Reminders: list, create, update/cancel.
  * Files/attachments: list and inspect/download where supported.
  * Activity: browse recent activity with useful filters.
  * Channel membership: add/remove members from channels.
  * DM creation and navigation.
  * Member profile/status/action edits where backend supports PATCH.
* Audit existing pages against backend routes so each supported protocol has either a real UI control, a read-only diagnostic view, or an explicit out-of-scope note in the task.
* Keep interactions resilient: show pending, success, and error states instead of silent failures.
* Avoid generating new `e2e-*` manual review clutter unless a test explicitly owns and cleans it up.

## Acceptance Criteria

* [x] Computers credential generation works from the browser and is covered by a Playwright smoke check.
* [x] A route-to-UI coverage matrix exists in the task notes, mapping backend protocols to frontend interaction surfaces.
* [x] Missing high-priority public API interactions have usable controls for Computers, Tasks, Reminders, Members, Files metadata, Activity, Channel membership, and DM creation.
* [x] Database cleanup remains verified: local `e2e` rows are absent after cleanup, and smoke-test `codex-ui-*` data was removed after verification.
* [x] Frontend lint/typecheck and relevant browser smoke checks pass.

## Definition Of Done

* Tests added or updated for fixed/added interactions.
* Lint/typecheck pass for frontend changes.
* Any backend contract assumptions are documented in the route-to-UI coverage matrix.
* Manual browser smoke test verifies the key workflows against the local backend.

## Out Of Scope

* Redesigning the entire product shell or creating a marketing landing page.
* Replacing Swagger/OpenAPI docs.
* Implementing backend protocol changes unless a frontend workflow exposes a confirmed backend bug.

## Technical Notes

* Likely frontend files:
  * `frontend/app/computers/connect-computer-form.tsx`
  * `frontend/app/computers/page.tsx`
  * `frontend/app/daemon/page.tsx`
  * `frontend/app/members/page.tsx`
  * `frontend/app/tasks/page.tsx`
  * `frontend/app/chat/[channel]/page.tsx`
  * `frontend/lib/control-plane.ts`
* Backend route sources:
  * `backend/routers/public_api.py`
  * `backend/routers/agent_api.py`
* Database cleanup verification after deletion:
  * `computers`, `members`, `channels`, `messages`, and `tasks` all returned count `0` for `%e2e%` matches.
  * `GET /api/v1/computers` returned only `Mac-mini.local`.
* Implementation notes:
  * `frontend/app/computers/connect-computer-form.tsx` was converted from a client-only submit handler to a server-action form so it works without relying on hydration.
  * Generated machine credentials are passed back via short-lived httpOnly cookie and `?created=1`, avoiding api key leakage in the URL.
  * `frontend/app/tasks/page.tsx` now supports task create/update interactions.
  * `frontend/app/daemon/page.tsx` now supports reminder cancellation and includes an expanded API surface matrix.
  * See `protocol-ui-matrix.md` for route coverage.
* Verification:
  * `npm run lint`
  * `npx tsc --noEmit`
  * Playwright smoke: create computer credential, create task, assert no credential secret in URL, render `/computers`, `/tasks`, and `/daemon`.
