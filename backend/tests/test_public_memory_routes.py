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
