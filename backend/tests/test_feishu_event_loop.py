from types import SimpleNamespace
import inspect
import uuid

import pytest

from services import feishu_event_loop
from services.feishu_adapter import FeishuCommand, FeishuDispatchOutcome, FeishuInboundMessage
from services.feishu_event_loop import (
    FEISHU_EVENT_LOOP_ACCEPTED,
    FEISHU_EVENT_LOOP_ACCEPTED_REPLY_FAILED,
    FEISHU_EVENT_LOOP_DISPATCH_PASSTHROUGH,
    FEISHU_EVENT_LOOP_RELEASE_FAILED,
    process_feishu_raw_event,
)
from services.feishu_reply_orchestration import FEISHU_REPLY_SEND_FAILED, FEISHU_REPLY_SENT
from services.release_loop import RELEASE_LOOP_JIRA_LOOKUP_FAILED, ReleaseLoopError


class _FakeSession:
    def __init__(self):
        self.flushed = False

    async def flush(self):
        self.flushed = True


def _raw_event():
    return {"event": {"message": {"content": "{\"text\":\"@SmallKhoj 分析 JIRA-123\"}"}}}


def _message():
    return FeishuInboundMessage(
        event_id="evt_1",
        event_type="im.message.receive_v1",
        app_id="cli_a",
        message_id="om_msg",
        chat_id="oc_chat",
        chat_type="group",
        sender_open_id="ou_user",
        text="@SmallKhoj 分析 JIRA-123",
    )


def _event():
    return SimpleNamespace(
        id=uuid.uuid4(),
        server_id=uuid.uuid4(),
        connector_id=uuid.uuid4(),
        failure_code=None,
        failure_reason=None,
        status="accepted",
    )


def _accepted_outcome(event):
    return FeishuDispatchOutcome(
        status="accepted",
        event=event,
        command=FeishuCommand(kind="jira_analysis", jira_issue_key="JIRA-123"),
        route=SimpleNamespace(channel_id=uuid.uuid4(), default_assignee_id=uuid.uuid4()),
        session=SimpleNamespace(id=uuid.uuid4()),
    )


@pytest.mark.asyncio
async def test_process_feishu_raw_event_dispatches_starts_loop_and_sends_accepted_reply(monkeypatch):
    calls = []
    event = _event()
    dispatch_outcome = _accepted_outcome(event)
    release_result = SimpleNamespace(task_run=SimpleNamespace(id=uuid.uuid4()))
    accepted_reply = SimpleNamespace(status="sent", reason_code=FEISHU_REPLY_SENT, reason="sent", mapping=None)

    def fake_normalize(raw_event):
        calls.append(("normalize", raw_event))
        return _message()

    async def fake_dispatch(db, message, **kwargs):
        calls.append(("dispatch", message, kwargs))
        return dispatch_outcome

    async def fake_start(db, **kwargs):
        calls.append(("start", kwargs))
        return release_result

    async def fake_reply(db, **kwargs):
        calls.append(("reply", kwargs))
        return accepted_reply

    monkeypatch.setattr(feishu_event_loop, "normalize_feishu_message", fake_normalize)
    monkeypatch.setattr(feishu_event_loop, "dispatch_feishu_message", fake_dispatch)
    monkeypatch.setattr(feishu_event_loop, "start_feishu_jira_analysis", fake_start)
    monkeypatch.setattr(feishu_event_loop, "send_feishu_accepted_reply", fake_reply)

    result = await process_feishu_raw_event(
        _FakeSession(),
        raw_event=_raw_event(),
        server_id=event.server_id,
        feishu_connector_id=event.connector_id,
        jira_connector=SimpleNamespace(id=uuid.uuid4()),
        creator_id=uuid.uuid4(),
        jira_http_client=SimpleNamespace(),
        jira_credentials={"email": "bot@example.com", "apiToken": "token"},
        feishu_http_client=SimpleNamespace(),
        feishu_reply_config=SimpleNamespace(),
        bot_name="SmallKhoj",
    )

    assert result.status == "accepted"
    assert result.reason_code == FEISHU_EVENT_LOOP_ACCEPTED
    assert result.dispatch_outcome is dispatch_outcome
    assert result.release_result is release_result
    assert result.accepted_reply is accepted_reply
    assert calls[0][0] == "normalize"
    assert calls[1][0] == "dispatch"
    assert calls[1][2]["server_id"] == event.server_id
    assert calls[1][2]["connector_id"] == event.connector_id
    assert calls[1][2]["bot_name"] == "SmallKhoj"
    assert calls[2][0] == "start"
    assert calls[2][1]["feishu_outcome"] is dispatch_outcome
    assert calls[3][0] == "reply"
    assert calls[3][1]["feishu_outcome"] is dispatch_outcome
    assert calls[3][1]["release_result"] is release_result


