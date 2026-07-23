# Plan 003: Repair `Message.seq` race + stop swallowing scheduler exceptions

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 47848e8..HEAD -- backend/routers/public_api.py backend/routers/agent_api.py backend/services/reminder_scheduler.py backend/services/thread_summary.py backend/services/daemon_control.py backend/models/slock.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-pytest-baseline.md`
- **Category**: correctness
- **Planned at**: commit `47848e8`, 2026-07-19

## Why this matters

Two unrelated correctness issues in the message/scheduler path:

1. **`Message.seq` is computed as `max(seq)+1` in Python**, then assigned
   manually at insert. The model declares the column as
   `autoincrement=True, unique=True`, so the manual assignment both defeats
   the DB's identity mechanism AND must obey the unique constraint. Two
   concurrent inserts (very common — multiple agents + humans send at once,
   and the reminder scheduler fires at 1Hz) compute the same next value, and
   the second `commit` raises `IntegrityError` → HTTP 500 for one of them.
   There is no retry. The seq value feeds SSE cursors
   (`public_event_hub.set_server_cursor` keyed on seq), so collisions also
   risk cursor skip/replay.

2. **The reminder scheduler, thread-summary scheduler, and daemon websocket
   send-loop all use `except Exception: pass`**, so if `fire_due_reminders`
   raises repeatedly (malformed row, schema drift, FK violation) the loop
   spins at 1Hz, opens a DB session every second, and emits **nothing** to
   logs. Operators have no signal that reminders are broken.

## Current state

**`backend/models/slock.py:270`** — column declares autoincrement + unique:

```python
seq: Mapped[int] = mapped_column(BigInteger, autoincrement=True, unique=True)
```

**Three call sites manually assign `seq`:**

`backend/routers/public_api.py:1986-1999` (public message send):

```python
with trace.time("backend.public_message.db_flush"):
    seq_result = await db.execute(select(func.coalesce(func.max(Message.seq), 0)))
    msg = Message(
        short_id=uuid.uuid4().hex[:8],
        channel_id=channel.id,
        sender_id=sender.id,
        parent_id=parent_id,
        content=content,
        channel_type="thread" if parent_id else channel.kind,
        mentions=await _parse_mentions(db, server, content),
        seq=int(seq_result.scalar() or 0) + 1,   # <-- race
    )
    db.add(msg)
    await db.flush()
```

`backend/routers/agent_api.py:1836-1840` (agent send):

```python
with trace.time("backend.agent_send.db_flush"):
    # Get next seq (global)
    seq_result = await db.execute(select(func.coalesce(func.max(Message.seq), 0)))
    last_seq = seq_result.scalar() or 0
    ...
```

(Then `seq=last_seq + 1` is passed into the `Message(...)` constructor a few
lines below — search for `seq=` in the same function.)

`backend/services/reminder_scheduler.py:41-43` (helper used by the scheduler):

```python
async def _next_message_seq(db: AsyncSession) -> int:
    result = await db.execute(select(func.coalesce(func.max(Message.seq), 0)))
    return int(result.scalar() or 0) + 1
