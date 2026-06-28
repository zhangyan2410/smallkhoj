from types import SimpleNamespace
import inspect
import uuid

import pytest

from services import feishu_replies
from services.feishu_replies import (
    FEISHU_REPLY_API_FAILED,
    FEISHU_REPLY_CHAT_MISSING,
    FEISHU_REPLY_CREDENTIALS_MISSING,
    FEISHU_REPLY_RESPONSE_MISSING_MESSAGE_ID,
    FEISHU_REPLY_TEXT_MISSING,
    FeishuReplyError,
    FeishuReplyConfig,
    send_feishu_text_reply,
)


class _Response:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.text = text

    def json(self):
        return self._payload


class _HttpClient:
    def __init__(self, response=None):
        self.response = response or _Response({"code": 0, "data": {"message_id": "om_reply"}})
        self.posts = []

    async def post(self, url, **kwargs):
        self.posts.append({"url": url, **kwargs})
        return self.response


class _FakeSession:
    def __init__(self):
        self.added = []
        self.flushed = False

    def add(self, item):
        self.added.append(item)
        if getattr(item, "id", None) is None:
            item.id = uuid.uuid4()

    async def flush(self):
        self.flushed = True


def _config():
    return FeishuReplyConfig(base_url="https://open.feishu.cn", access_token="tenant-token")


@pytest.mark.asyncio
async def test_send_feishu_text_reply_posts_chat_level_text_and_maps_message():
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    local_id = uuid.uuid4()
    client = _HttpClient()
    db = _FakeSession()

    result = await send_feishu_text_reply(
        db,
        http_client=client,
        config=_config(),
        server_id=server_id,
        connector_id=connector_id,
        chat_id="oc_chat",
        text="Accepted JIRA-123.",
        local_type="task_run",
        local_id=local_id,
    )

    assert client.posts[0]["url"] == "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id"
    assert client.posts[0]["headers"]["Authorization"] == "Bearer tenant-token"
    assert client.posts[0]["json"]["receive_id"] == "oc_chat"
    assert client.posts[0]["json"]["msg_type"] == "text"
    assert client.posts[0]["json"]["content"] == '{"text":"Accepted JIRA-123."}'
    assert result.message_id == "om_reply"
    assert result.mapping.local_type == "task_run"
    assert result.mapping.local_id == local_id
    assert result.mapping.provider == "feishu"
    assert result.mapping.external_type == "message"
    assert result.mapping.external_id == "om_reply"
    assert result.mapping.metadata_json["chatId"] == "oc_chat"
    assert "tenant-token" not in str(result.mapping.metadata_json)


@pytest.mark.asyncio
async def test_send_feishu_text_reply_uses_source_message_reply_endpoint():
    client = _HttpClient()

    await send_feishu_text_reply(
        _FakeSession(),
        http_client=client,
        config=_config(),
        server_id=uuid.uuid4(),
        connector_id=uuid.uuid4(),
        chat_id="oc_chat",
        source_message_id="om_source",
        text="Task completed.",
        local_type="task_run",
        local_id=uuid.uuid4(),
    )

    assert client.posts[0]["url"] == "https://open.feishu.cn/open-apis/im/v1/messages/om_source/reply"
    assert "receive_id" not in client.posts[0]["json"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("config", "chat_id", "text", "code"),
    [
        (FeishuReplyConfig(base_url="https://open.feishu.cn", access_token=""), "oc_chat", "ok", FEISHU_REPLY_CREDENTIALS_MISSING),
        (_config(), "", "ok", FEISHU_REPLY_CHAT_MISSING),
        (_config(), "oc_chat", "   ", FEISHU_REPLY_TEXT_MISSING),
    ],
)
async def test_send_feishu_text_reply_validates_inputs_before_http(config, chat_id, text, code):
    client = _HttpClient()

    with pytest.raises(FeishuReplyError) as error:
        await send_feishu_text_reply(
            _FakeSession(),
            http_client=client,
            config=config,
            server_id=uuid.uuid4(),
            connector_id=uuid.uuid4(),
            chat_id=chat_id,
            text=text,
            local_type="task_run",
            local_id=uuid.uuid4(),
        )

    assert error.value.code == code
    assert client.posts == []


@pytest.mark.asyncio
async def test_send_feishu_text_reply_wraps_feishu_api_error():
    client = _HttpClient(_Response({"code": 999, "msg": "denied"}, status_code=200))

    with pytest.raises(FeishuReplyError) as error:
        await send_feishu_text_reply(
            _FakeSession(),
            http_client=client,
            config=_config(),
            server_id=uuid.uuid4(),
            connector_id=uuid.uuid4(),
            chat_id="oc_chat",
            text="ok",
            local_type="task_run",
            local_id=uuid.uuid4(),
        )

    assert error.value.code == FEISHU_REPLY_API_FAILED
    assert "denied" in error.value.reason


@pytest.mark.asyncio
async def test_send_feishu_text_reply_requires_response_message_id():
    client = _HttpClient(_Response({"code": 0, "data": {}}))

    with pytest.raises(FeishuReplyError) as error:
        await send_feishu_text_reply(
            _FakeSession(),
            http_client=client,
            config=_config(),
            server_id=uuid.uuid4(),
            connector_id=uuid.uuid4(),
            chat_id="oc_chat",
            text="ok",
            local_type="task_run",
            local_id=uuid.uuid4(),
        )

    assert error.value.code == FEISHU_REPLY_RESPONSE_MISSING_MESSAGE_ID


def test_feishu_replies_does_not_import_runtime_or_daemon_execution_helpers():
    source = inspect.getsource(feishu_replies)

    assert "daemon_control" not in source
    assert "AgentProxy" not in source
    assert "create_task_assignment_and_run" not in source
