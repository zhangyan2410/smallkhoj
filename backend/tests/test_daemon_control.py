import logging
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import routers.agent_api as agent_api
import routers.public_api as public_api
import services.daemon_control as daemon_control
from routers.agent_api import (
    ACTIVITY_EVENT_TYPES,
    _apply_agent_status_transition,
    _apply_daemon_ws_activity,
    _daemon_lease_conflicts,
    _daemon_shutdown_can_release,
)
from routers.public_api import compact_activity_feed
from services.daemon_control import (
    DaemonControlHub,
    clear_workspace_reference,
    initial_daemon_event_cursor,
    mark_missing_runtimes_pending_start,
    parse_positive_event_cursor,
    pending_runtime_commands,
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

    def scalar_one_or_none(self):
        return self._scalar_one


class _FakeSession:
    def __init__(self, *results):
        self._results = list(results)
        self.execute_count = 0
        self.added = []

    async def execute(self, _statement):
        self.execute_count += 1
        return self._results.pop(0)

    def add(self, item):
        self.added.append(item)

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


def _profile_member(*, kind="human", avatar_url=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        kind=kind,
        status="online",
        description=None,
        avatar_url=avatar_url,
        config={},
        backend=None,
    )


def _runtime_member(*, config=None, backend=None, status="offline"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        computer_id=uuid.uuid4(),
        kind="agent",
        config=config or {},
        backend=backend,
        status=status,
    )


def _workspace(*, status="stopped", started_at=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        runtime="claude_code",
        runtime_command=None,
        runtime_model=None,
        cwd=None,
        session_id=None,
        started_at=started_at,
        status=status,
        pid=1234,
        stopped_at=datetime.now(timezone.utc),
    )


def _task(*, assignee_id, status="todo"):
    return SimpleNamespace(id=uuid.uuid4(), assignee_id=assignee_id, status=status)


def _computer(*, active_daemon_id="old-daemon", lease_expires_at=None, status="online", detected_runtimes=None):
    if lease_expires_at is None:
        lease_expires_at = datetime.now(timezone.utc) + timedelta(seconds=30)
    return SimpleNamespace(
        id=uuid.uuid4(),
        server_id=uuid.uuid4(),
        name="local-dev",
        machine_id="machine-old",
        os="darwin",
        daemon_version="0.2.0",
        api_key_prefix=None,
        status=status,
        active_daemon_id=active_daemon_id,
        daemon_lease_expires_at=lease_expires_at,
        last_heartbeat_at=None,
        detected_runtimes=detected_runtimes or [],
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def _event(seq, *, event_type="message.created", actor_id=None, channel_id=None, task_id=None, payload=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        seq=seq,
        event_type=event_type,
        actor_id=actor_id,
        channel_id=channel_id,
        task_id=task_id,
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


def test_public_agent_runtime_normalizer_exposes_codex_without_acp_detail():
    assert public_api._normalize_runtime("codex") == "codex"
    assert public_api._normalize_runtime("codex_acp") == "codex"
    assert public_api._normalize_runtime("codex-acp") == "codex"
    with pytest.raises(HTTPException) as exc:
        public_api._normalize_runtime("codex_cli")
    assert exc.value.status_code == 400
    assert exc.value.detail == "Unsupported runtime: codex_cli"


def test_agent_api_public_runtime_hides_codex_implementation_detail():
    assert agent_api._public_runtime("codex") == "codex"
    assert agent_api._public_runtime("codex_cli") == "codex"
    assert agent_api._public_runtime("codex_acp") == "codex"


class _FakeWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, event):
        self.sent.append(event)


class _FailingWebSocket:
    async def send_json(self, _event):
        raise RuntimeError("websocket send failed")


@pytest.mark.asyncio
async def test_daemon_hub_push_logs_and_removes_failed_websocket(caplog):
    hub = DaemonControlHub()
    computer_id = uuid.uuid4()
    websocket = _FailingWebSocket()
    hub.add(computer_id, websocket)

    with caplog.at_level(logging.ERROR, logger="services.daemon_control"):
        delivered = await hub.push(computer_id, {"type": "runtime.start"})

    assert delivered == 0
    assert hub.connected_computers() == []
    assert any(
        record.name == "services.daemon_control"
        and record.levelno == logging.ERROR
        and record.exc_info is not None
        and "daemon control push failed" in record.getMessage()
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_daemon_hub_push_events_logs_and_removes_failed_websocket(monkeypatch, caplog):
    hub = DaemonControlHub()
    server_id = uuid.uuid4()
    computer_id = uuid.uuid4()
    websocket = _FailingWebSocket()
    hub.add(computer_id, websocket)

    async def fake_pending_events(*_args, **_kwargs):
        return ([{"type": "message.created"}], 1)

    monkeypatch.setattr(
        daemon_control,
        "pending_visible_events_for_computer",
        fake_pending_events,
    )

    with caplog.at_level(logging.ERROR, logger="services.daemon_control"):
        delivered = await hub.push_events(
            _FakeSession(),
            server_id=server_id,
            computer_id=computer_id,
        )

    assert delivered == 0
    assert hub.connected_computers() == []
    assert any(
        record.name == "services.daemon_control"
        and record.levelno == logging.ERROR
        and record.exc_info is not None
        and "daemon control event push failed" in record.getMessage()
        for record in caplog.records
    )


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


def test_runtime_start_command_enables_writes_for_server_managed_runtime():
    workspace = _workspace(status="pending_start")
    agent = _runtime_member(config={})

    command = runtime_start_command(workspace, agent)

    assert command["command"]["config"]["allowWrites"] is True


def test_runtime_start_command_does_not_infer_provider_from_legacy_fields():
    workspace = _workspace(status="pending_start")
    agent = _runtime_member(config={"provider": "Kimi", "backend": "Claude"}, backend="Claude")

    command = runtime_start_command(workspace, agent)

    config = command["command"]["config"]
    assert "runtimeProvider" not in config
    assert config["backend"] == "Claude"


def test_runtime_start_command_suppresses_codex_runtime_command():
    workspace = _workspace(status="pending_start")
    workspace.runtime = "codex"
    workspace.runtime_command = "claude"
    agent = _runtime_member(config={})

    command = runtime_start_command(workspace, agent)

    config = command["command"]["config"]
    assert config["runtime"] == "codex"
    assert "runtimeCommand" not in config


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
    assert config["allowWrites"] is True


@pytest.mark.asyncio
async def test_create_public_reminder_requires_explicit_agent(monkeypatch):
    async def fake_resolve_active_server_context(_db, _request):
        return SimpleNamespace(server=SimpleNamespace(id=uuid.uuid4()))

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_resolve_active_server_context)
    request = _JsonRequest({"title": "Follow up", "delaySeconds": 60})

    with pytest.raises(HTTPException) as exc:
        await public_api.create_public_reminder(request, _auth=None, db=object())

    assert exc.value.status_code == 400
    assert exc.value.detail == "Missing agent"


@pytest.mark.asyncio
async def test_create_agent_rejects_unavailable_runtime_provider_before_creating_rows(monkeypatch):
    computer = _computer(detected_runtimes=[{
        "type": "codex",
        "runtimeProvider": "krill",
        "status": "available",
    }])
    server = SimpleNamespace(id=computer.server_id)
    db = _FakeSession(
        _ExecuteResult(scalar_one=None),
        _ExecuteResult(scalar_one=computer),
    )

    async def fake_active_server_context(_db, _request):
        return SimpleNamespace(server=server, member=SimpleNamespace(id=uuid.uuid4()), membership=SimpleNamespace(role="owner"))

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_active_server_context)
    request = _JsonRequest({
        "name": "bad-provider-probe",
        "computerId": str(computer.id),
        "runtime": "codex",
        "runtimeProvider": "codex-cli",
    })

    with pytest.raises(HTTPException) as exc:
        await public_api.create_agent(request, _auth=None, db=db)

    assert exc.value.status_code == 400
    assert exc.value.detail == "Runtime provider codex-cli is not available for codex on this computer"
    assert db.added == []


@pytest.mark.asyncio
async def test_create_agent_can_register_without_starting_runtime(monkeypatch):
    computer = _computer(detected_runtimes=[{
        "type": "codex",
        "runtimeProvider": "krill",
        "status": "available",
    }])
    server = SimpleNamespace(id=computer.server_id)
    db = _FakeSession(
        _ExecuteResult(scalar_one=None),
        _ExecuteResult(scalar_one=computer),
        _ExecuteResult(scalar_one=None),
    )
    pushed = []

    async def fake_active_server_context(_db, _request):
        return SimpleNamespace(server=server, member=SimpleNamespace(id=uuid.uuid4()), membership=SimpleNamespace(role="owner"))

    async def fake_resolve_human_actor(*_args, **_kwargs):
        return None

    async def fake_record_activity(*_args, **_kwargs):
        return None

    async def fake_push(*args):
        pushed.append(args)

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_active_server_context)
    monkeypatch.setattr(public_api, "_resolve_human_actor", fake_resolve_human_actor)
    monkeypatch.setattr(public_api, "_record_activity", fake_record_activity)
    monkeypatch.setattr(public_api, "_push_committed_events", fake_record_activity)
    monkeypatch.setattr(public_api.daemon_control_hub, "push", fake_push)
    request = _JsonRequest({
        "name": "release-assignee",
        "computerId": str(computer.id),
        "runtime": "codex",
        "runtimeProvider": "krill",
        "autoStart": False,
    })

    response = await public_api.create_agent(request, _auth=None, db=db)

    agent = db.added[0]
    workspace = db.added[1]
    assert response["created"] is True
    assert agent.config["runtimeDesiredStatus"] == "stopped"
    assert workspace.status == "stopped"
    assert pushed == []


