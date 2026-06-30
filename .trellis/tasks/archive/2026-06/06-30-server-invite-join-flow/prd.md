# Server invite join flow

## Goal

Let a Server owner/admin invite another logged-in human account into the current Server, so the invited account can see the shared Server in the Server switcher and work inside that Server's channels, members, computers, agents, tasks, and future integration surfaces.

The immediate product gap is concrete: the existing Server switcher supports switching among Servers that already belong to the current account, and creating another Server for yourself, but there is no product path to join someone else's Server.

## Confirmed Facts

- Prior task `.trellis/tasks/archive/2026-06/06-29-initial-release-better-auth-server-switcher/` explicitly scoped invite acceptance out:
  - `design.md`: "Multi-user invite testing remains a follow-up once invite acceptance UI exists."
  - `prd.md`: "Full invite acceptance flow" and "Full Server settings page" are out of scope.
- Existing validation used two accounts with separate personal Servers, not one account joining the other's Server:
  - `青禾 -> 青禾的服务器`
  - `竹影 -> 竹影的服务器`
- Backend already has durable invite storage:
  - `ServerInvite` ORM model in `backend/models/slock.py`
  - `server_invites` startup DDL in `backend/models/seed.py`
  - unique `token_hash` index
  - role values `admin | member`
  - `accepted_at`, `accepted_account_id`, `revoked_at`, `expires_at`
- Backend already has Server membership helpers:
  - `ensure_account_membership(...)`
  - `list_account_memberships(...)`
  - `resolve_active_server_context(...)`
  - `require_admin_role(...)`
- Existing `POST /api/v1/servers` creates a new Server owned by the current account. It does not join an existing Server.
- Frontend Server switcher renders `session.memberships`; once invite acceptance creates an active membership, the joined Server should appear without a new switcher model.
- Frontend Members page already has:
  - a `ProductShell` sidebar for member facts;
  - global actions for create agent/computers/tasks;
  - project Dialog components via Base UI;
  - current SmallKhoj product styling, not the heavy black/pink Raft reference style.
- There is no configured product email delivery path. Existing auth spec says not to imply email sending or verification is active without a provider.

## Requirements

- **R1: Create invite link.** A Server owner/admin can create an invite for the current Server. The backend returns a join URL containing a raw invite token exactly once; the database stores only a hash.
- **R2: Link-first UI.** Members page sidebar exposes an "Invite member" / "邀请成员" action. The dialog shows an invite link with copy affordance. It may include email inputs for future compatibility, but the first release must not imply real emails are sent unless a provider exists.
- **R3: Accept invite.** A logged-in account opening the invite URL can accept it and become an active member of the invited Server.
- **R4: Server switcher integration.** After acceptance, `/api/v1/auth/me` includes the newly joined Server in `memberships`, and the UI can switch into it.
- **R5: Server-scoped human member.** Accepting an invite creates or reuses a human `Member` row in the invited Server for the accepting account.
- **R6: Authorization.** Creating invites requires owner/admin role in the current Server. Accepting an invite requires a logged-in account but must not require already being a member of that Server.
- **R7: Token safety.** Raw invite tokens must not be stored in plaintext, logged, or returned after creation/listing. Store `token_hash` only.
- **R8: Expiry/revocation fields.** Use existing `expires_at` and `revoked_at` fields. First UI may omit full management, but backend must reject expired/revoked/accepted invalid invites.
- **R9: Idempotency.** If an account accepts an invite for a Server it already belongs to, do not create a duplicate membership; return the existing active membership/session shape.
- **R10: Real validation.** Use backend tests for create/accept/invalid invite behavior and `./twd` evidence for the real browser path.

## Product Shape

Entry point:

- Members page sidebar, near the human/member counts.
- Button label: `邀请成员` / `Invite member`.

Dialog shape:

- Title: `邀请成员`
- Optional email input area for names/emails, clearly marked as "copy link to send manually" until mail delivery exists.
- Invite link row with copy button.
- Primary action: `生成邀请链接` if no link exists, then `复制邀请链接`.
- Secondary action: cancel/close.

Accept shape:

- Route: `/join/<token>` or `/join?token=<token>`.
- If not logged in, send the user through login and preserve the invite token.
- If logged in, show Server name and role, then accept.
- After accept, set active Server to the joined Server and redirect to `/members` or home in that Server.

## Acceptance Criteria

- [ ] Owner/admin can create an invite for the active Server through an API.
- [ ] Member role invites are supported; admin role may be backend-supported but UI can default to member.
- [ ] Non-admin/non-owner cannot create an invite.
- [ ] Invite creation returns a join URL and does not expose raw token again from storage.
- [ ] Accepting a valid invite as a different account creates an active `ServerMembership`.
- [ ] Accepting a valid invite creates/reuses a human `Member` in the invited Server.
- [ ] Accepting a valid invite marks `accepted_at` and `accepted_account_id`.
- [ ] Expired, revoked, malformed, or already-consumed invite tokens are rejected with readable errors.
- [ ] Re-accepting as an already joined account is idempotent and does not duplicate membership.
- [ ] After accept, `/api/v1/auth/me` returns the invited Server in `memberships`.
- [ ] Members page sidebar includes a visible invite action and dialog.
- [ ] Browser flow with two accounts is verified by `./twd`: account A creates link, account B accepts, account B switcher shows account A's Server.

## Out Of Scope

- Real outbound email delivery.
- Email domain verification, SMTP/SES/SendGrid/Postmark setup, or paid mail provider integration.
- Full Server settings page.
- Full member role management UI.
- Invite list/revoke UI, unless needed as a small debug aid.
- Enterprise permission matrix.

## Open Question

- Should the first implementation strictly be link-only, or should the dialog collect email addresses and create named invite records without sending mail?
