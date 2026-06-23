from types import SimpleNamespace
import uuid

import pytest
from fastapi import HTTPException

import routers.public_api as public_api
from services.memory_store import MemoryScope


class _JsonRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


class _FakeSession:
    def __init__(self):
        self.committed = False
        self.refreshed = []

    async def commit(self):
        self.committed = True

    async def refresh(self, item):
        self.refreshed.append(item)


class _ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _FakeTaskSession(_FakeSession):
    def __init__(self, *, assignee=None):
        super().__init__()
        self.assignee = assignee

    async def execute(self, _statement):
        return _ScalarResult(self.assignee)


@pytest.mark.asyncio
async def test_public_memory_route_resolves_scope_with_current_viewer(monkeypatch):
    server = SimpleNamespace(id=uuid.uuid4())
    viewer = SimpleNamespace(id=uuid.uuid4(), display_name="zy-ean")
    context = SimpleNamespace(scope=MemoryScope("channel", uuid.uuid4()))
    seen = {}

    async def fake_get_server(db):
        return server

    async def fake_resolve_memory_viewer(db, resolved_server, request):
        assert resolved_server is server
        return viewer

    async def fake_resolve_memory_scope(db, resolved_server, scope_type, scope_id, *, viewer=None):
        seen["scope_type"] = scope_type
        seen["scope_id"] = scope_id
        seen["viewer"] = viewer
        return context

    async def fake_list_memory_entries(db, resolved_server, resolved_context):
        assert resolved_context is context
        return []

    monkeypatch.setattr(public_api, "_get_server", fake_get_server)
    monkeypatch.setattr(public_api, "_resolve_memory_viewer", fake_resolve_memory_viewer)
    monkeypatch.setattr(public_api, "resolve_memory_scope", fake_resolve_memory_scope)
    monkeypatch.setattr(public_api, "list_memory_entries", fake_list_memory_entries)

    response = await public_api.list_scoped_memory(
        "channel",
        "private-channel",
        SimpleNamespace(),
        _auth=None,
        db=object(),
    )

    assert response == {"scope": context.scope.as_dict(), "entries": []}
    assert seen == {
        "scope_type": "channel",
        "scope_id": "private-channel",
        "viewer": viewer,
    }


@pytest.mark.asyncio
async def test_public_task_memory_alias_resolves_scope_with_current_viewer(monkeypatch):
    server = SimpleNamespace(id=uuid.uuid4())
    viewer = SimpleNamespace(id=uuid.uuid4(), display_name="zy-ean")
    context = SimpleNamespace(scope=MemoryScope("task", uuid.uuid4()))
    seen = {}

    async def fake_get_server(db):
        return server

    async def fake_resolve_memory_viewer(db, resolved_server, request):
        assert resolved_server is server
        return viewer

    async def fake_resolve_memory_scope(db, resolved_server, scope_type, scope_id, *, viewer=None):
        seen["scope_type"] = scope_type
        seen["scope_id"] = scope_id
        seen["viewer"] = viewer
        return context

    async def fake_list_memory_entries(db, resolved_server, resolved_context):
        assert resolved_context is context
        return []

    monkeypatch.setattr(public_api, "_get_server", fake_get_server)
    monkeypatch.setattr(public_api, "_resolve_memory_viewer", fake_resolve_memory_viewer)
    monkeypatch.setattr(public_api, "resolve_memory_scope", fake_resolve_memory_scope)
    monkeypatch.setattr(public_api, "list_memory_entries", fake_list_memory_entries)

    response = await public_api.list_task_memory_alias(
        "42",
        SimpleNamespace(),
        _auth=None,
        db=object(),
    )

    assert response == {"scope": context.scope.as_dict(), "entries": []}
    assert seen == {
        "scope_type": "task",
        "scope_id": "42",
        "viewer": viewer,
    }


