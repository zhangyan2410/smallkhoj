import uuid
from types import SimpleNamespace

import pytest

from models import Message, Task
from services import release_loop
from services.feishu_adapter import FeishuCommand, FeishuDispatchOutcome
from services.jira_rest import JiraComment, JiraIssue, JiraRestError
from services.release_loop import (
    RELEASE_LOOP_FEISHU_OUTCOME_NOT_ACCEPTED,
    RELEASE_LOOP_JIRA_LOOKUP_FAILED,
    RELEASE_LOOP_JIRA_WRITEBACK_FAILED,
    RELEASE_LOOP_ROUTE_CHANNEL_MISSING,
    RELEASE_LOOP_UNSUPPORTED_COMMAND,
    ReleaseLoopError,
    start_feishu_jira_analysis,
    write_back_task_run_to_jira,
)


class _FakeSession:
    def __init__(self):
        self.added = []
        self.flushed = False

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        self.flushed = True
        for item in self.added:
            if getattr(item, "id", None) is None:
                item.id = uuid.uuid4()
            if isinstance(item, Message) and not getattr(item, "short_id", None):
                item.short_id = "msgshort"


def _accepted_outcome(server_id=None, connector_id=None, channel_id=None, assignee_id=None):
    server_id = server_id or uuid.uuid4()
    connector_id = connector_id or uuid.uuid4()
    channel_id = channel_id or uuid.uuid4()
    assignee_id = assignee_id or uuid.uuid4()
    event = SimpleNamespace(
        id=uuid.uuid4(),
        server_id=server_id,
        connector_id=connector_id,
        source_message_id="om_msg",
        source_thread_id=None,
        normalized={"chatId": "oc_chat", "messageId": "om_msg"},
    )
    route = SimpleNamespace(
        id=uuid.uuid4(),
        channel_id=channel_id,
        default_assignee_id=assignee_id,
        task_template_id=None,
    )
    session = SimpleNamespace(id=uuid.uuid4())
    return FeishuDispatchOutcome(
        status="accepted",
        event=event,
        command=FeishuCommand(kind="jira_analysis", jira_issue_key="JIRA-123"),
        route=route,
        session=session,
    )


@pytest.mark.asyncio
async def test_start_feishu_jira_analysis_rejects_invalid_outcomes():
    db = _FakeSession()

    with pytest.raises(ReleaseLoopError) as not_accepted:
        await start_feishu_jira_analysis(
            db,
            feishu_outcome=FeishuDispatchOutcome(status="unknown_command"),
            jira_http_client=object(),
            jira_connector=SimpleNamespace(config={"siteUrl": "https://team.atlassian.net"}),
            jira_credentials={"email": "a@example.com", "apiToken": "token"},
            creator_id=uuid.uuid4(),
            task_number_allocator=lambda *_args, **_kwargs: 1,
        )
    assert not_accepted.value.code == RELEASE_LOOP_FEISHU_OUTCOME_NOT_ACCEPTED

    bad_command = _accepted_outcome()
    bad_command = FeishuDispatchOutcome(
        status="accepted",
        event=bad_command.event,
        command=FeishuCommand(kind="unknown"),
        route=bad_command.route,
        session=bad_command.session,
    )
    with pytest.raises(ReleaseLoopError) as unsupported:
        await start_feishu_jira_analysis(
            db,
            feishu_outcome=bad_command,
            jira_http_client=object(),
            jira_connector=SimpleNamespace(config={"siteUrl": "https://team.atlassian.net"}),
            jira_credentials={"email": "a@example.com", "apiToken": "token"},
            creator_id=uuid.uuid4(),
            task_number_allocator=lambda *_args, **_kwargs: 1,
        )
    assert unsupported.value.code == RELEASE_LOOP_UNSUPPORTED_COMMAND


