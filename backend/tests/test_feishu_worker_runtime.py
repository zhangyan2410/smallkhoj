import inspect
import uuid
from types import SimpleNamespace

import pytest

from config import Settings
from models import ExternalConnector
from services import feishu_worker_runtime
from services.feishu_worker_runtime import (
    FEISHU_WORKER_CONFIG_MISSING_APP_CREDENTIALS,
    FEISHU_WORKER_CONFIG_MISSING_CONNECTOR_ID,
    FEISHU_WORKER_CONFIG_MISSING_CREATOR_ID,
    FEISHU_WORKER_CONNECTOR_DISABLED,
    FEISHU_WORKER_CONNECTOR_NOT_FOUND,
    FEISHU_WORKER_CONNECTOR_PROVIDER_MISMATCH,
    FEISHU_WORKER_EVENT_LOOP_FAILED,
    FEISHU_WORKER_EVENT_PROCESSED,
    FEISHU_WORKER_JIRA_CREDENTIALS_MISSING,
    FakeFeishuEventTransport,
    FeishuWorkerDependencies,
    close_feishu_worker_dependencies,
    handle_feishu_worker_raw_event,
    load_feishu_worker_connectors,
    resolve_feishu_worker_config,
    run_feishu_event_transport,
)


class _ExecuteResult:
    def __init__(self, value=None):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    def __init__(self, *results):
        self._results = list(results)

    async def execute(self, _statement):
        if self._results:
            return self._results.pop(0)
        return _ExecuteResult()


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


def _connector(*, provider, status="active", connector_id=None, server_id=None):
    return ExternalConnector(
        id=connector_id or uuid.uuid4(),
        server_id=server_id or uuid.uuid4(),
        provider=provider,
        name=f"{provider} connector",
        status=status,
        config={"siteUrl": "https://team.atlassian.net"} if provider == "jira" else {},
    )


def test_settings_exposes_safe_default_feishu_worker_runtime_values(monkeypatch):
    for key in (
        "FEISHU_WORKER_ENABLED",
        "FEISHU_WORKER_CONNECTOR_ID",
        "FEISHU_WORKER_JIRA_CONNECTOR_ID",
        "FEISHU_WORKER_CREATOR_ID",
        "FEISHU_WORKER_BOT_OPEN_ID",
        "FEISHU_WORKER_BOT_NAME",
        "FEISHU_WORKER_APP_ID",
        "FEISHU_WORKER_APP_SECRET",
    ):
        monkeypatch.delenv(key, raising=False)

    settings = Settings(_env_file=None)

    assert settings.feishu_worker_enabled is False
    assert settings.feishu_worker_connector_id == ""
    assert settings.feishu_worker_jira_connector_id == ""
    assert settings.feishu_worker_creator_id == ""
    assert settings.feishu_worker_bot_open_id == ""
    assert settings.feishu_worker_bot_name == "SmallKhoj"
    assert settings.feishu_worker_app_id == ""
    assert settings.feishu_worker_app_secret == ""


def test_resolve_feishu_worker_config_requires_ids_and_app_credentials():
    missing = resolve_feishu_worker_config(configured_settings=_settings(feishu_worker_connector_id=""))
    missing_creator = resolve_feishu_worker_config(configured_settings=_settings(feishu_worker_creator_id=""))
    missing_app = resolve_feishu_worker_config(configured_settings=_settings(feishu_worker_app_secret=""))
    complete = resolve_feishu_worker_config(configured_settings=_settings(feishu_worker_bot_name=" SmallKhoj "))

    assert missing.status == "failed"
    assert missing.reason_code == FEISHU_WORKER_CONFIG_MISSING_CONNECTOR_ID
    assert missing_creator.reason_code == FEISHU_WORKER_CONFIG_MISSING_CREATOR_ID
    assert missing_app.reason_code == FEISHU_WORKER_CONFIG_MISSING_APP_CREDENTIALS
    assert complete.status == "ready"
    assert complete.config.bot_name == "SmallKhoj"
    assert isinstance(complete.config.feishu_connector_id, uuid.UUID)