@pytest.mark.asyncio
async def test_public_task_memory_request_route_queues_targeted_reminder(monkeypatch):
    server = SimpleNamespace(id=uuid.uuid4())
    actor = SimpleNamespace(id=uuid.uuid4(), display_name="zy-ean")
    task = SimpleNamespace(id=uuid.uuid4(), task_number=9, status="in_review")
    event = SimpleNamespace(id=uuid.uuid4())
    db = _FakeSession()
    seen = {}

    async def fake_get_server(session):
        return server

    async def fake_resolve_task(session, resolved_server, task_id):
        seen["task_lookup"] = (resolved_server, task_id)
        return task

    async def fake_resolve_human_actor(session, resolved_server, request, actor_ref, *, role):
        seen["actor"] = (resolved_server, actor_ref, role)
        return actor

    async def fake_add_task_memory_request_event(
        session,
        resolved_server,
        resolved_task,
        *,
        actor,
        instruction,
        output_directions,
        trigger,
    ):
        seen["memory_request"] = {
            "server": resolved_server,
            "task": resolved_task,
            "actor": actor,
            "instruction": instruction,
            "output_directions": output_directions,
            "trigger": trigger,
        }
        return event

    async def fake_push(session, *, server_id):
        seen["push_server_id"] = server_id
        return 1

    monkeypatch.setattr(public_api, "_get_server", fake_get_server)
    monkeypatch.setattr(public_api, "_resolve_task_by_id_or_number", fake_resolve_task)
    monkeypatch.setattr(public_api, "_resolve_human_actor", fake_resolve_human_actor)
    monkeypatch.setattr(public_api, "add_task_memory_request_event", fake_add_task_memory_request_event)
    monkeypatch.setattr(public_api, "_push_committed_events", fake_push)

    response = await public_api.request_task_memory_result(
        str(task.id),
        _JsonRequest({
            "actor": "zy-ean",
            "instruction": "prioritize browser evidence",
            "outputDirections": ["final_summary", "evidence", "invalid"],
        }),
        _auth=None,
        db=db,
    )

    assert response == {"requested": True, "eventType": "task.memory_requested"}
    assert seen["task_lookup"] == (server, str(task.id))
    assert seen["actor"] == (server, "zy-ean", "task memory requester")
    assert seen["memory_request"] == {
        "server": server,
        "task": task,
        "actor": actor,
        "instruction": "prioritize browser evidence",
        "output_directions": ["final_summary", "evidence"],
        "trigger": "manual",
    }
    assert db.committed is True
    assert seen["push_server_id"] == server.id


