from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import uuid

from fastapi import HTTPException
import pytest

from routers.agent_api import _apply_agent_status_transition, _daemon_lease_conflicts
from routers.public_api import compact_activity_feed
from services.daemon_control import (
    DaemonControlHub,
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


def _task(*, assignee_id, status="todo"):
    return SimpleNamespace(id=uuid.uuid4(), assignee_id=assignee_id, status=status)


def _computer(*, active_daemon_id="old-daemon", lease_expires_at=None, status="online"):
    if lease_expires_at is None:
        lease_expires_at = datetime.now(timezone.utc) + timedelta(seconds=30)
    return SimpleNamespace(
        status=status,
        active_daemon_id=active_daemon_id,
        daemon_lease_expires_at=lease_expires_at,
    )


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


def _activity(kind, *, agent_id=None, occurred_at=None, description=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        agent_id=agent_id or uuid.uuid4(),
        kind=kind,
        description=description or kind,
        occurred_at=occurred_at or datetime.now(timezone.utc),
    )


class _FakeWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, event):
        self.sent.append(event)


def test_parse_positive_event_cursor():
    assert parse_positive_event_cursor(None) is None
    assert parse_positive_event_cursor("0") is None
    assert parse_positive_event_cursor("-10") is None
    assert parse_positive_event_cursor("not-a-number") is None
    assert parse_positive_event_cursor("42") == 42
    assert parse_positive_event_cursor(7) == 7


def test_agent_can_start_assigned_todo_task():
    agent_id = uuid.uuid4()
    member = _member(agent_id)
    task = _task(assignee_id=agent_id)

    old_status, new_status = _apply_agent_status_transition(task, "in_progress", member)

    assert (old_status, new_status) == ("todo", "in_progress")
    assert task.status == "in_progress"
    assert task.assignee_id == agent_id


def test_agent_cannot_start_task_assigned_to_someone_else():
    member = _member(uuid.uuid4())
    task = _task(assignee_id=uuid.uuid4())

    with pytest.raises(HTTPException) as exc:
        _apply_agent_status_transition(task, "in_progress", member)

    assert exc.value.status_code == 403


def test_expired_daemon_lease_does_not_block_new_daemon():
    now = datetime.now(timezone.utc)
    computer = _computer(lease_expires_at=now - timedelta(seconds=1))

    assert _daemon_lease_conflicts(computer, "new-daemon", now) is False


def test_active_daemon_lease_blocks_different_daemon():
    now = datetime.now(timezone.utc)
    computer = _computer(lease_expires_at=now + timedelta(seconds=30))

    assert _daemon_lease_conflicts(computer, "new-daemon", now) is True
    assert _daemon_lease_conflicts(computer, "old-daemon", now) is False


def test_compact_activity_feed_collapses_heartbeats_by_agent():
    now = datetime.now(timezone.utc)
    agent_a = uuid.uuid4()
    agent_b = uuid.uuid4()
    task_event = _activity("supervisor_task_created", agent_id=agent_a, occurred_at=now - timedelta(seconds=20))
    older_a = _activity("workspace_heartbeat", agent_id=agent_a, occurred_at=now - timedelta(seconds=15))
    latest_a = _activity("workspace_heartbeat", agent_id=agent_a, occurred_at=now)
    latest_b = _activity("workspace_heartbeat", agent_id=agent_b, occurred_at=now - timedelta(seconds=5))

    compacted = compact_activity_feed([latest_a, latest_b, older_a, task_event], limit=10)

    assert compacted == [task_event, latest_a, latest_b]


def test_compact_activity_feed_applies_limit_after_compaction():
    now = datetime.now(timezone.utc)
    task_event = _activity("supervisor_task_created", occurred_at=now - timedelta(seconds=1))
    heartbeat = _activity("workspace_heartbeat", occurred_at=now)

    assert compact_activity_feed([heartbeat, task_event], limit=1) == [task_event]


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


@pytest.mark.asyncio
async def test_push_events_skips_heartbeat_only_pages_and_delivers_later_message():
    server_id = uuid.uuid4()
    computer_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    agent = _member(agent_id, computer_id=computer_id)
    heartbeat_1 = _event(
        301,
        event_type="workspace.heartbeat",
        actor_id=agent_id,
        payload={"type": "workspace.heartbeat", "agentId": str(agent_id)},
    )
    heartbeat_2 = _event(
        302,
        event_type="workspace.heartbeat",
        actor_id=agent_id,
        payload={"type": "workspace.heartbeat", "agentId": str(agent_id)},
    )
    human_message = _event(
        303,
        actor_id=uuid.uuid4(),
        channel_id=channel_id,
        payload={"content": "real human prompt"},
    )
    db = _FakeSession(
        _ExecuteResult(scalar_rows=[agent]),
        _ExecuteResult(rows=[(agent_id, channel_id)]),
        _ExecuteResult(scalar_rows=[heartbeat_1, heartbeat_2]),
        _ExecuteResult(scalar_rows=[agent]),
        _ExecuteResult(rows=[(agent_id, channel_id)]),
        _ExecuteResult(scalar_rows=[human_message]),
    )
    hub = DaemonControlHub()
    websocket = _FakeWebSocket()
    hub._connections[str(computer_id)].add(websocket)
    hub._event_cursors[websocket] = 300

    delivered = await hub.push_events(
        db,
        server_id=server_id,
        computer_id=computer_id,
    )

    assert delivered == 1
    assert [event["content"] for event in websocket.sent] == ["real human prompt"]
    assert hub._event_cursors[websocket] == 303
