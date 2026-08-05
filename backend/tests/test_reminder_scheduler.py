"""Failure visibility and bounded retry behavior for scheduler loops."""

import asyncio
import logging
from contextlib import asynccontextmanager

import pytest

from services import reminder_scheduler, thread_summary


def test_thread_summary_request_instruction_uses_bare_aura():
    instruction = thread_summary.build_thread_summary_request_content("abc123ef")

    assert "aura thread summary --thread-id abc123ef" in instruction
    assert "slock thread" not in instruction.lower()
    assert "raft thread" not in instruction.lower()


def _fake_session_factory():
    @asynccontextmanager
    async def fake_session():
        yield object()

    return fake_session


@pytest.mark.asyncio
async def test_reminder_scheduler_backs_off_then_resets_and_logs(monkeypatch, caplog):
    calls = 0
    sleeps: list[float] = []

    async def fake_fire(_db):
        nonlocal calls
        calls += 1
        if calls <= 2:
            raise RuntimeError(f"reminder failure {calls}")

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 4:
            raise asyncio.CancelledError

    monkeypatch.setattr(reminder_scheduler, "async_session", _fake_session_factory())
    monkeypatch.setattr(reminder_scheduler, "fire_due_reminders", fake_fire)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    with caplog.at_level(logging.ERROR, logger="services.reminder_scheduler"):
        with pytest.raises(asyncio.CancelledError):
            await reminder_scheduler.reminder_scheduler_loop(interval_seconds=1.0)

    assert calls == 4
    assert sleeps == [2.0, 4.0, 1.0, 1.0]
    failures = [
        record
        for record in caplog.records
        if record.name == "services.reminder_scheduler"
        and record.levelno == logging.ERROR
        and record.exc_info is not None
    ]
    assert len(failures) == 2
    assert all("reminder scheduler iteration failed" in record.getMessage() for record in failures)


@pytest.mark.asyncio
async def test_reminder_scheduler_backoff_is_capped(monkeypatch):
    sleeps: list[float] = []

    async def fake_fire(_db):
        raise RuntimeError("persistent reminder failure")

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 8:
            raise asyncio.CancelledError

    monkeypatch.setattr(reminder_scheduler, "async_session", _fake_session_factory())
    monkeypatch.setattr(reminder_scheduler, "fire_due_reminders", fake_fire)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    with pytest.raises(asyncio.CancelledError):
        await reminder_scheduler.reminder_scheduler_loop(interval_seconds=1.0)

    assert sleeps == [2.0, 4.0, 8.0, 16.0, 32.0, 60.0, 60.0, 60.0]


@pytest.mark.asyncio
async def test_thread_summary_scheduler_backs_off_then_resets_and_logs(monkeypatch, caplog):
    calls = 0
    sleeps: list[float] = []

    async def fake_request(_db):
        nonlocal calls
        calls += 1
        if calls <= 2:
            raise RuntimeError(f"summary failure {calls}")

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 4:
            raise asyncio.CancelledError

    monkeypatch.setattr(thread_summary, "async_session", _fake_session_factory())
    monkeypatch.setattr(thread_summary, "request_due_thread_summaries", fake_request)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    with caplog.at_level(logging.ERROR, logger="services.thread_summary"):
        with pytest.raises(asyncio.CancelledError):
            await thread_summary.thread_summary_scheduler_loop(interval_seconds=10.0)

    assert calls == 4
    assert sleeps == [20.0, 40.0, 10.0, 10.0]
    failures = [
        record
        for record in caplog.records
        if record.name == "services.thread_summary"
        and record.levelno == logging.ERROR
        and record.exc_info is not None
    ]
    assert len(failures) == 2
    assert all("thread summary scheduler iteration failed" in record.getMessage() for record in failures)
