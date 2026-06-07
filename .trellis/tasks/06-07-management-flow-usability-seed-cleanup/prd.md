# Management Flow Usability And Seed Cleanup

## Goal

Make the current management flow usable enough for manual testing before adding new runtime-provider features. Channel member add and DM messaging must be diagnosed, current/manual/test data should be cleaned up, and startup seed data should stop polluting the review database.

## What I Already Know

* User tested the full flow and saw:
  * channel add member is not successful.
  * DM message does not return/show a reply.
  * default data created on startup is undesirable for current manual review.
* There is an existing active task `06-06-frontend-protocol-interactions-and-clean-e2e-data` that claims channel membership and DM creation UI are covered, but it still has uncommitted WIP files.
* Provider selection task `06-07-agent-runtime-provider-selection` is planning only and should wait until the basic flow works.
* Current local backend is running on `8000`, frontend on `3000`, with database on `55432`.

## Requirements

* Diagnose whether channel add member and DM messaging are failing because:
  * frontend WIP is incomplete,
  * backend API behavior is missing/buggy,
  * dirty local data/seed data is confusing the flow,
  * or a combination.
* Clean current local database of user-created/manual/test/default seed data requested by the user.
* Change startup seeding so manual review does not get default computers/agents/channels/tasks/messages unless explicitly requested.
* Ensure future tests create uniquely named test data and clean it up.
* Decide and report whether to fix current usability bugs before implementing runtime provider selection.

## Acceptance Criteria

* [x] Database cleanup removes current/manual/test/default data while preserving the schema and minimal server row needed for APIs.
* [x] Startup no longer recreates unwanted demo data by default.
* [x] Channel add member failure has a concrete root cause and recommended fix path.
* [x] DM message/reply failure has a concrete root cause and recommended fix path.
* [x] Recommendation is clear: fix current flow first vs implement provider selection first.

## Result

* Local database on `localhost:55432` is clean: only the default `zy-ean` human remains; channels, computers, agents, messages, tasks, activity/events, API keys, connect tickets, and workspaces are empty.
* Default startup seed now keeps only the minimal server/human baseline. Demo agents/channels/messages/tasks are opt-in via `SMALLKHOJ_SEED_DEMO=1`.
* Channel member add root cause was frontend client state/submission plus a Next dev origin hydration trap. The chat page now uses a client component with explicit client API writes and refreshes.
* DM message/reply path works in the verified browser management flow.
* Recommendation: keep provider selection paused until this basic flow fix lands.

## Out Of Scope

* Runtime provider dropdown implementation.
* Broad UI redesign.
* Production migration strategy beyond local dev/test cleanup.

## Technical Notes

* Likely files:
  * `backend/models/seed.py`
  * `backend/routers/public_api.py`
  * `frontend/app/chat/[channel]/page.tsx`
  * `frontend/app/chat/[channel]/channel-client.tsx`
  * `e2e/management-flow.spec.ts`
* Existing WIP task to compare: `.trellis/tasks/06-06-frontend-protocol-interactions-and-clean-e2e-data/prd.md`.
