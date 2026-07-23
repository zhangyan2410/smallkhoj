# Plan 003a: Scheduler loops — log + exponential backoff (split from 003)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Touch only the files listed as scope. If any STOP condition
> occurs, stop immediately and report. Do not improvise. When done, update
> the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 47848e8..HEAD -- backend/services/reminder_scheduler.py backend/services/thread_summary.py backend/services/daemon_control.py`
> NOTE: `backend/pyproject.toml` will differ if plan 001 was cherry-picked
> into your worktree — that is expected, NOT a STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-pytest-baseline.md`
- **Category**: correctness / observability
- **Planned at**: commit `47848e8`, 2026-07-19 (split from 003 on 2026-07-19)

## Why this matters

Split out of plan 003. Plan 003's `Message.seq` race fix is BLOCKED on plan
004 (the `seq` column needs to become a real DB IDENTITY first — see
`plans/README.md` dependency notes). But the OTHER half of plan 003 — the
silent-exception-swallowing scheduler loops — is fully independent of the
seq fix and can land now.

Three loops currently use `except Exception: pass`:

- `reminder_scheduler_loop` at 1Hz — if `fire_due_reminders` raises
  repeatedly (malformed row, schema drift, FK violation), it spins at 1Hz,
  opens a DB session every second, emits **nothing** to logs. Operators
  have no signal that reminders are broken.
- `thread_summary_scheduler_loop` — same pattern.
- daemon websocket send-loops — same pattern; a dead WS spins silently.

The fix: replace `pass` with `logger.exception(...)` and add exponential
backoff capped at 60s (reset on success). Pure observability + liveness
improvement, no behavior change on the happy path.

## Current state

**`backend/services/reminder_scheduler.py:170-180`**:

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

**`backend/services/thread_summary.py:320-329`** — same shape, `except Exception: pass`.

**`backend/services/daemon_control.py`** — websocket send loops reportedly
at ~287 and ~325. **OPEN THE FILE to confirm exact lines** before editing;
subagent-reported line numbers are leads, not facts.

No `logger` is defined in `reminder_scheduler.py` or `thread_summary.py`
at module top today (confirmed by grep). The repo's logger pattern is
`logger = logging.getLogger(__name__)` at module top (see
`routers/public_api.py:105`).

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Tests | `cd backend && uv run pytest -q` | exit 0 |
| Targeted | `cd backend && uv run pytest tests/test_reminder_scheduler.py -q` | exit 0 |

## Repo conventions to match

- Logger: `logger = logging.getLogger(__name__)` at module top.
- Async loops already re-raise `asyncio.CancelledError` — keep that pattern;
  only replace the bare `except Exception: pass`.
- Existing scheduler intervals: `reminder_scheduler_loop` default 1.0s;
  `thread_summary_scheduler_loop` uses `SUMMARY_SCHEDULER_INTERVAL_SECONDS`
  constant — preserve those as the backoff reset value.

## Scope

**In scope**:

- `backend/services/reminder_scheduler.py` — replace bare `except` in
  `reminder_scheduler_loop` with logging + backoff; add module-level `logger`.
- `backend/services/thread_summary.py` — same in
  `thread_summary_scheduler_loop`; add module-level `logger`.
- `backend/services/daemon_control.py` — replace bare `except` in WS send
  loops with logging (after confirming exact lines).
- New test: `backend/tests/test_reminder_scheduler.py`.

**Out of scope** (do NOT touch):

- The `Message.seq` manual assignment — that's the BLOCKED half of plan 003,
  deferred until plan 004 lands the IDENTITY migration.
- `_next_message_seq` helper in `reminder_scheduler.py` — leave it for now
  (still in use by `fire_due_reminders`); plan 003-seq will remove it once
  unblocked.
- `backend/pyproject.toml` — plan 001 handled it.
- Any scheduler interval default changes.

## Git workflow

- Branch: `advisor/003a-scheduler-logging`.
- Single commit: `fix(schedulers): log and back off on loop exceptions instead of swallowing`
- Do NOT push or open a PR.

## Steps

### Step 1: Add module-level logger to both scheduler files

In `backend/services/reminder_scheduler.py` and
`backend/services/thread_summary.py`, at module top (after imports), add:

```python
import logging

logger = logging.getLogger(__name__)
```

(Match the existing import ordering in each file. `logging` is stdlib; if
`asyncio`/`contextlib` are already imported, place `logging` alphabetically
among them.)

**Verify**: `cd backend && python -c "from services.reminder_scheduler import logger; print(logger.name)"` → prints `services.reminder_scheduler`. Same for thread_summary.

### Step 2: Replace bare `except` in `reminder_scheduler_loop`

In `backend/services/reminder_scheduler.py:170-180`:

