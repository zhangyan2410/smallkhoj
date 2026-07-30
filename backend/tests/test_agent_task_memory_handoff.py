import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import routers.agent_api as agent_api
import services.memory_api as memory_api
import services.task_memory_request as task_memory_request
from services.memory_store import MemoryScope


class _JsonRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


@pytest.mark.asyncio
async def test_task_memory_request_event_targets_assigned_agent_with_output_directions():
    server = SimpleNamespace(id=uuid.uuid4())
    actor = SimpleNamespace(id=uuid.uuid4())
    assignee = SimpleNamespace(id=uuid.uuid4(), kind="agent")
    channel = SimpleNamespace(id=uuid.uuid4(), kind="public", name="slock")
    task = SimpleNamespace(
        id=uuid.uuid4(),
        task_number=7,
        title="Produce final output",
        status="in_review",
        assignee_id=assignee.id,
        channel_id=channel.id,
        data={"source": {"channel": "#slock", "messageShortId": "abc123ef"}},
    )
    session = _FakeMemoryRequestSession(assignee=assignee, channel=channel)

    event = await task_memory_request.add_task_memory_request_event(
        session,
        server,
        task,
        actor=actor,
        instruction="include browser evidence",
        output_directions=["final_summary", "evidence", "channel_memory", "unknown"],
        trigger="manual",
    )

    assert event is not None
    assert session.added == [event]
    assert event.event_type == "task.memory_requested"
    assert event.actor_id == actor.id
    assert event.task_id == task.id
    assert event.channel_id == channel.id
    assert event.payload["targetAgentId"] == str(assignee.id)
    assert event.payload["target"] == "#slock:abc123ef"
    assert event.payload["outputDirections"] == ["final_summary", "evidence", "channel_memory"]
    assert "slock task summary" in event.payload["content"]
    assert "slock task promote" in event.payload["content"]
    assert "include browser evidence" in event.payload["content"]


class _FakeSession:
    def __init__(self):
        self.committed = False
        self.refreshed = []
        self.flushed = False

    async def commit(self):
        self.committed = True

    async def refresh(self, item):
        self.refreshed.append(item)

    async def flush(self):
        self.flushed = True


class _FakeMemoryRequestSession:
    def __init__(self, *, assignee, channel):
        self.assignee = assignee
        self.channel = channel
        self.added = []

    async def get(self, model, item_id):
        if model.__name__ == "Member" and item_id == self.assignee.id:
            return self.assignee
        if model.__name__ == "Channel" and item_id == self.channel.id:
            return self.channel
        return None

    def add(self, item):
        self.added.append(item)


@pytest.mark.asyncio
async def test_agent_task_summary_route_writes_recoverable_task_memory(monkeypatch):
    member = SimpleNamespace(id=uuid.uuid4(), display_name="glm", config={"permissions": {"updateTask": True}})
    server = SimpleNamespace(id=uuid.uuid4())
    db = _FakeSession()
    entry = SimpleNamespace(path="final-summary.md")
    seen = {}

    async def fake_write_task_memory_summary(session, resolved_server, task_id, body, *, author):
        seen["db"] = session
        seen["server"] = resolved_server
        seen["task_id"] = task_id
        seen["body"] = body
        seen["author"] = author
        return {
            "task": SimpleNamespace(id=uuid.UUID(task_id), data={"memory": {"summaryPath": "final-summary.md"}}),
            "summaryEntry": entry,
            "created": True,
        }

    async def fake_push(session, *, server_id):
        seen["push_server_id"] = server_id
        return 1

    monkeypatch.setattr(agent_api, "write_task_memory_summary", fake_write_task_memory_summary)
    monkeypatch.setattr(agent_api, "_push_committed_events", fake_push)
    monkeypatch.setattr(agent_api, "serialize_memory_entry", lambda item: {"path": item.path})

    task_id = str(uuid.uuid4())
    response = await agent_api.write_task_memory_summary_route(
        task_id,
        _JsonRequest({"finalSummary": "done", "evidence": ["evidence/ui.png"]}),
        agent=(member, server),
        db=db,
    )

    assert response["created"] is True
    assert response["entry"]["path"] == "final-summary.md"
    assert response["task"]["data"]["memory"]["summaryPath"] == "final-summary.md"
    assert seen["task_id"] == task_id
    assert seen["body"] == {"finalSummary": "done", "evidence": ["evidence/ui.png"]}
    assert seen["author"] is member
    assert db.committed is True
    assert seen["push_server_id"] == server.id