@pytest.mark.asyncio
async def test_load_feishu_worker_connectors_rejects_missing_wrong_provider_and_disabled():
    config = resolve_feishu_worker_config(configured_settings=_settings()).config
    feishu = _connector(provider="feishu", connector_id=config.feishu_connector_id)
    jira = _connector(provider="jira", connector_id=config.jira_connector_id, server_id=feishu.server_id)

    missing = await load_feishu_worker_connectors(_FakeSession(_ExecuteResult(None), _ExecuteResult(jira)), config)
    wrong_provider = await load_feishu_worker_connectors(
        _FakeSession(_ExecuteResult(_connector(provider="jira", connector_id=config.feishu_connector_id)), _ExecuteResult(jira)),
        config,
    )
    disabled = await load_feishu_worker_connectors(
        _FakeSession(_ExecuteResult(_connector(provider="feishu", status="disabled", connector_id=config.feishu_connector_id)), _ExecuteResult(jira)),
        config,
    )
    ready = await load_feishu_worker_connectors(_FakeSession(_ExecuteResult(feishu), _ExecuteResult(jira)), config)

    assert missing.status == "failed"
    assert missing.reason_code == FEISHU_WORKER_CONNECTOR_NOT_FOUND
    assert wrong_provider.reason_code == FEISHU_WORKER_CONNECTOR_PROVIDER_MISMATCH
    assert disabled.reason_code == FEISHU_WORKER_CONNECTOR_DISABLED
    assert ready.status == "ready"
    assert ready.feishu_connector is feishu
    assert ready.jira_connector is jira


@pytest.mark.asyncio
async def test_handle_feishu_worker_raw_event_delegates_to_event_loop_and_closes_clients(monkeypatch):
    config = resolve_feishu_worker_config(configured_settings=_settings()).config
    feishu = _connector(provider="feishu", connector_id=config.feishu_connector_id)
    jira = _connector(provider="jira", connector_id=config.jira_connector_id, server_id=feishu.server_id)
    jira_client = _Client()
    feishu_client = _Client()
    calls = []

    async def fake_process(db, **kwargs):
        calls.append((db, kwargs))
        return SimpleNamespace(status="accepted", reason_code="FEISHU_EVENT_LOOP_ACCEPTED")

    monkeypatch.setattr(feishu_worker_runtime, "process_feishu_raw_event", fake_process)

    dependencies = FeishuWorkerDependencies(
        jira_http_client=jira_client,
        feishu_http_client=feishu_client,
        jira_credentials_resolver=lambda _connector: {"email": "bot@example.com", "apiToken": "jira-token"},
        feishu_reply_config=SimpleNamespace(base_url="https://open.feishu.cn", access_token="tenant-token"),
    )

    result = await handle_feishu_worker_raw_event(
        _FakeSession(),
        raw_event={"event": {"message": {"message_id": "om_1"}}},
        config=config,
        connectors=SimpleNamespace(feishu_connector=feishu, jira_connector=jira),
        dependencies=dependencies,
        close_dependencies=True,
    )

    assert result.status == "processed"
    assert result.reason_code == FEISHU_WORKER_EVENT_PROCESSED
    assert calls[0][1]["server_id"] == feishu.server_id
    assert calls[0][1]["feishu_connector_id"] == feishu.id
    assert calls[0][1]["jira_connector"] is jira
    assert calls[0][1]["creator_id"] == config.creator_id
    assert calls[0][1]["bot_open_id"] == "ou_bot"
    assert calls[0][1]["bot_name"] == "SmallKhoj"
    assert jira_client.closed is True
    assert feishu_client.closed is True


