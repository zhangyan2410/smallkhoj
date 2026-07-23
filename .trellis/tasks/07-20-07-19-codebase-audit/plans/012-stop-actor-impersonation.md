# Plan 012: Stop `_resolve_human_actor` impersonation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Touch only the files listed as scope. If any STOP condition
> occurs, stop immediately and report. Do not improvise. When done, update
> the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 47848e8..HEAD -- backend/routers/public_api.py`
> If public_api.py changed since this plan was written (other than the
> plan-001/002 changes already in main when you start), compare "Current
> state" excerpts against live code.

## Status

- **Priority**: P1
- **Effort**: M (a day-ish)
- **Risk**: MED (many call sites rely on the override for legitimate bot/system actors)
- **Depends on**: `plans/001-pytest-baseline.md`, `plans/002-p1-security-batch.md` (002 sets the security baseline; this continues it)
- **Category**: security
- **Planned at**: commit `47848e8`, 2026-07-19 (deferred from plan 002's out-of-scope list)

## Why this matters

Many mutating endpoints accept an `actor` / `sender` / `creator` field in
the request body and use it to attribute the resulting activity. The helper
`_resolve_human_actor(..., explicit_name, ...)` calls `_ensure_human_member`
which looks up-or-creates a Member by display name — **without verifying
the caller's identity matches**. So any authenticated user can post
messages, react, update tasks, delete channels, or upload files "as" any
other human member of the same server.

The memory write path already does the right thing:
`_ensure_memory_actor_matches_viewer` (public_api.py:606) checks that the
body's `actor` matches the current viewer. Every other endpoint does not.

The fix applies the same viewer-match check to every `_resolve_human_actor`
call site, with a documented escape hatch for admin roles (who legitimately
need to attribute actions to other members, e.g. a supervisor correcting an
agent's record).

## Current state

**`backend/routers/public_api.py:323-346`** — `_ensure_human_member`:
looks up or creates a Member by `display_name`; no identity check.

**`backend/routers/public_api.py:564-599`** — `_resolve_human_actor`:
```python
async def _resolve_human_actor(
    db: AsyncSession, server: Server, request: Request,
    explicit_name: str | None, *, role: str,
) -> Member:
    ...
    if explicit_name:
        return await _ensure_human_member(db, server, explicit_name)   # <-- impersonation
    ...
```

**`backend/routers/public_api.py:606`** — the correct pattern, already used by memory:
```python
def _ensure_memory_actor_matches_viewer(body: dict, viewer: Member) -> None:
    ...
```
Called at lines 2685, 2707, 2745, 2775 (memory routes).

**~10 vulnerable call sites** that pass `body.get("actor")` / `sender` /
`creator` into `_resolve_human_actor`:
- 1959 `create_channel_message` (`body.get("sender")`)
- 2069, 2123 message reactions
- 2543 create_task_assignment
- 2871 task memory requester
- 2902 task creator
- 3048 update_task actor
- 3598 update_member actor (now admin-gated by plan 002)
- ~3 more (delete channel, upload file, etc.)

## Repo conventions to match

- The memory path's `_ensure_memory_actor_matches_viewer` is the exemplar.
- Admin role check: `require_admin_role(context.membership)` from
  `services/server_membership.py` (used by `delete_member` and, after plan
  002, `update_member`). It raises HTTPException(403) on non-admin.
- `_resolve_active_server_context(db, request)` returns
  `context.membership`, `context.server`, `context.member`.

## Scope

**In scope**:
- `backend/routers/public_api.py` — `_resolve_human_actor` gains an admin
  escape hatch + viewer-match default; update each vulnerable call site.
- New test: `backend/tests/test_actor_impersonation.py`.

**Out of scope**:
- The memory routes — they already do the right thing.
- Agent/daemon token auth (`agent_api.py`) — daemon tokens identify a
  specific agent member, no body override.
- Removing the `actor`/`sender`/`creator` body fields entirely — they are
  the public API contract; we tighten enforcement, not the shape.

## Steps

### Step 1: Add viewer-match + admin escape to `_resolve_human_actor`

Refactor `_resolve_human_actor` (line 564) to require either (a) the
explicit name matches the current viewer's display name, or (b) the caller
has admin role on the server. Use the existing context helper:

```python
async def _resolve_human_actor(
    db: AsyncSession,
    server: Server,
    request: Request,
    explicit_name: str | None,
    *,
    role: str,
    viewer: Member | None = None,
    is_admin: bool = False,
) -> Member:
    # When no override is requested, attribute to the caller (today's default).
    if not explicit_name:
        # ...existing fallback to context.member / account member...

    # Override requested: require admin OR a name match.
    if viewer is not None and explicit_name == viewer.display_name:
        return viewer
    if is_admin:
        return await _ensure_human_member(db, server, explicit_name)
    raise HTTPException(
        403,
        f"Cannot attribute {role} to another member without admin role",
    )