@pytest.mark.asyncio
async def test_agent_task_promote_route_creates_channel_memory_or_proposal(monkeypatch):
    member = SimpleNamespace(id=uuid.uuid4(), display_name="glm", config={"permissions": {"updateTask": True}})
    server = SimpleNamespace(id=uuid.uuid4())
    db = _FakeSession()
    entry = SimpleNamespace(path="tasks/task-1/final-summary.md")
    proposal = SimpleNamespace(path="tasks/task-1/final-summary.md")
    seen = {}

    async def fake_promote_task_memory_to_channel(session, resolved_server, task_id, body, *, author):
        seen["db"] = session
        seen["server"] = resolved_server
        seen["task_id"] = task_id
        seen["body"] = body
        seen["author"] = author
        return {
            "sourceEntry": SimpleNamespace(path="final-summary.md"),
            "channelEntry": entry,
            "proposal": proposal,
            "created": False,
        }

    async def fake_push(session, *, server_id):
        seen["push_server_id"] = server_id
        return 1

    monkeypatch.setattr(agent_api, "promote_task_memory_to_channel", fake_promote_task_memory_to_channel)
    monkeypatch.setattr(agent_api, "_push_committed_events", fake_push)
    monkeypatch.setattr(agent_api, "serialize_memory_entry", lambda item: {"path": item.path})
    monkeypatch.setattr(agent_api, "serialize_memory_proposal", lambda item: {"path": item.path})

    task_id = str(uuid.uuid4())
    response = await agent_api.promote_task_memory_route(
        task_id,
        _JsonRequest({"sourcePath": "final-summary.md", "proposal": True}),
        agent=(member, server),
        db=db,
    )

    assert response["created"] is False
    assert response["sourceEntry"]["path"] == "final-summary.md"
    assert response["channelEntry"]["path"] == "tasks/task-1/final-summary.md"
    assert response["proposal"]["path"] == "tasks/task-1/final-summary.md"
    assert seen["task_id"] == task_id
    assert seen["body"] == {"sourcePath": "final-summary.md", "proposal": True}
    assert seen["author"] is member
    assert db.committed is True
    assert seen["push_server_id"] == server.id


@pytest.mark.asyncio
async def test_agent_memory_routes_resolve_scope_with_agent_viewer(monkeypatch):
    member = SimpleNamespace(id=uuid.uuid4(), display_name="glm")
    server = SimpleNamespace(id=uuid.uuid4())
    context = SimpleNamespace(scope=MemoryScope("channel", uuid.uuid4()))
    entry = SimpleNamespace(path="MEMORY.md")
    seen = {}

    async def fake_resolve_memory_scope(session, resolved_server, scope_type, scope_id, *, viewer=None):
        seen["scope"] = (scope_type, scope_id, viewer)
        return context

    async def fake_list_memory_entries(session, resolved_server, resolved_context):
        seen["list_context"] = resolved_context
        return [entry]

    async def fake_get_memory_entry(session, resolved_server, resolved_context, path):
        seen["get"] = (resolved_context, path)
        return entry

    monkeypatch.setattr(agent_api, "resolve_memory_scope", fake_resolve_memory_scope)
    monkeypatch.setattr(agent_api, "list_memory_entries", fake_list_memory_entries)
    monkeypatch.setattr(agent_api, "get_memory_entry", fake_get_memory_entry)
    monkeypatch.setattr(agent_api, "serialize_memory_entry", lambda item: {"path": item.path})

    listed = await agent_api.list_agent_scoped_memory(
        "channel",
        "private-room",
        agent=(member, server),
        db=object(),
    )
    read = await agent_api.read_agent_scoped_memory_path(
        "channel",
        "private-room",
        "MEMORY.md",
        agent=(member, server),
        db=object(),
    )

    assert listed == {"scope": context.scope.as_dict(), "entries": [{"path": "MEMORY.md"}]}
    assert read == {"entry": {"path": "MEMORY.md"}}
    assert seen["scope"] == ("channel", "private-room", member)
    assert seen["list_context"] is context
    assert seen["get"] == (context, "MEMORY.md")