@pytest.mark.asyncio
async def test_start_feishu_jira_analysis_creates_message_task_run_and_mappings(monkeypatch):
    db = _FakeSession()
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    assignee_id = uuid.uuid4()
    outcome = _accepted_outcome(
        server_id=server_id,
        connector_id=connector_id,
        channel_id=channel_id,
        assignee_id=assignee_id,
    )
    issue = JiraIssue(
        id="10000",
        key="JIRA-123",
        url="https://team.atlassian.net/browse/JIRA-123",
        summary="Fix daemon reconnect",
        status="In Progress",
        description_text="Computer name conflict.",
    )
    calls = {"issue_mapped": None, "taskrun_helper": None, "linked": None}

    async def fake_fetch(_client, _config, key):
        assert key == "JIRA-123"
        return issue

    async def fake_map_issue(_db, **kwargs):
        calls["issue_mapped"] = kwargs
        return SimpleNamespace(**kwargs)

    async def fake_taskrun_helper(_db, **kwargs):
        calls["taskrun_helper"] = kwargs
        return SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(id=uuid.uuid4(), task_id=kwargs["task"].id)

    async def fake_link(_db, event, **kwargs):
        calls["linked"] = kwargs
        event.message_id = kwargs.get("message_id")
        event.task_id = kwargs.get("task_id")
        event.task_run_id = kwargs.get("task_run_id")
        return event

    monkeypatch.setattr(release_loop, "fetch_jira_issue", fake_fetch)
    monkeypatch.setattr(release_loop, "map_jira_issue", fake_map_issue)
    monkeypatch.setattr(release_loop, "create_task_assignment_and_run", fake_taskrun_helper)
    monkeypatch.setattr(release_loop, "link_external_event", fake_link)

    result = await start_feishu_jira_analysis(
        db,
        feishu_outcome=outcome,
        jira_http_client=object(),
        jira_connector=SimpleNamespace(id=connector_id, server_id=server_id, config={"siteUrl": "https://team.atlassian.net"}),
        jira_credentials={"email": "a@example.com", "apiToken": "token"},
        creator_id=uuid.uuid4(),
        task_number_allocator=lambda *_args, **_kwargs: 7,
    )

    message = next(item for item in db.added if isinstance(item, Message))
    task = next(item for item in db.added if isinstance(item, Task))
    assert message.channel_id == channel_id
    assert message.content.startswith("Feishu requested Jira analysis for JIRA-123")
    assert task.task_number == 7
    assert task.title == "Analyze JIRA-123: Fix daemon reconnect"
    assert task.description and "Computer name conflict." in task.description
    assert task.data["source"]["provider"] == "feishu"
    assert task.data["jira"]["issueKey"] == "JIRA-123"
    assert calls["taskrun_helper"]["task"] is task
    assert calls["taskrun_helper"]["assignee"].id == assignee_id
    assert calls["taskrun_helper"]["trigger_type"] == "feishu_jira_analysis"
    assert calls["issue_mapped"]["local_type"] == "task"
    assert calls["issue_mapped"]["issue_key"] == "JIRA-123"
    assert calls["linked"]["message_id"] == message.id
    assert calls["linked"]["task_id"] == task.id
    assert calls["linked"]["task_run_id"] == result.task_run.id


@pytest.mark.asyncio
async def test_start_feishu_jira_analysis_wraps_jira_lookup_failure(monkeypatch):
    async def fake_fetch(_client, _config, _key):
        raise JiraRestError("JIRA_AUTH_FAILED", "Jira authentication failed.", status_code=401)

    monkeypatch.setattr(release_loop, "fetch_jira_issue", fake_fetch)

    with pytest.raises(ReleaseLoopError) as error:
        await start_feishu_jira_analysis(
            _FakeSession(),
            feishu_outcome=_accepted_outcome(),
            jira_http_client=object(),
            jira_connector=SimpleNamespace(config={"siteUrl": "https://team.atlassian.net"}),
            jira_credentials={"email": "a@example.com", "apiToken": "token"},
            creator_id=uuid.uuid4(),
            task_number_allocator=lambda *_args, **_kwargs: 1,
        )

    assert error.value.code == RELEASE_LOOP_JIRA_LOOKUP_FAILED
    assert error.value.cause_code == "JIRA_AUTH_FAILED"


