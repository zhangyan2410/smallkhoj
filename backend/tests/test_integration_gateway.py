import uuid

import pytest

import models.seed as seed
from models import (
    Base,
    ExternalConnector,
    ExternalEvent,
    ExternalMapping,
    ExternalRoute,
    ExternalSession,
)
from services import integration_gateway
from services.integration_gateway import (
    claim_external_event,
    create_external_mapping,
    get_or_create_external_session,
    link_external_event,
    list_external_mappings_for_external,
    list_external_mappings_for_local,
    mark_external_event_completed,
    mark_external_event_dropped,
    resolve_external_route,
    serialize_external_connector,
    serialize_external_event,
)


class _ExecuteResult:
    def __init__(self, value=None, scalar_rows=None):
        self._value = value
        self._scalar_rows = scalar_rows or []

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return self._scalar_rows


class _FakeSession:
    def __init__(self, *results):
        self._results = list(results)
        self.added = []
        self.flushed = False
        self.rollback_calls = 0

    async def execute(self, _statement):
        if self._results:
            return self._results.pop(0)
        return _ExecuteResult()

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        self.flushed = True

    async def rollback(self):
        self.rollback_calls += 1


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


def test_integration_gateway_tables_are_declared_with_contract_columns():
    connector_table = Base.metadata.tables["external_connectors"]
    route_table = Base.metadata.tables["external_routes"]
    event_table = Base.metadata.tables["external_events"]
    session_table = Base.metadata.tables["external_sessions"]
    mapping_table = Base.metadata.tables["external_mappings"]

    assert {
        "server_id",
        "provider",
        "name",
        "status",
        "config",
        "secret_ref",
        "encrypted_config",
        "last_error_code",
        "last_error_reason",
    } <= set(connector_table.c.keys())
    assert {
        "connector_id",
        "source_selector",
        "channel_id",
        "task_template_id",
        "default_assignee_id",
        "runtime_rule",
        "writeback_policy",
    } <= set(route_table.c.keys())
    assert {
        "connector_id",
        "route_id",
        "session_id",
        "provider",
        "source_event_id",
        "source_message_id",
        "source_thread_id",
        "dedup_key",
        "status",
        "normalized",
        "channel_id",
        "message_id",
        "task_id",
        "task_run_id",
        "failure_code",
        "failure_reason",
    } <= set(event_table.c.keys())
    assert {
        "connector_id",
        "external_scope_type",
        "external_scope_id",
        "channel_id",
        "thread_root_message_id",
        "task_id",
        "member_id",
        "status",
    } <= set(session_table.c.keys())
    assert {
        "connector_id",
        "local_type",
        "local_id",
        "external_type",
        "external_id",
        "external_url",
    } <= set(mapping_table.c.keys())
    assert any(index.name == "uq_external_events_connector_dedup" and index.unique for index in event_table.indexes)
    assert any(index.name == "uq_external_sessions_scope" and index.unique for index in session_table.indexes)
    assert any(index.name == "idx_external_mappings_local" for index in mapping_table.indexes)
    assert any(index.name == "idx_external_mappings_external" for index in mapping_table.indexes)


@pytest.mark.asyncio
async def test_startup_seed_does_not_emit_integration_gateway_ddl(monkeypatch):
    """Schema for the external_* integration-gateway tables (and their indexes,
    including uq_external_events_connector_dedup and uq_external_sessions_scope)
    is owned by Alembic — see the ``0001_baseline`` migration. seed.create_tables()
    must not emit table/index DDL anymore.
    """
    fake_engine = _SeedEngine()
    monkeypatch.setattr(seed, "engine", fake_engine)

    await seed.create_tables()

    statements = "\n".join(fake_engine.conn.statements)
    assert "CREATE TABLE IF NOT EXISTS external_connectors" not in statements
    assert "CREATE TABLE IF NOT EXISTS external_routes" not in statements
    assert "CREATE TABLE IF NOT EXISTS external_events" not in statements
    assert "CREATE TABLE IF NOT EXISTS external_sessions" not in statements
    assert "CREATE TABLE IF NOT EXISTS external_mappings" not in statements
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_external_events_connector_dedup" not in statements
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_external_sessions_scope" not in statements
    assert "CREATE INDEX IF NOT EXISTS idx_external_mappings_local" not in statements
    assert "CREATE INDEX IF NOT EXISTS idx_external_mappings_external" not in statements


