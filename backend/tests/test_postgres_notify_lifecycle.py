import asyncio
import json
from pathlib import Path
import sys
import uuid

import asyncpg
import pytest
from pydantic import ValidationError

import services.public_events as public_events
from config import Settings
from postgres_test_support import disposable_postgres


async def _eventually(predicate, *, timeout=0.5):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.005)
    assert predicate()


def _event(event_id: str) -> dict:
    return {
        "id": event_id,
        "type": "message.created",
        "scope": {"kind": "channel", "id": "channel-1"},
        "seq": 1,
        "epoch": "epoch",
        "createdAt": "2026-07-23T00:00:00+00:00",
        "payload": {},
    }


class _Acquire:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _Pool:
    def __init__(self, connection, *, close_gate=None):
        self.connection = connection
        self.close_gate = close_gate
        self.closed = False

    def acquire(self, **kwargs):
        return _Acquire(self.connection)

    async def close(self):
        if self.close_gate is not None:
            await self.close_gate.wait()
        self.closed = True


class _ListenerConnection:
    def __init__(self, *, close_gate=None):
        self.close_gate = close_gate
        self.closed = False
        self.listener_callback = None
        self.termination_callback = None

    async def add_listener(self, channel, callback):
        assert channel == public_events.PUBLIC_EVENT_NOTIFY_CHANNEL
        self.listener_callback = callback

    def add_termination_listener(self, callback):
        self.termination_callback = callback

    def is_closed(self):
        return self.closed

    async def close(self):
        if self.close_gate is not None:
            await self.close_gate.wait()
        self.closed = True

    def terminate(self):
        self.closed = True
        assert self.termination_callback is not None
        self.termination_callback(self)


@pytest.mark.asyncio
async def test_publisher_failure_replaces_pool_and_retries_once(monkeypatch):
    class FailingPublisherConnection:
        async def execute(self, statement, *args):
            raise ConnectionError("publisher connection invalidated")

    class HealthyPublisherConnection:
        def __init__(self):
            self.executed = []

        async def execute(self, statement, *args):
            self.executed.append((statement, args))

    healthy = HealthyPublisherConnection()
    pools = [_Pool(FailingPublisherConnection()), _Pool(healthy)]
    listeners = []

    class FakeAsyncpg:
        async def create_pool(self, dsn, **kwargs):
            return pools.pop(0)

        async def connect(self, dsn, **kwargs):
            connection = _ListenerConnection()
            listeners.append(connection)
            return connection

    monkeypatch.setattr(
        public_events.settings,
        "database_url",
        "postgresql+asyncpg://user:pass@localhost/db",
    )
    monkeypatch.setattr(public_events.settings, "notify_publish_attempts", 2, raising=False)
    monkeypatch.setattr(public_events.settings, "notify_reconnect_initial_seconds", 0.001, raising=False)
    monkeypatch.setitem(sys.modules, "asyncpg", FakeAsyncpg())

    try:
        await public_events.start_postgres_public_event_listener()
        await _eventually(
            lambda: len(listeners) == 1
            and public_events._postgres_notify_runtime.state == "healthy"
        )
        await public_events._notify_postgres(object(), _event("evt-recover"))

        assert len(pools) == 0
        assert len(healthy.executed) == 1
        assert public_events._postgres_notify_runtime.state == "healthy"
        assert public_events._postgres_notify_runtime.last_error is None
    finally:
        await public_events.stop_postgres_public_event_listener()


@pytest.mark.asyncio
async def test_listener_termination_reconnects_and_restores_listen(monkeypatch):
    class PublisherConnection:
        async def execute(self, statement, *args):
            return None

    listeners = []

    class FakeAsyncpg:
        async def create_pool(self, dsn, **kwargs):
            return _Pool(PublisherConnection())

        async def connect(self, dsn, **kwargs):
            connection = _ListenerConnection()
            listeners.append(connection)
            return connection

    monkeypatch.setattr(
        public_events.settings,
        "database_url",
        "postgresql+asyncpg://user:pass@localhost/db",
    )
    monkeypatch.setattr(public_events.settings, "notify_reconnect_initial_seconds", 0.001, raising=False)
    monkeypatch.setattr(public_events.settings, "notify_reconnect_max_seconds", 0.005, raising=False)
    monkeypatch.setitem(sys.modules, "asyncpg", FakeAsyncpg())

    try:
        await public_events.start_postgres_public_event_listener()
        await _eventually(lambda: len(listeners) == 1 and listeners[0].listener_callback is not None)
        listeners[0].terminate()
        await _eventually(lambda: len(listeners) == 2 and listeners[1].listener_callback is not None)

        assert listeners[0].closed is True
        assert listeners[1].closed is False
    finally:
        await public_events.stop_postgres_public_event_listener()