@pytest.mark.asyncio
async def test_handle_feishu_worker_raw_event_closes_clients_when_event_loop_raises(monkeypatch):
    config = resolve_feishu_worker_config(configured_settings=_settings()).config
    feishu = _connector(provider="feishu", connector_id=config.feishu_connector_id)
    jira = _connector(provider="jira", connector_id=config.jira_connector_id, server_id=feishu.server_id)
    jira_client = _Client()
    feishu_client = _Client()

    async def fake_process(db, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(feishu_worker_runtime, "process_feishu_raw_event", fake_process)

    dependencies = FeishuWorkerDependencies(
        jira_http_client=jira_client,
        feishu_http_client=feishu_client,
        jira_credentials_resolver=lambda _connector: {"email": "bot@example.com", "apiToken": "jira-token"},
        feishu_reply_config=SimpleNamespace(base_url="https://open.feishu.cn", access_token="tenant-token"),
    )

    result = await handle_feishu_worker_raw_event(
        _FakeSession(),
        raw_event={},
        config=config,
        connectors=SimpleNamespace(feishu_connector=feishu, jira_connector=jira),
        dependencies=dependencies,
        close_dependencies=True,
    )

    assert result.status == "failed"
    assert result.reason_code == FEISHU_WORKER_EVENT_LOOP_FAILED
    assert result.reason == "boom"
    assert jira_client.closed is True
    assert feishu_client.closed is True


@pytest.mark.asyncio
async def test_handle_feishu_worker_raw_event_returns_missing_jira_credentials_before_event_loop(monkeypatch):
    config = resolve_feishu_worker_config(configured_settings=_settings()).config
    feishu = _connector(provider="feishu", connector_id=config.feishu_connector_id)
    jira = _connector(provider="jira", connector_id=config.jira_connector_id, server_id=feishu.server_id)
    calls = []

    async def fake_process(db, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(status="accepted")

    monkeypatch.setattr(feishu_worker_runtime, "process_feishu_raw_event", fake_process)

    result = await handle_feishu_worker_raw_event(
        _FakeSession(),
        raw_event={},
        config=config,
        connectors=SimpleNamespace(feishu_connector=feishu, jira_connector=jira),
        dependencies=FeishuWorkerDependencies(
            jira_http_client=_Client(),
            feishu_http_client=_Client(),
            jira_credentials_resolver=lambda _connector: None,
            feishu_reply_config=SimpleNamespace(),
        ),
        close_dependencies=True,
    )

    assert result.status == "failed"
    assert result.reason_code == FEISHU_WORKER_JIRA_CREDENTIALS_MISSING
    assert calls == []


@pytest.mark.asyncio
async def test_fake_transport_feeds_raw_events_without_feishu_sdk(monkeypatch):
    config = resolve_feishu_worker_config(configured_settings=_settings()).config
    feishu = _connector(provider="feishu", connector_id=config.feishu_connector_id)
    jira = _connector(provider="jira", connector_id=config.jira_connector_id, server_id=feishu.server_id)

    async def fake_process(db, **kwargs):
        return SimpleNamespace(status="accepted", reason_code="FEISHU_EVENT_LOOP_ACCEPTED")

    monkeypatch.setattr(feishu_worker_runtime, "process_feishu_raw_event", fake_process)
    transport = FakeFeishuEventTransport([{"event": {"message": {"message_id": "om_1"}}}])

    results = await run_feishu_event_transport(
        transport,
        db_factory=lambda: _FakeSession(),
        config=config,
        connectors=SimpleNamespace(feishu_connector=feishu, jira_connector=jira),
        dependencies_factory=lambda: FeishuWorkerDependencies(
            jira_http_client=_Client(),
            feishu_http_client=_Client(),
            jira_credentials_resolver=lambda _connector: {"email": "bot@example.com", "apiToken": "jira-token"},
            feishu_reply_config=SimpleNamespace(),
        ),
    )

    assert [result.reason_code for result in results] == [FEISHU_WORKER_EVENT_PROCESSED]


@pytest.mark.asyncio
async def test_close_feishu_worker_dependencies_closes_both_owned_clients():
    jira_client = _Client()
    feishu_client = _Client()
    dependencies = FeishuWorkerDependencies(
        jira_http_client=jira_client,
        feishu_http_client=feishu_client,
        jira_credentials_resolver=lambda _connector: None,
        feishu_reply_config=SimpleNamespace(),
    )

    await close_feishu_worker_dependencies(dependencies)

    assert jira_client.closed is True
    assert feishu_client.closed is True


def test_feishu_worker_runtime_does_not_import_daemon_or_taskrun_execution_helpers():
    source = inspect.getsource(feishu_worker_runtime)

    assert "daemon_control" not in source
    assert "AgentProxy" not in source
    assert "create_task_assignment_and_run" not in source
    assert "lark_oapi" not in source
