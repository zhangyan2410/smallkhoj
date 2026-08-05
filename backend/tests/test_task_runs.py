import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import models.seed as seed
import routers.agent_api as agent_api
import routers.public_api as public_api
from models import Base, TaskAssignment, TaskRun, TaskRunTemplate
from services.task_run_templates import create_template, update_template
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
        self.committed = False
        self.refreshed = False

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


def _patch_active_server_context(monkeypatch, server, *, member=None):
    async def fake_resolve_active_server_context(db, request):
        return SimpleNamespace(server=server, member=member)

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_resolve_active_server_context)


class _SeedConn:
    def __init__(self):
        self.statements = []

    async def run_sync(self, callback):
        self.run_sync_callback = callback

    async def execute(self, statement, _parameters=None):
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
async def test_startup_seed_emits_builtin_task_run_templates(monkeypatch):
    """Schema (tables/indexes/constraints) is owned by Alembic — see the
    ``0001_baseline`` migration for task_assignments/task_runs/task_run_templates
    DDL and the ck_task_assignments_mode CHECK (incl. 'external_feishu').
    seed.create_tables() now only emits runtime data seeding; this test guards
    the builtin-template INSERTs that ship with the app.
    """
    fake_engine = _SeedEngine()
    monkeypatch.setattr(seed, "engine", fake_engine)

    await seed.create_tables()

    statements = "\n".join(fake_engine.conn.statements)
    assert "INSERT INTO task_run_templates" in statements
    assert "general-task-runner" in statements
    assert "research-analyst" in statements
    assert "created_at" in statements
    assert "updated_at" in statements
    # Schema DDL must NOT be emitted by create_tables() anymore — it lives in
    # the Alembic baseline migration. If any of these appear, schema has crept
    # back into seed.py.
    assert "CREATE TABLE IF NOT EXISTS task_assignments" not in statements
    assert "CREATE TABLE IF NOT EXISTS task_run_templates" not in statements
    assert "CREATE INDEX IF NOT EXISTS idx_task_runs_task" not in statements


def test_task_run_tables_are_declared_with_runtime_context_columns():
    assignment_table = Base.metadata.tables["task_assignments"]
    run_table = Base.metadata.tables["task_runs"]
    template_table = Base.metadata.tables["task_run_templates"]

    assert {
        "slug",
        "name",
        "system_instruction",
        "tool_policy",
        "skill_policy",
        "memory_policy",
        "output_policy",
        "runtime_policy",
        "start_policy",
        "role_presets",
        "status",
    } <= set(template_table.c.keys())
    assert {
        "task_id",
        "assignee_id",
        "role",
        "role_key",
        "role_snapshot",
        "assignment_mode",
        "status",
        "template_id",
        "template_snapshot",
        "execution_strategy",
        "run_order",
    } <= set(assignment_table.c.keys())
    assert {
        "task_id",
        "assignment_id",
        "agent_id",
        "template_id",
        "template_snapshot",
        "role_key",
        "role_snapshot",
        "runtime_workspace_id",
        "workspace_session_id",
        "runtime_session_id",
        "context_session_id",
        "prompt_profile",
        "completion_policy",
        "output_refs",
        "context_scope",
        "context_usage",
        "token_usage",
        "failure_code",
        "output_message_id",
    } <= set(run_table.c.keys())
    assignment_mode_constraint = next(
        constraint for constraint in assignment_table.constraints if constraint.name == "ck_task_assignments_mode"
    )
    assert "external_feishu" in str(assignment_mode_constraint.sqltext)


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
    assert run.prompt_profile == "task.general"
    assert run.context_session_id
    assert run.context_session_id != run.workspace_session_id
    assert str(task_id) in run.context_session_id
    assert ":role:general:" in run.context_session_id
    assert run.template_snapshot["slug"] == "general-task-runner"
    assert run.role_key == "general"
    assert run.role_snapshot["roleKey"] == "general"
    assert run.completion_policy == "single_turn_result"


