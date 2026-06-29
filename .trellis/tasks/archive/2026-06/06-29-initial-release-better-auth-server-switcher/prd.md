# Initial release Better Auth login and server switcher

## Goal

Replace the current thin local login/session behavior with a real Better Auth-backed login foundation, then use authenticated accounts to create and switch between real Servers for initial-release testing.

The user-visible outcome is simple: after login, each account has a default personal Server; the rail exposes a Server switcher; switching Server changes the active scope for channels, agents, computers, tasks, activity, memory, and future integrations.

This task intentionally makes multi-Server state reachable through the product. We should not rely only on database fixtures to test Server switching.

## Background

- The Server/account backend foundation already exists:
  - `ServerMembership` and `ServerInvite` models exist.
  - public human API routes can resolve active Server from `X-Server-Id`.
  - cross-Server access returns 403 when the account is not a member.
- The frontend currently sends `X-Public-Key` and `X-Account-Token`, but not `X-Server-Id`.
- `/api/v1/auth/me` currently returns one account/default Server/member shape, not all active Server memberships.
- The existing login is project-local and not mature enough for real two-Server product testing.
- Better Auth is a TypeScript auth library that fits the Next.js frontend layer. Official docs show:
  - a Next.js App Router integration using a route handler for `auth.handler`;
  - server-side session access through `auth.api.getSession`;
  - cookie-based session management;
  - database-backed user/session/account/verification storage with PostgreSQL support.
- Product decision on 2026-06-29: first pass uses Better Auth email/password only. GitHub/OAuth and WeChat scan login are follow-up login providers, not initial implementation blockers.

## Requirements

### Authentication

- Add Better Auth to the frontend auth layer for the initial release.
- Use a database-backed Better Auth configuration suitable for the deployed Postgres environment.
- Support basic email/password login/sign-up that is enough for real multi-account testing.
- Keep Better Auth session cookies as the primary browser login state.
- Bridge Better Auth users to the existing backend `Account`, `Member`, `Server`, and `ServerMembership` model.
- Preserve compatibility with existing backend auth requirements during the migration, or provide a deliberate cutover path.

### Default Server Provisioning

- On first successful login/sign-up, provision a personal Server for the Better Auth user if one does not already exist.
- Create an active `owner` membership and human `Member` in that Server.
- Re-login must be idempotent: the same Better Auth user must not create duplicate default Servers or duplicate owner memberships.

### Multi-Server Test Path

- Provide a minimal way for an authenticated user to create a second Server for testing.
- This is not a full Server management surface. The goal is to create real multi-Server state without database hand-editing.
- Creating a Server should:
  - create the Server;
  - create an owner membership for the current account;
  - create or associate the current user's human Member in that Server;
  - switch the UI to the new Server after success.

### Server Switcher UI

- Add a Server switcher to the main product shell, visually close to the left rail/account area.
- The switcher must show:
  - current account identity;
  - current active Server;
  - all Servers the account is an active member of;
  - role (`owner`, `admin`, `member`) in a secondary way;
  - a minimal `Create Server` entry.
- Switching Server must update global active Server state and refresh the current screen.
- The UI should follow SmallKhoj's product design system: calm, operational, readable, light-first, no Slock-style heavy black border/yellow clone.

### Active Server Request Scope

- All browser-side API helpers must include `X-Server-Id` when an active Server is selected.
- SSR fetches and Server Actions must include the same active Server.
- Realtime/public-event connections must subscribe or filter using the active Server where applicable.
- If a selected Server becomes invalid or forbidden, the frontend must clear that selection, fall back to the default/personal Server, and surface a clear permissions message.

### Scope Isolation

- Channels, agents, computers, tasks, saved items, memory, activity, and files shown in the UI must belong to the active Server.
- Creating new channels/agents/computers/tasks from the UI must create them in the active Server.
- Server A resources must not appear after switching to Server B, and vice versa.

### Testing And Evidence

- Unit/backend tests must prove:
  - Better Auth user bridge creates exactly one default personal Server;
  - creating a second Server creates a second active membership;
  - selecting Server A vs Server B scopes channels/agents/computers/tasks correctly.
- Frontend tests must prove:
  - active Server is persisted;
  - request helpers attach `X-Server-Id`;
  - invalid selected Server is handled gracefully.
- Real UI verification must use `./twd`:
  - login;
  - create second Server;
  - open switcher;
  - switch between two Servers;
  - confirm at least channels and computers are scoped to the active Server.

## Out Of Scope

- Full invite acceptance flow.
- Full Server settings page.
- Member management UI.
- GitHub/OAuth provider setup.
- WeChat scan login.
- Enterprise/team permission matrix.
- Paid email delivery, verification emails, password reset, or magic links for the first pass.
- Native/mobile authentication.

## Acceptance Criteria

- [x] Better Auth is installed and configured in the frontend with a documented database/session strategy.
- [x] Better Auth sign-up/login creates or resolves a backend `Account`.
- [x] First login creates exactly one personal Server, owner membership, and human Member for that account.
- [x] The same account can create a second Server through a product UI path.
- [x] `/auth/me` or an equivalent endpoint returns all active Server memberships required by the switcher.
- [x] ProductShell includes a visible Server switcher that lists the account's Servers and marks the active Server.
- [x] Switching Server persists active Server state and refreshes scoped product data.
- [x] Frontend `apiHeaders`, SSR fetches, Server Actions, and relevant realtime calls send the selected `X-Server-Id`.
- [x] Channel creation/read, Computer list, Agent list/create, Task list/create, and other core surfaces use the selected Server scope.
- [x] A real two-Server UI drill is captured with `./twd` evidence.
- [x] Existing foundation gates remain green after the auth/switcher migration.

## Final Validation Notes

- Real evidence uses two separate accounts: `青禾` and `竹影`.
- Each account has one default personal Server: `青禾的服务器` and `竹影的服务器`.
- Each Server has its own channel, Computer, and agent with short Chinese names for visual comparison.
- The same visible Computer name and `machineId` were used in both Servers. Current behavior is Server-scoped Computer identity: one `Computer` row per Server per machine.
- The validation agents were intentionally created with `autoStart: false`; runtime launch was not part of this drill.
- Runtime workspace defaults were tightened after validation: daemon-generated runtime directories are now scoped by `<serverId>/<computerId-or-machineId>/<workspaceId>` under the daemon workspace when the backend does not provide an explicit `workspacePath`.

## Open Questions

- Should Better Auth own auth tables in the frontend deployment database directly, or should the FastAPI backend expose a bridge endpoint that receives a verified Better Auth session and owns all SmallKhoj account writes?
