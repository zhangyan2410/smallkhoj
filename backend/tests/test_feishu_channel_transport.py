from types import SimpleNamespace
import inspect
import sys
import uuid

import pytest

from models import ExternalConnector
from services import feishu_channel_transport
from services.feishu_adapter import normalize_feishu_message
from services.feishu_channel_transport import (
    FEISHU_CHANNEL_TRANSPORT_CONFIG_FAILED,
    FEISHU_CHANNEL_TRANSPORT_CONNECTOR_FAILED,
    FEISHU_CHANNEL_TRANSPORT_SDK_MISSING,
    FEISHU_CHANNEL_TRANSPORT_STARTED,
    FeishuChannelSDKTransport,
    create_feishu_channel,
    run_feishu_channel_worker,
    sdk_message_to_raw_event,
)
from services.feishu_worker_runtime import FeishuWorkerDependencies, resolve_feishu_worker_config


class _AsyncSessionContext:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeChannel:
    def __init__(self):
        self.handlers = {}
        self.connected = False
        self.disconnected = False

    def on(self, event_name, handler):
        self.handlers[event_name] = handler

    async def connect(self):
        self.connected = True

    async def disconnect(self):
        self.disconnected = True


class _Client:
    def __init__(self):
        self.closed = False

    async def aclose(self):
        self.closed = True


