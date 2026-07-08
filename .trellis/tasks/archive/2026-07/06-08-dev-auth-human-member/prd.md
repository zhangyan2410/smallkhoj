# dev auth bootstrap for human member

## Goal

Add a minimal local account login/register flow so a fresh SmallKhoj database can bootstrap a real human identity without seed data. Registered/logged-in accounts should automatically have a server and a `Member(kind="human")` with stable name/id, letting real runtime tests create computers, channels, agents, tasks, DMs, and thread replies through product flows.

## What I already know

- The real runtime test is blocked because public UI/API still assumes a pre-seeded `zy-ean` member.
- The current database can already create/connect a computer through the product connect-ticket path.
- There is no full auth/user system yet.
- The project currently relies on `create_tables()` plus lightweight table/column backfills rather than Alembic migrations.
- Existing frontend calls use `X-Public-Key: sk_public_local`; this MVP can remain local/dev-only.

## Requirements

- Add a simplified account registration/login flow.
- Registration/login accepts a human-readable account/member name.
- Logging in automatically creates or selects a server.
- Logging in automatically creates or reuses the account's human member under that server.
- The human member must have a stable `id` and `display_name`/name.
- Frontend product actions should use the logged-in human as `creator`, `sender`, and `actor` instead of hardcoded `zy-ean`.
- Unauthenticated users should be sent to login/register before using the main product pages.
- Keep this as a minimal local auth bootstrap; do not build full organizations, password reset, RBAC, or production-grade security in this task.
- Do not use seed data to make the test pass.

## Acceptance Criteria

- [ ] Fresh/local DB can register a user and returns current account + server + human member.
- [ ] Login reuses the same account and member rather than creating duplicates.
- [ ] Creating a channel from the UI succeeds after login without seed data.
- [ ] Creating tasks/messages/DMs uses the logged-in member name instead of `zy-ean`.
- [ ] Existing computer connect flow still works and does not require an agent/human seed.
- [ ] Focused backend tests cover auth bootstrap and channel/task actor behavior where practical.

## Out of Scope

- Production password security, OAuth, multi-tenant server switching, invitations, billing, RBAC.
- Reworking agent API authentication.
- Replacing the public local API key model.

## Technical Notes

- Relevant files: `backend/models/slock.py`, `backend/models/seed.py`, `backend/routers/public_api.py`, `frontend/lib/control-plane.ts`, `frontend/app/page.tsx`, `frontend/app/chat/[channel]/channel-client.tsx`, `frontend/app/tasks/page.tsx`, `frontend/app/daemon/page.tsx`.
- Specs read: `.trellis/spec/backend/runtime-slock-integration.md`, `.trellis/spec/backend/threading-contracts.md`.
