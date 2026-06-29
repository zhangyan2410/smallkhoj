# Design

## Architecture Decision

Use Better Auth as the browser-facing authentication system in the Next.js frontend, but keep SmallKhoj product authorization and resource ownership in the FastAPI backend.

Better Auth answers: "Who is the logged-in browser user?"

FastAPI answers: "Which SmallKhoj Account, Server, Member, channel, Computer, Agent, and TaskRun can this user access?"

This split avoids rewriting the existing backend authorization model around Better Auth internals while still giving the frontend a real login/session system.

## Proposed Flow

1. User signs up or logs in through Better Auth in the Next.js app.
2. Next.js obtains the Better Auth session server-side.
3. Next.js calls a backend bridge endpoint with a server-trusted credential and Better Auth user identity.
4. Backend creates or resolves:
   - `Account` mapped to the Better Auth user;
   - default personal `Server`;
   - human `Member`;
   - owner `ServerMembership`.
5. Backend returns the SmallKhoj account/session shape plus active Server membership list.
6. Frontend stores:
   - Better Auth session cookie through Better Auth;
   - active Server ID in a small product cookie/local state.
7. All SmallKhoj public API requests include:
   - existing public key;
   - account/session bridge credential or backend session token during migration;
   - `X-Server-Id` for selected Server.

## Data Contracts

### Account Session

Extend the existing account session shape with memberships:

```ts
type AccountServerMembership = {
  server: {
    id: string
    name: string
  }
  member: {
    id: string
    displayName: string
    kind: string
  }
  role: "owner" | "admin" | "member"
  status: "active"
  isDefault: boolean
}

type AccountSession = {
  account: { id: string; name: string; displayName?: string | null }
  server: { id: string; name: string }
  member: Member
  memberships: AccountServerMembership[]
}
```

### Active Server

Use `X-Server-Id` as the product Server scope header. The backend already parses and validates this header for routes that use `_resolve_active_server_context`.

Frontend state should not be trusted. If the selected Server ID does not belong to the account, backend returns 403 and frontend clears the stale selection.

## UI Placement

Place the switcher in `ProductShell`, visually associated with the rail identity area. The switcher should be compact:

- current Server label;
- account display name/handle;
- dropdown/popover list of Servers;
- role/status text as secondary metadata;
- `Create Server` action at the bottom.

Use existing SmallKhoj design tokens and product component vocabulary. Do not clone the screenshot's black-border/yellow visual style.

## Testing Strategy

Use single-account multi-Server as the first real product drill:

1. Login/signup as one user.
2. Confirm default Server exists.
3. Create a second Server.
4. Create a channel or Computer-scoped fixture in Server A.
5. Switch to Server B and verify Server A resource disappears.
6. Create a Server B resource.
7. Switch back to Server A and verify isolation.

Multi-user invite testing remains a follow-up once invite acceptance UI exists.

## Risks

- Better Auth is TypeScript/Next-native while backend authorization is FastAPI. A clean bridge is required to avoid two divergent account systems.
- If Better Auth and FastAPI write to the same Postgres with separate migration systems, schema ownership must be explicit.
- Existing `X-Account-Token` is project-local. Migration must avoid breaking daemon/internal auth and public API smoke checks.
- SSR and client fetches can diverge if active Server is only stored in localStorage. Server Actions need cookie-readable active Server state.

## Rollback

- Keep existing backend account/session behavior available behind a compatibility path until Better Auth login and Server switcher pass the real two-Server drill.
- If Better Auth integration blocks initial release, keep the backend Server membership foundation and defer browser auth cutover while retaining a fixture-backed switcher test task.