@pytest.mark.asyncio
async def test_start_feishu_jira_analysis_requires_route_channel():
    bad = _accepted_outcome(channel_id=None)
    bad.route.channel_id = None

    with pytest.raises(ReleaseLoopError) as error:
        await start_feishu_jira_analysis(
            _FakeSession(),
            feishu_outcome=bad,
            jira_http_client=object(),
            jira_connector=SimpleNamespace(config={"siteUrl": "https://team.atlassian.net"}),
            jira_credentials={"email": "a@example.com", "apiToken": "token"},
            creator_id=uuid.uuid4(),
            task_number_allocator=lambda *_args, **_kwargs: 1,
        )

    assert error.value.code == RELEASE_LOOP_ROUTE_CHANNEL_MISSING


@pytest.mark.asyncio
async def test_write_back_task_run_to_jira_appends_comment_and_maps_comment(monkeypatch):
    db = _FakeSession()
    connector_id = uuid.uuid4()
    server_id = uuid.uuid4()
    run_id = uuid.uuid4()
    comment = JiraComment(
        id="20000",
        url="https://team.atlassian.net/browse/JIRA-123?focusedCommentId=20000",
    )
    calls = {}

    async def fake_append(_client, _config, issue_key, text):
        calls["append"] = {"issue_key": issue_key, "text": text}
        return comment

    async def fake_map_comment(_db, **kwargs):
        calls["map"] = kwargs
        return SimpleNamespace(**kwargs)

    monkeypatch.setattr(release_loop, "append_jira_comment", fake_append)
    monkeypatch.setattr(release_loop, "map_jira_comment", fake_map_comment)

    mapping = await write_back_task_run_to_jira(
        db,
        jira_http_client=object(),
        jira_connector=SimpleNamespace(id=connector_id, server_id=server_id, config={"siteUrl": "https://team.atlassian.net"}),
        jira_credentials={"email": "a@example.com", "apiToken": "token"},
        issue_key="JIRA-123",
        task_run=SimpleNamespace(id=run_id, status="completed", output_message_id=uuid.uuid4(), failure_reason=None),
        task=SimpleNamespace(title="Analyze JIRA-123: Fix daemon reconnect"),
        output_text="Daemon reconnect diagnosis complete.",
    )

    assert calls["append"]["issue_key"] == "JIRA-123"
    assert "Daemon reconnect diagnosis complete." in calls["append"]["text"]
    assert calls["map"]["local_type"] == "task_run"
    assert calls["map"]["local_id"] == run_id
    assert calls["map"]["comment_id"] == "20000"
    assert mapping.comment_id == "20000"


@pytest.mark.asyncio
async def test_write_back_task_run_to_jira_wraps_comment_failure(monkeypatch):
    async def fake_append(_client, _config, _issue_key, _text):
        raise JiraRestError("JIRA_COMMENT_FAILED", "Jira rejected comment.", status_code=500)

    monkeypatch.setattr(release_loop, "append_jira_comment", fake_append)

    with pytest.raises(ReleaseLoopError) as error:
        await write_back_task_run_to_jira(
            _FakeSession(),
            jira_http_client=object(),
            jira_connector=SimpleNamespace(id=uuid.uuid4(), server_id=uuid.uuid4(), config={"siteUrl": "https://team.atlassian.net"}),
            jira_credentials={"email": "a@example.com", "apiToken": "token"},
            issue_key="JIRA-123",
            task_run=SimpleNamespace(id=uuid.uuid4(), status="completed", failure_reason=None),
            task=SimpleNamespace(title="Analyze JIRA-123"),
            output_text="local output remains",
        )

    assert error.value.code == RELEASE_LOOP_JIRA_WRITEBACK_FAILED
    assert error.value.cause_code == "JIRA_COMMENT_FAILED"


def test_release_loop_does_not_import_runtime_execution_helpers_directly():
    source = release_loop.__dict__

    assert "daemon_control" not in source
    assert "runtime_control_command" not in source
