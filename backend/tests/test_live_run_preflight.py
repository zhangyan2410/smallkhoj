from types import SimpleNamespace
import uuid

import pytest

from models import ExternalConnector, ExternalRoute
from services.integration_gateway import EXTERNAL_ROUTE_NOT_FOUND
from services.live_run_preflight import (
    LIVE_RUN_PREFLIGHT_READY,
    LIVE_RUN_PREFLIGHT_ROUTE_TARGET_MISSING,
    LIVE_RUN_PREFLIGHT_WORKER_CONFIG_INCOMPLETE,
    LiveRunPreflightRequest,
    run_initial_release_preflight,
    serialize_preflight_report,
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
        self.queries = 0

    async def execute(self, _statement):
        self.queries += 1
        if self._results:
            result = self._results.pop(0)
            if isinstance(result, _ExecuteResult):
                return result
            return _ExecuteResult(result)
        return _ExecuteResult()


def _settings(**overrides):
    feishu_connector_id = overrides.pop("feishu_connector_id", uuid.uuid4())
    jira_connector_id = overrides.pop("jira_connector_id", uuid.uuid4())
    values = {
        "feishu_worker_connector_id": str(feishu_connector_id),
        "feishu_worker_jira_connector_id": str(jira_connector_id),
        "feishu_worker_creator_id": str(uuid.uuid4()),
        "feishu_worker_bot_open_id": "ou_bot",
        "feishu_worker_bot_name": "SmallKhoj",
        "feishu_worker_app_id": "cli_app",
        "feishu_worker_app_secret": "app-secret",
        "feishu_reply_access_token": "tenant-token",
        "jira_email": "bot@example.com",
        "jira_api_token": "jira-token",
    }
    values.update(overrides)
    return SimpleNamespace(**values), feishu_connector_id, jira_connector_id


def _request(**overrides):
    values = {
        "feishu_chat_id": "oc_release",
        "feishu_chat_type": "group",
        "command": "jira_analysis",
    }
    values.update(overrides)
    return LiveRunPreflightRequest(**values)


def _connectors(settings_ids):
    _settings_obj, feishu_connector_id, jira_connector_id = settings_ids
    server_id = uuid.uuid4()
    feishu = ExternalConnector(
        id=feishu_connector_id,
        server_id=server_id,
        provider="feishu",
        name="Initial release Feishu",
        status="active",
        config={"appId": "cli_app", "botOpenId": "ou_bot", "botName": "SmallKhoj"},
    )
    jira = ExternalConnector(
        id=jira_connector_id,
        server_id=server_id,
        provider="jira",
        name="Initial release Jira",
        status="active",
        config={"siteUrl": "https://team.atlassian.net"},
    )
    return feishu, jira


@pytest.mark.asyncio
async def test_preflight_ready_validates_worker_config_connectors_route_and_credentials_without_network():
    settings_bundle = _settings()
    settings_obj = settings_bundle[0]
    feishu, jira = _connectors(settings_bundle)
    route = ExternalRoute(
        id=uuid.uuid4(),
        server_id=feishu.server_id,
        connector_id=feishu.id,
        name="Feishu Jira analysis",
        status="active",
        source_selector={"chatId": "oc_release", "chatType": "group", "command": "jira_analysis"},
        channel_id=uuid.uuid4(),
        default_assignee_id=uuid.uuid4(),
    )
    db = _FakeSession(feishu, jira, _ExecuteResult(scalar_rows=[route]))

    report = await run_initial_release_preflight(db, _request(), configured_settings=settings_obj)
    payload = serialize_preflight_report(report)

    assert report.ready is True
    assert payload["ready"] is True
    assert [check["status"] for check in payload["checks"]] == ["passed", "passed", "passed", "passed", "passed"]
    assert {check["name"] for check in payload["checks"]} == {
        "workerConfig",
        "connectors",
        "connectorConfig",
        "jiraCredentials",
        "feishuRoute",
    }
    assert all(check["reasonCode"] == LIVE_RUN_PREFLIGHT_READY for check in payload["checks"])
    assert db.queries == 3


@pytest.mark.asyncio
async def test_preflight_stops_before_db_when_worker_config_is_missing():
    settings_obj, _feishu_id, _jira_id = _settings(
        feishu_worker_connector_id="",
        feishu_worker_jira_connector_id="",
        feishu_worker_creator_id="",
        feishu_worker_app_id="",
        feishu_worker_app_secret="",
        feishu_reply_access_token="",
        jira_email="",
        jira_api_token="",
    )
    db = _FakeSession()

    report = await run_initial_release_preflight(db, _request(), configured_settings=settings_obj)
    payload = serialize_preflight_report(report)

    assert report.ready is False
    assert report.checks[0].name == "workerConfig"
    assert report.checks[0].status == "failed"
    assert report.checks[0].reason_code == LIVE_RUN_PREFLIGHT_WORKER_CONFIG_INCOMPLETE
    assert payload["checks"][0]["details"] == {
        "missing": [
            "FEISHU_WORKER_CONNECTOR_ID",
            "FEISHU_WORKER_JIRA_CONNECTOR_ID",
            "FEISHU_WORKER_CREATOR_ID",
            "FEISHU_WORKER_APP_ID",
            "FEISHU_WORKER_APP_SECRET",
            "FEISHU_REPLY_ACCESS_TOKEN",
            "JIRA_EMAIL",
            "JIRA_API_TOKEN",
        ]
    }
    assert db.queries == 0


@pytest.mark.asyncio
async def test_preflight_reports_missing_route_as_not_ready():
    settings_bundle = _settings()
    settings_obj = settings_bundle[0]
    feishu, jira = _connectors(settings_bundle)
    db = _FakeSession(feishu, jira, _ExecuteResult(scalar_rows=[]))

    report = await run_initial_release_preflight(db, _request(), configured_settings=settings_obj)

    route_check = report.checks[-1]
    assert report.ready is False
    assert route_check.name == "feishuRoute"
    assert route_check.status == "failed"
    assert route_check.reason_code == EXTERNAL_ROUTE_NOT_FOUND


@pytest.mark.asyncio
async def test_preflight_reports_route_without_channel_or_assignee_as_not_ready():
    settings_bundle = _settings()
    settings_obj = settings_bundle[0]
    feishu, jira = _connectors(settings_bundle)
    route = ExternalRoute(
        id=uuid.uuid4(),
        server_id=feishu.server_id,
        connector_id=feishu.id,
        name="Feishu Jira analysis",
        status="active",
        source_selector={"chatId": "oc_release", "chatType": "group", "command": "jira_analysis"},
        channel_id=None,
        default_assignee_id=None,
    )
    db = _FakeSession(feishu, jira, _ExecuteResult(scalar_rows=[route]))

    report = await run_initial_release_preflight(db, _request(), configured_settings=settings_obj)

    assert report.ready is False
    assert report.checks[-1].reason_code == LIVE_RUN_PREFLIGHT_ROUTE_TARGET_MISSING


@pytest.mark.asyncio
async def test_preflight_reports_missing_jira_credentials_as_not_ready():
    settings_bundle = _settings(jira_api_token="")
    settings_obj = settings_bundle[0]
    feishu, jira = _connectors(settings_bundle)
    route = ExternalRoute(
        id=uuid.uuid4(),
        server_id=feishu.server_id,
        connector_id=feishu.id,
        name="Feishu Jira analysis",
        status="active",
        source_selector={"chatId": "oc_release", "chatType": "group", "command": "jira_analysis"},
        channel_id=uuid.uuid4(),
        default_assignee_id=uuid.uuid4(),
    )
    db = _FakeSession(feishu, jira, _ExecuteResult(scalar_rows=[route]))

    report = await run_initial_release_preflight(db, _request(), configured_settings=settings_obj)

    assert report.ready is False
    assert report.checks[0].name == "workerConfig"
    assert report.checks[0].reason_code == LIVE_RUN_PREFLIGHT_WORKER_CONFIG_INCOMPLETE
    assert report.checks[0].details == {"missing": ["JIRA_API_TOKEN"]}
    assert db.queries == 0


def test_preflight_cli_help_loads_and_rejects_secret_arguments():
    from live_run_preflight_cli import build_parser

    parser = build_parser()
    parsed = parser.parse_args(["--feishu-chat-id", "oc_release"])

    assert parsed.feishu_chat_id == "oc_release"

    with pytest.raises(SystemExit):
        parser.parse_args(["--jira-api-token", "should-not-be-accepted"])

    with pytest.raises(SystemExit):
        parser.parse_args(["--feishu-app-secret", "should-not-be-accepted"])