@pytest.mark.asyncio
async def test_agent_memory_proposal_routes_list_and_resolve_with_agent_viewer(monkeypatch):
    member = SimpleNamespace(id=uuid.uuid4(), display_name="glm", config={"permissions": {"writeMemory": True}})
    server = SimpleNamespace(id=uuid.uuid4())
    context = SimpleNamespace(scope=MemoryScope("channel", uuid.uuid4()))
    proposal = SimpleNamespace(id=uuid.uuid4(), path="MEMORY.md", status="open")
    entry = SimpleNamespace(path="MEMORY.md")
    db = _FakeSession()
    seen = {}

    async def fake_resolve_memory_scope(session, resolved_server, scope_type, scope_id, *, viewer=None):
        seen["scope"] = (scope_type, scope_id, viewer)
        return context

    async def fake_list_memory_proposals(session, resolved_server, resolved_context, *, status):
        seen["list"] = (resolved_context, status)
        return [proposal]

    async def fake_resolve_memory_proposal(session, resolved_server, proposal_id, body, *, reviewer):
        seen["resolve"] = (proposal_id, body, reviewer)
        proposal.status = body["status"]
        return {"proposal": proposal, "entry": entry}

    async def fake_push(session, *, server_id):
        seen["push_server_id"] = server_id
        return 1

    monkeypatch.setattr(agent_api, "resolve_memory_scope", fake_resolve_memory_scope)
    monkeypatch.setattr(agent_api, "list_memory_proposals", fake_list_memory_proposals)
    monkeypatch.setattr(agent_api, "resolve_memory_proposal", fake_resolve_memory_proposal)
    monkeypatch.setattr(agent_api, "_push_committed_events", fake_push)
    monkeypatch.setattr(agent_api, "serialize_memory_proposal", lambda item: {"path": item.path, "status": item.status})
    monkeypatch.setattr(agent_api, "serialize_memory_entry", lambda item: {"path": item.path})

    listed = await agent_api.list_agent_scoped_memory_proposals(
        "channel",
        "slock",
        status="all",
        agent=(member, server),
        db=db,
    )
    accepted = await agent_api.accept_agent_memory_proposal(
        str(proposal.id),
        _JsonRequest({"reviewNote": "durable"}),
        agent=(member, server),
        db=db,
    )

    assert listed == {"scope": context.scope.as_dict(), "proposals": [{"path": "MEMORY.md", "status": "open"}]}
    assert accepted == {
        "proposal": {"path": "MEMORY.md", "status": "accepted"},
        "entry": {"path": "MEMORY.md"},
    }
    assert seen["scope"] == ("channel", "slock", member)
    assert seen["list"] == (context, "all")
    assert seen["resolve"] == (str(proposal.id), {"reviewNote": "durable", "status": "accepted"}, member)
    assert db.committed is True
    assert db.refreshed == [proposal, entry]
    assert seen["push_server_id"] == server.id


@pytest.mark.asyncio
async def test_agent_memory_delete_route_soft_deletes_with_agent_viewer(monkeypatch):
    member = SimpleNamespace(id=uuid.uuid4(), display_name="glm", config={"permissions": {"writeMemory": True}})
    server = SimpleNamespace(id=uuid.uuid4())
    context = SimpleNamespace(scope=MemoryScope("task", uuid.uuid4()))
    entry = SimpleNamespace(path="progress/old.md")
    db = _FakeSession()
    seen = {}

    async def fake_resolve_memory_scope(session, resolved_server, scope_type, scope_id, *, viewer=None):
        seen["scope"] = (scope_type, scope_id, viewer)
        return context

    async def fake_delete_memory_entry(session, resolved_server, resolved_context, path, *, author):
        seen["delete"] = (resolved_context, path, author)
        return entry

    async def fake_push(session, *, server_id):
        seen["push_server_id"] = server_id
        return 1

    monkeypatch.setattr(agent_api, "resolve_memory_scope", fake_resolve_memory_scope)
    monkeypatch.setattr(agent_api, "delete_memory_entry", fake_delete_memory_entry)
    monkeypatch.setattr(agent_api, "_push_committed_events", fake_push)
    monkeypatch.setattr(agent_api, "serialize_memory_entry", lambda item: {"path": item.path})

    response = await agent_api.delete_agent_scoped_memory_path(
        "task",
        "task-1",
        "progress/old.md",
        agent=(member, server),
        db=db,
    )

    assert response == {"deleted": True, "entry": {"path": "progress/old.md"}}
    assert seen["scope"] == ("task", "task-1", member)
    assert seen["delete"] == (context, "progress/old.md", member)
    assert db.committed is True
    assert db.refreshed == [entry]
    assert seen["push_server_id"] == server.id


