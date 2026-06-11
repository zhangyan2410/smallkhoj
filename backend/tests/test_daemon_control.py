from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import uuid

from fastapi import HTTPException
import pytest

import routers.agent_api as agent_api
import routers.public_api as public_api
from routers.agent_api import (
    ACTIVITY_EVENT_TYPES,
    _apply_agent_status_transition,
    _daemon_lease_conflicts,
    _daemon_shutdown_can_release,
)
from routers.public_api import compact_activity_feed
from services.daemon_control import (
    DaemonControlHub,
    initial_daemon_event_cursor,
    mark_missing_runtimes_pending_start,
    parse_positive_event_cursor,
    pending_visible_events_for_computer,
    runtime_control_command,
    runtime_start_command,
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

    async def flush(self):
        return None

    async def commit(self):
        return None

    async def refresh(self, _item):
        return None


class _JsonRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


def _member(member_id, *, computer_id=None):
    return SimpleNamespace(id=member_id, computer_id=computer_id, kind="agent")


def _runtime_member(*, config=None, backend=None, status="offline"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        computer_id=uuid.uuid4(),
        kind="agent",
        config=config or {},
        backend=backend,
        status=status,
    )


def _workspace(*, status="stopped"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        runtime="claude_code",
        runtime_command=None,
        runtime_model=None,
        cwd=None,
        status=status,
        pid=1234,
        stopped_at=datetime.now(timezone.utc),
    )


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


def test_runtime_start_command_uses_runtime_provider_without_command_args():
    workspace = _workspace(status="pending_start")
    agent = _runtime_member(config={"runtimeProvider": "Kimi"})

    command = runtime_start_command(workspace, agent)

    config = command["command"]["config"]
    assert config["runtimeProvider"] == "Kimi"
    assert "runtimeCommandArgs" not in config
    assert "runtimeCommand" not in config


def test_runtime_start_command_does_not_infer_provider_from_legacy_fields():
    workspace = _workspace(status="pending_start")
    agent = _runtime_member(config={"provider": "Kimi", "backend": "Claude"}, backend="Claude")

    command = runtime_start_command(workspace, agent)

    config = command["command"]["config"]
    assert "runtimeProvider" not in config
    assert config["backend"] == "Claude"


def test_runtime_control_command_builds_stop_envelope_without_provider_leakage():
    workspace = _workspace(status="running")
    agent = _runtime_member(config={"runtimeProvider": "Kimi"})

    command = runtime_control_command(workspace, agent, "stop_runtime")

    assert command["controlType"] == "stop_runtime"
    assert command["command"]["type"] == "stop_runtime"
    assert command["command"]["agentId"] == str(agent.id)
    assert command["command"]["workspaceId"] == str(workspace.id)
    assert command["command"]["config"]["runtimeProvider"] == "Kimi"
    assert "runtimeCommand" not in command["command"]["config"]


def test_runtime_control_command_reuses_start_config_for_restart():
    workspace = _workspace(status="running")
    workspace.runtime_model = "glm-5.1"
    workspace.cwd = "/tmp/runtime-workspace"
    agent = _runtime_member(config={})

    command = runtime_control_command(workspace, agent, "restart_runtime")

    config = command["command"]["config"]
    assert command["controlType"] == "restart_runtime"
    assert config["workspaceId"] == str(workspace.id)
    assert config["runtimeModel"] == "glm-5.1"
    assert config["workspacePath"] == "/tmp/runtime-workspace"


@pytest.mark.asyncio
async def test_create_public_reminder_requires_explicit_agent(monkeypatch):
    async def fake_get_server(_db):
        return SimpleNamespace(id=uuid.uuid4())

    monkeypatch.setattr(public_api, "_get_server", fake_get_server)
    request = _JsonRequest({"title": "Follow up", "delaySeconds": 60})

    with pytest.raises(HTTPException) as exc:
        await public_api.create_public_reminder(request, _auth=None, db=object())

    assert exc.value.status_code == 400
    assert exc.value.detail == "Missing agent"


@pytest.mark.asyncio
async def test_missing_stopped_workspace_is_rearmed_when_autostart_enabled():
    workspace = _workspace(status="stopped")
    agent = _runtime_member(config={"runtimeDesiredStatus": "running"}, status="active")
    db = _FakeSession(_ExecuteResult(rows=[(workspace, agent)]))

    stale = await mark_missing_runtimes_pending_start(
        db,
        server_id=uuid.uuid4(),
        computer_id=uuid.uuid4(),
        reported_workspace_ids=set(),
    )

    assert stale == [(workspace, agent)]
    assert workspace.status == "pending_start"
    assert workspace.pid is None
    assert workspace.stopped_at is None
    assert agent.status == "offline"


@pytest.mark.asyncio
async def test_missing_workspace_is_not_rearmed_when_desired_stopped():
    workspace = _workspace(status="stopped")
    agent = _runtime_member(config={"runtimeDesiredStatus": "stopped"}, status="offline")
    db = _FakeSession(_ExecuteResult(rows=[(workspace, agent)]))

    await mark_missing_runtimes_pending_start(
        db,
        server_id=uuid.uuid4(),
        computer_id=uuid.uuid4(),
        reported_workspace_ids=set(),
    )

    assert workspace.status == "stopped"
    assert workspace.pid == 1234


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


def test_daemon_shutdown_only_releases_matching_active_daemon():
    computer = _computer(active_daemon_id="new-daemon")

    assert _daemon_shutdown_can_release(computer, "new-daemon") is True
    assert _daemon_shutdown_can_release(computer, "old-daemon") is False


def test_workspace_heartbeat_does_not_create_event_record_type():
    assert ACTIVITY_EVENT_TYPES.get("workspace_heartbeat") is None
    assert ACTIVITY_EVENT_TYPES["workspace_registered"] == "workspace.registered"
    assert ACTIVITY_EVENT_TYPES["workspace_updated"] == "workspace.updated"


@pytest.mark.asyncio
async def test_daemon_heartbeat_does_not_record_existing_workspace_activity(monkeypatch):
    recorded_activity_kinds = []
    computer_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    server = SimpleNamespace(id=uuid.uuid4())
    computer = SimpleNamespace(
        id=computer_id,
        name="local-dev",
        status="online",
        active_daemon_id="daemon-a",
        daemon_lease_expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
        last_heartbeat_at=None,
        detected_runtimes=[],
    )
    workspace = SimpleNamespace(id=workspace_id)
    agent = SimpleNamespace(id=agent_id, display_name="agent", kind="agent")

    async def fake_upsert(_db, _server, _computer, _item):
        return workspace, agent, False

    async def fake_record_activity(_db, _server, _agent, kind, *_args, **_kwargs):
        recorded_activity_kinds.append(kind)

    async def fake_mark_missing(*_args, **_kwargs):
        return []

    async def fake_pending_runtime_commands(*_args, **_kwargs):
        return []

    async def fake_serialize_workspace(_db, item):
        return {"id": str(item.id)}

    async def fake_serialize_computer(_db, item):
        return {"id": str(item.id)}

    monkeypatch.setattr(agent_api, "_upsert_daemon_workspace", fake_upsert)
    monkeypatch.setattr(agent_api, "_record_activity", fake_record_activity)
    monkeypatch.setattr(agent_api, "mark_missing_runtimes_pending_start", fake_mark_missing)
    monkeypatch.setattr(agent_api, "pending_runtime_commands", fake_pending_runtime_commands)
    monkeypatch.setattr(agent_api, "_serialize_workspace", fake_serialize_workspace)
    monkeypatch.setattr(agent_api, "_serialize_computer", fake_serialize_computer)

    body = agent_api.DaemonHeartbeatRequest(
        daemonId="daemon-a",
        status="online",
        workspaces=[agent_api.DaemonWorkspacePayload(workspaceId=str(workspace_id), agentId=str(agent_id))],
    )

    result = await agent_api.daemon_heartbeat(body, machine=(computer, server, object()), db=_FakeSession())

    assert result["ok"] is True
    assert recorded_activity_kinds == []


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
