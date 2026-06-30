# Design

## Decision

Use the existing backend `ServerInvite` and `ServerMembership` models to implement invite-link acceptance. Keep mail delivery out of the first slice because the project currently has no email provider configuration and the auth spec warns against implying email sends without a real provider.

## Backend Flow

### Create Invite

`POST /api/v1/server-invites`

Auth:

- Existing public API key.
- Current account session.
- Active Server context from `X-Server-Id`.
- `require_admin_role(context.membership)`.

Request:

```json
{
  "role": "member",
  "invitedName": "optional display/email label",
  "expiresInDays": 14
}
```

Behavior:

1. Generate a high-entropy token such as `sk_invite_<urlsafe>`.
2. Store `sha256(token)` in `server_invites.token_hash`.
3. Store `server_id`, `role`, optional `invited_name`, `expires_at`, and `created_by`.
4. Return invite metadata plus a join URL built from the browser/public origin.

Response:

```json
{
  "invite": {
    "id": "...",
    "serverId": "...",
    "serverName": "...",
    "role": "member",
    "invitedName": "...",
    "expiresAt": "...",
    "joinUrl": "http://localhost:3000/join/sk_invite_..."
  }
}
```

The raw token appears only in `joinUrl` on create. Do not add a list endpoint that returns raw tokens.

### Inspect Invite

`GET /api/v1/server-invites/{token}`

Auth:

- Public API key.
- Account session optional for display, but accepting still requires login.

Behavior:

- Hash token and load active invite.
- Return Server name, role, expiry, and whether current account is already a member if logged in.
- Reject malformed/expired/revoked/accepted invites with readable 404/410-style errors.

### Accept Invite

`POST /api/v1/server-invites/{token}/accept`

Auth:

- Public API key.
- Current account session required.
- Do not resolve active Server context first; the accepting account is not yet a member of the invited Server.

Behavior:

1. Hash token and load invite.
2. Reject malformed, expired, revoked, or accepted invites.
3. Load invite Server.
4. Create/reuse a human `Member` in the invited Server for the accepting account.
5. Call `ensure_account_membership(..., default_role=invite.role)`.
6. Mark `accepted_at` and `accepted_account_id`.
7. Return the same account session shape as `/auth/me`, scoped to the invited Server.

## Frontend Flow

### Members Sidebar

Add an invite panel/button in the Members page sidebar below member counts:

- Show current Server name in small text.
- Show `Invite member` button for owner/admin. If membership role is not available client-side yet, let backend enforce and surface errors.

### Invite Dialog

Use the existing `Dialog` component.

State:

- `idle`: form fields and generate button.
- `created`: invite link field, copy button, close button.
- `error`: readable API error.

Controls:

- Email/name inputs can be present as labels only; copy must say manual sending.
- Link copy uses `navigator.clipboard.writeText`.
- No nested card styling inside the dialog.

### Join Route

Add `/join/[token]`:

- Server component checks `currentAccount()`.
- If logged out, redirect to `/login?returnTo=/join/<token>` once login supports return path, or show a login-required message with a link.
- If logged in, render invite details and a server action to accept.
- On accept, set active Server cookie to returned `server.id`, revalidate layout, redirect to `/members`.

## Data And Security Notes

- Raw invite token is bearer access to join a Server. Treat it like a secret.
- Store only token hash.
- Keep invite URL short enough to scan/copy.
- Default expiry should be bounded, e.g. 14 days.
- Avoid logging raw request path if app logs may include URL path; trace should redact if later added.

## UI Notes

The attached Raft-style screenshot is useful for interaction structure, not visual style. SmallKhoj should use its existing light-first product UI:

- familiar dialog with restrained primary button;
- copy button icon in the link row;
- no heavy pink primary action;
- no thick black brutalist modal beyond existing component vocabulary.
