# Plan 005: Kill serializer N+1 on message/task/member list endpoints

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 47848e8..HEAD -- backend/routers/agent_api.py backend/routers/public_api.py backend/routers/member_serialization.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: M (a day-ish)
- **Risk**: LOW (serializers are read-only transforms; response shape must stay identical)
- **Depends on**: `plans/001-pytest-baseline.md`
- **Category**: perf
- **Planned at**: commit `47848e8`, 2026-07-19

## Why this matters

`_serialize_message` issues 3 queries per message (Channel lookup, Member
lookup for sender, `count(*)` for reply count) and then calls
`_serialize_reactions`, which issues one `select(Member)` **per reaction**
inside the reaction loop. The list endpoints iterate this serializer:

- `/search` (agent) runs it over up to 100 rows ⇒ ~400+ queries per request.
- `/threads` runs it per root plus a per-root `count(*)`.
- `/history` hand-rolls its own per-message `select(Member)` inside the loop.
- The public-API equivalents (`_serialize_public_message`,
  `_serialize_public_reactions`) repeat the same pattern.

A 50-message channel page triggers ~150–250 round-trips; a 100-row search
triggers ~400+. This is the dominant latency cost on the most-used read paths
and adds connection-pool pressure on every list request.

The fix is local, mechanical, and verifiable: batch the lookups into one
`select(Member).where(Member.id.in_(ids))` query per request, build a Map,
and have serializers read from it. Response shape stays identical; existing
serializer tests are the regression gate.

## Current state

**`backend/routers/agent_api.py:700-735`** — `_serialize_message`:

```python
async def _serialize_message(db: AsyncSession, msg: Message) -> dict:
    channel_result = await db.execute(select(Channel).where(Channel.id == msg.channel_id))
    channel = channel_result.scalar_one_or_none()

    sender_result = await db.execute(select(Member).where(Member.id == msg.sender_id))
    sender = sender_result.scalar_one_or_none()

    reply_count_result = await db.execute(
        select(func.count()).select_from(Message).where(Message.parent_id == msg.id)
    )
    reply_count = int(reply_count_result.scalar() or 0)
    thread_root_id = msg.parent_id or msg.id
    reactions = await _serialize_reactions(db, msg.id)

    return { ... 20 keys, reads channel/sender/reply_count/reactions ... }
```

**`backend/routers/agent_api.py:738-759`** — `_serialize_reactions`:

```python
async def _serialize_reactions(db: AsyncSession, message_id: uuid.UUID) -> dict:
    reactions_result = await db.execute(
        select(MessageReaction).where(MessageReaction.message_id == message_id)
        .order_by(MessageReaction.created_at)
    )
    reactions = reactions_result.scalars().all()

    items = []
    counts: dict[str, int] = {}
    for reaction in reactions:
        member_result = await db.execute(select(Member).where(Member.id == reaction.member_id))   # <-- N+1
        member = member_result.scalar_one_or_none()
        ...
```

**`backend/routers/agent_api.py:2200`** — `/search` list call site:

```python
result = await db.execute(q_stmt.order_by(Message.seq.desc()).limit(min(limit, 100)))
messages = list(reversed(result.scalars().all()))
items = [await _serialize_message(db, item) for item in messages]   # <-- N+1 outer
```

**`backend/routers/public_api.py:1221-1292`** — `_serialize_public_message` +
`_serialize_public_reactions` (same shape, different file).

**`backend/routers/public_api.py:3232-3246`** — public `/search` also issues
`select(Member)` per message inside the result loop (line 3233).

**`backend/routers/member_serialization.py:48-60`** — `member_workspace_id`
issues `select(AgentWorkspace.id)...limit(1)` per member; `serialize_member`
(line 96) calls it once per member. `/members` at `public_api.py:3512-3534`
batches computers into `computers_map` but not workspaces.

## Commands you will need

| Purpose      | Command                                                       | Expected on success |
|--------------|---------------------------------------------------------------|---------------------|
| Tests        | `cd backend && uv run pytest -q`                              | exit 0              |
| Targeted     | `cd backend && uv run pytest tests/test_chat_read_cursors_http.py tests/test_public_memory_routes.py -q` | exit 0 |
| Query-count probe (manual, optional) | see Test plan                          | fewer queries than before |

## Repo conventions to match

- Serializers are module-level `async def` taking `(db: AsyncSession, entity)`.
- Response shape is **the contract** — clients in `frontend/lib/control-plane.ts`
  depend on it. Do not add, remove, reorder, or rename keys.
- Where batching already exists in the same file (`/members` builds
  `computers_map` at `public_api.py:3523`), mirror that pattern.

