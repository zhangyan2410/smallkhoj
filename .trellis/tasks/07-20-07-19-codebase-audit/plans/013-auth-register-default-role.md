# Plan 013: Stop `/auth/register` & `/auth/login` granting owner role

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Touch only the files listed as scope. If any STOP condition
> occurs (especially the product-decision STOP in Step 1), stop immediately
> and report.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (changes the first-user bootstrap flow — needs operator sign-off on the new behavior)
- **Depends on**: `plans/001-pytest-baseline.md`
- **Category**: security
- **Planned at**: commit `47848e8`, 2026-07-19 (deferred from plan 002)

## Why this matters

`POST /api/v1/auth/register` and `/auth/login` both call
`_bootstrap_account(..., default_role="owner")` (public_api.py:488 and 553).
There is no password, no email verification, and no invitation check — the
only gate is the static `PUBLIC_API_KEY` (now settings-backed after plan
002, but still a single shared value).

Combined, anyone with the public key can become `owner` of the default
server and thereby admin-delete members, computers, channels, and mint new
API credentials. The "login" endpoint is functionally identical to
"register" — both upsert and mint a token.

The better-auth bridge (`/auth/better-auth/bridge`) is the intended auth
flow for real deployments. This legacy register/login path needs to either
be disabled in production or gated behind an existing-owner invitation.

## Current state

**`backend/routers/public_api.py:725-750`**:
```python
@router.post("/auth/register")
async def register(...):
    account, server, member, token = await _bootstrap_account(
        db, name=name, display_name=display_name,
    )
    ...

@router.post("/auth/login")
async def login(...):
    account, server, member, token = await _bootstrap_account(
        db, name=name, display_name=display_name,
    )
    ...
```

**`backend/routers/public_api.py:452-494`** — `_bootstrap_account` calls
`ensure_account_membership(..., default_role="owner")` at lines 488 and 553.

**`services/server_membership.py`** — `ensure_account_membership` creates a
`ServerMembership` row with the given role.

## Scope

**In scope**:
- `backend/routers/public_api.py` — `_bootstrap_account` signature + the two route handlers.
- New setting in `backend/config.py` if needed (see Step 1).
- New test: `backend/tests/test_auth_register_role.py`.

**Out of scope**:
- The better-auth bridge path — already fail-closed after plan 002.
- Password / email verification — out of scope; if you want real auth, use better-auth.
- Removing register/login entirely — Step 1 decision; do NOT remove without operator sign-off.

## Steps

### Step 1: Operator decision — which model?

**STOP here and get operator sign-off before proceeding.** Present three options:

**Option A — Member-by-default, first-user-promotes**: `default_role="member"`
for everyone. The first account on a fresh server is also a member; a
documented CLI / SQL command promotes the first user to owner. Safest; most
friction for fresh deploys.

**Option B — First-user-wins, then member**: the first account created on a
server with zero existing members becomes `owner`; every subsequent account
is `member`. Preserves the "fresh deploy just works" UX without leaving
owner open forever. Recommended.

**Option C — Disable register/login in production**: add a setting
`legacy_auth_enabled: bool = True`; when False, both endpoints return 503.
Operators use better-auth bridge exclusively.

**Verify**: operator picks A, B, or C. Record in `plans/README.md`. Do NOT
proceed without a decision.

### Step 2: Implement the chosen option

**If A**: change both `default_role="owner"` to `default_role="member"` in
`_bootstrap_account`. Document a promotion command in `AGENTS.md` or a new
`docs/operator-promotion.md` (e.g. `UPDATE server_memberships SET
role='owner' WHERE ...`).

**If B**: in `_bootstrap_account`, before calling
`ensure_account_membership`, check if any `ServerMembership` exists for the
target server. If none, role="owner"; else role="member". Race-safe via the
unique constraint on `(server_id, account_id)`.

**If C**: add `legacy_auth_enabled: bool = True` to `backend/config.py`; at
the top of `register` and `login`, `if not settings.legacy_auth_enabled:
raise HTTPException(503, "Legacy auth disabled; use better-auth bridge")`.

**Verify**: write `backend/tests/test_auth_register_role.py`:
- Option A: new account is `member`.
- Option B: first account on empty server is `owner`; second is `member`.
- Option C: with `legacy_auth_enabled=False`, both endpoints return 503.

Then: `cd backend && uv run pytest tests/test_auth_register_role.py -q` → pass.

### Step 3: Update existing tests if needed

`grep -rn 'default_role.*owner\|role.*owner' backend/tests/` — any test
asserting the old owner-by-default behavior needs updating to match the new
contract.

**Verify**: `cd backend && uv run pytest -q` → all pass.

## Done criteria

- [ ] Operator decision (A/B/C) recorded in `plans/README.md`.
- [ ] `grep -n 'default_role="owner"' backend/routers/public_api.py` returns
      matches only where Option B's first-user-wins logic explicitly grants owner.
- [ ] New `test_auth_register_role.py` exists and passes.
- [ ] `cd backend && uv run pytest -q` exits 0.
- [ ] If Option C: `legacy_auth_enabled` is in `backend/config.py` and documented in `.env.example`.

## STOP conditions

- Operator does not pick A/B/C — BLOCK, leave the finding open.
- Step 2 reveals that production deployments rely on register/login minting
  owner (e.g. bootstrap scripts) — report; those scripts need updating
  before this code ships.
- A test asserts the old behavior and cannot be updated without changing
  what it tests — report; discuss before editing.

## Maintenance notes

- **Option B is recommended** — it preserves fresh-deploy UX without leaving
  owner open. The first-user-wins check must be inside `_bootstrap_account`
  (not the route handler) so both register and login benefit.
- **The real fix is better-auth**: once the better-auth bridge is the only
  auth path used in production, these endpoints can be removed entirely.
  Until then, this plan is defense-in-depth.
- **Reviewer scrutiny**: confirm the first-user-wins check (Option B) is
  race-safe — two concurrent registers could both see "zero members." The
  unique constraint on `(server_id, account_id)` prevents duplicate
  memberships, but both could still get owner. Acceptable for a bootstrap
  path; document it.
