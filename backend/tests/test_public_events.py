from datetime import datetime, timezone
from types import SimpleNamespace
import json
import sys
import uuid

import pytest

import routers.public_api as public_api
from services.public_events import (
    InMemoryPublicEventHub,
    PostgresNotifyPublicEventFanout,
    _notify_postgres,
    public_event_envelope_from_record,
    sse_comment,
    sse_frame,
)


def _record(*, seq=7, event_type="message.created", channel_id=None, task_id=None, message_id=None, payload=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        server_id=uuid.uuid4(),
        seq=seq,
        event_type=event_type,
        actor_id=uuid.uuid4(),
        channel_id=channel_id,
        task_id=task_id,
        message_id=message_id or uuid.uuid4(),
        payload=payload or {},
        created_at=datetime(2026, 6, 21, 1, 2, 3, tzinfo=timezone.utc),
    )


def test_public_event_envelope_uses_stable_browser_contract():
    channel_id = uuid.uuid4()
    message_id = uuid.uuid4()
    record = _record(
        seq=42,
        channel_id=channel_id,
        message_id=message_id,
        payload={
            "messageId": str(message_id),
            "shortId": "abc12345",
            "content": "hello",
            "channel": "#all",
        },
    )

    event = public_event_envelope_from_record(record)

    assert event["id"] == str(record.id)
    assert event["type"] == "message.created"
    assert event["seq"] == 42
    assert event["epoch"]
    assert event["createdAt"] == "2026-06-21T01:02:03+00:00"
    assert event["scope"] == {
        "kind": "channel",
        "id": str(channel_id),
        "name": "all",
    }
    assert event["payload"]["messageId"] == str(message_id)
    assert event["payload"]["content"] == "hello"


def test_task_event_scope_prefers_task_id_over_channel_id():
    channel_id = uuid.uuid4()
    task_id = uuid.uuid4()
    record = _record(
        event_type="task.updated",
        channel_id=channel_id,
        task_id=task_id,
        payload={"taskNumber": 3, "channelId": str(channel_id)},
    )

    event = public_event_envelope_from_record(record)

    assert event["scope"] == {"kind": "task", "id": str(task_id)}
    assert event["payload"]["channelId"] == str(channel_id)


def test_channel_memory_event_uses_channel_scope():
    channel_id = uuid.uuid4()
    memory_id = uuid.uuid4()
    record = _record(
        event_type="memory.updated",
        channel_id=channel_id,
        message_id=None,
        payload={
            "memoryId": str(memory_id),
            "scopeType": "channel",
            "scopeId": str(channel_id),
            "path": "decisions/channel-memory.md",
            "channel": "#window",
        },
    )

    event = public_event_envelope_from_record(record)

    assert event["type"] == "memory.updated"
    assert event["scope"] == {
        "kind": "channel",
        "id": str(channel_id),
        "name": "window",
    }
    assert event["payload"]["memoryId"] == str(memory_id)
    assert event["payload"]["path"] == "decisions/channel-memory.md"


def test_task_memory_event_uses_task_scope():
    channel_id = uuid.uuid4()
    task_id = uuid.uuid4()
    record = _record(
        event_type="memory.proposal.created",
        channel_id=channel_id,
        task_id=task_id,
        message_id=None,
        payload={
            "scopeType": "task",
            "scopeId": str(task_id),
            "path": "final-summary.md",
            "channelId": str(channel_id),
        },
    )

    event = public_event_envelope_from_record(record)

    assert event["type"] == "memory.proposal.created"
    assert event["scope"] == {"kind": "task", "id": str(task_id)}
    assert event["payload"]["channelId"] == str(channel_id)


def test_memory_delete_and_proposal_resolved_events_use_memory_scope():
    channel_id = uuid.uuid4()
    memory_id = uuid.uuid4()
    deleted = public_event_envelope_from_record(_record(
        event_type="memory.deleted",
        channel_id=channel_id,
        message_id=None,
        payload={
            "memoryId": str(memory_id),
            "scopeType": "channel",
            "scopeId": str(channel_id),
            "path": "references/old.md",
            "channel": "#window",
        },
    ))
    resolved = public_event_envelope_from_record(_record(
        event_type="memory.proposal.resolved",
        channel_id=channel_id,
        message_id=None,
        payload={
            "proposalId": str(uuid.uuid4()),
            "scopeType": "channel",
            "scopeId": str(channel_id),
            "path": "MEMORY.md",
            "status": "accepted",
            "channel": "#window",
        },
    ))

    assert deleted["type"] == "memory.deleted"
    assert deleted["scope"] == {"kind": "channel", "id": str(channel_id), "name": "window"}
    assert resolved["type"] == "memory.proposal.resolved"
    assert resolved["scope"] == {"kind": "channel", "id": str(channel_id), "name": "window"}
    assert resolved["payload"]["status"] == "accepted"


def test_public_event_type_aliases_match_ui_contract():
    record = _record(event_type="member.updated", payload={"memberId": str(uuid.uuid4())})
    assert public_event_envelope_from_record(record)["type"] == "member.status.updated"

    record = _record(event_type="message.reaction_added", payload={"reaction": "+1"})
    assert public_event_envelope_from_record(record)["type"] == "reaction.updated"


def test_computer_status_event_uses_computer_scope():
    computer_id = uuid.uuid4()
    record = _record(
        event_type="computer.status.updated",
        message_id=None,
        payload={
            "computerId": str(computer_id),
            "computerName": "local-mac",
            "status": "online",
            "previousStatus": "offline",
        },
    )

    event = public_event_envelope_from_record(record)

    assert event["type"] == "computer.status.updated"
    assert event["scope"] == {"kind": "computer", "id": str(computer_id)}
    assert event["payload"]["status"] == "online"