@pytest.mark.asyncio
async def test_agent_memory_context_manifest_route_builds_selective_task_and_channel_manifest(monkeypatch):
    member = SimpleNamespace(id=uuid.uuid4(), display_name="glm", config={"permissions": {"read": True}})
    server = SimpleNamespace(id=uuid.uuid4())
    channel = SimpleNamespace(id=uuid.uuid4())
    task = SimpleNamespace(id=uuid.uuid4())
    task_context = SimpleNamespace(scope=MemoryScope("task", task.id), task=task, channel=channel)
    seen = {"listed": []}

    async def fake_resolve_memory_scope(session, resolved_server, scope_type, scope_id, *, viewer=None):
        assert viewer is member
        if scope_type == "task":
            return task_context
        if scope_type == "channel":
            return SimpleNamespace(scope=MemoryScope("channel", channel.id), channel=channel, task=None)
        raise AssertionError(scope_type)

    async def fake_list_memory_entries(session, resolved_server, context):
        seen["listed"].append(context.scope.type)
        if context.scope.type == "task":
            return [SimpleNamespace(id=uuid.uuid4(), scope_type="task", scope_id=task.id, path="final-summary.md", title="Final", content_text="task output screenshot", content_sha256="sha-task", updated_at=None)]
        return [SimpleNamespace(id=uuid.uuid4(), scope_type="channel", scope_id=channel.id, path="MEMORY.md", title="Channel", content_text="channel recovery policy", content_sha256="sha-channel", updated_at=None)]

    monkeypatch.setattr(agent_api, "resolve_memory_scope", fake_resolve_memory_scope)
    monkeypatch.setattr(agent_api, "list_memory_entries", fake_list_memory_entries)

    response = await agent_api.build_agent_memory_context_manifest_route(
        _JsonRequest({"scopeType": "task", "scopeId": str(task.id), "prompt": "recovery screenshot", "topK": 2}),
        agent=(member, server),
        db=object(),
    )

    assert response["policy"] == "selective"
    assert response["sessionScope"] == {"type": "task", "id": str(task.id)}
    assert [item["path"] for item in response["taskMemories"]] == ["final-summary.md"]
    assert [item["path"] for item in response["channelMemories"]] == ["MEMORY.md"]
    assert seen["listed"] == ["task", "channel"]


