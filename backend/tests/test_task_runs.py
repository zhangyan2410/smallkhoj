from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
import uuid

import pytest

import models.seed as seed
import routers.public_api as public_api
import routers.agent_api as agent_api
from models import Base, TaskAssignment, TaskRun
from services.task_runs import create_task_assignment_and_run, serialize_task_run, update_task_run_lifecycle


class _ExecuteResult:
    def __init__(self, value=None, scalar_rows=None):
        self._value = value
        self._scalar_rows = scalar_rows or []

    def scalar_one_or_none(self):
        return self._value

    def scalar(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return self._scalar_rows

    def one_or_none(self):
        return self._value


class _FakeSession:
    def __init__(self, *results):
        self._results = list(results)
        self.added = []
        self.flushed = False

    async def execute(self, _statement):
        return self._results.pop(0)

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        self.flushed = True
        for item in self.added:
            if getattr(item, "id", None) is None:
                item.id = uuid.uuid4()

    async def commit(self):
        self.committed = True

    async def refresh(self, _item):
        self.refreshed = True


class _JsonRequest:
    headers = {}
    cookies = {}
    query_params = {}

    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


class _SeedConn:
    def __init__(self):
        self.statements = []

    async def run_sync(self, callback):
        self.run_sync_callback = callback

    async def execute(self, statement):
        self.statements.append(str(statement))


class _SeedBegin:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _SeedEngine:
    def __init__(self):
        self.conn = _SeedConn()

    def begin(self):
        return _SeedBegin(self.conn)


@pytest.mark.asyncio
async def test_startup_seed_emits_task_assignment_and_run_table_ddl(monkeypatch):
    fake_engine = _SeedEngine()
    monkeypatch.setattr(seed, "engine", fake_engine)

    await seed.create_tables()

    statements = "\n".join(fake_engine.conn.statements)
    assert "CREATE TABLE IF NOT EXISTS task_assignments" in statements
    assert "CREATE TABLE IF NOT EXISTS task_runs" in statements
    assert "CREATE INDEX IF NOT EXISTS idx_task_runs_task" in statements
    assert "CREATE INDEX IF NOT EXISTS idx_task_assignments_assignee" in statements


def test_task_run_tables_are_declared_with_runtime_context_columns():
    assignment_table = Base.metadata.tables["task_assignments"]
    run_table = Base.metadata.tables["task_runs"]

    assert {"task_id", "assignee_id", "role", "assignment_mode", "status"} <= set(assignment_table.c.keys())
    assert {
        "task_id",
        "assignment_id",
        "agent_id",
        "runtime_workspace_id",
        "workspace_session_id",
        "runtime_session_id",
        "context_session_id",
        "prompt_profile",
        "context_scope",
        "context_usage",
        "token_usage",
        "failure_code",
        "output_message_id",
    } <= set(run_table.c.keys())


@pytest.mark.asyncio
async def test_agent_assignment_creates_queued_task_run_with_independent_context_session():
    task_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    message_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    creator_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    computer_id = uuid.uuid4()

    task = SimpleNamespace(
        id=task_id,
        channel_id=channel_id,
        message_id=message_id,
        data={"source": {"threadId": str(message_id)}},
    )
    agent = SimpleNamespace(id=agent_id, kind="agent")
    workspace = SimpleNamespace(
        id=workspace_id,
        computer_id=computer_id,
        runtime="claude_code",
        runtime_command=None,
        runtime_model="minimax",
        session_id="workspace-session-1",
        cwd="/tmp/agent-workspace",
        status="running",
    )
    db = _FakeSession(_ExecuteResult(workspace))

    assignment, run = await create_task_assignment_and_run(
        db,
        task=task,
        assignee=agent,
        assigned_by_id=creator_id,
        role="worker",
        assignment_mode="direct_drag",
        trigger_type="direct_drag",
    )

    assert db.flushed is True
    assert isinstance(assignment, TaskAssignment)
    assert isinstance(run, TaskRun)
    assert assignment.task_id == task_id
    assert assignment.assignee_id == agent_id
    assert assignment.role == "worker"
    assert assignment.assignment_mode == "direct_drag"
    assert assignment.status == "active"
    assert run.task_id == task_id
    assert run.assignment_id == assignment.id
    assert run.agent_id == agent_id
    assert run.channel_id == channel_id
    assert run.source_message_id == message_id
    assert run.thread_root_message_id == message_id
    assert run.status == "queued"
    assert run.trigger_type == "direct_drag"
    assert run.runtime_workspace_id == workspace_id
    assert run.computer_id == computer_id
    assert run.runtime == "claude_code"
    assert run.runtime_model == "minimax"
    assert run.workspace_session_id == "workspace-session-1"
    assert run.context_scope == "task"
    assert run.prompt_profile == "task.worker"
    assert run.context_session_id
    assert run.context_session_id != run.workspace_session_id
    assert str(task_id) in run.context_session_id


@pytest.mark.asyncio
async def test_non_agent_assignment_does_not_create_runtime_run():
    task = SimpleNamespace(id=uuid.uuid4(), channel_id=uuid.uuid4(), message_id=None, data={})
    human = SimpleNamespace(id=uuid.uuid4(), kind="human")
    db = _FakeSession()

    assignment, run = await create_task_assignment_and_run(
        db,
        task=task,
        assignee=human,
        assigned_by_id=uuid.uuid4(),
    )

    assert assignment is None
    assert run is None
    assert db.added == []


@pytest.mark.asyncio
async def test_update_task_run_lifecycle_marks_running_with_context_usage():
    run_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    run = SimpleNamespace(
        id=run_id,
        agent_id=agent_id,
        status="queued",
        runtime_session_id=None,
        workspace_session_id="workspace-session",
        context_session_id="context-session",
        context_usage={},
        token_usage={},
        tool_usage_summary={},
        output_message_id=None,
        failure_code=None,
        failure_reason=None,
        started_at=None,
        completed_at=None,
        updated_at=None,
    )
    db = _FakeSession(_ExecuteResult(run))

    updated = await update_task_run_lifecycle(
        db,
        run_id=run_id,
        agent_id=agent_id,
        status="running",
        runtime_session_id="provider-session-1",
        context_usage={"occupancyRatio": 0.52, "source": "runtime_usage_event"},
    )

    assert updated is run
    assert run.status == "running"
    assert run.started_at is not None
    assert run.started_at.tzinfo == timezone.utc
    assert run.updated_at.tzinfo == timezone.utc
    assert run.completed_at is None
    assert run.runtime_session_id == "provider-session-1"
    assert run.context_usage["occupancyRatio"] == 0.52
    assert db.flushed is True


@pytest.mark.asyncio
async def test_update_task_run_lifecycle_backfills_workspace_from_report():
    run_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    computer_id = uuid.uuid4()
    run = SimpleNamespace(
        id=run_id,
        agent_id=agent_id,
        status="queued",
        runtime_workspace_id=None,
        computer_id=None,
        runtime=None,
        runtime_provider=None,
        runtime_model=None,
        workspace_session_id=None,
        cwd=None,
        runtime_session_id=None,
        context_session_id="context-session",
        context_usage={},
        token_usage={},
        tool_usage_summary={},
        output_message_id=None,
        failure_code=None,
        failure_reason=None,
        started_at=None,
        completed_at=None,
        updated_at=None,
    )
    workspace = SimpleNamespace(
        id=workspace_id,
        agent_id=agent_id,
        computer_id=computer_id,
        runtime="claude_code",
        runtime_provider="MiniMax",
        runtime_model="MiniMax-M3",
        session_id="workspace-session",
        cwd="/tmp/work",
    )
    db = _FakeSession(_ExecuteResult(run), _ExecuteResult(workspace))

    updated = await update_task_run_lifecycle(
        db,
        run_id=run_id,
        agent_id=agent_id,
        status="running",
        workspace_id=workspace_id,
    )

    assert updated is run
    assert run.runtime_workspace_id == workspace_id
    assert run.computer_id == computer_id
    assert run.runtime == "claude_code"
    assert run.runtime_provider == "MiniMax"
    assert run.runtime_model == "MiniMax-M3"
    assert run.workspace_session_id == "workspace-session"
    assert run.cwd == "/tmp/work"
    assert db.flushed is True


@pytest.mark.asyncio
async def test_update_task_run_lifecycle_marks_completed_with_token_and_output_evidence():
    run_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    output_message_id = uuid.uuid4()
    run = SimpleNamespace(
        id=run_id,
        agent_id=agent_id,
        status="running",
        runtime_session_id="provider-session-1",
        workspace_session_id="workspace-session",
        context_session_id="context-session",
        context_usage={},
        token_usage={},
        tool_usage_summary={},
        output_message_id=None,
        failure_code=None,
        failure_reason=None,
        started_at=None,
        completed_at=None,
        updated_at=None,
    )
    db = _FakeSession(_ExecuteResult(run))

    updated = await update_task_run_lifecycle(
        db,
        run_id=run_id,
        agent_id=agent_id,
        status="completed",
        token_usage={"inputTokens": 100, "outputTokens": 20},
        tool_usage_summary={"calls": 2},
        output_message_id=output_message_id,
    )

    assert updated is run
    assert run.status == "completed"
    assert run.started_at is not None
    assert run.completed_at is not None
    assert run.started_at.tzinfo == timezone.utc
    assert run.completed_at.tzinfo == timezone.utc
    assert run.updated_at.tzinfo == timezone.utc
    assert run.token_usage["inputTokens"] == 100
    assert run.tool_usage_summary["calls"] == 2
    assert run.output_message_id == output_message_id
    assert db.flushed is True


@pytest.mark.asyncio
async def test_agent_task_run_lifecycle_endpoint_updates_current_agent_run(monkeypatch):
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    member = SimpleNamespace(id=agent_id, display_name="worker", kind="agent")
    server = SimpleNamespace(id=uuid.uuid4())
    run = SimpleNamespace(
        id=run_id,
        task_id=task_id,
        assignment_id=None,
        agent_id=agent_id,
        channel_id=channel_id,
        source_message_id=None,
        thread_root_message_id=None,
        parent_run_id=None,
        attempt=1,
        status="running",
        trigger_type="task_created",
        runtime_workspace_id=None,
        computer_id=None,
        daemon_id=None,
        runtime="claude_code",
        runtime_provider=None,
        runtime_model="minimax",
        prompt_profile="task.worker",
        workspace_session_id="workspace-session",
        runtime_session_id="provider-session-1",
        context_session_id=f"task:{task_id}:role:worker:run:{run_id}",
        cwd="/tmp/work",
        context_scope="task",
        context_summary={},
        context_usage={"occupancyRatio": 0.33},
        token_usage={"inputTokens": 10},
        tool_usage_summary={},
        output_message_id=None,
        failure_code=None,
        failure_reason=None,
        started_at=None,
        completed_at=None,
        created_at=None,
        updated_at=None,
    )
    calls = []

    async def fake_update_task_run_lifecycle(db_arg, **kwargs):
        calls.append(kwargs)
        return run

    monkeypatch.setattr(agent_api, "update_task_run_lifecycle", fake_update_task_run_lifecycle, raising=False)

    response = await agent_api.update_task_run_lifecycle_endpoint(
        str(run_id),
        SimpleNamespace(
            status="running",
            runtimeSessionId="provider-session-1",
            workspaceSessionId="workspace-session",
            contextSessionId=None,
            contextUsage={"occupancyRatio": 0.33},
            tokenUsage={"inputTokens": 10},
            toolUsageSummary=None,
            outputMessageId=None,
            failureCode=None,
            failureReason=None,
        ),
        agent=(member, server),
        db=_FakeSession(),
    )

    assert response["ok"] is True
    assert calls[0]["run_id"] == run_id
    assert calls[0]["agent_id"] == agent_id
    assert calls[0]["status"] == "running"
    assert calls[0]["runtime_session_id"] == "provider-session-1"
    assert calls[0]["context_usage"]["occupancyRatio"] == 0.33
    assert response["run"]["id"] == str(run_id)
    assert response["run"]["runtimeSessionId"] == "provider-session-1"


def test_serialize_task_run_uses_public_camel_case_contract():
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    run = SimpleNamespace(
        id=run_id,
        task_id=task_id,
        assignment_id=None,
        agent_id=agent_id,
        channel_id=uuid.uuid4(),
        source_message_id=None,
        thread_root_message_id=None,
        attempt=1,
        status="queued",
        trigger_type="task_created",
        runtime_workspace_id=workspace_id,
        computer_id=None,
        daemon_id=None,
        runtime="claude_code",
        runtime_provider="MiniMax",
        runtime_model="minimax",
        prompt_profile="task.worker",
        workspace_session_id="workspace-session",
        runtime_session_id=None,
        context_session_id=f"task:{task_id}:run:{run_id}",
        cwd="/tmp/work",
        context_scope="task",
        context_summary={"source": "task"},
        context_usage={"occupancyRatio": 0.25},
        token_usage={"inputTokens": 100},
        tool_usage_summary={"calls": 1},
        output_message_id=None,
        failure_code=None,
        failure_reason=None,
        started_at=None,
        completed_at=None,
        created_at=None,
        updated_at=None,
    )

    payload = serialize_task_run(run)

    assert payload["id"] == str(run_id)
    assert payload["taskId"] == str(task_id)
    assert payload["agentId"] == str(agent_id)
    assert payload["runtimeWorkspaceId"] == str(workspace_id)
    assert payload["workspaceSessionId"] == "workspace-session"
    assert payload["contextSessionId"] == f"task:{task_id}:run:{run_id}"
    assert payload["promptProfile"] == "task.worker"
    assert payload["contextUsage"]["occupancyRatio"] == 0.25
    assert payload["progressState"] == "waiting"
    assert payload["progressLabel"] == "queued"
    assert payload["usageSummary"]["inputTokens"] == 100
    assert payload["usageSummary"]["totalTokens"] == 100
    assert payload["usageSummary"]["contextOccupancyRatio"] == 0.25
    assert payload["evidenceIssues"] == []


def test_serialize_completed_task_run_classifies_missing_evidence():
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    run = SimpleNamespace(
        id=run_id,
        task_id=task_id,
        assignment_id=None,
        agent_id=agent_id,
        channel_id=uuid.uuid4(),
        source_message_id=None,
        thread_root_message_id=None,
        parent_run_id=None,
        attempt=1,
        status="completed",
        trigger_type="task_created",
        runtime_workspace_id=uuid.uuid4(),
        computer_id=uuid.uuid4(),
        daemon_id=None,
        runtime="claude_code",
        runtime_provider="MiniMax",
        runtime_model="MiniMax-M3",
        prompt_profile="task.worker",
        workspace_session_id="workspace-session",
        runtime_session_id="provider-session",
        context_session_id=f"task:{task_id}:role:worker:run:{run_id}",
        cwd="/tmp/work",
        context_scope="task",
        context_summary={},
        context_usage={},
        token_usage={"source": "provider-stream-json"},
        tool_usage_summary={},
        output_message_id=None,
        failure_code=None,
        failure_reason=None,
        started_at=None,
        completed_at=None,
        created_at=None,
        updated_at=None,
    )

    payload = serialize_task_run(run)

    assert payload["progressState"] == "completed"
    assert payload["progressLabel"] == "completed_missing_evidence"
    assert payload["usageSummary"]["inputTokens"] is None
    assert payload["usageSummary"]["toolCalls"] is None
    assert payload["evidenceIssues"] == [
        "TASK_RUN_OUTPUT_MISSING",
        "TASK_RUN_TOKEN_USAGE_MISSING",
        "TASK_RUN_CONTEXT_USAGE_MISSING",
        "TASK_RUN_TOOL_USAGE_MISSING",
    ]


def test_serialize_running_task_run_surfaces_pending_result_staleness():
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    stale_at = datetime.utcnow() - timedelta(minutes=8)
    run = SimpleNamespace(
        id=run_id,
        task_id=task_id,
        assignment_id=None,
        agent_id=agent_id,
        channel_id=uuid.uuid4(),
        source_message_id=None,
        thread_root_message_id=None,
        parent_run_id=None,
        attempt=1,
        status="running",
        trigger_type="task_created",
        runtime_workspace_id=uuid.uuid4(),
        computer_id=uuid.uuid4(),
        daemon_id=None,
        runtime="claude_code",
        runtime_provider="MiniMax",
        runtime_model="MiniMax-M3",
        prompt_profile="task.worker",
        workspace_session_id="workspace-session",
        runtime_session_id="provider-session",
        context_session_id=f"task:{task_id}:role:worker:run:{run_id}",
        cwd="/tmp/work",
        context_scope="task",
        context_summary={},
        context_usage={},
        token_usage={},
        tool_usage_summary={},
        output_message_id=None,
        failure_code=None,
        failure_reason=None,
        started_at=stale_at,
        completed_at=None,
        created_at=stale_at,
        updated_at=stale_at,
    )

    payload = serialize_task_run(run)

    assert payload["progressState"] == "working"
    assert payload["progressLabel"] == "running_result_pending"
    assert payload["stale"] is True
    assert payload["runtimePendingMs"] >= 8 * 60 * 1000
    assert payload["lastUpdateAgeMs"] >= 8 * 60 * 1000
    assert payload["evidenceIssues"] == ["TASK_RUN_RESULT_PENDING"]


def test_serialize_completed_task_run_classifies_missing_context_window():
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    run = SimpleNamespace(
        id=run_id,
        task_id=task_id,
        assignment_id=None,
        agent_id=uuid.uuid4(),
        channel_id=uuid.uuid4(),
        source_message_id=None,
        thread_root_message_id=None,
        parent_run_id=None,
        attempt=1,
        status="completed",
        trigger_type="task_created",
        runtime_workspace_id=uuid.uuid4(),
        computer_id=uuid.uuid4(),
        daemon_id=None,
        runtime="claude_code",
        runtime_provider="MiniMax",
        runtime_model="MiniMax-M3",
        prompt_profile="task.worker",
        workspace_session_id="workspace-session",
        runtime_session_id="provider-session",
        context_session_id=f"task:{task_id}:role:worker:run:{run_id}",
        cwd="/tmp/work",
        context_scope="task",
        context_summary={},
        context_usage={"source": "provider-stream-json", "knownTokens": 1200},
        token_usage={"source": "provider-stream-json", "totalTokens": 1200},
        tool_usage_summary={"toolUseCount": 0, "toolResultCount": 0},
        output_message_id=uuid.uuid4(),
        failure_code=None,
        failure_reason=None,
        started_at=None,
        completed_at=None,
        created_at=None,
        updated_at=None,
    )

    payload = serialize_task_run(run)

    assert payload["usageSummary"]["contextKnownTokens"] == 1200
    assert payload["usageSummary"]["contextWindow"] is None
    assert "TASK_RUN_CONTEXT_WINDOW_MISSING" in payload["evidenceIssues"]
    assert "TASK_RUN_CONTEXT_USAGE_MISSING" not in payload["evidenceIssues"]
    assert "TASK_RUN_TOOL_USAGE_MISSING" not in payload["evidenceIssues"]


@pytest.mark.asyncio
async def test_public_task_serializer_includes_task_runs():
    task_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    creator_id = uuid.uuid4()
    assignee_id = uuid.uuid4()
    run_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    task = SimpleNamespace(
        id=task_id,
        task_number=7,
        channel_id=channel_id,
        message_id=None,
        title="Ship channel task runs",
        description=None,
        status="todo",
        creator_id=creator_id,
        assignee_id=assignee_id,
        data={},
        created_at=None,
        updated_at=None,
    )
    creator = SimpleNamespace(
        id=creator_id,
        display_name="zy-ean",
        kind="human",
        status="online",
        description=None,
        avatar_url=None,
        skills=[],
        config={},
        computer_id=None,
        backend=None,
    )
    assignee = SimpleNamespace(
        id=assignee_id,
        display_name="minimax",
        kind="agent",
        status="online",
        description=None,
        avatar_url=None,
        skills=[],
        config={},
        computer_id=None,
        backend=None,
    )
    channel = SimpleNamespace(id=channel_id, name="work", kind="public")
    run = SimpleNamespace(
        id=run_id,
        task_id=task_id,
        assignment_id=None,
        agent_id=assignee_id,
        channel_id=channel_id,
        source_message_id=None,
        thread_root_message_id=None,
        parent_run_id=None,
        attempt=1,
        status="queued",
        trigger_type="task_created",
        runtime_workspace_id=workspace_id,
        computer_id=None,
        daemon_id=None,
        runtime="claude_code",
        runtime_provider=None,
        runtime_model="minimax",
        prompt_profile="task.worker",
        workspace_session_id="workspace-session",
        runtime_session_id=None,
        context_session_id=f"task:{task_id}:run:{run_id}",
        cwd="/tmp/work",
        context_scope="task",
        context_summary={},
        context_usage={},
        token_usage={},
        tool_usage_summary={},
        output_message_id=None,
        failure_code=None,
        failure_reason=None,
        started_at=None,
        completed_at=None,
        created_at=None,
        updated_at=None,
    )
    db = _FakeSession(
        _ExecuteResult(creator),
        _ExecuteResult(assignee),
        _ExecuteResult(None),
        _ExecuteResult(channel),
        _ExecuteResult(scalar_rows=[run]),
    )

    payload = await public_api._serialize_task(db, task)

    assert payload["runs"][0]["id"] == str(run_id)
    assert payload["runs"][0]["runtimeWorkspaceId"] == str(workspace_id)
    assert payload["runs"][0]["workspaceSessionId"] == "workspace-session"


@pytest.mark.asyncio
async def test_public_create_task_creates_task_run_for_agent_assignment(monkeypatch):
    server = SimpleNamespace(id=uuid.uuid4())
    channel = SimpleNamespace(id=uuid.uuid4(), name="work", kind="public")
    creator = SimpleNamespace(
        id=uuid.uuid4(),
        display_name="zy-ean",
        kind="human",
        status="online",
        description=None,
        avatar_url=None,
        skills=[],
        config={},
        computer_id=None,
        backend=None,
    )
    assignee = SimpleNamespace(
        id=uuid.uuid4(),
        display_name="minimax",
        kind="agent",
        status="online",
        description=None,
        avatar_url=None,
        skills=[],
        config={},
        computer_id=None,
        backend=None,
    )
    run_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    run = SimpleNamespace(
        id=run_id,
        task_id=None,
        assignment_id=None,
        agent_id=assignee.id,
        channel_id=channel.id,
        source_message_id=None,
        thread_root_message_id=None,
        parent_run_id=None,
        attempt=1,
        status="queued",
        trigger_type="task_created",
        runtime_workspace_id=workspace_id,
        computer_id=None,
        daemon_id=None,
        runtime="claude_code",
        runtime_provider=None,
        runtime_model="minimax",
        prompt_profile="task.worker",
        workspace_session_id="workspace-session",
        runtime_session_id=None,
        context_session_id=f"task:pending:run:{run_id}",
        cwd="/tmp/work",
        context_scope="task",
        context_summary={},
        context_usage={},
        token_usage={},
        tool_usage_summary={},
        output_message_id=None,
        failure_code=None,
        failure_reason=None,
        started_at=None,
        completed_at=None,
        created_at=None,
        updated_at=None,
    )
    db = _FakeSession(
        _ExecuteResult(server),
        _ExecuteResult(channel),
        _ExecuteResult(creator),
        _ExecuteResult(assignee),
        _ExecuteResult(0),
        _ExecuteResult(creator),
        _ExecuteResult(assignee),
        _ExecuteResult(None),
        _ExecuteResult(channel),
        _ExecuteResult(scalar_rows=[run]),
    )
    calls = []

    async def fake_create_task_assignment_and_run(db_arg, **kwargs):
        calls.append(kwargs)
        run.task_id = kwargs["task"].id
        run.context_session_id = f"task:{kwargs['task'].id}:run:{run_id}"
        return SimpleNamespace(id=uuid.uuid4()), run

    async def fake_push(_db, *, server_id):
        return 0

    monkeypatch.setattr(public_api, "create_task_assignment_and_run", fake_create_task_assignment_and_run)
    monkeypatch.setattr(public_api, "_push_committed_events", fake_push)

    response = await public_api.create_task(
        _JsonRequest({"channel": "#work", "creator": "@zy-ean", "assignee": "@minimax", "title": "Run it"}),
        _auth=None,
        db=db,
    )

    assert response["created"] is True
    assert calls
    assert calls[0]["assignee"] is assignee
    assert calls[0]["assigned_by_id"] == creator.id
    assert calls[0]["role"] == "worker"
    assert calls[0]["assignment_mode"] == "task_created"
    assert calls[0]["trigger_type"] == "task_created"
    assert response["task"]["runs"][0]["id"] == str(run_id)


@pytest.mark.asyncio
async def test_agent_create_task_targets_worker_and_creates_task_run(monkeypatch):
    server = SimpleNamespace(id=uuid.uuid4())
    channel = SimpleNamespace(id=uuid.uuid4(), name="work", kind="public")
    architect = SimpleNamespace(
        id=uuid.uuid4(),
        display_name="architect",
        kind="agent",
        config={},
    )
    worker = SimpleNamespace(id=uuid.uuid4(), display_name="worker", kind="agent")
    run_id = uuid.uuid4()
    db = _FakeSession(
        _ExecuteResult(channel),
        _ExecuteResult(0),
        _ExecuteResult(worker),
    )
    calls = []
    activities = []

    async def fake_create_task_assignment_and_run(db_arg, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(id=run_id)

    async def fake_record_activity(db_arg, server_arg, agent_arg, kind, description, details, channel_id=None, task_id=None):
        activities.append(
            {
                "kind": kind,
                "details": details,
                "channel_id": channel_id,
                "task_id": task_id,
            }
        )
        return SimpleNamespace(id=uuid.uuid4())

    async def fake_push(_db, *, server_id):
        return 0

    async def fake_serialize_task(db_arg, task):
        return {"id": str(task.id), "runs": []}

    monkeypatch.setattr(agent_api, "create_task_assignment_and_run", fake_create_task_assignment_and_run)
    monkeypatch.setattr(agent_api, "_record_activity", fake_record_activity)
    monkeypatch.setattr(agent_api, "_push_committed_events", fake_push)
    monkeypatch.setattr(agent_api, "_serialize_task", fake_serialize_task)

    response = await agent_api.create_tasks(
        _JsonRequest({"channel": "#work", "assignee": "@worker", "title": "Implement worker slice"}),
        agent=(architect, server),
        db=db,
    )

    assert response["created"] is True
    assert calls
    assert calls[0]["task"].assignee_id == worker.id
    assert calls[0]["assignee"] is worker
    assert calls[0]["assigned_by_id"] == architect.id
    assert activities[0]["details"]["assigneeId"] == str(worker.id)
    assert activities[0]["details"]["targetAgentId"] == str(worker.id)
    assert activities[0]["details"]["taskRunId"] == str(run_id)