```

(Read the existing function body first — the "no override" branch already
resolves the session member; preserve that logic. Only the `if explicit_name`
branch changes.)

**Verify**: `cd backend && uv run pytest -q` — existing tests that pass
explicit actor names may now fail (they relied on the impersonation). Those
tests need updating in Step 3, not here.

### Step 2: Thread `viewer` and `is_admin` through every call site

For each vulnerable call site (the ~10 listed in Current state), change:

```python
actor = await _resolve_human_actor(db, server, request, body.get("actor"), role="...")
```

to:

```python
context = await _resolve_active_server_context(db, request)   # if not already done
actor = await _resolve_human_actor(
    db, server, request, body.get("actor"),
    role="...",
    viewer=context.member,
    is_admin=_is_admin(context.membership),
)
```

Where `_is_admin(membership)` is a small helper that returns True for
`role in ("owner", "admin")` without raising (unlike `require_admin_role`).
If such a helper doesn't exist, add it next to `require_admin_role` in
`services/server_membership.py`.

For sites where `context` is already resolved (most of them), reuse it.

**Verify**: `cd backend && uv run pytest -q` — see Step 3 for test updates.

### Step 3: Update tests that relied on impersonation

Find tests that pass an `actor`/`sender`/`creator` different from the
authenticated member:

```
grep -rn '"actor":\|"sender":\|"creator":' backend/tests/
```

For each: either (a) change the test to use the viewer's own name (the
common case — most tests just picked an arbitrary name), or (b) upgrade
the test's session to admin role if it's genuinely testing admin
attribution. Do NOT delete tests.

**Verify**: `cd backend && uv run pytest -q` → all pass.

### Step 4: New impersonation test

Write `backend/tests/test_actor_impersonation.py`:

```python
@pytest.mark.asyncio
async def test_non_admin_cannot_impersonate_other_member(client, ...):
    """A non-admin member passing another member's name as `actor` gets 403."""
    # POST /api/v1/channels/{id}/messages with body {"sender": "other-user"}
    # Authenticated as viewer-member (role=member).
    # Assert 403, no message row inserted, no activity row attributed to other-user.

@pytest.mark.asyncio
async def test_admin_can_attribute_to_other_member(client, ...):
    """An admin passing another member's name as `actor` succeeds."""
    # Same call, authenticated as admin.
    # Assert 200, activity attributed to the named member.

@pytest.mark.asyncio
async def test_viewer_can_use_own_name(client, ...):
    """Passing your own display_name as actor is always allowed."""
    # Non-admin, body sender == viewer.display_name → 200.
```

Model after `backend/tests/test_member_patch_admin.py` (the fake-session
pattern from plan 002).

**Verify**: `cd backend && uv run pytest tests/test_actor_impersonation.py -q` → all pass.

## Done criteria

- [ ] `grep -nE "_resolve_human_actor" backend/routers/public_api.py` shows
      every call site passes `viewer=` and `is_admin=`.
- [ ] `cd backend && uv run pytest -q` exits 0.
- [ ] New `test_actor_impersonation.py` exists and passes the 3 cases.
- [ ] No test was deleted (only updated to use viewer's own name or admin role).
- [ ] `git status` shows only in-scope files modified.

## STOP conditions

- A call site cannot easily obtain `context.member` (e.g. it's in a
  background task that only has a member_id, not a request) — report; that
  site may need a different fix (e.g. explicit admin-only decorator).
- The existing memory-path `_ensure_memory_actor_matches_viewer` has
  different semantics than the plan assumes (e.g. it allows admin override
  too) — reconcile the two helpers into one rather than diverging.
- Step 3 reveals a production caller (e.g. the Feishu bridge) that
  legitimately impersonates human members as a non-admin — report; that
  caller needs an explicit service-account role, not the current blanket
  allowance.

## Maintenance notes

- **The admin escape hatch is intentional.** A supervisor correcting an
  agent's record or re-attributing a mis-filed task needs to attribute to
  another member. The fix is "require admin," not "remove the override."
- **Reviewer scrutiny**: the highest-risk change is Step 1's signature
  change. Confirm every call site was updated (grep for any remaining
  4-argument `_resolve_human_actor(` calls).
- **Follow-up**: consider folding `_ensure_memory_actor_matches_viewer`
  into this helper so there's one attribution-check function, not two.