@pytest.mark.asyncio
async def test_missing_running_workspace_is_rearmed_when_autostart_enabled():
    workspace = _workspace(status="running")
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
async def test_recent_running_workspace_with_session_is_not_rearmed_by_empty_heartbeat():
    workspace = _workspace(status="running", started_at=datetime.now(timezone.utc))
    workspace.session_id = "codex-acp-session"
    agent = _runtime_member(config={"runtimeDesiredStatus": "running"}, status="active")
    db = _FakeSession(_ExecuteResult(rows=[(workspace, agent)]))

    await mark_missing_runtimes_pending_start(
        db,
        server_id=uuid.uuid4(),
        computer_id=uuid.uuid4(),
        reported_workspace_ids=set(),
    )

    assert workspace.status == "running"
    assert workspace.pid == 1234
    assert agent.status == "active"


@pytest.mark.asyncio
async def test_missing_stopped_workspace_is_not_rearmed_when_desired_running():
    workspace = _workspace(status="stopped")
    agent = _runtime_member(config={"runtimeDesiredStatus": "running"}, status="active")
    db = _FakeSession(_ExecuteResult(rows=[(workspace, agent)]))

    await mark_missing_runtimes_pending_start(
        db,
        server_id=uuid.uuid4(),
        computer_id=uuid.uuid4(),
        reported_workspace_ids=set(),
    )

    assert workspace.status == "stopped"
    assert workspace.pid is None
    assert agent.status == "active"


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
    assert workspace.pid is None


