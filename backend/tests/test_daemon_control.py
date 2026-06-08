from types import SimpleNamespace
import uuid

import pytest

from services.daemon_control import (
    initial_daemon_event_cursor,
    parse_positive_event_cursor,
    pending_visible_events_for_computer,
)


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _ExecuteResult:
    def __init__(self, *, rows=None, scalar_rows=None, scalar_one=None):
        self._rows = rows or []
        self._scalar_rows = scalar_rows or []
        self._scalar_one = scalar_one

    def all(self):
        return self._rows

    def scalars(self):
        return _ScalarResult(self._scalar_rows)

    def scalar_one(self):
        return self._scalar_one


class _FakeSession:
    def __init__(self, *results):
        self._results = list(results)
        self.execute_count = 0

    async def execute(self, _statement):
        self.execute_count += 1
        return self._results.pop(0)


def _member(member_id, *, computer_id=None):
    return SimpleNamespace(id=member_id, computer_id=computer_id, kind="agent")


def _event(seq, *, event_type="message.created", actor_id=None, channel_id=None, payload=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        seq=seq,
        event_type=event_type,
        actor_id=actor_id,
        channel_id=channel_id,
        task_id=None,
        message_id=None,
        payload=payload or {"content": f"event {seq}"},
        created_at=None,
    )


def test_parse_positive_event_cursor():
    assert parse_positive_event_cursor(None) is None
    assert parse_positive_event_cursor("0") is None
    assert parse_positive_event_cursor("-10") is None
    assert parse_positive_event_cursor("not-a-number") is None
    assert parse_positive_event_cursor("42") == 42
    assert parse_positive_event_cursor(7) == 7


@pytest.mark.asyncio
async def test_initial_daemon_event_cursor_treats_missing_zero_and_invalid_as_live_subscription():
    server_id = uuid.uuid4()
    for raw_cursor in (None, "0", "-1", "not-a-number"):
        db = _FakeSession(_ExecuteResult(scalar_one=123))
        assert await initial_daemon_event_cursor(db, server_id=server_id, raw_cursor=raw_cursor) == 123
        assert db.execute_count == 1

    db = _FakeSession()
    assert await initial_daemon_event_cursor(db, server_id=server_id, raw_cursor="55") == 55
    assert db.execute_count == 0


@pytest.mark.asyncio
async def test_pending_visible_events_filters_self_messages_and_advances_scanned_cursor():
    server_id = uuid.uuid4()
    computer_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    agent = _member(agent_id, computer_id=computer_id)
    self_message = _event(
        101,
        actor_id=agent_id,
        channel_id=channel_id,
        payload={"content": "self-authored prompt"},
    )
    human_id = uuid.uuid4()
    human_message = _event(
        102,
        actor_id=human_id,
        channel_id=channel_id,
        payload={"content": "human prompt"},
    )
    db = _FakeSession(
        _ExecuteResult(scalar_rows=[agent]),
        _ExecuteResult(rows=[(agent_id, channel_id)]),
        _ExecuteResult(scalar_rows=[self_message, human_message]),
    )

    events, scanned_cursor = await pending_visible_events_for_computer(
        db,
        server_id=server_id,
        computer_id=computer_id,
        event_cursor=100,
    )

    assert scanned_cursor == 102
    assert [event["content"] for event in events] == ["human prompt"]
    assert events[0]["eventSeq"] == 102
    assert events[0]["targetAgentId"] == str(agent_id)


@pytest.mark.asyncio
async def test_pending_visible_events_skips_summary_updates_without_blocking_later_events():
    server_id = uuid.uuid4()
    computer_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    agent = _member(agent_id, computer_id=computer_id)
    summary_update = _event(
        201,
        event_type="thread.summary_updated",
        actor_id=agent_id,
        channel_id=channel_id,
        payload={"content": "summary updated"},
    )
    next_message = _event(
        202,
        actor_id=uuid.uuid4(),
        channel_id=channel_id,
        payload={"content": "next visible prompt"},
    )
    db = _FakeSession(
        _ExecuteResult(scalar_rows=[agent]),
        _ExecuteResult(rows=[(agent_id, channel_id)]),
        _ExecuteResult(scalar_rows=[summary_update, next_message]),
    )

    events, scanned_cursor = await pending_visible_events_for_computer(
        db,
        server_id=server_id,
        computer_id=computer_id,
        event_cursor=200,
    )

    assert scanned_cursor == 202
    assert [event["content"] for event in events] == ["next visible prompt"]
