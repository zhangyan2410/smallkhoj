import uuid

import pytest

from models import (
    Channel,
    ChannelMember,
    ExternalConnector,
    ExternalRoute,
    Member,
    Server,
)
from services.integration_bootstrap import (
    BOOTSTRAP_REFERENCE_NOT_FOUND,
    BootstrapError,
    IntegrationBootstrapRequest,
    bootstrap_initial_release_integrations,
    serialize_bootstrap_result,
)


class _ExecuteResult:
    def __init__(self, value=None):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    def __init__(self, *results):
        self._results = list(results)
        self.added = []
        self.flushed = 0

    async def execute(self, _statement):
        if self._results:
            return _ExecuteResult(self._results.pop(0))
        return _ExecuteResult()

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        self.flushed += 1
        for item in self.added:
            if getattr(item, "id", None) is None:
                item.id = uuid.uuid4()


def _request(**overrides):
    data = {
        "server_id": uuid.uuid4(),
        "channel_id": uuid.uuid4(),
        "creator_id": uuid.uuid4(),
        "assignee_id": uuid.uuid4(),
        "feishu_chat_id": "oc_release",
        "feishu_chat_type": "group",
        "feishu_app_id": "cli_release",
        "feishu_bot_open_id": "ou_bot",
        "feishu_bot_name": "SmallKhoj",
        "jira_site_url": "https://team.atlassian.net",
    }
    data.update(overrides)
    return IntegrationBootstrapRequest(**data)


def _references(request):
    server = Server(id=request.server_id, name="release")
    channel = Channel(id=request.channel_id, server_id=request.server_id, name="release-loop", kind="public")
    creator = Member(id=request.creator_id, server_id=request.server_id, kind="human", display_name="operator")
    assignee = Member(id=request.assignee_id, server_id=request.server_id, kind="agent", display_name="worker")
    return server, channel, creator, assignee


@pytest.mark.asyncio
async def test_bootstrap_creates_connectors_route_and_channel_memberships():
    request = _request()
    server, channel, creator, assignee = _references(request)
    db = _FakeSession(
        server,
        channel,
        creator,
        assignee,
        None,
        None,
        None,
        None,
        None,
    )

    result = await bootstrap_initial_release_integrations(db, request)

    feishu_connector = next(item for item in db.added if isinstance(item, ExternalConnector) and item.provider == "feishu")
    jira_connector = next(item for item in db.added if isinstance(item, ExternalConnector) and item.provider == "jira")
    route = next(item for item in db.added if isinstance(item, ExternalRoute))
    memberships = [item for item in db.added if isinstance(item, ChannelMember)]

    assert result.status == "ready"
    assert result.feishu_connector is feishu_connector
    assert result.jira_connector is jira_connector
    assert result.feishu_route is route
    assert feishu_connector.server_id == request.server_id
    assert feishu_connector.config == {
        "appId": "cli_release",
        "botOpenId": "ou_bot",
        "botName": "SmallKhoj",
    }
    assert jira_connector.config == {"siteUrl": "https://team.atlassian.net"}
    assert route.source_selector == {
        "chatId": "oc_release",
        "chatType": "group",
        "command": "jira_analysis",
    }
    assert route.channel_id == request.channel_id
    assert route.default_assignee_id == request.assignee_id
    assert route.writeback_policy == {"feishu": True, "jira": True}
    assert {membership.member_id for membership in memberships} == {request.creator_id, request.assignee_id}


@pytest.mark.asyncio
async def test_bootstrap_is_idempotent_for_existing_connector_and_route_rows():
    request = _request(jira_site_url="https://new-team.atlassian.net")
    server, channel, creator, assignee = _references(request)
    feishu_connector = ExternalConnector(
        id=uuid.uuid4(),
        server_id=request.server_id,
        provider="feishu",
        name="Initial release Feishu",
        status="disabled",
        config={"appId": "old"},
    )
    jira_connector = ExternalConnector(
        id=uuid.uuid4(),
        server_id=request.server_id,
        provider="jira",
        name="Initial release Jira",
        status="disabled",
        config={"siteUrl": "https://old.atlassian.net"},
    )
    route = ExternalRoute(
        id=uuid.uuid4(),
        server_id=request.server_id,
        connector_id=feishu_connector.id,
        name="Feishu Jira analysis",
        status="disabled",
        source_selector={"chatId": "old"},
        channel_id=uuid.uuid4(),
    )
    creator_membership = ChannelMember(channel_id=request.channel_id, member_id=request.creator_id)
    assignee_membership = ChannelMember(channel_id=request.channel_id, member_id=request.assignee_id)
    db = _FakeSession(
        server,
        channel,
        creator,
        assignee,
        feishu_connector,
        jira_connector,
        route,
        creator_membership,
        assignee_membership,
    )

    result = await bootstrap_initial_release_integrations(db, request)

    assert result.feishu_connector is feishu_connector
    assert result.jira_connector is jira_connector
    assert result.feishu_route is route
    assert feishu_connector.status == "active"
    assert jira_connector.status == "active"
    assert route.status == "active"
    assert jira_connector.config == {"siteUrl": "https://new-team.atlassian.net"}
    assert route.channel_id == request.channel_id
    assert route.default_assignee_id == request.assignee_id
    assert not any(isinstance(item, (ExternalConnector, ExternalRoute, ChannelMember)) for item in db.added)


@pytest.mark.asyncio
async def test_bootstrap_fails_before_writes_when_required_reference_is_missing():
    request = _request()
    server, _channel, _creator, _assignee = _references(request)
    db = _FakeSession(server, None)

    with pytest.raises(BootstrapError) as error:
        await bootstrap_initial_release_integrations(db, request)

    assert error.value.code == BOOTSTRAP_REFERENCE_NOT_FOUND
    assert "channel" in error.value.reason.lower()
    assert db.added == []


@pytest.mark.asyncio
async def test_bootstrap_output_excludes_secret_values_and_prints_worker_env_guidance():
    request = _request()
    server, channel, creator, assignee = _references(request)
    db = _FakeSession(server, channel, creator, assignee, None, None, None, None, None)

    result = await bootstrap_initial_release_integrations(db, request)
    payload = serialize_bootstrap_result(result)

    assert payload["env"]["FEISHU_WORKER_CONNECTOR_ID"] == str(result.feishu_connector.id)
    assert payload["env"]["FEISHU_WORKER_JIRA_CONNECTOR_ID"] == str(result.jira_connector.id)
    assert payload["env"]["FEISHU_WORKER_CREATOR_ID"] == str(request.creator_id)
    assert payload["env"]["FEISHU_WORKER_APP_SECRET"] == "<set-in-runtime-env>"
    assert payload["env"]["JIRA_API_TOKEN"] == "<set-in-runtime-env>"
    assert "secret" not in str(result.feishu_connector.config).lower()
    assert "token" not in str(result.jira_connector.config).lower()


def test_bootstrap_cli_does_not_accept_secret_arguments():
    from integration_bootstrap_cli import build_parser

    parser = build_parser()

    with pytest.raises(SystemExit):
        parser.parse_args(["--feishu-app-secret", "should-not-be-accepted"])