@pytest.mark.asyncio
async def test_daemon_workspace_stopped_update_clears_stale_pid():
    server = SimpleNamespace(id=uuid.uuid4())
    computer = _computer()
    agent = _runtime_member(status="online")
    workspace = _workspace(status="running")
    db = _FakeSession(
        _ExecuteResult(scalar_one=agent),
        _ExecuteResult(scalar_one=workspace),
    )
    item = agent_api.DaemonWorkspacePayload(
        workspaceId=str(workspace.id),
        agentId=str(agent.id),
        runtime="claude_code",
        status="stopped",
        pid=None,
    )

    updated, updated_agent, created = await agent_api._upsert_daemon_workspace(db, server, computer, item)

    assert created is False
    assert updated is workspace
    assert updated.pid is None
    assert updated_agent.status == "offline"
    assert updated.stopped_at is not None
    assert getattr(updated, "_smallkhoj_realtime_changed") is True


@pytest.mark.asyncio
async def test_daemon_workspace_codex_heartbeat_clears_runtime_command():
    server = SimpleNamespace(id=uuid.uuid4())
    computer = _computer()
    agent = _runtime_member(status="offline")
    workspace = _workspace(status="pending_start")
    workspace.runtime = "codex"
    workspace.runtime_command = "claude"
    db = _FakeSession(
        _ExecuteResult(scalar_one=agent),
        _ExecuteResult(scalar_one=workspace),
    )
    item = agent_api.DaemonWorkspacePayload(
        workspaceId=str(workspace.id),
        agentId=str(agent.id),
        runtime="codex",
        runtimeCommand="claude",
        status="running",
        sessionId="codex-acp-session",
    )

    updated, updated_agent, created = await agent_api._upsert_daemon_workspace(db, server, computer, item)

    assert created is False
    assert updated is workspace
    assert updated.runtime == "codex"
    assert updated.runtime_command is None
    assert updated.status == "running"
    assert updated.session_id == "codex-acp-session"
    assert updated_agent.status == "online"