@pytest.mark.asyncio
async def test_agent_memory_context_manifest_omits_private_channel_memory_for_task_visible_non_member(monkeypatch):
    member = SimpleNamespace(id=uuid.uuid4(), display_name="glm", config={"permissions": {"read": True}})
    server = SimpleNamespace(id=uuid.uuid4())
    channel = SimpleNamespace(id=uuid.uuid4())
    task = SimpleNamespace(id=uuid.uuid4())
    task_context = SimpleNamespace(scope=MemoryScope("task", task.id), task=task, channel=channel)
    seen = {"listed": []}

    async def fake_resolve_memory_scope(session, resolved_server, scope_type, scope_id, *, viewer=None):
        assert viewer is member
        if scope_type == "task":
            return task_context
        if scope_type == "channel":
            raise HTTPException(403, "Private channel memory requires membership")
        raise AssertionError(scope_type)

    async def fake_list_memory_entries(session, resolved_server, context):
        seen["listed"].append(context.scope.type)
        if context.scope.type == "task":
            return [SimpleNamespace(id=uuid.uuid4(), scope_type="task", scope_id=task.id, path="brief.md", title="Brief", content_text="private task brief", content_sha256="sha-task", updated_at=None)]
        return [SimpleNamespace(id=uuid.uuid4(), scope_type="channel", scope_id=channel.id, path="MEMORY.md", title="Private", content_text="private channel secret", content_sha256="sha-channel", updated_at=None)]

    monkeypatch.setattr(agent_api, "resolve_memory_scope", fake_resolve_memory_scope)
    monkeypatch.setattr(agent_api, "list_memory_entries", fake_list_memory_entries)

    response = await agent_api.build_agent_memory_context_manifest_route(
        _JsonRequest({"scopeType": "task", "scopeId": str(task.id), "prompt": "private", "topK": 3}),
        agent=(member, server),
        db=object(),
    )

    assert [item["path"] for item in response["taskMemories"]] == ["brief.md"]
    assert response["channelMemories"] == []
    assert "private channel secret" not in str(response)
    assert seen["listed"] == ["task"]


@pytest.mark.asyncio
async def test_write_task_memory_summary_builds_final_summary_and_recovery_metadata(monkeypatch):
    db = _FakeSession()
    server = SimpleNamespace(id=uuid.uuid4())
    author = SimpleNamespace(id=uuid.uuid4())
    task = SimpleNamespace(
        id=uuid.uuid4(),
        task_number=7,
        data={"source": {"messageId": "msg-1"}},
    )
    context = SimpleNamespace(scope=MemoryScope("task", task.id), task=task, channel=SimpleNamespace(id=uuid.uuid4()))
    writes = []

    async def fake_resolve_memory_scope(session, resolved_server, scope_type, scope_id, *, viewer=None):
        assert scope_type == "task"
        assert scope_id == str(task.id)
        assert viewer is author
        return context

    async def fake_write_memory_entry(session, resolved_server, resolved_context, path, body, *, author):
        writes.append((path, body))
        return SimpleNamespace(path=path, content_text=body["contentText"]), path == "final-summary.md"

    monkeypatch.setattr(memory_api, "resolve_memory_scope", fake_resolve_memory_scope)
    monkeypatch.setattr(memory_api, "write_memory_entry", fake_write_memory_entry)

    result = await memory_api.write_task_memory_summary(
        db,
        server,
        str(task.id),
        {
            "finalSummary": "Implemented channel/task recovery surfaces.",
            "progress": "Backend, daemon, and frontend verified.",
            "evidence": ["evidence/task.png"],
            "artifacts": ["artifacts/demo.mp4"],
            "nextSteps": ["Promote durable conclusion"],
        },
        author=author,
    )

    assert result["created"] is True
    assert [path for path, _body in writes] == ["final-summary.md", "progress.md"]
    summary_body = writes[0][1]
    assert summary_body["entryKind"] == "final_summary"
    assert summary_body["metadata"]["recoverySignal"] == "output"
    assert "## Evidence" in summary_body["contentText"]
    assert "evidence/task.png" in summary_body["contentText"]
    assert task.data["memory"]["summaryPath"] == "final-summary.md"
    assert task.data["memory"]["evidence"] == ["evidence/task.png"]
    assert task.data["review"]["state"] == "pending_review"
    assert db.flushed is True


