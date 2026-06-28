from types import SimpleNamespace
import inspect
import uuid

import pytest

from services import feishu_reply_orchestration
from services.feishu_adapter import FeishuCommand, FeishuDispatchOutcome
from services.feishu_replies import FeishuReplyConfig
from services.feishu_reply_orchestration import (
    FEISHU_REPLY_ALREADY_SENT,
    FEISHU_REPLY_NO_SOURCE_CONTEXT,
    FEISHU_REPLY_SEND_FAILED,
    FEISHU_REPLY_SENT,
    send_feishu_accepted_reply,
    send_task_run_feishu_terminal_reply,
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
        if not self._results:
            raise AssertionError("Unexpected database query")
        return self._results.pop(0)

    def add(self, item):
        self.added.append(item)
        if getattr(item, "id", None) is None:
            item.id = uuid.uuid4()

    async def flush(self):
        self.flushed = True


class _Response:
    def __init__(self, payload=None, status_code=200):
        self._payload = payload or {"code": 0, "data": {"message_id": "om_reply"}}
        self.status_code = status_code
        self.text = str(self._payload)

    def json(self):
        return self._payload


class _HttpClient:
    def __init__(self, response=None):
        self.response = response or _Response()
        self.posts = []

    async def post(self, url, **kwargs):
        self.posts.append({"url": url, **kwargs})
        return self.response


def _config():
    return FeishuReplyConfig(base_url="https://open.feishu.cn", access_token="tenant-token")


def _event(*, normalized=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        server_id=uuid.uuid4(),
        connector_id=uuid.uuid4(),
        task_id=uuid.uuid4(),
        task_run_id=uuid.uuid4(),
        normalized=normalized if normalized is not None else {"chatId": "oc_chat", "messageId": "om_source"},
    )


@pytest.mark.asyncio
async def test_send_feishu_accepted_reply_confirms_created_task_run_and_maps_event():
    event = _event()
    outcome = FeishuDispatchOutcome(
        status="accepted",
        command=FeishuCommand(kind="jira_analysis", jira_issue_key="JIRA-123"),
        event=event,
    )
    release_result = SimpleNamespace(
        task=SimpleNamespace(id=event.task_id, title="Analyze JIRA-123"),
        task_run=SimpleNamespace(id=event.task_run_id),
    )
    client = _HttpClient()
    db = _FakeSession()

    result = await send_feishu_accepted_reply(
        db,
        feishu_outcome=outcome,
        release_result=release_result,
        http_client=client,
        config=_config(),
    )

    assert result.status == "sent"
    assert result.reason_code == FEISHU_REPLY_SENT
    assert result.mapping.local_type == "external_event"
    assert result.mapping.local_id == event.id
    assert result.mapping.external_id == "om_reply"
    assert client.posts[0]["url"] == "https://open.feishu.cn/open-apis/im/v1/messages/om_source/reply"
    assert "Accepted JIRA-123" in client.posts[0]["json"]["content"]
    assert str(event.task_run_id) in client.posts[0]["json"]["content"]


@pytest.mark.asyncio
async def test_send_task_run_feishu_terminal_reply_sends_completed_output_message():
    run_id = uuid.uuid4()
    event = _event()
    event.task_run_id = run_id
    output_message_id = uuid.uuid4()
    db = _FakeSession(
        _ExecuteResult(event),
        _ExecuteResult(scalar_rows=[]),
        _ExecuteResult(SimpleNamespace(id=output_message_id, content="Here is the analysis.")),
    )
    client = _HttpClient()
    run = SimpleNamespace(
        id=run_id,
        task_id=event.task_id,
        status="completed",
        output_message_id=output_message_id,
        failure_reason=None,
    )

    result = await send_task_run_feishu_terminal_reply(db, task_run=run, http_client=client, config=_config())

    assert result.status == "sent"
    assert result.reason_code == FEISHU_REPLY_SENT
    assert result.mapping.local_type == "task_run"
    assert result.mapping.local_id == run_id
    assert "Here is the analysis." in client.posts[0]["json"]["content"]


@pytest.mark.asyncio
async def test_send_task_run_feishu_terminal_reply_sends_failure_reason():
    run_id = uuid.uuid4()
    event = _event()
    event.task_run_id = run_id
    db = _FakeSession(_ExecuteResult(event), _ExecuteResult(scalar_rows=[]))
    client = _HttpClient()
    run = SimpleNamespace(
        id=run_id,
        task_id=event.task_id,
        status="failed",
        output_message_id=None,
        failure_reason="Runtime provider is unavailable.",
    )

    result = await send_task_run_feishu_terminal_reply(db, task_run=run, http_client=client, config=_config())

    assert result.status == "sent"
    assert result.reason_code == FEISHU_REPLY_SENT
    assert "Runtime provider is unavailable." in client.posts[0]["json"]["content"]


@pytest.mark.asyncio
async def test_send_task_run_feishu_terminal_reply_skips_existing_mapping():
    run_id = uuid.uuid4()
    event = _event()
    existing = SimpleNamespace(
        provider="feishu",
        local_type="task_run",
        local_id=run_id,
        external_type="message",
        external_id="om_existing",
    )
    db = _FakeSession(_ExecuteResult(event), _ExecuteResult(scalar_rows=[existing]))
    client = _HttpClient()
    run = SimpleNamespace(id=run_id, task_id=event.task_id, status="completed", output_message_id=None, failure_reason=None)

    result = await send_task_run_feishu_terminal_reply(db, task_run=run, http_client=client, config=_config())

    assert result.status == "skipped"
    assert result.reason_code == FEISHU_REPLY_ALREADY_SENT
    assert result.mapping is existing
    assert client.posts == []


@pytest.mark.asyncio
async def test_send_task_run_feishu_terminal_reply_skips_missing_source_context():
    run_id = uuid.uuid4()
    event = _event(normalized={})
    db = _FakeSession(_ExecuteResult(event), _ExecuteResult(scalar_rows=[]))
    run = SimpleNamespace(id=run_id, task_id=event.task_id, status="completed", output_message_id=None, failure_reason=None)

    result = await send_task_run_feishu_terminal_reply(db, task_run=run, http_client=_HttpClient(), config=_config())

    assert result.status == "skipped"
    assert result.reason_code == FEISHU_REPLY_NO_SOURCE_CONTEXT


@pytest.mark.asyncio
async def test_send_task_run_feishu_terminal_reply_returns_structured_failure_on_send_error():
    run_id = uuid.uuid4()
    event = _event()
    db = _FakeSession(_ExecuteResult(event), _ExecuteResult(scalar_rows=[]))
    client = _HttpClient(_Response({"code": 999, "msg": "denied"}))
    run = SimpleNamespace(id=run_id, task_id=event.task_id, status="completed", output_message_id=None, failure_reason=None)

    result = await send_task_run_feishu_terminal_reply(db, task_run=run, http_client=client, config=_config())

    assert result.status == "failed"
    assert result.reason_code == FEISHU_REPLY_SEND_FAILED
    assert "denied" in result.reason


def test_feishu_reply_orchestration_does_not_import_runtime_or_daemon_execution_helpers():
    source = inspect.getsource(feishu_reply_orchestration)

    assert "daemon_control" not in source
    assert "AgentProxy" not in source
    assert "create_task_assignment_and_run" not in source