@pytest.mark.asyncio
async def test_pending_runtime_with_missing_provider_is_marked_failed_without_command():
    workspace = _workspace(status="pending_start")
    workspace.runtime = "codex"
    agent = _runtime_member(
        config={"runtimeProvider": "codex-cli", "runtimeDesiredStatus": "running"},
        status="active",
    )
    computer = _computer(detected_runtimes=[{
        "type": "codex",
        "runtimeProvider": "krill",
        "status": "available",
    }])
    db = _FakeSession(_ExecuteResult(rows=[(workspace, agent, computer)]))

    commands = await pending_runtime_commands(
        db,
        server_id=uuid.uuid4(),
        computer_id=computer.id,
    )

    assert commands == []
    assert workspace.status == "failed"
    assert workspace.pid is None
    assert workspace.stopped_at is not None
    assert agent.status == "offline"
    assert agent.config["runtimeLastError"] == "Runtime provider codex-cli is not available for codex on this computer"
    assert agent.config["runtimeAutostart"] is False
    assert agent.config["runtimeDesiredStatus"] == "stopped"


@pytest.mark.asyncio
async def test_pending_runtime_with_available_provider_returns_start_command():
    workspace = _workspace(status="pending_start")
    workspace.runtime = "codex"
    agent = _runtime_member(config={"runtimeProvider": "krill"})
    computer = _computer(detected_runtimes=[{
        "type": "codex",
        "runtimeProvider": "krill",
        "status": "available",
    }])
    db = _FakeSession(_ExecuteResult(rows=[(workspace, agent, computer)]))

    commands = await pending_runtime_commands(
        db,
        server_id=uuid.uuid4(),
        computer_id=computer.id,
    )

    assert len(commands) == 1
    assert commands[0]["command"]["config"]["runtimeProvider"] == "krill"


def test_clear_workspace_reference_removes_workspace_id_and_disables_autostart():
    workspace_id = uuid.uuid4()
    agent = _runtime_member(config={
        "workspaceId": str(workspace_id),
        "runtimeProvider": "codex-cli",
        "runtimeDesiredStatus": "running",
    })

    clear_workspace_reference(agent, workspace_id)

    assert "workspaceId" not in agent.config
    assert agent.config["runtimeProvider"] == "codex-cli"
    assert agent.config["runtimeAutostart"] is False
    assert agent.config["runtimeDesiredStatus"] == "stopped"


def test_public_api_detaches_agent_from_computer_binding():
    computer_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    agent = _runtime_member(config={
        "computerId": str(computer_id),
        "workspaceId": str(workspace_id),
        "runtimeProvider": "krill",
        "runtimeDesiredStatus": "running",
        "runtimeAutostart": True,
    })
    agent.computer_id = computer_id

    public_api._detach_agent_from_computer(agent)

    assert agent.computer_id is None
    assert "computerId" not in agent.config
    assert "workspaceId" not in agent.config
    assert agent.config["runtimeProvider"] == "krill"
    assert agent.config["runtimeDesiredStatus"] == "stopped"
    assert agent.config["runtimeAutostart"] is False