@pytest.mark.asyncio
async def test_public_task_update_to_in_review_queues_memory_request(monkeypatch):
    server = SimpleNamespace(id=uuid.uuid4())
    actor = SimpleNamespace(id=uuid.uuid4(), display_name="zy-ean")
    assignee = SimpleNamespace(id=uuid.uuid4(), display_name="kimi", kind="agent")
    task = SimpleNamespace(
        id=uuid.uuid4(),
        task_number=12,
        title="Finish worker slice",
        description="Do the work",
        status="in_progress",
        assignee_id=assignee.id,
        channel_id=uuid.uuid4(),
        data={},
    )
    db = _FakeTaskSession(assignee=assignee)
    seen = {}

    async def fake_get_server(session):
        return server

    async def fake_resolve_task(session, resolved_server, task_id):
        seen["task_lookup"] = (resolved_server, task_id)
        return task

    async def fake_resolve_human_actor(session, resolved_server, request, actor_ref, *, role):
        seen["actor"] = (resolved_server, actor_ref, role)
        return actor

    async def fake_record_activity(session, resolved_server, resolved_actor, kind, description, details, *, channel_id=None, task_id=None):
        seen["activity"] = {
            "kind": kind,
            "description": description,
            "details": details,
            "channel_id": channel_id,
            "task_id": task_id,
        }

    async def fake_add_task_memory_request_event(
        session,
        resolved_server,
        resolved_task,
        *,
        actor,
        instruction,
        output_directions,
        trigger,
    ):
        seen["memory_request"] = {
            "server": resolved_server,
            "task": resolved_task,
            "actor": actor,
            "instruction": instruction,
            "output_directions": output_directions,
            "trigger": trigger,
        }
        return SimpleNamespace(id=uuid.uuid4())

    async def fake_push(session, *, server_id):
        seen["push_server_id"] = server_id
        return 1

    async def fake_serialize_task(session, resolved_task):
        return {"id": str(resolved_task.id), "status": resolved_task.status}

    monkeypatch.setattr(public_api, "_get_server", fake_get_server)
    monkeypatch.setattr(public_api, "_resolve_task_by_id_or_number", fake_resolve_task)
    monkeypatch.setattr(public_api, "_resolve_human_actor", fake_resolve_human_actor)
    monkeypatch.setattr(public_api, "_record_activity", fake_record_activity)
    monkeypatch.setattr(public_api, "add_task_memory_request_event", fake_add_task_memory_request_event)
    monkeypatch.setattr(public_api, "_push_committed_events", fake_push)
    monkeypatch.setattr(public_api, "_serialize_task", fake_serialize_task)

    response = await public_api.update_task(
        str(task.id),
        _JsonRequest({
            "actor": "zy-ean",
            "status": "in_review",
            "memoryInstruction": "include remaining risks",
            "outputDirections": ["final_summary", "next_steps", "unknown"],
        }),
        _auth=None,
        db=db,
    )

    assert response == {"updated": True, "task": {"id": str(task.id), "status": "in_review"}}
    assert task.status == "in_review"
    assert seen["task_lookup"] == (server, str(task.id))
    assert seen["activity"]["kind"] == "supervisor_task_updated"
    assert seen["activity"]["details"]["targetAgentId"] == str(assignee.id)
    assert seen["memory_request"] == {
        "server": server,
        "task": task,
        "actor": actor,
        "instruction": "include remaining risks",
        "output_directions": ["final_summary", "next_steps"],
        "trigger": "status_in_review",
    }
    assert db.committed is True
    assert db.refreshed == [task]
    assert seen["push_server_id"] == server.id


def test_public_memory_actor_must_match_current_viewer():
    viewer = SimpleNamespace(id=uuid.uuid4(), display_name="zy-ean")

    public_api._ensure_memory_actor_matches_viewer({}, viewer)
    public_api._ensure_memory_actor_matches_viewer({"actor": "zy-ean"}, viewer)
    public_api._ensure_memory_actor_matches_viewer({"actor": f"@{viewer.display_name}"}, viewer)
    public_api._ensure_memory_actor_matches_viewer({"actor": str(viewer.id)}, viewer)

    with pytest.raises(HTTPException) as exc:
        public_api._ensure_memory_actor_matches_viewer({"actor": "other-human"}, viewer)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_public_memory_proposal_routes_list_and_resolve_with_current_viewer(monkeypatch):
    server = SimpleNamespace(id=uuid.uuid4())
    viewer = SimpleNamespace(id=uuid.uuid4(), display_name="zy-ean")
    context = SimpleNamespace(scope=MemoryScope("channel", uuid.uuid4()))
    proposal = SimpleNamespace(id=uuid.uuid4(), path="MEMORY.md", status="open")
    entry = SimpleNamespace(path="MEMORY.md")
    db = _FakeSession()
    seen = {}

    async def fake_get_server(session):
        return server

    async def fake_resolve_memory_viewer(session, resolved_server, request):
        return viewer

    async def fake_resolve_memory_scope(session, resolved_server, scope_type, scope_id, *, viewer=None):
        seen["scope"] = (scope_type, scope_id, viewer)
        return context

    async def fake_list_memory_proposals(session, resolved_server, resolved_context, *, status):
        seen["list_status"] = status
        return [proposal]

    async def fake_resolve_memory_proposal(session, resolved_server, proposal_id, body, *, reviewer):
        seen["resolve"] = (proposal_id, body, reviewer)
        proposal.status = "accepted"
        return {"proposal": proposal, "entry": entry}

    async def fake_push(session, *, server_id):
        seen["push_server_id"] = server_id
        return 1

    monkeypatch.setattr(public_api, "_get_server", fake_get_server)
    monkeypatch.setattr(public_api, "_resolve_memory_viewer", fake_resolve_memory_viewer)
    monkeypatch.setattr(public_api, "resolve_memory_scope", fake_resolve_memory_scope)
    monkeypatch.setattr(public_api, "list_memory_proposals", fake_list_memory_proposals)
    monkeypatch.setattr(public_api, "resolve_memory_proposal", fake_resolve_memory_proposal)
    monkeypatch.setattr(public_api, "_push_committed_events", fake_push)
    monkeypatch.setattr(public_api, "serialize_memory_proposal", lambda item: {"path": item.path, "status": item.status})
    monkeypatch.setattr(public_api, "serialize_memory_entry", lambda item: {"path": item.path})

    listed = await public_api.list_scoped_memory_proposals(
        "channel",
        "general",
        SimpleNamespace(),
        status="open",
        _auth=None,
        db=db,
    )
    resolved = await public_api.accept_memory_proposal(
        str(proposal.id),
        _JsonRequest({"reviewNote": "Ship it"}),
        _auth=None,
        db=db,
    )

    assert listed == {"scope": context.scope.as_dict(), "proposals": [{"path": "MEMORY.md", "status": "open"}]}
    assert resolved == {
        "proposal": {"path": "MEMORY.md", "status": "accepted"},
        "entry": {"path": "MEMORY.md"},
    }
    assert seen["scope"] == ("channel", "general", viewer)
    assert seen["list_status"] == "open"
    assert seen["resolve"] == (str(proposal.id), {"reviewNote": "Ship it", "status": "accepted"}, viewer)
    assert db.committed is True
    assert db.refreshed == [proposal, entry]
    assert seen["push_server_id"] == server.id