@pytest.mark.asyncio
async def test_agent_assignment_snapshots_task_run_template_and_role_policies():
    task_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    template_id = uuid.uuid4()
    role_snapshot = {
        "roleKey": "researcher",
        "displayName": "Research Analyst",
        "purpose": "Find useful facts and produce sourced notes.",
        "toolPolicy": {"allow": ["slock", "web"]},
        "skillPolicy": {"required": ["research"]},
        "memoryPolicy": {"readScopes": ["channel", "task"]},
        "outputPolicy": {"required": ["message", "memory"]},
        "runtimePolicy": {"contextIsolation": "required"},
        "loopPolicy": {"completionPolicy": "single_turn_result"},
    }
    template_snapshot = {
        "id": str(template_id),
        "slug": "research-analyst",
        "name": "Research Analyst",
        "updatedAt": "2026-06-25T00:00:00+00:00",
        "rolePresets": [role_snapshot],
        "toolPolicy": {"allow": ["slock"]},
        "skillPolicy": {"required": ["research"]},
        "memoryPolicy": {"readScopes": ["channel", "task"]},
        "outputPolicy": {"required": ["message"]},
        "runtimePolicy": {"contextIsolation": "required"},
        "startPolicy": {"autoStart": True},
    }
    task = SimpleNamespace(id=task_id, channel_id=channel_id, message_id=None, data={})
    agent = SimpleNamespace(id=agent_id, kind="agent")
    db = _FakeSession(_ExecuteResult(None))

    assignment, run = await create_task_assignment_and_run(
        db,
        task=task,
        assignee=agent,
        assigned_by_id=uuid.uuid4(),
        role="researcher",
        role_key="researcher",
        template_id=template_id,
        template_snapshot=template_snapshot,
        role_snapshot=role_snapshot,
        execution_strategy="parallel",
    )

    assert assignment.template_id == template_id
    assert assignment.template_snapshot["slug"] == "research-analyst"
    assert assignment.role == "researcher"
    assert assignment.role_key == "researcher"
    assert assignment.role_snapshot["displayName"] == "Research Analyst"
    assert assignment.execution_strategy == "parallel"
    assert run.template_id == template_id
    assert run.template_snapshot["slug"] == "research-analyst"
    assert run.role_key == "researcher"
    assert run.role_snapshot["toolPolicy"]["allow"] == ["slock", "web"]
    assert run.prompt_profile == "task.researcher"
    assert run.context_summary["template"]["slug"] == "research-analyst"
    assert run.context_summary["legacyRole"] == "researcher"
    assert run.context_summary["role"]["roleKey"] == "researcher"


@pytest.mark.asyncio
async def test_task_run_template_service_validates_structured_role_presets():
    db = _FakeSession()
    server_id = uuid.uuid4()

    with pytest.raises(ValueError, match="rolePresets\\[0\\]\\.roleKey"):
        await create_template(
            db,
            {
                "slug": "bad-role-template",
                "name": "Bad Role Template",
                "systemInstruction": "Do work.",
                "rolePresets": [{"displayName": "Missing Key"}],
            },
            server_id=server_id,
        )

    template = await create_template(
        db,
        {
            "slug": "research-notes",
            "name": "Research Notes",
            "systemInstruction": "Research the task and write durable notes.",
            "toolPolicy": {"allowedToolGroups": ["slock", "web"]},
            "skillPolicy": {"requiredSkills": ["research"]},
            "memoryPolicy": {"readScopes": ["channel", "task"], "writeScopes": ["task"]},
            "outputPolicy": {"expectedOutputTypes": ["message", "memory"], "multipleOutputsAllowed": True},
            "runtimePolicy": {"contextIsolation": "required"},
            "startPolicy": {"autoStart": True, "executionStrategy": "parallel"},
            "rolePresets": [
                {
                    "roleKey": "researcher",
                    "displayName": "Researcher",
                    "purpose": "Collect facts and write sourced notes.",
                    "instructionTemplate": "Investigate and summarize evidence.",
                    "toolPolicy": {"allowedToolGroups": ["slock", "web"]},
                    "skillPolicy": {"requiredSkills": ["research"]},
                    "memoryPolicy": {"writeScopes": ["task"]},
                    "outputPolicy": {"expectedOutputTypes": ["message", "memory"]},
                    "runtimePolicy": {"contextIsolation": "required"},
                    "loopPolicy": {"completionPolicy": "single_turn_result"},
                    "contextPolicy": {"suggestSummaryAtContextRatio": 0.85},
                    "editableFields": ["purpose", "instructionTemplate"],
                }
            ],
        },
        server_id=server_id,
    )

    assert isinstance(template, TaskRunTemplate)
    assert template.slug == "research-notes"
    assert template.role_presets[0]["roleKey"] == "researcher"
    assert db.flushed is True

    updated = await update_template(
        db,
        template,
        {"name": "Updated Research Notes"},
        server_id=server_id,
    )

    assert updated.name == "Updated Research Notes"
    assert updated.updated_at.tzinfo == timezone.utc