@pytest.mark.asyncio
async def test_claim_external_event_creates_received_event_and_sanitizes_sensitive_payload():
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    db = _FakeSession(_ExecuteResult())

    outcome = await claim_external_event(
        db,
        server_id=server_id,
        connector_id=connector_id,
        provider="jira",
        event_type="issue.comment",
        dedup_key="jira:event-1",
        source_event_id="event-1",
        source_message_id="comment-1",
        actor_external_id="account-1",
        normalized={
            "issueKey": "JIRA-123",
            "apiToken": "should-not-leak",
            "nested": {"clientSecret": "also-hidden", "summary": "safe"},
        },
    )

    assert outcome.status == "claimed"
    assert isinstance(outcome.event, ExternalEvent)
    assert db.added == [outcome.event]
    assert outcome.event.status == "received"
    assert outcome.event.provider == "jira"
    assert outcome.event.dedup_key == "jira:event-1"
    assert outcome.event.normalized["issueKey"] == "JIRA-123"
    assert outcome.event.normalized["apiToken"] == "[redacted]"
    assert outcome.event.normalized["nested"]["clientSecret"] == "[redacted]"


@pytest.mark.asyncio
async def test_claim_external_event_duplicate_returns_existing_without_new_add():
    existing = ExternalEvent(
        id=uuid.uuid4(),
        server_id=uuid.uuid4(),
        connector_id=uuid.uuid4(),
        provider="feishu",
        dedup_key="feishu:message-1",
        event_type="message.created",
        status="accepted",
        normalized={"text": "already processed"},
    )
    db = _FakeSession(_ExecuteResult(existing))

    outcome = await claim_external_event(
        db,
        server_id=existing.server_id,
        connector_id=existing.connector_id,
        provider="feishu",
        event_type="message.created",
        dedup_key="feishu:message-1",
    )

    assert outcome.status == "duplicate"
    assert outcome.event is existing
    assert db.added == []


@pytest.mark.asyncio
async def test_route_resolution_returns_typed_match_disabled_and_no_route_outcomes():
    connector_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    active = ExternalRoute(
        id=uuid.uuid4(),
        server_id=uuid.uuid4(),
        connector_id=connector_id,
        name="Feishu analysis",
        status="active",
        source_selector={"chatId": "oc_1", "command": "analysis"},
        channel_id=channel_id,
    )
    disabled = ExternalRoute(
        id=uuid.uuid4(),
        server_id=active.server_id,
        connector_id=connector_id,
        name="Disabled route",
        status="disabled",
        source_selector={"chatId": "oc_2"},
        channel_id=channel_id,
    )

    matched = await resolve_external_route(
        _FakeSession(_ExecuteResult(scalar_rows=[active, disabled])),
        connector_id=connector_id,
        source={"chatId": "oc_1", "command": "analysis", "extra": "ignored"},
    )
    disabled_outcome = await resolve_external_route(
        _FakeSession(_ExecuteResult(scalar_rows=[active, disabled])),
        connector_id=connector_id,
        source={"chatId": "oc_2"},
    )
    missing = await resolve_external_route(
        _FakeSession(_ExecuteResult(scalar_rows=[active, disabled])),
        connector_id=connector_id,
        source={"chatId": "unknown"},
    )

    assert matched.status == "matched"
    assert matched.route is active
    assert disabled_outcome.status == "disabled"
    assert disabled_outcome.route is disabled
    assert missing.status == "no_route"
    assert missing.failure_code == "EXTERNAL_ROUTE_NOT_FOUND"


