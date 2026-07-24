import inspect
import uuid
from types import SimpleNamespace

import pytest

from services import task_run_writeback
from services.task_run_writeback import (
    TASK_RUN_WRITEBACK_ALREADY_WRITTEN,
    TASK_RUN_WRITEBACK_JIRA_FAILED,
    TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS,
    TASK_RUN_WRITEBACK_NON_TERMINAL,
    TASK_RUN_WRITEBACK_WRITTEN,
    TaskRunWritebackDependencies,
    handle_terminal_task_run_writeback,
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
        self.flushed = False

    async def execute(self, _statement):
        if not self._results:
            raise AssertionError("Unexpected database query")
        return self._results.pop(0)

    def add(self, item):
        if getattr(item, "id", None) is None:
            item.id = uuid.uuid4()

    async def flush(self):
        self.flushed = True


class _Response:
    status_code = 201

    def json(self):
        return {"id": "comment-1", "self": "https://jira.example/rest/api/3/issue/JIRA-123/comment/comment-1"}


class _FailingResponse:
    status_code = 500
    text = "Jira is unavailable"

    def json(self):
        return {"errorMessages": ["Jira is unavailable"]}


class _HttpClient:
    def __init__(self, response=None):
        self.response = response or _Response()
        self.posts = []

    async def post(self, url, *, headers=None, json=None):
        self.posts.append({"url": url, "headers": headers or {}, "json": json or {}})
        return self.response


def _connector(connector_id, server_id):
    return SimpleNamespace(
        id=connector_id,
        server_id=server_id,
        provider="jira",
        config={"siteUrl": "https://jira.example"},
    )


def _event(server_id, task_id, run_id):
    return SimpleNamespace(
        id=uuid.uuid4(),
        server_id=server_id,
        connector_id=uuid.uuid4(),
        task_id=task_id,
        task_run_id=run_id,
        status="accepted",
        failure_code=None,
        failure_reason=None,
        completed_at=None,
        updated_at=None,
    )


def _issue_mapping(connector_id, server_id, task_id):
    return SimpleNamespace(
        id=uuid.uuid4(),
        server_id=server_id,
        connector_id=connector_id,
        provider="jira",
        local_type="task",
        local_id=task_id,
        external_type="issue",
        external_id="JIRA-123",
        external_url="https://jira.example/browse/JIRA-123",
    )


@pytest.mark.asyncio
async def test_writeback_skips_non_terminal_task_run_without_queries():
    run = SimpleNamespace(id=uuid.uuid4(), task_id=uuid.uuid4(), status="running")
    outcome = await handle_terminal_task_run_writeback(_FakeSession(), task_run=run)

    assert outcome.status == "not_applicable"
    assert outcome.reason_code == TASK_RUN_WRITEBACK_NON_TERMINAL


@pytest.mark.asyncio
async def test_writeback_skips_when_comment_mapping_already_exists():
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    server_id = uuid.uuid4()
    existing_comment = SimpleNamespace(
        provider="jira",
        local_type="task_run",
        local_id=run_id,
        external_type="comment",
        external_id="comment-existing",
    )
    db = _FakeSession(
        _ExecuteResult(_event(server_id, task_id, run_id)),
        _ExecuteResult(scalar_rows=[existing_comment]),
    )
    run = SimpleNamespace(id=run_id, task_id=task_id, status="completed")

    outcome = await handle_terminal_task_run_writeback(db, task_run=run)

    assert outcome.status == "skipped"
    assert outcome.reason_code == TASK_RUN_WRITEBACK_ALREADY_WRITTEN
    assert outcome.mapping is existing_comment


@pytest.mark.asyncio
async def test_writeback_appends_jira_comment_for_terminal_task_run():
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    event = _event(server_id, task_id, run_id)
    mapping = _issue_mapping(connector_id, server_id, task_id)
    connector = _connector(connector_id, server_id)
    task = SimpleNamespace(id=task_id, title="Analyze JIRA-123")
    http_client = _HttpClient()
    db = _FakeSession(
        _ExecuteResult(event),
        _ExecuteResult(scalar_rows=[]),
        _ExecuteResult(scalar_rows=[mapping]),
        _ExecuteResult(task),
        _ExecuteResult(connector),
    )
    run = SimpleNamespace(
        id=run_id,
        task_id=task_id,
        status="completed",
        output_message_id=None,
        failure_reason=None,
    )

    outcome = await handle_terminal_task_run_writeback(
        db,
        task_run=run,
        output_text="The fix is to reuse the existing daemon identity.",
        dependencies=TaskRunWritebackDependencies(
            jira_http_client=http_client,
            jira_credentials_resolver=lambda _connector: {"email": "bot@example.com", "apiToken": "token"},
        ),
    )

    assert outcome.status == "written"
    assert outcome.reason_code == TASK_RUN_WRITEBACK_WRITTEN
    assert outcome.mapping.local_type == "task_run"
    assert outcome.mapping.local_id == run_id
    assert outcome.mapping.external_type == "comment"
    assert outcome.mapping.external_id == "comment-1"
    assert event.status == "completed"
    assert http_client.posts[0]["url"] == "https://jira.example/rest/api/3/issue/JIRA-123/comment"


@pytest.mark.asyncio
async def test_writeback_uses_output_message_content_when_output_text_not_passed():
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    output_message_id = uuid.uuid4()
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    event = _event(server_id, task_id, run_id)
    http_client = _HttpClient()
    db = _FakeSession(
        _ExecuteResult(event),
        _ExecuteResult(scalar_rows=[]),
        _ExecuteResult(scalar_rows=[_issue_mapping(connector_id, server_id, task_id)]),
        _ExecuteResult(SimpleNamespace(id=task_id, title="Analyze JIRA-123")),
        _ExecuteResult(SimpleNamespace(id=output_message_id, content="Output from the agent message.")),
        _ExecuteResult(_connector(connector_id, server_id)),
    )
    run = SimpleNamespace(
        id=run_id,
        task_id=task_id,
        status="completed",
        output_message_id=output_message_id,
        failure_reason=None,
    )

    outcome = await handle_terminal_task_run_writeback(
        db,
        task_run=run,
        dependencies=TaskRunWritebackDependencies(
            jira_http_client=http_client,
            jira_credentials_resolver=lambda _connector: {"email": "bot@example.com", "apiToken": "token"},
        ),
    )

    assert outcome.status == "written"
    posted_body = http_client.posts[0]["json"]["body"]
    posted_text = str(posted_body)
    assert "Output from the agent message." in posted_text


@pytest.mark.asyncio
async def test_writeback_missing_credentials_is_structured_skip():
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    event = _event(server_id, task_id, run_id)
    db = _FakeSession(
        _ExecuteResult(event),
        _ExecuteResult(scalar_rows=[]),
        _ExecuteResult(scalar_rows=[_issue_mapping(connector_id, server_id, task_id)]),
        _ExecuteResult(SimpleNamespace(id=task_id, title="Analyze JIRA-123")),
        _ExecuteResult(_connector(connector_id, server_id)),
    )
    run = SimpleNamespace(id=run_id, task_id=task_id, status="completed", failure_reason=None)

    outcome = await handle_terminal_task_run_writeback(
        db,
        task_run=run,
        dependencies=TaskRunWritebackDependencies(
            jira_http_client=_HttpClient(),
            jira_credentials_resolver=lambda _connector: None,
        ),
    )

    assert outcome.status == "skipped"
    assert outcome.reason_code == TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS
    assert event.status == "accepted"


@pytest.mark.asyncio
async def test_writeback_incomplete_credentials_from_resolver_is_structured_skip():
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    event = _event(server_id, task_id, run_id)
    db = _FakeSession(
        _ExecuteResult(event),
        _ExecuteResult(scalar_rows=[]),
        _ExecuteResult(scalar_rows=[_issue_mapping(connector_id, server_id, task_id)]),
        _ExecuteResult(SimpleNamespace(id=task_id, title="Analyze JIRA-123")),
        _ExecuteResult(_connector(connector_id, server_id)),
    )
    run = SimpleNamespace(id=run_id, task_id=task_id, status="completed", output_message_id=None, failure_reason=None)

    outcome = await handle_terminal_task_run_writeback(
        db,
        task_run=run,
        dependencies=TaskRunWritebackDependencies(
            jira_http_client=_HttpClient(),
            jira_credentials_resolver=lambda _connector: {"email": "bot@example.com"},
        ),
    )

    assert outcome.status == "skipped"
    assert outcome.reason_code == TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS
    assert event.status == "accepted"


@pytest.mark.asyncio
async def test_writeback_jira_failure_marks_external_event_failed():
    run_id = uuid.uuid4()
    task_id = uuid.uuid4()
    server_id = uuid.uuid4()
    connector_id = uuid.uuid4()
    event = _event(server_id, task_id, run_id)
    db = _FakeSession(
        _ExecuteResult(event),
        _ExecuteResult(scalar_rows=[]),
        _ExecuteResult(scalar_rows=[_issue_mapping(connector_id, server_id, task_id)]),
        _ExecuteResult(SimpleNamespace(id=task_id, title="Analyze JIRA-123")),
        _ExecuteResult(_connector(connector_id, server_id)),
    )
    run = SimpleNamespace(id=run_id, task_id=task_id, status="failed", failure_reason="Runtime crashed")

    outcome = await handle_terminal_task_run_writeback(
        db,
        task_run=run,
        dependencies=TaskRunWritebackDependencies(
            jira_http_client=_HttpClient(_FailingResponse()),
            jira_credentials_resolver=lambda _connector: {"email": "bot@example.com", "apiToken": "token"},
        ),
    )

    assert outcome.status == "failed"
    assert outcome.reason_code == TASK_RUN_WRITEBACK_JIRA_FAILED
    assert event.status == "writeback_failed"
    assert event.failure_code == TASK_RUN_WRITEBACK_JIRA_FAILED
    assert "Jira write-back failed" in event.failure_reason


def test_task_run_writeback_does_not_import_runtime_or_daemon_execution_helpers():
    source = inspect.getsource(task_run_writeback)

    assert "daemon_control" not in source
    assert "AgentProxy" not in source
    assert "runtime_provider" not in source
    assert "create_task_assignment_and_run" not in source