@pytest.mark.asyncio
async def test_public_task_run_template_routes_create_update_disable_and_list(monkeypatch):
    server = SimpleNamespace(id=uuid.uuid4())
    member = SimpleNamespace(id=uuid.uuid4())
    _patch_active_server_context(monkeypatch, server, member=member)

    create_db = _FakeSession()
    created = await public_api.create_task_run_template(
        _JsonRequest(
            {
                "slug": "qa-runner",
                "name": "QA Runner",
                "systemInstruction": "Verify behavior and report concise evidence.",
                "toolPolicy": {"allowedToolGroups": ["slock", "read"]},
                "rolePresets": [
                    {
                        "roleKey": "qa",
                        "displayName": "QA",
                        "purpose": "Verify the requested behavior.",
                    }
                ],
            }
        ),
        db=create_db,
    )

    assert created["template"]["slug"] == "qa-runner"
    assert created["template"]["rolePresets"][0]["roleKey"] == "qa"
    assert create_db.committed is True
    assert create_db.refreshed is True

    template = create_db.added[0]
    update_db = _FakeSession(_ExecuteResult(template))
    updated = await public_api.update_task_run_template(
        str(template.id),
        _JsonRequest({"name": "QA Runner v2", "outputPolicy": {"expectedOutputTypes": ["message", "file"]}}),
        db=update_db,
    )

    assert updated["template"]["name"] == "QA Runner v2"
    assert updated["template"]["outputPolicy"]["expectedOutputTypes"] == ["message", "file"]
    assert update_db.committed is True

    list_db = _FakeSession(_ExecuteResult(scalar_rows=[template]))
    listed = await public_api.list_task_run_templates(_JsonRequest({}), db=list_db)

    assert listed["templates"][0]["slug"] == "qa-runner"

    disable_db = _FakeSession(_ExecuteResult(template))
    disabled = await public_api.disable_task_run_template(str(template.id), _JsonRequest({}), db=disable_db)

    assert disabled["template"]["status"] == "disabled"
    assert disable_db.committed is True