## Scope

**In scope**:

- `backend/routers/agent_api.py` — `_serialize_message`, `_serialize_reactions`,
  and the 4 list call sites that iterate them (`/search`, `/threads`,
  `/history`, `/messages`).
- `backend/routers/public_api.py` — `_serialize_public_message`,
  `_serialize_public_reactions`, the public `/search` loop, and the
  `/members` workspace-map prefetch.
- `backend/routers/member_serialization.py` — `serialize_member` to accept an
  optional pre-fetched `_workspace_id`.

**Out of scope**:

- Switching to ORM relationship navigation (`selectinload(Message.sender)`)
  end-to-end. That's a cleaner long-term fix but requires touching every
  outer query; the batched-Map approach achieves the same perf wins with
  smaller blast radius. Note as a follow-up.
- The `_serialize_task` and `_serialize_activity` N+1 (similar shape) —
  defer to a follow-up; this plan stays focused on message/member.
- The SSE `/events` per-connection session issue (separate perf finding) —
  not a serializer problem.

## Git workflow

- Branch: `advisor/005-serializer-n-plus-1`.
- Commits per logical unit:
  - `perf(agent-api): batch member/channel lookups in _serialize_message`
  - `perf(public-api): batch lookups in _serialize_public_message`
  - `perf(members): prefetch workspace ids in /members list`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a batched helper for member lookups

Near the top of `backend/routers/agent_api.py` (after the imports, before
`_serialize_message`), add:

```python
async def _prefetch_members(
    db: AsyncSession, member_ids: set[uuid.UUID]
) -> dict[uuid.UUID, Member]:
    if not member_ids:
        return {}
    result = await db.execute(select(Member).where(Member.id.in_(member_ids)))
    return {m.id: m for m in result.scalars().all()}
```

(Mirror in `backend/routers/public_api.py` or extract to a shared
`routers/_serialization.py` if a shared module already exists; otherwise a
local copy in each file is fine for this step.)

**Verify**: `cd backend && uv run pytest -q` — no failures introduced (helper
is unused so far).

### Step 2: Batch member + reaction-member lookups inside `_serialize_message`'s caller

Refactor `_serialize_message` to accept an optional prefetched-members map
and an optional prefetched-reactions map, so list callers can pre-fetch
once. The single-message call sites keep working by passing `None` and
falling back to per-message queries.

Concretely, change the signature:

```python
async def _serialize_message(
    db: AsyncSession,
    msg: Message,
    *,
    members: dict[uuid.UUID, Member] | None = None,
    channels: dict[uuid.UUID, Channel] | None = None,
) -> dict:
    channel = (channels or {}).get(msg.channel_id)
    if channel is None and channels is not None:
        channel = None  # explicit miss; do not re-query
    elif channels is None:
        ch_result = await db.execute(select(Channel).where(Channel.id == msg.channel_id))
        channel = ch_result.scalar_one_or_none()

    sender = (members or {}).get(msg.sender_id)
    if sender is None and members is None:
        s_result = await db.execute(select(Member).where(Member.id == msg.sender_id))
        sender = s_result.scalar_one_or_none()
    ...
```

And `_serialize_reactions` similarly accepts an optional `members` map;
when present, read from it instead of querying per reaction.

**Backward compat**: when `members=None` (single-message call sites), the
original behavior is preserved. This keeps the change safe to land step by
step.

**Verify**: `cd backend && uv run pytest -q` → all pass (no behavior change
when maps are not supplied).

### Step 3: Wire the batched prefetch into list endpoints

At each list call site in `agent_api.py` (`/search` ~line 2200, `/threads`
~line 3006, `/history` ~line 2140, `/messages` where applicable):

```python
messages = list(reversed(result.scalars().all()))

# Batch all member + channel lookups for the page in two queries.
all_member_ids = {m.sender_id for m in messages}
all_channel_ids = {m.channel_id for m in messages}
# Also collect reaction member ids:
reaction_rows = await db.execute(
    select(MessageReaction).where(MessageReaction.message_id.in_([m.id for m in messages]))
)
reactions_by_msg: dict[uuid.UUID, list[MessageReaction]] = {}
for r in reaction_rows.scalars():
    reactions_by_msg.setdefault(r.message_id, []).append(r)
    all_member_ids.add(r.member_id)

members_map = await _prefetch_members(db, all_member_ids)
channels_map = await _prefetch_channels(db, all_channel_ids)  # analogous helper

items = [
    await _serialize_message(
        db, m, members=members_map, channels=channels_map
    ) for m in messages
]
```

