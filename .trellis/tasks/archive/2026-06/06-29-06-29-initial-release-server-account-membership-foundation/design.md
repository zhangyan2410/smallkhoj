# Server/account membership foundation design

## Current State

SmallKhoj already has a `Server` table and most core records are server-scoped with `server_id`: `Member`, `Computer`, `Channel`, `Task`, `EventRecord`, `ApiKey`, integration gateway records, files, reminders, memory, and saved items.

The missing layer is product/account semantics:

- `public_api._ensure_server()` creates or returns a single default Server.
- `_bootstrap_account()` currently attaches every account to that default Server.
- many authenticated public API routes call `_get_server()` and therefore select the first/default Server rather than an active Server tied to the current account/session.
- `Account` has a single `server_id` and `member_id`, so it cannot represent one user belonging to multiple Servers.
- daemon and agent APIs are better scoped already because connect tickets, machine tokens, members, and computers carry `server_id`.

## Recommended Direction

Treat `Server` as the team/workspace boundary. Add membership semantics around it instead of adding another workspace abstraction.

Recommended model additions:

- `server_memberships`
  - `server_id`
  - `account_id`
  - `member_id`
  - `role`: `owner | admin | member`
  - `status`: `active | invited | disabled`
  - timestamps
- `server_invites`
  - `server_id`
  - `token_hash`
  - `role`
  - optional `channel_id`
  - optional invited display/email/name field if needed later
  - expiry/revoked/accepted timestamps
- session active Server
  - simple first version: cookie/header `X-Server-Id` or session metadata, validated against `server_memberships`
  - compatibility: if account has exactly one membership, select it automatically

Keep existing `Account.server_id/member_id` as a compatibility mirror for the primary/default membership until migration is complete. Do not remove it in the first slice.

## API Shape

Minimum API surface:

- `GET /api/v1/servers`
  - list Servers current account belongs to
- `POST /api/v1/servers`
  - create Server and owner membership
- `POST /api/v1/servers/join`
  - join through invite token
- `GET /api/v1/servers/current`
  - current active Server and member role
- `POST /api/v1/servers/current`
  - select active Server for the session
- `POST /api/v1/servers/{serverId}/invites`
  - owner/admin creates invite
- `POST /api/v1/servers/{serverId}/channels/{channelId}/members`
  - add member to private channel, admin/owner path

Then migrate existing Server-scoped routes to resolve Server from authenticated account + active Server, not from `_get_server()`.

## Frontend Shape

Initial release UI should stay simple:

1. Login.
2. If account has no Server memberships:
   - show "Create Server" and "Join Server" choices.
3. If account has one Server:
   - enter it directly.
4. If account has multiple Servers:
   - show a lightweight Server switcher.
5. Inside Server:
   - channels/chat;
   - members;
   - computers;
   - agents;
   - integration/readiness pages.

Do not build a full organization admin product yet. The first slice is membership correctness plus a visible Server context.

## Permissions

Initial roles:

- `owner`: create invites, create Computers, create Agents, manage channels, manage integrations.
- `admin`: same as owner except destructive Server-level operations.
- `member`: chat in visible/joined channels, see assigned tasks, create messages.

Computer connect and Agent creation should require owner/admin for the first release. This avoids untrusted users registering machines into someone else's Server.

## Migration

For existing data:

1. Ensure current default/deployed Server remains unchanged.
2. For each existing `Account`, create one `server_membership` using its current `server_id/member_id`.
3. First existing account on the deployed Server can be `owner`; later accounts can be `member` unless explicitly promoted.
4. Keep `Account.server_id/member_id` populated for compatibility.

## Capacity

The current 4C4G Lighthouse is suitable for initial small-team chat/control-plane usage:

- current core stack uses under 350 MiB across backend/frontend/db/caddy containers at idle/light smoke;
- host has about 2.4 GiB available memory and 26 GiB disk free;
- current DB is tiny.

Operational constraints:

- keep model inference and heavy agent runtime off-host;
- avoid server-side builds;
- cap upload sizes and message/page limits;
- add retention/cleanup for event logs, task evidence, Docker build cache, and uploaded files;
- monitor Postgres disk growth once real conversations begin.

## Risks

- If public routes continue to use default `_get_server()`, cross-account data leakage becomes likely once more than one Server exists.
- If `Account` remains single-server only, future join/switch flows will require rework.
- If invites are channel-only without Server membership, users can enter channels without a durable permission boundary.
- If Computers are globally unique instead of per Server, one physical machine used by two teams will collide incorrectly.