@pytest.mark.asyncio
async def test_public_task_assignment_endpoint_auto_starts_with_template_snapshot(monkeypatch):
    task = SimpleNamespace(
        id=uuid.uuid4(),
        task_number=7,
        channel_id=uuid.uuid4(),
        message_id=None,
        title="Research TaskRun models",
        status="todo",
        data={},
    )
    server = SimpleNamespace(id=uuid.uuid4())
    actor = SimpleNamespace(id=uuid.uuid4(), display_name="zy-ean", handle="zy-ean", kind="human")
    assignee = SimpleNamespace(id=uuid.uuid4(), display_name="agent-a", handle="agent-a", kind="agent")
    template = TaskRunTemplate(
        id=uuid.uuid4(),
        slug="research-analyst",
        name="Research Analyst",
        system_instruction="Research the task.",
        tool_policy={"allowedToolGroups": ["slock", "web"]},
        skill_policy={"requiredSkills": ["research"]},
        memory_policy={"readScopes": ["channel", "task"], "writeScopes": ["task"]},
        output_policy={"expectedOutputTypes": ["message", "memory"]},
        runtime_policy={"contextIsolation": "required"},
        start_policy={"autoStart": True, "executionStrategy": "parallel"},
        role_presets=[
            {
                "roleKey": "researcher",
                "displayName": "Researcher",
                "purpose": "Collect facts.",
                "loopPolicy": {"completionPolicy": "single_turn_result"},
            }
        ],
        visibility="builtin",
        status="active",
    )
    calls = []
    activity_calls = []

    async def fake_get_server(_db):
        return server

    async def fake_resolve_task(_db, server_arg, task_ref):
        assert server_arg is server
        assert task_ref == str(task.id)
        return task

    async def fake_resolve_member(_db, server_arg, member_ref):
        assert server_arg is server
        assert member_ref == "@agent-a"
        return assignee

    async def fake_resolve_human_actor(_db, server_arg, request, actor_ref, role):
        assert server_arg is server
        assert actor_ref == "zy-ean"
        assert role == "task assignment actor"
        return actor

    async def fake_get_template_by_ref(_db, template_ref, *, server_id):
        assert template_ref == "research-analyst"
        assert server_id == server.id
        return template

    async def fake_create_assignment_and_run(_db, **kwargs):
        calls.append(kwargs)
        run_id = uuid.uuid4()
        return SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(
            id=run_id,
            task_id=task.id,
            assignment_id=None,
            agent_id=assignee.id,
            channel_id=task.channel_id,
            source_message_id=None,
            thread_root_message_id=None,
            parent_run_id=None,
            attempt=1,
            status="queued",
            trigger_type="direct_assignment",
            runtime_workspace_id=None,
            computer_id=None,
            daemon_id=None,
            runtime=None,
            runtime_provider=None,
            runtime_model=None,
            prompt_profile="task.researcher",
            workspace_session_id=None,
            runtime_session_id=None,
            context_session_id=f"task:{task.id}:role:researcher:run:{run_id}",
            cwd=None,
            context_scope="task",
            context_summary={},
            context_usage={},
            token_usage={},
            tool_usage_summary={},
            template_id=template.id,
            template_snapshot={"slug": "research-analyst", "name": "Research Analyst"},
            role_key="researcher",
            role_snapshot={"roleKey": "researcher"},
            completion_policy="single_turn_result",
            output_refs=[],
            output_message_id=None,
            failure_code=None,
            failure_reason=None,
            started_at=None,
            completed_at=None,
            created_at=None,
            updated_at=None,
        )

    async def fake_record_activity(_db, server_arg, actor_arg, kind, description, details, channel_id=None, task_id=None):
        activity_calls.append(
            {
                "server": server_arg,
                "actor": actor_arg,
                "kind": kind,
                "description": description,
                "details": details,
                "channel_id": channel_id,
                "task_id": task_id,
            }
        )
        return SimpleNamespace(id=uuid.uuid4())

    async def fake_task_channel_target(_db, task_arg):
        assert task_arg is task
        return "#research"

    async def fake_push_committed_events(*args, **kwargs):
        return None

    async def fake_serialize_task(_db, task_arg):
        return {"id": str(task_arg.id), "assigneeId": str(task_arg.assignee_id)}

    async def fake_ensure_task_channel_access(
        _db,
        server_arg,
        task_arg,
        member_id,
    ):
        assert server_arg is server
        assert task_arg is task
        assert member_id == actor.id

    _patch_active_server_context(monkeypatch, server, member=actor)
    monkeypatch.setattr(public_api, "_resolve_task_by_id_or_number", fake_resolve_task)
    monkeypatch.setattr(
        public_api,
        "_ensure_task_channel_access",
        fake_ensure_task_channel_access,
    )
    monkeypatch.setattr(public_api, "_resolve_member", fake_resolve_member)
    monkeypatch.setattr(public_api, "_resolve_human_actor", fake_resolve_human_actor)
    monkeypatch.setattr(public_api, "get_template_by_ref", fake_get_template_by_ref)
    monkeypatch.setattr(public_api, "create_task_assignment_and_run", fake_create_assignment_and_run)
    monkeypatch.setattr(public_api, "_record_activity", fake_record_activity)
    monkeypatch.setattr(public_api, "_task_channel_target", fake_task_channel_target)
    monkeypatch.setattr(public_api, "_push_committed_events", fake_push_committed_events)
    monkeypatch.setattr(public_api, "_serialize_task", fake_serialize_task)

    db = _FakeSession()
    response = await public_api.create_task_assignment(
        str(task.id),
        _JsonRequest(
            {
                "actor": "zy-ean",
                "assignee": "@agent-a",
                "template": "research-analyst",
                "roleKey": "researcher",
                "executionStrategy": "parallel",
                "autoStart": True,
            }
        ),
        db=db,
    )

    assert response["created"] is True
    assert response["run"]["status"] == "queued"
    assert db.committed is True
    assert calls[0]["task"] is task
    assert calls[0]["assignee"] is assignee
    assert calls[0]["assigned_by_id"] == actor.id
    assert calls[0]["role"] == "researcher"
    assert calls[0]["role_key"] == "researcher"
    assert calls[0]["template_id"] == template.id
    assert calls[0]["template_snapshot"]["slug"] == "research-analyst"
    assert calls[0]["role_snapshot"]["roleKey"] == "researcher"
    assert calls[0]["execution_strategy"] == "parallel"
    assert calls[0]["assignment_mode"] == "direct_drag"
    assert calls[0]["trigger_type"] == "direct_assignment"
    assert activity_calls[0]["kind"] == "supervisor_task_assigned"
    assert activity_calls[0]["details"]["target"] == "#research"
    assert activity_calls[0]["details"]["targetAgentId"] == str(assignee.id)
    assert activity_calls[0]["details"]["template"]["slug"] == "research-analyst"
    assert activity_calls[0]["details"]["role"]["roleKey"] == "researcher"
    assert activity_calls[0]["details"]["completionPolicy"] == "single_turn_result"


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
    member = SimpleNamespace(id=agent_id, display_name="worker", handle="worker", kind="agent")
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