def test_public_api_delete_blocking_workspace_statuses():
    workspaces = [
        _workspace(status="stopped"),
        _workspace(status="failed"),
        _workspace(status="pending_start"),
        _workspace(status="running"),
    ]

    assert public_api._delete_blocking_workspace_statuses(workspaces) == ["running"]


def test_public_api_stale_starting_workspace_does_not_block_delete():
    old_started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    workspaces = [
        _workspace(status="starting", started_at=old_started_at),
        _workspace(status="restarting", started_at=old_started_at),
    ]

    assert public_api._delete_blocking_workspace_statuses(workspaces) == []


def test_public_api_fresh_starting_workspace_blocks_delete():
    recent_started_at = datetime.now(timezone.utc)
    workspaces = [_workspace(status="starting", started_at=recent_started_at)]

    assert public_api._delete_blocking_workspace_statuses(workspaces) == ["starting"]


@pytest.mark.asyncio
async def test_missing_starting_workspace_is_rearmed_when_autostart_enabled():
    workspace = _workspace(status="starting")
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


def test_public_api_member_patch_updates_human_avatar_url():
    member = _profile_member(kind="human")

    public_api._apply_member_patch(member, {"avatarUrl": "https://example.com/human.png"})

    assert member.avatar_url == "https://example.com/human.png"


def test_public_api_member_patch_ignores_agent_avatar_url():
    member = _profile_member(kind="agent", avatar_url=None)

    public_api._apply_member_patch(member, {"avatarUrl": "https://example.com/agent.png"})

    assert member.avatar_url is None


def test_public_api_channel_member_payload_accepts_single_and_list_ids():
    first_id = uuid.uuid4()
    second_id = uuid.uuid4()

    assert public_api._channel_member_ids_from_body({"memberId": str(first_id)}) == [first_id]
    assert public_api._channel_member_ids_from_body({"memberIds": [str(first_id), str(second_id)]}) == [
        first_id,
        second_id,
    ]


def test_public_api_channel_member_payload_rejects_missing_ids():
    with pytest.raises(HTTPException) as exc:
        public_api._channel_member_ids_from_body({})

    assert exc.value.status_code == 400
    assert exc.value.detail == "Missing memberId"


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


def test_daemon_ws_activity_does_not_extend_conflicting_active_lease():
    now = datetime.now(timezone.utc)
    computer = _computer(
        active_daemon_id="old-daemon",
        lease_expires_at=now + timedelta(seconds=30),
    )

    updated = _apply_daemon_ws_activity(computer, "new-daemon", now)

    assert updated is False
    assert computer.active_daemon_id == "old-daemon"
    assert computer.daemon_lease_expires_at == now + timedelta(seconds=30)


def test_daemon_ws_activity_can_take_over_expired_lease():
    now = datetime.now(timezone.utc)
    computer = _computer(
        active_daemon_id="old-daemon",
        lease_expires_at=now - timedelta(seconds=1),
    )

    updated = _apply_daemon_ws_activity(computer, "new-daemon", now)

    assert updated is True
    assert computer.active_daemon_id == "new-daemon"
    assert computer.daemon_lease_expires_at == now + timedelta(seconds=90)


def _connect_ticket(token: str, *, server_id: uuid.UUID):
    return SimpleNamespace(
        server_id=server_id,
        key_prefix=token[:20],
        token_hash=agent_api._token_hash(token),
        requested_name="Mac-mini.local",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        revoked_at=None,
        consumed_at=None,
    )