@pytest.mark.asyncio
async def test_stale_listener_generation_cannot_publish_after_restart(monkeypatch):
    class PublisherConnection:
        async def execute(self, statement, *args):
            return None

    listeners = []

    class FakeAsyncpg:
        async def create_pool(self, dsn, **kwargs):
            return _Pool(PublisherConnection())

        async def connect(self, dsn, **kwargs):
            connection = _ListenerConnection()
            listeners.append(connection)
            return connection

    published = []

    async def capture_publish(event):
        published.append(event)
        return True

    monkeypatch.setattr(
        public_events.settings,
        "database_url",
        "postgresql+asyncpg://user:pass@localhost/db",
    )
    monkeypatch.setitem(sys.modules, "asyncpg", FakeAsyncpg())
    monkeypatch.setattr(public_events.public_event_hub, "publish", capture_publish)

    await public_events.start_postgres_public_event_listener()
    await _eventually(lambda: len(listeners) == 1 and listeners[0].listener_callback is not None)
    stale_callback = listeners[0].listener_callback
    await public_events.stop_postgres_public_event_listener()

    try:
        await public_events.start_postgres_public_event_listener()
        await _eventually(lambda: len(listeners) == 2 and listeners[1].listener_callback is not None)
        stale_callback(None, 1, public_events.PUBLIC_EVENT_NOTIFY_CHANNEL, json.dumps(_event("evt-stale")))
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        assert published == []
    finally:
        await public_events.stop_postgres_public_event_listener()


@pytest.mark.asyncio
async def test_shutdown_is_bounded_when_connection_cleanup_stalls(monkeypatch):
    publisher_close_gate = asyncio.Event()
    listener_close_gate = asyncio.Event()

    class PublisherConnection:
        async def execute(self, statement, *args):
            return None

    listener = _ListenerConnection(close_gate=listener_close_gate)

    class FakeAsyncpg:
        async def create_pool(self, dsn, **kwargs):
            return _Pool(PublisherConnection(), close_gate=publisher_close_gate)

        async def connect(self, dsn, **kwargs):
            return listener

    monkeypatch.setattr(
        public_events.settings,
        "database_url",
        "postgresql+asyncpg://user:pass@localhost/db",
    )
    monkeypatch.setattr(public_events.settings, "notify_shutdown_timeout_seconds", 0.02, raising=False)
    monkeypatch.setitem(sys.modules, "asyncpg", FakeAsyncpg())

    await public_events.start_postgres_public_event_listener()
    await _eventually(lambda: listener.listener_callback is not None)

    stop_task = asyncio.create_task(public_events.stop_postgres_public_event_listener())
    try:
        done, _pending = await asyncio.wait({stop_task}, timeout=0.15)
        completed_within_bound = stop_task in done
    finally:
        publisher_close_gate.set()
        listener_close_gate.set()
        await stop_task

    assert completed_within_bound is True