@pytest.mark.asyncio
async def test_promote_task_memory_to_channel_can_create_proposal(monkeypatch):
    db = _FakeSession()
    server = SimpleNamespace(id=uuid.uuid4())
    author = SimpleNamespace(id=uuid.uuid4())
    channel = SimpleNamespace(id=uuid.uuid4())
    task = SimpleNamespace(id=uuid.uuid4(), task_number=9)
    task_context = SimpleNamespace(scope=MemoryScope("task", task.id), task=task, channel=channel)
    source_entry = SimpleNamespace(path="final-summary.md", content_text="Durable task output")
    seen = {}

    async def fake_resolve_memory_scope(session, resolved_server, scope_type, scope_id, *, viewer=None):
        assert scope_type == "task"
        return task_context

    async def fake_get_memory_entry(session, resolved_server, context, path):
        assert path == "final-summary.md"
        return source_entry

    async def fake_create_memory_proposal(session, resolved_server, context, body, *, author):
        seen["context"] = context
        seen["body"] = body
        return SimpleNamespace(path=body["path"])

    monkeypatch.setattr(memory_api, "resolve_memory_scope", fake_resolve_memory_scope)
    monkeypatch.setattr(memory_api, "get_memory_entry", fake_get_memory_entry)
    monkeypatch.setattr(memory_api, "create_memory_proposal", fake_create_memory_proposal)

    result = await memory_api.promote_task_memory_to_channel(
        db,
        server,
        str(task.id),
        {"proposal": True, "reason": "Reusable conclusion"},
        author=author,
    )

    assert result["sourceEntry"] is source_entry
    assert result["channelEntry"] is None
    assert result["proposal"].path == f"tasks/{str(task.id).split('-')[0]}/final-summary.md"
    assert seen["context"].scope.type == "channel"
    assert seen["context"].scope.id == channel.id
    assert seen["body"]["contentText"] == "Durable task output"
    assert seen["body"]["metadata"]["sourceTaskId"] == str(task.id)


@pytest.mark.asyncio
async def test_resolve_memory_proposal_accepts_into_memory_and_records_review(monkeypatch):
    db = _FakeSession()
    server = SimpleNamespace(id=uuid.uuid4())
    reviewer = SimpleNamespace(id=uuid.uuid4(), config={"permissions": {"writeMemory": True}})
    scope_id = uuid.uuid4()
    proposal = SimpleNamespace(
        id=uuid.uuid4(),
        server_id=server.id,
        scope_type="channel",
        scope_id=scope_id,
        path="decisions/runtime.md",
        proposed_content_text="Use scoped runtime sessions.",
        status="open",
        metadata_json={"kind": "decision"},
        updated_at=None,
    )
    context = SimpleNamespace(scope=MemoryScope("channel", scope_id), channel=SimpleNamespace(id=scope_id), task=None)
    writes = []
    events = []

    async def fake_get_memory_proposal(session, resolved_server, proposal_id, *, viewer):
        assert session is db
        assert resolved_server is server
        assert proposal_id == str(proposal.id)
        assert viewer is reviewer
        return proposal, context

    async def fake_write_memory_entry(session, resolved_server, resolved_context, path, body, *, author):
        writes.append((path, body, author, resolved_context))
        return SimpleNamespace(path=path, content_text=body["contentText"]), True

    monkeypatch.setattr(memory_api, "get_memory_proposal", fake_get_memory_proposal)
    monkeypatch.setattr(memory_api, "write_memory_entry", fake_write_memory_entry)
    monkeypatch.setattr(memory_api, "_add_memory_proposal_resolved_event", lambda session, resolved_server, item, reviewer, context: events.append((item.status, reviewer.id, context.scope.type)))

    result = await memory_api.resolve_memory_proposal(
        db,
        server,
        str(proposal.id),
        {"status": "accepted", "reviewNote": "Good channel decision"},
        reviewer=reviewer,
    )

    assert result["proposal"] is proposal
    assert result["entry"].path == "decisions/runtime.md"
    assert proposal.status == "accepted"
    assert proposal.reviewer_member_id == reviewer.id
    assert proposal.review_note == "Good channel decision"
    assert proposal.resolved_at is not None
    assert writes[0][0] == "decisions/runtime.md"
    assert writes[0][1]["entryKind"] == "decision"
    assert writes[0][1]["baseSha"] == memory_api.content_sha256("")
    assert writes[0][1]["metadata"]["proposalId"] == str(proposal.id)
    assert events == [("accepted", reviewer.id, "channel")]
    assert db.flushed is True


