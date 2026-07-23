import asyncio
import uuid
from types import SimpleNamespace

import pytest
from postgres_test_support import disposable_postgres
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from main import app
from routers import agent_api, public_api


async def _open_asgi_stream(path: str, *, headers: list[tuple[bytes, bytes]]):
    request_messages = asyncio.Queue()
    await request_messages.put({"type": "http.request", "body": b"", "more_body": False})
    response_messages = []
    first_body = asyncio.Event()

    async def receive():
        return await request_messages.get()

    async def send(message):
        response_messages.append(message)
        if message["type"] == "http.response.body" and message.get("body"):
            first_body.set()

    path_part, _, query = path.partition("?")
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path_part,
        "raw_path": path_part.encode(),
        "query_string": query.encode(),
        "root_path": "",
        "headers": headers,
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
        "state": {},
    }
    request_task = asyncio.create_task(app(scope, receive, send))
    await asyncio.wait_for(first_body.wait(), timeout=1)
    return request_task, request_messages, response_messages


async def _disconnect(request_task, request_messages):
    await request_messages.put({"type": "http.disconnect"})
    await asyncio.wait_for(request_task, timeout=1)


@pytest.mark.asyncio
async def test_public_sse_finalizes_request_db_before_open_stream_completes(monkeypatch):
    dependency_opened = asyncio.Event()
    dependency_finalized = asyncio.Event()

    async def tracked_db():
        dependency_opened.set()
        try:
            yield object()
        finally:
            dependency_finalized.set()

    async def fake_resolve_active_server_context(db, request):
        return SimpleNamespace(server=SimpleNamespace(id=uuid.uuid4()))

    app.dependency_overrides[public_api.get_db] = tracked_db
    monkeypatch.setattr(
        public_api,
        "_resolve_active_server_context",
        fake_resolve_active_server_context,
    )

    request_task = None
    request_messages = None
    try:
        request_task, request_messages, messages = await _open_asgi_stream(
            "/api/v1/events/stream?heartbeatSeconds=120",
            headers=[(b"x-public-key", public_api.PUBLIC_API_KEY.encode())],
        )
        assert dependency_opened.is_set()
        assert any(
            message["type"] == "http.response.body"
            and b"event: ready" in message.get("body", b"")
            for message in messages
        )
        assert dependency_finalized.is_set()
        assert not request_task.done()
    finally:
        if request_task is not None and request_messages is not None:
            await _disconnect(request_task, request_messages)
        app.dependency_overrides.pop(public_api.get_db, None)

    assert dependency_finalized.is_set()
    assert public_api.public_event_hub.subscriber_count == 0


@pytest.mark.asyncio
async def test_agent_sse_finalizes_request_db_before_open_stream_completes(monkeypatch):
    dependency_opened = asyncio.Event()
    dependency_finalized = asyncio.Event()
    member_id = uuid.uuid4()
    server_id = uuid.uuid4()

    async def tracked_db():
        dependency_opened.set()
        try:
            yield object()
        finally:
            dependency_finalized.set()

    async def fake_resolve_agent_claims():
        return agent_api.AgentEventStreamClaims(
            member_id=member_id,
            server_id=server_id,
        )

    async def fake_load_agent_event_stream_entities(db, claims):
        return (
            SimpleNamespace(
                id=member_id,
                server_id=server_id,
                kind="human",
                computer_id=None,
                config={},
            ),
            SimpleNamespace(id=server_id),
        )

    async def fake_visible_channel_ids(db, member):
        return []

    async def fake_visible_event_records(*args, **kwargs):
        return []

    app.dependency_overrides[agent_api.get_db] = tracked_db
    app.dependency_overrides[
        agent_api.resolve_agent_event_stream_claims
    ] = fake_resolve_agent_claims
    monkeypatch.setattr(
        agent_api,
        "_load_agent_event_stream_entities",
        fake_load_agent_event_stream_entities,
    )
    monkeypatch.setattr(agent_api, "_visible_channel_ids", fake_visible_channel_ids)
    monkeypatch.setattr(agent_api, "_visible_event_records", fake_visible_event_records)

    request_task = None
    request_messages = None
    try:
        request_task, request_messages, messages = await _open_asgi_stream(
            "/internal/agent-api/events/stream?since=0&intervalSeconds=30&heartbeatSeconds=120",
            headers=[],
        )
        assert dependency_opened.is_set()
        assert any(
            message["type"] == "http.response.body"
            and b"event: ready" in message.get("body", b"")
            for message in messages
        )
        assert dependency_finalized.is_set()
        assert not request_task.done()
    finally:
        if request_task is not None and request_messages is not None:
            await _disconnect(request_task, request_messages)
        app.dependency_overrides.pop(agent_api.get_db, None)
        app.dependency_overrides.pop(agent_api.resolve_agent_event_stream_claims, None)

    assert dependency_finalized.is_set()