def _settings(**overrides):
    values = {
        "feishu_worker_connector_id": str(uuid.uuid4()),
        "feishu_worker_jira_connector_id": str(uuid.uuid4()),
        "feishu_worker_creator_id": str(uuid.uuid4()),
        "feishu_worker_bot_open_id": "ou_bot",
        "feishu_worker_bot_name": "SmallKhoj",
        "feishu_worker_app_id": "cli_app",
        "feishu_worker_app_secret": "app-secret",
        "jira_email": "bot@example.com",
        "jira_api_token": "jira-token",
        "feishu_reply_base_url": "https://open.feishu.cn",
        "feishu_reply_access_token": "tenant-token",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _connector(*, provider, connector_id, server_id=None):
    return ExternalConnector(
        id=connector_id,
        server_id=server_id or uuid.uuid4(),
        provider=provider,
        name=f"{provider} connector",
        status="active",
        config={"siteUrl": "https://team.atlassian.net"} if provider == "jira" else {},
    )


def _sdk_message(**overrides):
    values = {
        "event_id": "evt_1",
        "message_id": "om_1",
        "chat_id": "oc_1",
        "chat_type": "group",
        "sender_open_id": "ou_user",
        "content_text": "@SmallKhoj 分析 JIRA-123",
        "mentions": [{"name": "SmallKhoj", "id": {"open_id": "ou_bot"}}],
        "thread_id": "omt_thread",
        "root_id": "om_root",
        "parent_id": "om_parent",
        "create_time": "1710000000000",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _dependencies():
    return FeishuWorkerDependencies(
        jira_http_client=_Client(),
        feishu_http_client=_Client(),
        jira_credentials_resolver=lambda _connector: {"email": "bot@example.com", "apiToken": "jira-token"},
        feishu_reply_config=SimpleNamespace(base_url="https://open.feishu.cn", access_token="tenant-token"),
    )


def test_sdk_message_to_raw_event_matches_existing_normalizer_shape():
    config = resolve_feishu_worker_config(configured_settings=_settings()).config

    raw = sdk_message_to_raw_event(_sdk_message(), config)
    message = normalize_feishu_message(raw)

    assert raw["header"]["event_id"] == "evt_1"
    assert raw["header"]["app_id"] == "cli_app"
    assert message.event_id == "evt_1"
    assert message.message_id == "om_1"
    assert message.chat_id == "oc_1"
    assert message.chat_type == "group"
    assert message.sender_open_id == "ou_user"
    assert message.text == "@SmallKhoj 分析 JIRA-123"
    assert message.thread_id == "omt_thread"


@pytest.mark.asyncio
async def test_transport_registers_message_handler_and_forwards_to_worker_runtime(monkeypatch):
    config = resolve_feishu_worker_config(configured_settings=_settings()).config
    channel = _FakeChannel()
    calls = []

    async def fake_handle(db, **kwargs):
        calls.append((db, kwargs))
        return SimpleNamespace(status="processed", reason_code="FEISHU_WORKER_EVENT_PROCESSED")

    monkeypatch.setattr(feishu_channel_transport, "handle_feishu_worker_raw_event", fake_handle)
    transport = FeishuChannelSDKTransport(
        channel=channel,
        config=config,
        connectors=SimpleNamespace(feishu_connector=SimpleNamespace(), jira_connector=SimpleNamespace()),
        db_factory=lambda: "db-session",
        dependencies_factory=_dependencies,
    )

    await transport.connect()
    await channel.handlers["message"](_sdk_message())
    await transport.disconnect()

    assert channel.connected is True
    assert channel.disconnected is True
    assert calls[0][0] == "db-session"
    assert calls[0][1]["raw_event"]["event"]["message"]["message_id"] == "om_1"
    assert calls[0][1]["close_dependencies"] is True
    assert transport.outcomes[0].status == "processed"


def test_create_feishu_channel_lazy_imports_lark_channel(monkeypatch):
    config = resolve_feishu_worker_config(configured_settings=_settings()).config
    created = []

    class _FeishuChannel:
        def __init__(self, **kwargs):
            created.append(kwargs)

    monkeypatch.setitem(sys.modules, "lark_channel", SimpleNamespace(FeishuChannel=_FeishuChannel))

    channel = create_feishu_channel(config)

    assert isinstance(channel, _FeishuChannel)
    assert created == [{"app_id": "cli_app", "app_secret": "app-secret"}]


def test_create_feishu_channel_reports_missing_sdk(monkeypatch):
    config = resolve_feishu_worker_config(configured_settings=_settings()).config
    monkeypatch.delitem(sys.modules, "lark_channel", raising=False)

    def fake_import(name, *args, **kwargs):
        if name == "lark_channel":
            raise ImportError("missing")
        return original_import(name, *args, **kwargs)

    original_import = __import__
    monkeypatch.setattr("builtins.__import__", fake_import)

    with pytest.raises(RuntimeError) as error:
        create_feishu_channel(config)

    assert FEISHU_CHANNEL_TRANSPORT_SDK_MISSING in str(error.value)


@pytest.mark.asyncio
async def test_run_feishu_channel_worker_returns_config_failure_before_channel_creation():
    channel_factory_calls = []

    result = await run_feishu_channel_worker(
        db_factory=lambda: _AsyncSessionContext(SimpleNamespace()),
        configured_settings=_settings(feishu_worker_connector_id=""),
        channel_factory=lambda _config: channel_factory_calls.append(_config),
    )

    assert result.status == "failed"
    assert result.reason_code == FEISHU_CHANNEL_TRANSPORT_CONFIG_FAILED
    assert channel_factory_calls == []


@pytest.mark.asyncio
async def test_run_feishu_channel_worker_resolves_connectors_and_starts_injected_channel(monkeypatch):
    settings = _settings()
    config = resolve_feishu_worker_config(configured_settings=settings).config
    server_id = uuid.uuid4()
    feishu = _connector(provider="feishu", connector_id=config.feishu_connector_id, server_id=server_id)
    jira = _connector(provider="jira", connector_id=config.jira_connector_id, server_id=server_id)
    channel = _FakeChannel()

    async def fake_load(db, loaded_config):
        return SimpleNamespace(status="ready", feishu_connector=feishu, jira_connector=jira)

    monkeypatch.setattr(feishu_channel_transport, "load_feishu_worker_connectors", fake_load)

    result = await run_feishu_channel_worker(
        db_factory=lambda: _AsyncSessionContext(SimpleNamespace()),
        configured_settings=settings,
        channel_factory=lambda _config: channel,
        dependencies_factory=_dependencies,
    )

    assert result.status == "started"
    assert result.reason_code == FEISHU_CHANNEL_TRANSPORT_STARTED
    assert channel.connected is True
    assert result.transport.channel is channel
    assert result.transport.connectors.feishu_connector is feishu
    await result.transport.disconnect()


@pytest.mark.asyncio
async def test_run_feishu_channel_worker_returns_connector_failure(monkeypatch):
    settings = _settings()
    channel = _FakeChannel()

    async def fake_load(db, loaded_config):
        return SimpleNamespace(status="failed", reason_code="NO_CONNECTOR", reason="missing connector")

    monkeypatch.setattr(feishu_channel_transport, "load_feishu_worker_connectors", fake_load)

    result = await run_feishu_channel_worker(
        db_factory=lambda: _AsyncSessionContext(SimpleNamespace()),
        configured_settings=settings,
        channel_factory=lambda _config: channel,
    )

    assert result.status == "failed"
    assert result.reason_code == FEISHU_CHANNEL_TRANSPORT_CONNECTOR_FAILED
    assert channel.connected is False


def test_feishu_channel_transport_does_not_import_business_or_daemon_helpers():
    source = inspect.getsource(feishu_channel_transport)

    assert "daemon_control" not in source
    assert "AgentProxy" not in source
    assert "create_task_assignment_and_run" not in source
    assert "fetch_jira_issue" not in source
    assert "parse_feishu_command" not in source