def test_sse_frame_and_heartbeat_comment_format():
    assert sse_comment("heartbeat") == ": heartbeat\n\n"

    frame = sse_frame({"id": "evt-1", "type": "message.created", "payload": {"x": 1}})

    assert frame.startswith("id: evt-1\nevent: message.created\n")
    assert 'data: {"id":"evt-1","type":"message.created","payload":{"x":1}}' in frame
    assert frame.endswith("\n\n")


@pytest.mark.asyncio
async def test_in_memory_public_event_hub_filters_and_cleans_up_subscribers():
    hub = InMemoryPublicEventHub()
    channel_id = str(uuid.uuid4())
    matching = {
        "id": "evt-1",
        "type": "message.created",
        "scope": {"kind": "channel", "id": channel_id},
        "seq": 1,
        "epoch": "epoch",
        "createdAt": "2026-06-21T01:02:03+00:00",
        "payload": {},
    }
    other = {**matching, "id": "evt-2", "scope": {"kind": "channel", "id": str(uuid.uuid4())}}

    subscription = hub.subscribe(scope_kind="channel", scope_id=channel_id)
    assert hub.subscriber_count == 1

    await hub.publish(other)
    await hub.publish(matching)

    assert await subscription.get() == matching
    await subscription.close()
    assert hub.subscriber_count == 0


def test_postgres_notify_fanout_has_validated_listen_notify_seam():
    fanout = PostgresNotifyPublicEventFanout(channel="smallkhoj_public_events")
    event = {
        "id": "evt-1",
        "type": "task.updated",
        "scope": {"kind": "task", "id": "task-1"},
        "seq": 9,
        "epoch": "epoch",
        "createdAt": "2026-06-21T01:02:03+00:00",
        "payload": {},
    }

    statement, params = fanout.notify_statement(event)

    assert str(fanout.listen_statement()) == "LISTEN smallkhoj_public_events"
    assert "pg_notify" in str(statement)
    assert params["channel"] == "smallkhoj_public_events"
    assert '"type":"task.updated"' in params["payload"]


def test_postgres_notify_fanout_compacts_large_payloads():
    fanout = PostgresNotifyPublicEventFanout(channel="smallkhoj_public_events")
    event = {
        "id": "evt-large",
        "type": "message.created",
        "scope": {"kind": "channel", "id": "channel-1", "name": "general"},
        "seq": 27,
        "epoch": "epoch",
        "createdAt": "2026-06-21T01:02:03+00:00",
        "payload": {
            "eventId": "evt-large",
            "eventSeq": 27,
            "messageId": "message-1",
            "shortId": "f576654b",
            "channelId": "channel-1",
            "content": "x" * 9000,
        },
    }

    _statement, params = fanout.notify_statement(event)
    payload = params["payload"]
    parsed = json.loads(payload)

    assert len(payload.encode("utf-8")) <= 7800
    assert parsed["id"] == "evt-large"
    assert parsed["type"] == "message.created"
    assert parsed["scope"] == {"kind": "channel", "id": "channel-1", "name": "general"}
    assert parsed["payload"]["compacted"] is True
    assert parsed["payload"]["messageId"] == "message-1"
    assert "content" not in parsed["payload"]


def test_postgres_notify_fanout_rejects_unsafe_channel_names():
    with pytest.raises(ValueError):
        PostgresNotifyPublicEventFanout(channel="public_events; DROP TABLE event_records")


@pytest.mark.asyncio
async def test_postgres_notify_does_not_commit_or_rollback_caller_session(monkeypatch):
    class FakeDb:
        commit_calls = 0
        rollback_calls = 0

        async def commit(self):
            self.commit_calls += 1

        async def rollback(self):
            self.rollback_calls += 1

    class FakeConnection:
        def __init__(self):
            self.executed = []
            self.closed = False

        async def execute(self, statement, *args):
            self.executed.append((statement, args))

        async def close(self):
            self.closed = True

    connection = FakeConnection()

    class FakeAsyncpg:
        async def connect(self, dsn):
            assert dsn.startswith("postgresql://")
            return connection

    monkeypatch.setattr("services.public_events.settings.database_url", "postgresql+asyncpg://user:pass@localhost/db")
    monkeypatch.setitem(sys.modules, "asyncpg", FakeAsyncpg())

    db = FakeDb()
    await _notify_postgres(db, {
        "id": "evt-1",
        "type": "message.created",
        "scope": {"kind": "channel", "id": "channel-1"},
        "seq": 1,
        "epoch": "epoch",
        "createdAt": "2026-06-21T01:02:03+00:00",
        "payload": {},
    })

    assert db.commit_calls == 0
    assert db.rollback_calls == 0
    assert len(connection.executed) == 1
    statement, args = connection.executed[0]
    assert statement == "SELECT pg_notify($1, $2)"
    assert args[0] == "smallkhoj_public_events"
    assert '"type":"message.created"' in args[1]
    assert connection.closed is True


@pytest.mark.asyncio
async def test_public_events_stream_endpoint_returns_sse_response(monkeypatch):
    class _DisconnectedRequest:
        async def is_disconnected(self):
            return True

    async def fake_resolve_active_server_context(db, request):
        return SimpleNamespace(server=SimpleNamespace(id=uuid.uuid4()))

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_resolve_active_server_context)

    response = await public_api.stream_public_events(
        _DisconnectedRequest(),
        scopeKind=None,
        scopeId=None,
        heartbeatSeconds=1.0,
        _auth=None,
    )

    assert response.media_type == "text/event-stream"
    first_chunk = await anext(response.body_iterator)
    assert first_chunk == 'event: ready\ndata: {"ok":true}\n\n'