@pytest.mark.asyncio
async def test_open_public_and_agent_sse_release_the_only_real_postgres_connection(monkeypatch):
    async with disposable_postgres() as postgres:
        engine = create_async_engine(
            postgres.database_url,
            pool_size=1,
            max_overflow=0,
            pool_timeout=0.2,
        )
        sessions = async_sessionmaker(engine, expire_on_commit=False)

        async def assert_independent_query_succeeds():
            async with sessions() as independent:
                result = await asyncio.wait_for(
                    independent.execute(text("SELECT 1")),
                    timeout=0.5,
                )
                assert result.scalar_one() == 1

        try:
            public_finalized = asyncio.Event()

            async def public_db():
                async with sessions() as db:
                    await db.execute(text("SELECT 1"))
                    try:
                        yield db
                    finally:
                        public_finalized.set()

            async def fake_resolve_active_server_context(db, request):
                return SimpleNamespace(server=SimpleNamespace(id=uuid.uuid4()))

            app.dependency_overrides[public_api.get_db] = public_db
            monkeypatch.setattr(
                public_api,
                "_resolve_active_server_context",
                fake_resolve_active_server_context,
            )
            public_task, public_messages, _ = await _open_asgi_stream(
                "/api/v1/events/stream?heartbeatSeconds=120",
                headers=[(b"x-public-key", public_api.PUBLIC_API_KEY.encode())],
            )
            assert public_finalized.is_set()
            assert not public_task.done()
            await assert_independent_query_succeeds()
            await _disconnect(public_task, public_messages)
            app.dependency_overrides.pop(public_api.get_db, None)

            agent_finalized = asyncio.Event()
            member_id = uuid.uuid4()
            server_id = uuid.uuid4()

            async def agent_db():
                async with sessions() as db:
                    await db.execute(text("SELECT 1"))
                    try:
                        yield db
                    finally:
                        agent_finalized.set()

            async def fake_agent_claims():
                return agent_api.AgentEventStreamClaims(
                    member_id=member_id,
                    server_id=server_id,
                )

            async def fake_load_entities(db, claims):
                return (
                    SimpleNamespace(
                        id=member_id,
                        server_id=server_id,
                        kind="human",
                        computer_id=None,
                        config={},
                    ),
                    SimpleNamespace(id=server_id),
                )

            async def no_visible_rows(*args, **kwargs):
                return []

            app.dependency_overrides[agent_api.get_db] = agent_db
            app.dependency_overrides[
                agent_api.resolve_agent_event_stream_claims
            ] = fake_agent_claims
            monkeypatch.setattr(
                agent_api,
                "_load_agent_event_stream_entities",
                fake_load_entities,
            )
            monkeypatch.setattr(agent_api, "_visible_channel_ids", no_visible_rows)
            monkeypatch.setattr(agent_api, "_visible_event_records", no_visible_rows)
            agent_task, agent_messages, _ = await _open_asgi_stream(
                "/internal/agent-api/events/stream?since=0&intervalSeconds=30&heartbeatSeconds=120",
                headers=[],
            )
            assert agent_finalized.is_set()
            assert not agent_task.done()
            await assert_independent_query_succeeds()
            await _disconnect(agent_task, agent_messages)
        finally:
            app.dependency_overrides.pop(public_api.get_db, None)
            app.dependency_overrides.pop(agent_api.get_db, None)
            app.dependency_overrides.pop(agent_api.resolve_agent_event_stream_claims, None)
            await engine.dispose()


@pytest.mark.asyncio
async def test_agent_poll_session_closes_before_event_frame_is_yielded(monkeypatch):
    member_id = uuid.uuid4()
    server_id = uuid.uuid4()
    poll_session_exited = asyncio.Event()

    class ConnectedRequest:
        headers = {"accept": "text/event-stream"}

        async def is_disconnected(self):
            return False

    class PollSessionContext:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, traceback):
            poll_session_exited.set()

    async def fake_load_entities(db, claims):
        return (
            SimpleNamespace(
                id=member_id,
                server_id=server_id,
                kind="human",
                computer_id=None,
                config={},
            ),
            SimpleNamespace(id=server_id),
        )

    async def no_visible_channels(db, member):
        return []

    record = SimpleNamespace(
        id=uuid.uuid4(),
        seq=9,
        event_type="task.updated",
        actor_id=member_id,
        channel_id=None,
        task_id=uuid.uuid4(),
        message_id=None,
        created_at=None,
        payload={"type": "task.updated"},
    )

    async def one_visible_record(*args, **kwargs):
        return [record]

    monkeypatch.setattr(agent_api, "async_session", lambda: PollSessionContext())
    monkeypatch.setattr(
        agent_api,
        "_load_agent_event_stream_entities",
        fake_load_entities,
    )
    monkeypatch.setattr(agent_api, "_visible_channel_ids", no_visible_channels)
    monkeypatch.setattr(agent_api, "_visible_event_records", one_visible_record)

    response = await agent_api.get_events(
        request=ConnectedRequest(),
        since="0",
        eventLogCursor=None,
        activityCursor=None,
        stream=True,
        intervalSeconds=30,
        heartbeatSeconds=120,
        claims=agent_api.AgentEventStreamClaims(
            member_id=member_id,
            server_id=server_id,
        ),
        db=object(),
    )

    iterator = response.body_iterator
    assert {"db", "member", "server"}.isdisjoint(iterator.ag_code.co_freevars)
    assert "claims" in iterator.ag_code.co_freevars
    assert b"event: ready" in (await anext(iterator)).encode()
    event_frame = await anext(iterator)
    assert poll_session_exited.is_set()
    assert "event: task.updated" in event_frame
    await iterator.aclose()