@pytest.mark.asyncio
async def test_process_feishu_raw_event_passthrough_duplicate_without_starting_loop(monkeypatch):
    calls = []
    duplicate = FeishuDispatchOutcome(status="duplicate", event=_event())

    monkeypatch.setattr(feishu_event_loop, "normalize_feishu_message", lambda raw: _message())

    async def fake_dispatch(db, message, **kwargs):
        return duplicate

    async def fake_start(db, **kwargs):
        calls.append("start")
        raise AssertionError("release loop should not start")

    monkeypatch.setattr(feishu_event_loop, "dispatch_feishu_message", fake_dispatch)
    monkeypatch.setattr(feishu_event_loop, "start_feishu_jira_analysis", fake_start)

    result = await process_feishu_raw_event(
        _FakeSession(),
        raw_event=_raw_event(),
        server_id=uuid.uuid4(),
        feishu_connector_id=uuid.uuid4(),
        jira_connector=SimpleNamespace(id=uuid.uuid4()),
        creator_id=uuid.uuid4(),
        jira_http_client=SimpleNamespace(),
        jira_credentials={"email": "bot@example.com", "apiToken": "token"},
        feishu_http_client=SimpleNamespace(),
        feishu_reply_config=SimpleNamespace(),
    )

    assert result.status == "duplicate"
    assert result.reason_code == FEISHU_EVENT_LOOP_DISPATCH_PASSTHROUGH
    assert result.dispatch_outcome is duplicate
    assert calls == []


@pytest.mark.asyncio
async def test_process_feishu_raw_event_marks_event_failed_on_release_loop_error(monkeypatch):
    event = _event()
    dispatch_outcome = _accepted_outcome(event)
    failures = []

    monkeypatch.setattr(feishu_event_loop, "normalize_feishu_message", lambda raw: _message())

    async def fake_dispatch(db, message, **kwargs):
        return dispatch_outcome

    async def fake_start(db, **kwargs):
        raise ReleaseLoopError(RELEASE_LOOP_JIRA_LOOKUP_FAILED, "Jira lookup failed.", cause_code="JIRA_AUTH_FAILED")

    async def fake_mark_failed(db, failed_event, **kwargs):
        failures.append((failed_event, kwargs))
        failed_event.status = "failed"
        failed_event.failure_code = kwargs["failure_code"]
        failed_event.failure_reason = kwargs["failure_reason"]
        return failed_event

    monkeypatch.setattr(feishu_event_loop, "dispatch_feishu_message", fake_dispatch)
    monkeypatch.setattr(feishu_event_loop, "start_feishu_jira_analysis", fake_start)
    monkeypatch.setattr(feishu_event_loop, "mark_external_event_failed", fake_mark_failed)

    result = await process_feishu_raw_event(
        _FakeSession(),
        raw_event=_raw_event(),
        server_id=event.server_id,
        feishu_connector_id=event.connector_id,
        jira_connector=SimpleNamespace(id=uuid.uuid4()),
        creator_id=uuid.uuid4(),
        jira_http_client=SimpleNamespace(),
        jira_credentials={"email": "bot@example.com", "apiToken": "token"},
        feishu_http_client=SimpleNamespace(),
        feishu_reply_config=SimpleNamespace(),
    )

    assert result.status == "failed"
    assert result.reason_code == FEISHU_EVENT_LOOP_RELEASE_FAILED
    assert result.failure_code == RELEASE_LOOP_JIRA_LOOKUP_FAILED
    assert result.failure_reason == "Jira lookup failed."
    assert failures[0][0] is event
    assert failures[0][1]["failure_code"] == RELEASE_LOOP_JIRA_LOOKUP_FAILED


@pytest.mark.asyncio
async def test_process_feishu_raw_event_keeps_release_result_when_accepted_reply_fails(monkeypatch):
    event = _event()
    dispatch_outcome = _accepted_outcome(event)
    release_result = SimpleNamespace(task_run=SimpleNamespace(id=uuid.uuid4()))
    reply_failure = SimpleNamespace(
        status="failed",
        reason_code=FEISHU_REPLY_SEND_FAILED,
        reason="Feishu access token is required.",
        mapping=None,
    )

    monkeypatch.setattr(feishu_event_loop, "normalize_feishu_message", lambda raw: _message())

    async def fake_dispatch(db, message, **kwargs):
        return dispatch_outcome

    async def fake_start(db, **kwargs):
        return release_result

    async def fake_reply(db, **kwargs):
        return reply_failure

    monkeypatch.setattr(feishu_event_loop, "dispatch_feishu_message", fake_dispatch)
    monkeypatch.setattr(feishu_event_loop, "start_feishu_jira_analysis", fake_start)
    monkeypatch.setattr(feishu_event_loop, "send_feishu_accepted_reply", fake_reply)

    result = await process_feishu_raw_event(
        _FakeSession(),
        raw_event=_raw_event(),
        server_id=event.server_id,
        feishu_connector_id=event.connector_id,
        jira_connector=SimpleNamespace(id=uuid.uuid4()),
        creator_id=uuid.uuid4(),
        jira_http_client=SimpleNamespace(),
        jira_credentials={"email": "bot@example.com", "apiToken": "token"},
        feishu_http_client=SimpleNamespace(),
        feishu_reply_config=SimpleNamespace(),
    )

    assert result.status == "accepted_reply_failed"
    assert result.reason_code == FEISHU_EVENT_LOOP_ACCEPTED_REPLY_FAILED
    assert result.release_result is release_result
    assert result.accepted_reply is reply_failure


def test_feishu_event_loop_does_not_import_runtime_or_daemon_execution_helpers():
    source = inspect.getsource(feishu_event_loop)

    assert "daemon_control" not in source
    assert "AgentProxy" not in source
    assert "create_task_assignment_and_run" not in source