@pytest.mark.asyncio
async def test_public_memory_delete_route_soft_deletes_with_current_viewer(monkeypatch):
    server = SimpleNamespace(id=uuid.uuid4())
    viewer = SimpleNamespace(id=uuid.uuid4(), display_name="zy-ean")
    context = SimpleNamespace(scope=MemoryScope("channel", uuid.uuid4()))
    entry = SimpleNamespace(path="references/old.md", deleted_at=None)
    db = _FakeSession()
    seen = {}

    async def fake_get_server(session):
        return server

    async def fake_resolve_memory_viewer(session, resolved_server, request):
        return viewer

    async def fake_resolve_memory_scope(session, resolved_server, scope_type, scope_id, *, viewer=None):
        seen["scope"] = (scope_type, scope_id, viewer)
        return context

    async def fake_delete_memory_entry(session, resolved_server, resolved_context, path, *, author):
        seen["delete"] = (path, author)
        return entry

    async def fake_push(session, *, server_id):
        seen["push_server_id"] = server_id
        return 1

    monkeypatch.setattr(public_api, "_get_server", fake_get_server)
    monkeypatch.setattr(public_api, "_resolve_memory_viewer", fake_resolve_memory_viewer)
    monkeypatch.setattr(public_api, "resolve_memory_scope", fake_resolve_memory_scope)
    monkeypatch.setattr(public_api, "delete_memory_entry", fake_delete_memory_entry)
    monkeypatch.setattr(public_api, "_push_committed_events", fake_push)
    monkeypatch.setattr(public_api, "serialize_memory_entry", lambda item: {"path": item.path})

    response = await public_api.delete_scoped_memory_path(
        "channel",
        "general",
        "references/old.md",
        SimpleNamespace(),
        _auth=None,
        db=db,
    )

    assert response == {"deleted": True, "entry": {"path": "references/old.md"}}
    assert seen["scope"] == ("channel", "general", viewer)
    assert seen["delete"] == ("references/old.md", viewer)
    assert db.committed is True
    assert db.refreshed == [entry]
    assert seen["push_server_id"] == server.id