```

**Exception-swallowing loops:**

`backend/services/reminder_scheduler.py:170-180`:

```python
async def reminder_scheduler_loop(interval_seconds: float = 1.0):
    while True:
        try:
            async with async_session() as db:
                await fire_due_reminders(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Keep the lightweight local scheduler alive; detailed DB errors surface in app logs.
            pass
        await asyncio.sleep(interval_seconds)
```

`backend/services/thread_summary.py:320-329` — same shape, `except Exception: pass`.

`backend/services/daemon_control.py` — websocket send loops at lines ~287 and
~325 also swallow exceptions silently (subagent-reported; open the file before
editing to confirm exact lines).

## Commands you will need

| Purpose      | Command                                                       | Expected on success |
|--------------|---------------------------------------------------------------|---------------------|
| Tests        | `cd backend && uv run pytest -q`                              | exit 0              |
| Targeted test| `cd backend && uv run pytest tests/test_task_runs.py -q`      | exit 0              |
| Grep audit   | `grep -rn "max(Message.seq)" backend/ --include="*.py" \| grep -v __pycache__` | only test/docs matches remain |

## Repo conventions to match

- Logger pattern: `logger = logging.getLogger(__name__)` at module top (see
  `routers/public_api.py:105`).
- Async loops already re-raise `asyncio.CancelledError` — keep that pattern;
  only replace the bare `except Exception: pass`.
- `trace.time(...)` context manager wrappers around DB flushes are used in
  both routers — keep them; only remove the manual `seq=` assignment inside.

## Scope

**In scope** (the only files you should modify):

- `backend/routers/public_api.py` — remove manual `seq=` in `create_channel_message`.
- `backend/routers/agent_api.py` — remove manual `seq=` in agent send.
- `backend/services/reminder_scheduler.py` — remove `_next_message_seq` usage
  in `fire_due_reminders`; replace bare `except` with logging + backoff.
- `backend/services/thread_summary.py` — replace bare `except` with logging.
- `backend/services/daemon_control.py` — replace bare `except` in WS send loops
  with logging (after confirming exact line numbers in the live file).

**Out of scope**:

- `backend/models/slock.py` — do NOT change the column declaration; the fix
  is to stop overriding the autoincrement, not to remove it.
- Public event cursor logic keyed on seq — leave as is; once seq is DB-assigned
  and monotonic, cursor semantics are correct by construction.
- `public_events.py:_notify_postgres` per-event connection (separate finding,
  plan 005 territory).

## Git workflow

- Branch: `advisor/003-seq-race-and-scheduler-logging`.
- Two commits, conventional-commit style:
  - `fix(messages): let DB assign Message.seq instead of max(seq)+1`
  - `fix(schedulers): log and back off on loop exceptions instead of swallowing`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Stop assigning `Message.seq` manually in the public send path

In `backend/routers/public_api.py:create_channel_message` around line 1986:

- Delete the `seq_result = await db.execute(...)` line and the
  `seq=int(seq_result.scalar() or 0) + 1` kwarg from the `Message(...)` call.
- After `await db.flush()` (line 1999), add `await db.refresh(msg)` so the
  DB-assigned `seq` is loaded onto the object before it's serialized or used
  to build the event payload.
- Find every later use of `msg.seq` in the same function (event payload,
  activity record, response) and confirm it reads from the refreshed `msg`;
  if any local variable captured the old `seq` value, replace it with
  `msg.seq`.

**Verify**: `cd backend && uv run pytest tests/test_public_memory_routes.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py -q` → all pass.

### Step 2: Stop assigning `Message.seq` manually in the agent send path

In `backend/routers/agent_api.py` around line 1836, apply the same change:

- Delete the `seq_result = await db.execute(select(func.coalesce(func.max(Message.seq), 0)))`
  block and the `last_seq = seq_result.scalar() or 0` line.
- Remove the `seq=last_seq + 1` (or equivalent) kwarg from the `Message(...)`
  constructor in the same function.
- After the `db.flush()` call, add `await db.refresh(msg)` and update any
  downstream `seq` references.

**Verify**: `cd backend && uv run pytest -q` → no regressions (agent send
has no dedicated test; rely on the full suite + manual check below).

**Manual concurrency check (recommended)**: with a running Postgres, hit the
public send endpoint with 10 concurrent requests and confirm all 10 succeed
with distinct increasing `seq` values. (Skip if no live DB available — note
in the completion message.)

### Step 3: Drop `_next_message_seq` usage in the reminder scheduler

In `backend/services/reminder_scheduler.py`:

- In `fire_due_reminders` (line 46 onward), find the `Message(...)` construction
  that uses `seq=await _next_message_seq(db)` and remove the `seq=` kwarg.
- After the `db.flush()` for each message, `await db.refresh(message)` so
  `message.seq` is populated for the activity payload at line 157.
- Delete the now-unused `_next_message_seq` helper (lines 41-43).

**Verify**: `cd backend && uv run pytest tests/test_daemon_command_generation.py tests/test_release_loop.py -q` → pass. (Reminder firing has no direct test; the full-suite run is the gate.)

### Step 4: Replace silent `except Exception: pass` in scheduler loops

In `backend/services/reminder_scheduler.py:170-180`:

```python
logger = logging.getLogger(__name__)   # add at module top if not present

async def reminder_scheduler_loop(interval_seconds: float = 1.0):
    backoff = interval_seconds
    while True:
        try:
            async with async_session() as db:
                await fire_due_reminders(db)
            backoff = interval_seconds      # reset on success
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("reminder_scheduler iteration failed")
            backoff = min(backoff * 2, 60.0) # cap at 60s
        await asyncio.sleep(backoff)
```

In `backend/services/thread_summary.py:320-329` — apply the same pattern
(`logger.exception` + exponential backoff capped at 60s, reset on success).

In `backend/services/daemon_control.py` — open the file first to confirm the
exact line numbers (~287, ~325 per the subagent report). For each WS send
loop with `except Exception: pass`, replace with `logger.exception(...)` and
a `break` (or continue, matching surrounding semantics) so a dead WS does not
spin silently.

**Verify**: `cd backend && uv run pytest -q` → no regressions. Add a unit
test in `backend/tests/test_reminder_scheduler.py` (new file) that:
- Monkeypatches `fire_due_reminders` to raise `RuntimeError` twice then
  succeed.
- Asserts the loop's `backoff` grew on the failure iterations and reset
  afterward (use `asyncio.sleep` mocked via `pytest-monkeypatch`).

## Test plan

- New: `backend/tests/test_reminder_scheduler.py` covering backoff behavior.
- Regression: the existing message-routing tests
  (`test_chat_read_cursors_*`, `test_public_memory_routes`) confirm message
  creation still produces a valid `seq`.
- Concurrency (manual, optional): 10× concurrent sends produce distinct seqs.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "max(Message.seq)" backend/ --include="*.py" | grep -v __pycache__ | grep -v test`
      returns no matches in `routers/` or `services/`.
- [ ] `grep -rn "_next_message_seq" backend/ --include="*.py" | grep -v __pycache__`
      returns no matches (helper deleted).
- [ ] `grep -rn "except Exception" backend/services/reminder_scheduler.py backend/services/thread_summary.py`
      shows the new logging + backoff, not bare `pass`.
- [ ] `cd backend && uv run pytest -q` exits 0.
- [ ] `git status` shows only the in-scope files modified.
- [ ] `plans/README.md` status row for plan 003 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- Any in-scope file no longer matches the excerpts at the cited line numbers.
- Removing the manual `seq=` assignment causes `msg.seq` to be `None` after
  `db.flush()` + `db.refresh(msg)` — this means the column is not actually
  wired as a DB identity column in the live schema (despite the model
  declaration); STOP and report. The likely cause is that `seed.py`'s raw
  `CREATE TABLE` for `messages` did not declare `seq` as `IDENTITY`/`SERIAL`,
  so the autoincrement never worked. If so, the fix belongs in plan 004
  (Alembic) alongside the schema reconciliation, not here.
- A router uses the `seq` value in a way that cannot tolerate the
  post-flush refresh (e.g. inside a `trace.time(...)` block that closes over
  `seq` before flush) — report the actual call site; do not restructure the
  tracing code on the fly.
- `daemon_control.py` WS loops at the cited lines do not exist or have
  already been refactored — report what's there.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **The deeper schema fix is in plan 004.** If Step 2's STOP condition fired
  (column not actually an identity in the live DB), plan 004 must add a
  migration to convert `messages.seq` into a proper `IDENTITY` column before
  this plan's fix is valid. Sequence the two accordingly.
- **Backoff cap**: 60s is a conservative default for a local scheduler; if
  reminders are time-critical, lower the cap and add alerting on logged
  exceptions.
- **Reviewer scrutiny**: confirm no call site reads `msg.seq` before the
  post-flush `refresh`. The most likely regression is an event payload built
  before refresh that captures `seq=None`.
- **Follow-up deferred**: the SSE `/events` per-connection DB session
  (perf finding) is plan 005 territory; do not touch it here.
