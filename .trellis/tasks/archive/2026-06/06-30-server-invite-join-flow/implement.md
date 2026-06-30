# Implementation Plan

## Phase 1: Backend Invite Service And Tests

1. [x] Add invite token helpers in `services/server_membership.py` or a focused `services/server_invites.py`.
2. [x] Add backend tests first in `backend/tests/test_server_account_membership.py`:
   - owner/admin creates invite and stores token hash;
   - member cannot create invite;
   - accept valid invite creates active membership and human member;
   - accept invalid/expired/revoked/accepted invite fails;
   - already-member accept is idempotent.
3. [x] Add public API routes in `backend/routers/public_api.py`:
   - `POST /api/v1/server-invites`
   - `GET /api/v1/server-invites/{token}`
   - `POST /api/v1/server-invites/{token}/accept`
4. [x] Keep startup DDL unchanged unless tests expose missing columns/indexes.

## Phase 2: Frontend Join And Invite UI

1. [x] Add frontend types for invite responses in `frontend/lib/control-plane.ts`.
2. [x] Add `InviteMemberDialog` client component for Members sidebar.
3. [x] Add server actions for accepting invite and setting active Server cookie.
4. [x] Add `/join/[token]` page.
5. [x] Add copy strings to `frontend/messages/zh-CN.json` and `frontend/messages/en.json`.
6. [x] Add tests for:
   - server action uses returned Server id as active Server;
   - invite dialog has link-only/manual-send copy and no false email-send promise.

## Phase 3: Real Validation

1. [x] Start backend/frontend in the local test mode used by current scripts.
2. [x] Use `./twd`:
   - account A logs in;
   - opens Members page;
   - opens invite dialog;
   - generates invite link;
   - account B logs in or signs up;
   - opens join link;
   - accepts invite;
   - Server switcher shows account A's Server;
   - account B can switch into account A's Server and see shared members.
3. [x] Save screenshots/snapshots under this task's `evidence/`.

Evidence:

- Browser screenshot: `evidence/REAL_server_invite_join_202606301104.png`
- Owner invite-link screenshot: `evidence/REAL_owner_invite_link_202606301119.png`
- UI flow used two accounts: `青禾 -> 青禾的服务器`, `竹影 -> 竹影的服务器`.
- After accepting the invite, `竹影` was redirected to `/members`, active Server cookie became `青禾的服务器`, and `/auth/me` returned both memberships.
- Follow-up live check on current code:
  - `竹影` as a `member` of `青禾的服务器` does not see the invite action.
  - `竹影` as `owner` of `竹影的服务器` sees `邀请成员`, opens the dialog, sees the manual-copy/no-email copy, and generates a `http://localhost:3000/join/sk_invite_...` link with no UI error.

## Validation Commands

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_server_account_membership.py -q  # 26 passed
rtk npx tsx --test test/runtime-url.test.ts test/server-auth-render-safety.test.ts test/server-switcher-state.test.ts test/server-invite-flow.test.ts  # 16 passed
rtk npm run lint  # passed
rtk env BETTER_AUTH_SECRET=sk_build_secret_1234567890_min_32_chars BETTER_AUTH_URL=http://localhost:3000 BETTER_AUTH_DATABASE_URL=postgresql://smallkhoj:smallkhoj@localhost:5432/smallkhoj AUTH_BRIDGE_SECRET=sk_bridge_build_min_32_chars npm run build  # passed
rtk ./twd --compact eval --url-match localhost:3000/members "<member-role invite visibility check>"  # invite hidden for non-admin member
rtk ./twd --compact eval --url-match localhost:3000/members "<owner invite link check>"  # invite link generated for owner/admin path
rtk ./twd screenshot --url-match localhost:3000/members .trellis/tasks/06-30-server-invite-join-flow/evidence/REAL_owner_invite_link_202606301119.png
```

## Risks

- Login return path may not preserve `/join/<token>` yet. If absent, first implementation can show "log in, then reopen this link" while recording return-path follow-up.
- Email inputs can mislead users if they imply delivery. Copy must say the link should be sent manually until a mail provider exists.
- Accepted invite links are single-use in this design. If reusable team invite links are wanted, that is a separate product decision.