@pytest.mark.asyncio
async def test_daemon_connect_reuses_offline_same_name_computer_when_machine_id_changed(monkeypatch):
    token = "sk_connect_same_name_reuse"
    server = SimpleNamespace(id=uuid.uuid4())
    ticket = _connect_ticket(token, server_id=server.id)
    existing = _computer(
        active_daemon_id=None,
        lease_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        status="offline",
    )
    existing.server_id = server.id
    existing.name = "Mac-mini.local"
    existing.machine_id = "old-local-machine-id"
    db = _FakeSession(
        _ExecuteResult(scalar_rows=[ticket]),
        _ExecuteResult(scalar_one=server),
        _ExecuteResult(scalar_one=None),
        _ExecuteResult(scalar_one=existing),
        _ExecuteResult(),
        _ExecuteResult(scalar_rows=[]),
    )
    monkeypatch.setattr(agent_api, "_new_machine_token", lambda: "sk_machine_test_token")

    result = await agent_api.connect_daemon(
        agent_api.DaemonConnectRequest(
            daemonId="daemon-new",
            machineId="new-local-machine-id",
            name="Mac-mini.local",
            os="darwin",
            daemonVersion="0.2.0",
            detectedRuntimes=[{"type": "codex", "status": "available"}],
        ),
        authorization=f"Bearer {token}",
        db=db,
    )

    assert result["connected"] is True
    assert result["computer"]["id"] == str(existing.id)
    assert result["computer"]["machineId"] == "new-local-machine-id"
    assert existing.machine_id == "new-local-machine-id"
    assert existing.active_daemon_id == "daemon-new"
    assert existing.status == "online"
    assert existing.detected_runtimes == [{"type": "codex", "status": "available"}]
    assert ticket.consumed_at is not None
    assert len(db.added) == 1


@pytest.mark.asyncio
async def test_daemon_connect_rejects_version_below_minimum(monkeypatch):
    token = "sk_connect_old_daemon"
    server = SimpleNamespace(id=uuid.uuid4())
    ticket = _connect_ticket(token, server_id=server.id)
    db = _FakeSession(
        _ExecuteResult(scalar_rows=[ticket]),
        _ExecuteResult(scalar_one=server),
    )
    monkeypatch.setattr(agent_api.settings, "minimum_daemon_version", "0.2.0")

    with pytest.raises(HTTPException) as exc:
        await agent_api.connect_daemon(
            agent_api.DaemonConnectRequest(
                daemonId="daemon-old",
                machineId="old-daemon-machine",
                name="Mac-mini.local",
                os="darwin",
                daemonVersion="0.1.9",
            ),
            authorization=f"Bearer {token}",
            db=db,
        )

    assert exc.value.status_code == 426
    assert "minimum supported daemon version is 0.2.0" in exc.value.detail
    assert ticket.consumed_at is None


def test_daemon_heartbeat_accepts_version_field_for_compatibility_checks():
    body = agent_api.DaemonHeartbeatRequest(daemonVersion="0.2.0")

    assert body.daemonVersion == "0.2.0"


