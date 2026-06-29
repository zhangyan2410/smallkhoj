# Initial release server account membership foundation

## Goal

Introduce the product-level Server/account membership foundation so a user owns or joins a server, creates Computers and Agents inside that server, and invites other humans into channels for chat.

This is now a release-critical foundation because Feishu/Jira integrations should not be the first way humans enter SmallKhoj. A team needs a durable server/workspace boundary first: one account can create or join a Server, add Computers and Agents to that Server, invite other humans, and then talk in Server channels.

## Requirements

- Reuse the existing `Server` model as the product-level workspace/team boundary. Do not introduce a parallel workspace concept for the same scope.
- Replace the current "single default server" product assumption with explicit server ownership/membership in API and UI flows.
- A first account can create a Server during onboarding/login when no Server membership exists.
- A user can join an existing Server through an invite or join token without creating a duplicate Server.
- Accounts must be able to list their Server memberships and select the active Server.
- Server-scoped resources must remain scoped to the selected Server:
  - channels and messages;
  - human members and agent members;
  - Computers and daemon connect tickets;
  - AgentWorkspaces and runtime/provider state;
  - tasks, TaskRuns, files, reminders, memory, saved items, API keys, and integration connectors/routes/events.
- Server owners/admins can invite humans into the Server and optionally add them to channels.
- Channel membership should determine who sees private channels; public Server channels can be visible to all Server members.
- Computer creation/connect must happen inside the selected Server. A physical computer identity is unique per Server, not globally across all users.
- Agent creation must happen inside the selected Server and can be bound to a Computer in that Server.
- Existing single-server local/dev behavior must keep working through a compatibility path until the UI is migrated.
- The first release can support one active Server per browser session; multi-server switching can be simple but must not corrupt resource scope.
- The design must keep Feishu/Jira connectors and routes under the selected Server so later external integrations map to the correct team/channel.
- The implementation must include migration/seed behavior for the existing deployed Server and account so current data remains usable.
- The first implementation should avoid password/email complexity if not required for the initial release; current name/session-token auth can be hardened later, but the Server boundary must be correct now.

## Acceptance Criteria

- [x] Existing deployed data remains under the current Server and current account after migration.
- [x] A logged-in account can see its Server membership and active Server.
- [x] A new account can create or switch to real Servers for release testing without database hand edits.
- [x] A Server owner/admin can create a Computer connect command for that Server.
- [x] A Server owner/admin can create an Agent in that Server and optionally bind it to a Server Computer.
- [x] A Server member can enter a Server channel and send/read messages scoped to that Server.
- [x] Private channel membership prevents non-members from reading or posting to that channel.
- [x] Public APIs no longer rely on `_get_server()` selecting the first/default Server for authenticated human operations when an active Server is available.
- [x] Daemon connect/register keeps using the Server from its connect ticket or machine token and does not cross Server boundaries.
- [x] Frontend login/onboarding shows the Server context clearly enough that users understand the active Server and can create/switch Servers.
- [x] Tests cover account -> Server membership, active Server scoping, channel access, Computer connect command scoping, Agent creation scoping, and Better Auth bridge/default Server behavior.
- [x] Deployment smoke for the current Tencent Cloud host still passes after the migration.
- [x] Full invite acceptance is explicitly deferred out of the initial release login/server-switcher scope rather than treated as a hidden blocker.

## Deferred Invite/Join Scope

The original PRD included "new account joins an existing Server through an invite/join token" as an acceptance item. That has been narrowed for the 07-15 initial release after the Better Auth/server-switcher task:

- The release-critical Server foundation is now: real login, personal Server provisioning, real second-Server creation, active Server switching, scoped API requests, scoped channel/member/computer/task data, and owner/admin gating.
- Full invite acceptance flow remains out of scope for the completed Better Auth task and is not required to prove the initial Feishu/Jira release loop.
- The database foundation still reserves `server_invites`; a future Server admin/invite task should add create-invite, accept-invite, optional channel assignment, expiry/revocation UI, and email/scan-provider interaction once the core release loop is stable.

## Capacity Question

The current Tencent Cloud Lighthouse target is 4 vCPU / 4 GB RAM / 40 GB SSD. Current deployed baseline on 2026-06-29:

- database counts: 1 Server, 1 Account, 3 Members, 1 Computer, 1 Channel, 0 Messages, 2 Events;
- container memory: backend about 118 MiB, frontend about 125 MiB, Postgres about 41 MiB, Caddy about 15 MiB;
- host memory: 3.3 GiB total, about 2.4 GiB available, 3 GiB swap configured and nearly unused;
- disk: 40 GiB root, about 26 GiB available.

Capacity conclusion for this task:

- The current server should comfortably handle early human chat, channel membership, and control-plane state for a small initial team.
- The risk is not ordinary chat volume; the risk is agent/runtime workload, large file uploads, heavy logs/evidence, server-side builds, and many concurrent WebSocket/SSE clients.
- Keep runtime execution and model inference off this server for the initial release. Treat it as the control plane, Postgres, frontend, backend, Caddy, and light integration-worker host.
- Add basic limits before inviting broader users: message page size, SSE/WebSocket heartbeat hygiene, file upload size, log retention, Docker image/cache cleanup, and DB backup.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
- Backend foundation progress on 2026-06-29: `backend/tests/test_server_account_membership.py` covers membership metadata, seed backfill, active Server rejection for non-members, private channel rejection, cross-Server Computer scoping, Better Auth bootstrap/bridge behavior, and static migration of key human public routes away from `_get_server()`.
- Product Server switching progress on 2026-06-29 lives in `.trellis/tasks/06-29-initial-release-better-auth-server-switcher/`: Better Auth email/password login, default personal Server provisioning, create-second-Server UI, active Server switcher, `X-Server-Id` propagation, and real two-account/two-Server browser evidence. GitHub/OAuth, WeChat scan login, and full invite acceptance remain follow-up login/provider/admin work.