(Apply the analogous change to `_serialize_reactions` so it reads from
`members_map` when supplied.)

**Verify**: `cd backend && uv run pytest tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py tests/test_public_memory_routes.py -q` → pass.
Then full suite: `cd backend && uv run pytest -q` → pass.

### Step 4: Apply the same pattern to public-API serializers

Mirror Step 2 and Step 3 for `backend/routers/public_api.py`:
`_serialize_public_message`, `_serialize_public_reactions`, and the public
`/search` loop at line 3232.

**Verify**: `cd backend && uv run pytest -q` → all pass.

### Step 5: Prefetch workspace IDs in `/members`

In `backend/routers/member_serialization.py`, change `serialize_member` to
accept an optional `_workspace_id: uuid.UUID | None = None`:

```python
async def serialize_member(
    db: AsyncSession, member: Member, *, _computer=None, _workspace_id=None
) -> dict:
    ...
    workspace_id = _workspace_id if _workspace_id is not None else await member_workspace_id(db, member)
    ...
```

In `backend/routers/public_api.py:update_member`-equivalent list endpoints
(`/members` at ~line 3512, `/channels/{id}/members` at ~line 4526), build a
`workspaces_map` from one query:

```python
ws_result = await db.execute(
    select(AgentWorkspace.agent_id, AgentWorkspace.id)
    # If there can be multiple workspaces per agent, pick the latest via
    # a subquery or DISTINCT ON; otherwise just fetch all and group.
)
workspaces_map = {row[0]: row[1] for row in ws_result.all()}
```

Pass `workspaces_map.get(member.id)` as `_workspace_id` to `serialize_member`.

**Verify**: `cd backend && uv run pytest tests/test_server_account_membership.py -q` → pass.
Full suite: `cd backend && uv run pytest -q` → pass.

## Test plan

- **Regression gate**: the existing serializer-output tests
  (`test_chat_read_cursors_*`, `test_public_memory_routes`) assert response
  shape; they must pass unchanged after every step. This is the primary
  safety net — the optimization must be shape-preserving.
- **Query-count probe (manual, optional but recommended)**: instrument the
  `/search` endpoint temporarily by adding
  `event.listen(engine, "before_cursor_execute", ...)` in a scratch test to
  count queries; assert that a 50-message search issues fewer than ~30
  queries (down from ~200+). This is a characterization test that can be
  kept or dropped after the plan lands.
- No new behavioral tests required — the change is purely an access-pattern
  refactor.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd backend && uv run pytest -q` exits 0.
- [ ] `grep -nE "select\(Member\)\.where\(Member\.id == reaction\.member_id\)" backend/routers/`
      returns no matches (per-reaction member query eliminated).
- [ ] `grep -nE "select\(Member\)\.where\(Member\.id == msg\.sender_id\)" backend/routers/`
      returns no matches in the list call sites (single-message paths may
      still query, but list paths must batch).
- [ ] A 50-message `/search` issues fewer than 50 queries total (manual probe).
- [ ] Response shape of `_serialize_message` / `_serialize_public_message`
      is byte-identical (verify via existing tests).
- [ ] `git status` shows only the in-scope files modified.
- [ ] `plans/README.md` status row for plan 005 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- Any in-scope file no longer matches the "Current state" excerpts at the
  cited line numbers.
- A list call site uses the serializer in a way that cannot accept the
  optional `members=`/`channels=` kwargs without a larger refactor (e.g.
  it's called inside a generator that yields across requests) — report.
- Existing serializer tests fail AFTER Step 2 (before any list call site is
  changed) — this means the helper signature change introduced a regression
  in single-message paths; STOP and debug before proceeding.
- The query-count probe shows NO reduction — this means the batching is not
  actually being used by the list call sites; check that the maps are being
  populated and passed through.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **The cleaner long-term fix is ORM relationship navigation**: change the
  outer queries to use `selectinload(Message.sender, Message.channel)` and
  have serializers read `msg.sender` / `msg.channel` directly. This plan
  deliberately uses the batched-Map approach for smaller blast radius; the
  ORM-navigation rewrite can be done file-by-file later.
- **New list endpoints**: follow the established pattern — collect IDs,
  pre-fetch into Maps, pass through. Do not regress to per-row queries.
- **Reviewer scrutiny**: confirm response shape is unchanged on at least one
  message WITH reactions and one WITHOUT. The reactions batching is the
  most likely place for a subtle shape change (e.g. ordering).
- **Follow-ups deferred**: `_serialize_task` and `_serialize_activity` have
  the same N+1 shape; apply the same pattern there in a follow-up.