@pytest.mark.asyncio
async def test_daemon_connect_rejects_active_same_name_computer_when_machine_id_changed():
    token = "sk_connect_active_same_name"
    server = SimpleNamespace(id=uuid.uuid4())
    ticket = _connect_ticket(token, server_id=server.id)
    existing = _computer(
        active_daemon_id="daemon-active",
        lease_expires_at=datetime.now(timezone.utc) + timedelta(minutes=1),
        status="online",
    )
    existing.server_id = server.id
    existing.name = "Mac-mini.local"
    existing.machine_id = "old-local-machine-id"
    db = _FakeSession(
        _ExecuteResult(scalar_rows=[ticket]),
        _ExecuteResult(scalar_one=server),
        _ExecuteResult(scalar_one=None),
        _ExecuteResult(scalar_one=existing),
    )

    with pytest.raises(HTTPException) as exc:
        await agent_api.connect_daemon(
            agent_api.DaemonConnectRequest(
                daemonId="daemon-new",
                machineId="new-local-machine-id",
                name="Mac-mini.local",
                daemonVersion="0.2.0",
            ),
            authorization=f"Bearer {token}",
            db=db,
        )

    assert exc.value.status_code == 409
    assert exc.value.detail == "Computer already has an active daemon"
    assert existing.machine_id == "old-local-machine-id"
    assert ticket.consumed_at is None


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

    async def fake_push(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(agent_api, "_upsert_daemon_workspace", fake_upsert)
    monkeypatch.setattr(agent_api, "_record_activity", fake_record_activity)
    monkeypatch.setattr(agent_api, "mark_missing_runtimes_pending_start", fake_mark_missing)
    monkeypatch.setattr(agent_api, "pending_runtime_commands", fake_pending_runtime_commands)
    monkeypatch.setattr(agent_api, "_serialize_workspace", fake_serialize_workspace)
    monkeypatch.setattr(agent_api, "_serialize_computer", fake_serialize_computer)
    monkeypatch.setattr(agent_api, "_push_committed_events", fake_push)

    body = agent_api.DaemonHeartbeatRequest(
        daemonId="daemon-a",
        daemonVersion="0.2.0",
        status="online",
        workspaces=[agent_api.DaemonWorkspacePayload(workspaceId=str(workspace_id), agentId=str(agent_id))],
    )

    result = await agent_api.daemon_heartbeat(body, machine=(computer, server, object()), db=_FakeSession())

    assert result["ok"] is True
    assert recorded_activity_kinds == []


@pytest.mark.asyncio
async def test_daemon_heartbeat_records_computer_status_event_on_status_change(monkeypatch):
    pushed = []
    server = SimpleNamespace(id=uuid.uuid4())
    computer = SimpleNamespace(
        id=uuid.uuid4(),
        name="local-dev",
        status="offline",
        active_daemon_id="daemon-a",
        daemon_lease_expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
        last_heartbeat_at=None,
        detected_runtimes=[],
    )

    async def fake_mark_missing(*_args, **_kwargs):
        return []

    async def fake_pending_runtime_commands(*_args, **_kwargs):
        return []

    async def fake_serialize_computer(_db, item):
        return {"id": str(item.id), "status": item.status}

    async def fake_push(*_args, **_kwargs):
        pushed.append(True)
        return 1

    monkeypatch.setattr(agent_api, "mark_missing_runtimes_pending_start", fake_mark_missing)
    monkeypatch.setattr(agent_api, "pending_runtime_commands", fake_pending_runtime_commands)
    monkeypatch.setattr(agent_api, "_serialize_computer", fake_serialize_computer)
    monkeypatch.setattr(agent_api, "_push_committed_events", fake_push)

    body = agent_api.DaemonHeartbeatRequest(
        daemonId="daemon-a",
        daemonVersion="0.2.0",
        status="online",
        workspaces=[],
    )
    db = _FakeSession()

    result = await agent_api.daemon_heartbeat(body, machine=(computer, server, object()), db=db)

    assert result["ok"] is True
    assert pushed == [True]
    assert len(db.added) == 1
    assert db.added[0].event_type == "computer.status.updated"
    assert db.added[0].payload["computerId"] == str(computer.id)
    assert db.added[0].payload["previousStatus"] == "offline"
    assert db.added[0].payload["status"] == "online"


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
async def test_pending_visible_task_events_are_scoped_to_task_assignee():
    server_id = uuid.uuid4()
    computer_id = uuid.uuid4()
    assignee_id = uuid.uuid4()
    other_agent_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    task_id = uuid.uuid4()
    assignee = _member(assignee_id, computer_id=computer_id)
    other_agent = _member(other_agent_id, computer_id=computer_id)
    task_update = _event(
        150,
        event_type="task.updated",
        actor_id=assignee_id,
        channel_id=channel_id,
        task_id=task_id,
        payload={"taskNumber": 7, "status": "in_review"},
    )
    db = _FakeSession(
        _ExecuteResult(scalar_rows=[assignee, other_agent]),
        _ExecuteResult(rows=[(assignee_id, channel_id), (other_agent_id, channel_id)]),
        _ExecuteResult(scalar_rows=[task_update]),
        _ExecuteResult(scalar_one=assignee_id),
    )

    events, scanned_cursor = await pending_visible_events_for_computer(
        db,
        server_id=server_id,
        computer_id=computer_id,
        event_cursor=149,
    )

    assert scanned_cursor == 150
    assert len(events) == 1
    assert events[0]["targetAgentId"] == str(assignee_id)
    assert events[0]["assigneeId"] == str(assignee_id)


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