@pytest.mark.asyncio
async def test_notify_runtime_recovers_real_publisher_and_listener_connections(monkeypatch):
    async with disposable_postgres() as postgres:
        database_url = postgres.database_url.replace("+asyncpg", "")
        observer = await asyncpg.connect(database_url)
        monkeypatch.setattr(public_events.settings, "database_url", postgres.database_url)
        monkeypatch.setattr(public_events.settings, "notify_reconnect_initial_seconds", 0.01)
        monkeypatch.setattr(public_events.settings, "notify_reconnect_max_seconds", 0.05)

        async def owner_pids(application_name):
            rows = await observer.fetch(
                """
                SELECT pid
                FROM pg_stat_activity
                WHERE datname = current_database() AND application_name = $1
                ORDER BY pid
                """,
                application_name,
            )
            return [row["pid"] for row in rows]

        async def wait_for_new_listener(previous_pid):
            loop = asyncio.get_running_loop()
            deadline = loop.time() + 3
            while loop.time() < deadline:
                pids = await owner_pids("smallkhoj-notify-listener")
                if len(pids) == 1 and pids[0] != previous_pid:
                    return pids[0]
                await asyncio.sleep(0.02)
            pytest.fail("listener did not reconnect with a new PostgreSQL backend pid")

        async def publish_and_receive(queue, event_id):
            event = _event(event_id)
            await public_events._notify_postgres(object(), event)
            received = await asyncio.wait_for(queue.get(), timeout=2)
            assert received["id"] == event_id
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(queue.get(), timeout=0.05)

        try:
            await public_events.start_postgres_public_event_listener()
            await _eventually(
                lambda: public_events._postgres_notify_runtime.state == "healthy",
                timeout=2,
            )
            publisher_pids = await owner_pids("smallkhoj-notify-publisher")
            listener_pids = await owner_pids("smallkhoj-notify-listener")
            assert len(publisher_pids) == 1
            assert len(listener_pids) == 1

            async with public_events.public_event_hub.subscribe_queue() as queue:
                await publish_and_receive(queue, f"evt-before-{uuid.uuid4().hex}")

                old_listener_pid = listener_pids[0]
                assert await observer.fetchval(
                    "SELECT pg_terminate_backend($1)",
                    old_listener_pid,
                ) is True
                await wait_for_new_listener(old_listener_pid)
                await publish_and_receive(queue, f"evt-listener-recovered-{uuid.uuid4().hex}")

                for pid in await owner_pids("smallkhoj-notify-publisher"):
                    assert await observer.fetchval("SELECT pg_terminate_backend($1)", pid) is True
                await publish_and_receive(queue, f"evt-publisher-recovered-{uuid.uuid4().hex}")
                assert len(await owner_pids("smallkhoj-notify-publisher")) == 1
        finally:
            await public_events.stop_postgres_public_event_listener()
            await public_events.stop_postgres_public_event_listener()
            assert await owner_pids("smallkhoj-notify-publisher") == []
            assert await owner_pids("smallkhoj-notify-listener") == []
            await observer.close()


def test_connection_budget_multiplies_all_process_owned_connections_by_workers():
    configured = Settings(
        _env_file=None,
        database_pool_size=5,
        database_max_overflow=10,
        notify_publisher_pool_size=2,
        backend_workers=3,
        postgres_max_connections=60,
        postgres_connection_headroom=5,
    )

    assert configured.backend_connections_per_process == 18
    assert configured.backend_deployment_connections == 54
    assert configured.required_postgres_connections == 59


def test_connection_budget_rejects_worker_count_that_exceeds_postgres_capacity():
    with pytest.raises(ValidationError, match="PostgreSQL connection budget"):
        Settings(
            _env_file=None,
            database_pool_size=5,
            database_max_overflow=10,
            notify_publisher_pool_size=2,
            backend_workers=3,
            postgres_max_connections=58,
            postgres_connection_headroom=5,
        )


def test_production_runtime_wires_notify_and_worker_connection_budget():
    repository_root = Path(__file__).resolve().parents[2]
    compose = (repository_root / "docker-compose.prod.yml").read_text()
    env_example = (repository_root / "backend" / ".env.example").read_text()

    assert "max_connections=${POSTGRES_MAX_CONNECTIONS:-100}" in compose
    assert "--workers ${BACKEND_WORKERS:-1}" in compose
    for name in (
        "DATABASE_POOL_SIZE",
        "DATABASE_MAX_OVERFLOW",
        "BACKEND_WORKERS",
        "POSTGRES_MAX_CONNECTIONS",
        "POSTGRES_CONNECTION_HEADROOM",
        "NOTIFY_PUBLISHER_POOL_SIZE",
        "NOTIFY_CONNECT_TIMEOUT_SECONDS",
        "NOTIFY_OPERATION_TIMEOUT_SECONDS",
        "NOTIFY_RECONNECT_INITIAL_SECONDS",
        "NOTIFY_RECONNECT_MAX_SECONDS",
        "NOTIFY_SHUTDOWN_TIMEOUT_SECONDS",
        "NOTIFY_PUBLISH_ATTEMPTS",
    ):
        assert f"{name}:" in compose
        assert f"{name}=" in env_example
