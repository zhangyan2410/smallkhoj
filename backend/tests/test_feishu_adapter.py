import uuid

import pytest

from models import ExternalEvent, ExternalRoute, ExternalSession
from services import feishu_adapter
from services.feishu_adapter import (
    FEISHU_COMMAND_UNKNOWN,
    FEISHU_ROUTE_NOT_FOUND,
    FEISHU_UNADDRESSED_GROUP,
    FeishuInboundMessage,
    dispatch_feishu_message,
    is_message_addressed_to_bot,
    normalize_feishu_message,
    parse_feishu_command,
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

    async def execute(self, _statement):
        if self._results:
            return self._results.pop(0)
        return _ExecuteResult()

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        self.flushed = True

    async def rollback(self):
        pass


def _raw_message_event(**overrides):
    event = {
        "schema": "2.0",
        "header": {
            "event_id": "evt_1",
            "event_type": "im.message.receive_v1",
            "app_id": "cli_a",
        },
        "event": {
            "sender": {"sender_id": {"open_id": "ou_user"}},
            "message": {
                "message_id": "om_msg",
                "chat_id": "oc_chat",
                "chat_type": "group",
                "message_type": "text",
                "content": "{\"text\":\"@SmallKhoj 分析 JIRA-123\"}",
                "mentions": [{"name": "SmallKhoj", "id": {"open_id": "ou_bot"}}],
                "create_time": "1760000000000",
            },
        },
    }
    event["event"]["message"].update(overrides)
    return event


def test_normalize_feishu_message_extracts_stable_business_shape():
    message = normalize_feishu_message(_raw_message_event(thread_id="omt_thread", root_id="om_root", parent_id="om_parent"))

    assert message.event_id == "evt_1"
    assert message.event_type == "im.message.receive_v1"
    assert message.app_id == "cli_a"
    assert message.message_id == "om_msg"
    assert message.chat_id == "oc_chat"
    assert message.chat_type == "group"
    assert message.sender_open_id == "ou_user"
    assert message.text == "@SmallKhoj 分析 JIRA-123"
    assert message.mentions[0]["name"] == "SmallKhoj"
    assert message.thread_id == "omt_thread"
    assert message.root_id == "om_root"
    assert message.parent_id == "om_parent"


def test_group_addressing_requires_mention_or_direct_chat():
    group_message = normalize_feishu_message(_raw_message_event(content="{\"text\":\"只是群聊\"}", mentions=[]))
    direct_message = normalize_feishu_message(_raw_message_event(chat_type="p2p", content="{\"text\":\"分析 JIRA-123\"}", mentions=[]))
    mentioned = normalize_feishu_message(_raw_message_event())

    assert is_message_addressed_to_bot(group_message, bot_name="SmallKhoj") is False
    assert is_message_addressed_to_bot(direct_message, bot_name="SmallKhoj") is True
    assert is_message_addressed_to_bot(mentioned, bot_name="SmallKhoj") is True


def test_parse_feishu_command_supports_first_jira_analysis_shape():
    mentioned = parse_feishu_command(normalize_feishu_message(_raw_message_event()))
    direct = parse_feishu_command(
        FeishuInboundMessage(
            event_id="evt_2",
            event_type="im.message.receive_v1",
            app_id="cli_a",
            message_id="om_direct",
            chat_id="oc_direct",
            chat_type="p2p",
            sender_open_id="ou_user",
            text="分析 OPS-987",
        )
    )
    unknown = parse_feishu_command(
        FeishuInboundMessage(
            event_id="evt_3",
            event_type="im.message.receive_v1",
            app_id="cli_a",
            message_id="om_unknown",
            chat_id="oc_direct",
            chat_type="p2p",
            sender_open_id="ou_user",
            text="随便聊聊",
        )
    )

    assert mentioned.kind == "jira_analysis"
    assert mentioned.jira_issue_key == "JIRA-123"
    assert direct.kind == "jira_analysis"
    assert direct.jira_issue_key == "OPS-987"
    assert unknown is None


@pytest.mark.asyncio
async def test_dispatch_drops_unaddressed_group_before_claiming_event():
    db = _FakeSession()
    message = normalize_feishu_message(_raw_message_event(content="{\"text\":\"只是群聊\"}", mentions=[]))

    outcome = await dispatch_feishu_message(
        db,
        message,
        server_id=uuid.uuid4(),
        connector_id=uuid.uuid4(),
        bot_name="SmallKhoj",
    )

    assert outcome.status == "unaddressed_group"
    assert outcome.failure_code == FEISHU_UNADDRESSED_GROUP
    assert db.added == []


@pytest.mark.asyncio
async def test_dispatch_returns_duplicate_when_gateway_claim_hits_existing_event():
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    existing = ExternalEvent(
        id=uuid.uuid4(),
        server_id=server_id,
        connector_id=connector_id,
        provider="feishu",
        dedup_key="feishu:evt_1",
        event_type="im.message.receive_v1",
        status="accepted",
        normalized={"jiraIssueKey": "JIRA-123"},
    )
    db = _FakeSession(_ExecuteResult(existing))

    outcome = await dispatch_feishu_message(
        db,
        normalize_feishu_message(_raw_message_event()),
        server_id=server_id,
        connector_id=connector_id,
        bot_name="SmallKhoj",
    )

    assert outcome.status == "duplicate"
    assert outcome.event is existing
    assert db.added == []


@pytest.mark.asyncio
async def test_dispatch_unknown_command_marks_event_dropped():
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    db = _FakeSession(_ExecuteResult())
    message = normalize_feishu_message(_raw_message_event(content="{\"text\":\"@SmallKhoj 帮我随便看看\"}"))

    outcome = await dispatch_feishu_message(
        db,
        message,
        server_id=server_id,
        connector_id=connector_id,
        bot_name="SmallKhoj",
    )

    assert outcome.status == "unknown_command"
    assert outcome.failure_code == FEISHU_COMMAND_UNKNOWN
    assert isinstance(outcome.event, ExternalEvent)
    assert outcome.event.status == "dropped"


@pytest.mark.asyncio
async def test_dispatch_unknown_route_marks_event_dropped_with_reason():
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    db = _FakeSession(_ExecuteResult(), _ExecuteResult(scalar_rows=[]))

    outcome = await dispatch_feishu_message(
        db,
        normalize_feishu_message(_raw_message_event()),
        server_id=server_id,
        connector_id=connector_id,
        bot_name="SmallKhoj",
    )

    assert outcome.status == "no_route"
    assert outcome.failure_code == FEISHU_ROUTE_NOT_FOUND
    assert outcome.event.status == "dropped"


@pytest.mark.asyncio
async def test_dispatch_matched_route_links_event_and_creates_external_session():
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    route = ExternalRoute(
        id=uuid.uuid4(),
        server_id=server_id,
        connector_id=connector_id,
        name="Feishu Jira analysis",
        status="active",
        source_selector={"chatId": "oc_chat", "chatType": "group", "command": "jira_analysis"},
        channel_id=channel_id,
    )
    db = _FakeSession(_ExecuteResult(), _ExecuteResult(scalar_rows=[route]), _ExecuteResult())

    outcome = await dispatch_feishu_message(
        db,
        normalize_feishu_message(_raw_message_event()),
        server_id=server_id,
        connector_id=connector_id,
        bot_name="SmallKhoj",
    )

    assert outcome.status == "accepted"
    assert outcome.command.kind == "jira_analysis"
    assert outcome.command.jira_issue_key == "JIRA-123"
    assert outcome.route is route
    assert isinstance(outcome.session, ExternalSession)
    assert outcome.session.external_scope_type == "chat"
    assert outcome.session.external_scope_id == "oc_chat"
    assert outcome.session.channel_id == channel_id
    assert outcome.event.status == "accepted"
    assert outcome.event.route_id == route.id
    assert outcome.event.session_id == outcome.session.id
    assert outcome.event.channel_id == channel_id


def test_feishu_adapter_does_not_import_runtime_execution_helpers():
    source = feishu_adapter.__dict__

    assert "daemon_control" not in source
    assert "runtime_control_command" not in source
    assert "create_task_assignment_and_run" not in source