@pytest.mark.asyncio
async def test_resolve_memory_proposal_rejects_without_writing_entry(monkeypatch):
    db = _FakeSession()
    server = SimpleNamespace(id=uuid.uuid4())
    reviewer = SimpleNamespace(id=uuid.uuid4(), config={"permissions": {"writeMemory": True}})
    proposal = SimpleNamespace(
        id=uuid.uuid4(),
        server_id=server.id,
        scope_type="channel",
        scope_id=uuid.uuid4(),
        path="MEMORY.md",
        proposed_content_text="Too broad",
        status="open",
        metadata_json={},
        updated_at=None,
    )
    context = SimpleNamespace(scope=MemoryScope("channel", proposal.scope_id), channel=SimpleNamespace(id=proposal.scope_id), task=None)
    events = []

    async def fake_get_memory_proposal(session, resolved_server, proposal_id, *, viewer):
        return proposal, context

    async def fake_write_memory_entry(*_args, **_kwargs):
        raise AssertionError("Rejected proposals must not write memory entries")

    monkeypatch.setattr(memory_api, "get_memory_proposal", fake_get_memory_proposal)
    monkeypatch.setattr(memory_api, "write_memory_entry", fake_write_memory_entry)
    monkeypatch.setattr(memory_api, "_add_memory_proposal_resolved_event", lambda session, resolved_server, item, reviewer, context: events.append(item.status))

    result = await memory_api.resolve_memory_proposal(
        db,
        server,
        str(proposal.id),
        {"status": "rejected", "reviewNote": "Keep task-local"},
        reviewer=reviewer,
    )

    assert result["entry"] is None
    assert proposal.status == "rejected"
    assert proposal.review_note == "Keep task-local"
    assert events == ["rejected"]


@pytest.mark.asyncio
async def test_delete_memory_entry_soft_deletes_and_emits_event(monkeypatch):
    db = _FakeSession()
    server = SimpleNamespace(id=uuid.uuid4())
    actor = SimpleNamespace(id=uuid.uuid4(), config={"permissions": {"writeMemory": True}})
    context = SimpleNamespace(scope=MemoryScope("channel", uuid.uuid4()), channel=SimpleNamespace(id=uuid.uuid4()), task=None)
    entry = SimpleNamespace(id=uuid.uuid4(), path="references/old.md", deleted_at=None)
    events = []

    async def fake_get_memory_entry(session, resolved_server, resolved_context, path):
        assert path == "references/old.md"
        return entry

    monkeypatch.setattr(memory_api, "get_memory_entry", fake_get_memory_entry)
    monkeypatch.setattr(memory_api, "_add_memory_deleted_event", lambda session, resolved_server, item, author, context: events.append((item.path, author.id)))

    deleted = await memory_api.delete_memory_entry(
        db,
        server,
        context,
        "references/old.md",
        author=actor,
    )

    assert deleted is entry
    assert entry.deleted_at is not None
    assert events == [("references/old.md", actor.id)]
    assert db.flushed is True


@pytest.mark.asyncio
async def test_memory_proposal_review_requires_channel_membership_without_write_capability(monkeypatch):
    db = _FakeSession()
    server = SimpleNamespace(id=uuid.uuid4())
    channel = SimpleNamespace(id=uuid.uuid4(), kind="public")
    reviewer = SimpleNamespace(id=uuid.uuid4(), config={})
    proposal = SimpleNamespace(
        id=uuid.uuid4(),
        server_id=server.id,
        scope_type="channel",
        scope_id=channel.id,
        path="MEMORY.md",
        proposed_content_text="Public readers should not review memory proposals.",
        status="open",
        metadata_json={},
        updated_at=None,
    )
    context = SimpleNamespace(scope=MemoryScope("channel", channel.id), channel=channel, task=None)

    async def fake_get_memory_proposal(session, resolved_server, proposal_id, *, viewer):
        return proposal, context

    async def fake_is_channel_member(session, channel_id, member_id):
        assert channel_id == channel.id
        assert member_id == reviewer.id
        return False

    monkeypatch.setattr(memory_api, "get_memory_proposal", fake_get_memory_proposal)
    monkeypatch.setattr(memory_api, "_is_channel_member", fake_is_channel_member)

    with pytest.raises(memory_api.HTTPException) as exc:
        await memory_api.resolve_memory_proposal(
            db,
            server,
            str(proposal.id),
            {"status": "accepted"},
            reviewer=reviewer,
        )

    assert exc.value.status_code == 403