@pytest.mark.asyncio
async def test_agent_task_run_lifecycle_endpoint_triggers_terminal_writeback_hook(monkeypatch):
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    agent_id = uuid.uuid4()
    member = SimpleNamespace(id=agent_id, display_name="worker", handle="worker", kind="agent")
    server = SimpleNamespace(id=uuid.uuid4())
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
        trigger_type="feishu_jira_analysis",
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
    hook_calls = []
    class _Client:
        def __init__(self):
            self.closed = False

        async def aclose(self):
            self.closed = True

    jira_client = _Client()
    feishu_client = _Client()
    dependencies = SimpleNamespace(name="jira-runtime-deps", jira_http_client=jira_client)
    feishu_dependencies = SimpleNamespace(
        name="feishu-runtime-deps",
        http_client=feishu_client,
        config=SimpleNamespace(base_url="https://open.feishu.cn", access_token="tenant-token"),
    )

    async def fake_update_task_run_lifecycle(db_arg, **kwargs):
        return run

    async def fake_writeback_hook(db_arg, **kwargs):
        hook_calls.append(kwargs)
        return SimpleNamespace(
            status="failed",
            reason_code="TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS",
            reason="Jira credentials were not available for TaskRun write-back.",
            mapping=None,
        )

    feishu_calls = []

    async def fake_feishu_reply(db_arg, **kwargs):
        feishu_calls.append(kwargs)
        return SimpleNamespace(
            status="sent",
            reason_code="FEISHU_REPLY_SENT",
            reason="Feishu terminal TaskRun reply was sent.",
            mapping=None,
        )

    monkeypatch.setattr(agent_api, "update_task_run_lifecycle", fake_update_task_run_lifecycle, raising=False)
    monkeypatch.setattr(agent_api, "handle_terminal_task_run_writeback", fake_writeback_hook, raising=False)
    monkeypatch.setattr(agent_api, "build_task_run_writeback_dependencies", lambda: dependencies, raising=False)
    monkeypatch.setattr(agent_api, "send_task_run_feishu_terminal_reply", fake_feishu_reply, raising=False)
    monkeypatch.setattr(agent_api, "build_feishu_reply_dependencies", lambda: feishu_dependencies, raising=False)
    db = _FakeSession()

    response = await agent_api.update_task_run_lifecycle_endpoint(
        str(run_id),
        SimpleNamespace(
            status="completed",
            runtimeSessionId="provider-session-1",
            workspaceSessionId="workspace-session",
            contextSessionId=None,
            contextUsage=None,
            tokenUsage=None,
            toolUsageSummary=None,
            outputMessageId=None,
            failureCode=None,
            failureReason=None,
        ),
        agent=(member, server),
        db=db,
    )

    assert db.committed is True
    assert response["ok"] is True
    assert response["writeBack"]["status"] == "failed"
    assert response["writeBack"]["reasonCode"] == "TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS"
    assert response["feishuReply"]["status"] == "sent"
    assert response["feishuReply"]["reasonCode"] == "FEISHU_REPLY_SENT"
    assert hook_calls[0]["task_run"] is run
    assert hook_calls[0]["dependencies"] is dependencies
    assert feishu_calls[0]["task_run"] is run
    assert feishu_calls[0]["http_client"] is feishu_client
    assert feishu_calls[0]["config"] is feishu_dependencies.config
    assert jira_client.closed is True
    assert feishu_client.closed is True


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
        template_id=uuid.uuid4(),
        template_snapshot={"slug": "research-analyst", "name": "Research Analyst"},
        role_key="researcher",
        role_snapshot={"roleKey": "researcher", "displayName": "Research Analyst"},
        completion_policy="single_turn_result",
        output_refs=[{"type": "message", "refId": "abc123", "isFinal": True}],
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
    assert payload["template"]["slug"] == "research-analyst"
    assert payload["role"]["roleKey"] == "researcher"
    assert payload["completionPolicy"] == "single_turn_result"
    assert payload["outputs"][0]["refId"] == "abc123"
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
        handle="zy-ean",
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
        handle="minimax",
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
        handle="zy-ean",
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
        handle="minimax",
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
        _ExecuteResult(channel),
        _ExecuteResult(scalar_rows=[assignee]),
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

    async def fake_resolve_human_actor(*_args, **_kwargs):
        return creator

    monkeypatch.setattr(public_api, "create_task_assignment_and_run", fake_create_task_assignment_and_run)
    monkeypatch.setattr(public_api, "_push_committed_events", fake_push)
    monkeypatch.setattr(public_api, "_resolve_human_actor", fake_resolve_human_actor)
    _patch_active_server_context(monkeypatch, server, member=creator)

    response = await public_api.create_task(
        _JsonRequest({"channel": "#work", "creator": "@zy-ean", "assignee": "@minimax", "title": "Run it"}),
        _auth=None,
        db=db,
    )

    assert response["created"] is True
    assert calls
    assert calls[0]["assignee"] is assignee
    assert calls[0]["assigned_by_id"] == creator.id
    assert calls[0]["role"] == "general"
    assert calls[0]["role_key"] is None
    assert calls[0]["execution_strategy"] == "parallel"
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
        handle="architect",
        kind="agent",
        config={"permissions": {"createTask": True}},
    )
    worker = SimpleNamespace(id=uuid.uuid4(), display_name="worker", handle="worker", kind="agent")
    run_id = uuid.uuid4()
    db = _FakeSession(
        _ExecuteResult(channel),
        _ExecuteResult(SimpleNamespace(channel_id=channel.id, member_id=architect.id)),
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