@pytest.mark.asyncio
async def test_session_and_mapping_helpers_create_stable_external_links():
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    task_id = uuid.uuid4()
    run_id = uuid.uuid4()
    db = _FakeSession(_ExecuteResult(), _ExecuteResult(), _ExecuteResult(), _ExecuteResult())

    session_outcome = await get_or_create_external_session(
        db,
        server_id=server_id,
        connector_id=connector_id,
        provider="feishu",
        external_scope_type="chat",
        external_scope_id="oc_1",
        channel_id=channel_id,
        task_id=task_id,
    )
    mapping = await create_external_mapping(
        db,
        server_id=server_id,
        connector_id=connector_id,
        provider="jira",
        local_type="task_run",
        local_id=run_id,
        external_type="comment",
        external_id="10001",
        external_url="https://jira.example/browse/JIRA-123?focusedCommentId=10001",
    )

    assert session_outcome.status == "created"
    assert isinstance(session_outcome.session, ExternalSession)
    assert session_outcome.session.channel_id == channel_id
    assert session_outcome.session.task_id == task_id
    assert isinstance(mapping, ExternalMapping)
    assert mapping.local_type == "task_run"
    assert mapping.local_id == run_id
    assert mapping.external_type == "comment"
    assert mapping.external_id == "10001"

    local_rows = await list_external_mappings_for_local(
        _FakeSession(_ExecuteResult(scalar_rows=[mapping])),
        server_id=server_id,
        local_type="task_run",
        local_id=run_id,
    )
    external_rows = await list_external_mappings_for_external(
        _FakeSession(_ExecuteResult(scalar_rows=[mapping])),
        connector_id=connector_id,
        external_type="comment",
        external_id="10001",
    )

    assert local_rows == [mapping]
    assert external_rows == [mapping]


@pytest.mark.asyncio
async def test_event_state_updates_link_local_work_without_executing_runtime():
    event = ExternalEvent(
        id=uuid.uuid4(),
        server_id=uuid.uuid4(),
        connector_id=uuid.uuid4(),
        provider="feishu",
        dedup_key="feishu:message-2",
        event_type="message.created",
        status="received",
        normalized={},
    )
    channel_id = uuid.uuid4()
    message_id = uuid.uuid4()
    task_id = uuid.uuid4()
    run_id = uuid.uuid4()

    linked = await link_external_event(
        _FakeSession(),
        event,
        route_id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        channel_id=channel_id,
        message_id=message_id,
        task_id=task_id,
        task_run_id=run_id,
    )
    completed = await mark_external_event_completed(_FakeSession(), linked)
    dropped_event = ExternalEvent(
        id=uuid.uuid4(),
        server_id=event.server_id,
        connector_id=event.connector_id,
        provider="feishu",
        dedup_key="feishu:message-3",
        event_type="message.created",
        status="received",
        normalized={},
    )
    dropped = await mark_external_event_dropped(
        _FakeSession(),
        dropped_event,
        failure_code="EXTERNAL_ROUTE_NOT_FOUND",
        failure_reason="No active route matched this external source.",
    )

    assert completed.status == "completed"
    assert completed.channel_id == channel_id
    assert completed.message_id == message_id
    assert completed.task_id == task_id
    assert completed.task_run_id == run_id
    assert dropped.status == "dropped"
    assert dropped.failure_code == "EXTERNAL_ROUTE_NOT_FOUND"

    source = integration_gateway.__dict__
    assert "daemon_control" not in source
    assert "runtime_control_command" not in source
    assert "create_task_assignment_and_run" not in source


def test_serializers_redact_connector_secrets_and_expose_event_debug_shape():
    connector = ExternalConnector(
        id=uuid.uuid4(),
        server_id=uuid.uuid4(),
        provider="jira",
        name="Jira Cloud",
        status="active",
        config={"siteUrl": "https://jira.example", "apiToken": "should-not-leak"},
        secret_ref="secret://jira/token",
        encrypted_config={"ciphertext": "opaque"},
    )
    event = ExternalEvent(
        id=uuid.uuid4(),
        server_id=connector.server_id,
        connector_id=connector.id,
        provider="jira",
        dedup_key="jira:event-3",
        event_type="issue.comment",
        status="writeback_failed",
        normalized={"issueKey": "JIRA-123"},
        failure_code="JIRA_COMMENT_FAILED",
        failure_reason="Jira rejected the comment.",
    )

    connector_payload = serialize_external_connector(connector)
    event_payload = serialize_external_event(event)

    assert connector_payload["config"]["siteUrl"] == "https://jira.example"
    assert connector_payload["config"]["apiToken"] == "[redacted]"
    assert connector_payload["secretRef"] == "[redacted]"
    assert connector_payload["encryptedConfig"] == "[redacted]"
    assert event_payload["status"] == "writeback_failed"
    assert event_payload["failureCode"] == "JIRA_COMMENT_FAILED"
    assert event_payload["failureReason"] == "Jira rejected the comment."