```python
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
            backoff = min(backoff * 2, 60.0)  # cap at 60s
        await asyncio.sleep(backoff)
```

### Step 3: Same for `thread_summary_scheduler_loop`

In `backend/services/thread_summary.py:320-329`, apply the identical pattern
using `SUMMARY_SCHEDULER_INTERVAL_SECONDS` as the reset value and the same
60s cap.

### Step 4: daemon_control WS send loops

Open `backend/services/daemon_control.py` and locate the websocket send
loops (reported at ~287, ~325). For each loop with `except Exception: pass`:

- Add module-level `logger = logging.getLogger(__name__)` if not present.
- Replace `pass` with `logger.exception("<descriptive name> send loop failed")`.
- Add a `break` (or `continue` if the surrounding logic retries the same
  connection — match what the loop already does on `WebSocketDisconnect`)
  so a dead WS does not spin silently.

**Verify the exact semantics before choosing break vs continue** — read the
surrounding 20 lines of each loop.

### Step 5: New backoff test

Write `backend/tests/test_reminder_scheduler.py`:

```python
import asyncio
import pytest

from services import reminder_scheduler


@pytest.mark.asyncio
async def test_reminder_scheduler_backs_off_then_resets(monkeypatch):
    """On repeated failure, backoff doubles and caps at 60s; on success it resets."""
    calls = {"n": 0}
    sleeps: list[float] = []

    async def fake_fire(_db):
        calls["n"] += 1
        if calls["n"] <= 2:
            raise RuntimeError("simulated failure")

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) >= 4:
            raise asyncio.CancelledError  # stop the loop after enough iters

    monkeypatch.setattr(reminder_scheduler, "fire_due_reminders", fake_fire)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    with pytest.raises(asyncio.CancelledError):
        await reminder_scheduler.reminder_scheduler_loop(interval_seconds=1.0)

    # First two iterations fail: backoff should grow (1 -> 2 -> 4 ...)
    # Third iteration succeeds: backoff resets to interval_seconds
    assert calls["n"] == 3
    assert sleeps[0] == 2.0   # backoff after 1st failure (1 * 2)
    assert sleeps[1] == 4.0   # backoff after 2nd failure (2 * 2)
    assert sleeps[2] == 1.0   # reset to interval_seconds after success
```

(Adjust the exact assertions to match your Step 2 implementation — the key
property is "backoff grows on failure, resets on success, caps at 60s." If
your implementation's growth differs slightly, fix the test to match the
implemented contract, not the plan's example.)

**Verify**: `cd backend && uv run pytest tests/test_reminder_scheduler.py -q` → pass.

## Test plan

- New: `backend/tests/test_reminder_scheduler.py` (backoff behavior).
- Regression: `cd backend && uv run pytest -q` — full suite still passes.

## Done criteria (ALL must hold)

- [ ] `grep -n "except Exception" backend/services/reminder_scheduler.py backend/services/thread_summary.py`
      shows the new logging + backoff, not bare `pass`.
- [ ] `grep -n "logger.exception" backend/services/reminder_scheduler.py backend/services/thread_summary.py`
      returns matches.
- [ ] `backend/services/daemon_control.py` WS send loops log on exception
      (verify by reading the edited sections).
- [ ] `cd backend && uv run pytest -q` exits 0, including the new test.
- [ ] `git status` shows only the in-scope files + new test modified (plus
      pyproject.toml from plan-001 cherry-pick if applicable).
- [ ] Commit created on `advisor/003a-scheduler-logging`.

## STOP conditions (stop and report)

- Any in-scope file no longer matches the "Current state" excerpts at the
  cited line numbers. NOTE: `backend/pyproject.toml` differs because plan
  001 was cherry-picked — that is expected, NOT a STOP.
- `daemon_control.py` WS loops at the cited lines do not exist or have
  already been refactored to log — report what's there; do not invent loops
  to edit.
- Step 5's test cannot stabilize because the loop's control flow makes
  monkeypatching `asyncio.sleep` insufficient (e.g. the loop also awaits
  something else) — report; fall back to a simpler assertion (e.g. just
  assert the test loop terminates and logs) rather than weakening the
  implementation.

## Maintenance notes

- **The seq-race half is still open.** This plan only fixes observability.
  Plan 004 must land the `messages.seq → IDENTITY` migration; then a
  revived 003-seq can remove the manual `seq=` assignment and the
  `_next_message_seq` helper.
- **Backoff cap of 60s** is conservative for a local scheduler; if
  reminders are time-critical, lower the cap and add alerting on logged
  exceptions.
- **Reviewer scrutiny**: confirm the `break`/`continue` choice in
  `daemon_control.py` matches each loop's existing disconnect semantics.
  A wrong choice could either spin silently (continue on dead WS) or
  drop a reconnectable connection (break on transient error).
