import base64
import uuid

import pytest

from models import ExternalConnector, ExternalMapping
from services import jira_rest
from services.jira_rest import (
    JIRA_AUTH_FAILED,
    JIRA_COMMENT_FAILED,
    JIRA_CONFIG_INVALID_SITE_URL,
    JIRA_CONFIG_MISSING_SITE_URL,
    JIRA_CREDENTIALS_MISSING,
    JIRA_ISSUE_NOT_FOUND,
    JiraRestError,
    append_jira_comment,
    fetch_jira_issue,
    jira_text_to_adf,
    map_jira_comment,
    map_jira_issue,
    resolve_jira_config,
)


class _FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


class _FakeHttpClient:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    async def get(self, url, **kwargs):
        self.requests.append(("GET", url, kwargs))
        return self.responses.pop(0)

    async def post(self, url, **kwargs):
        self.requests.append(("POST", url, kwargs))
        return self.responses.pop(0)


class _ExecuteResult:
    def __init__(self, scalar_rows=None):
        self._scalar_rows = scalar_rows or []

    def scalars(self):
        return self

    def all(self):
        return self._scalar_rows


class _FakeSession:
    def __init__(self):
        self.added = []
        self.flushed = False

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        self.flushed = True

    async def execute(self, _statement):
        return _ExecuteResult()


def _connector(**config):
    return ExternalConnector(
        id=uuid.uuid4(),
        server_id=uuid.uuid4(),
        provider="jira",
        name="Jira Cloud",
        status="active",
        config=config,
        secret_ref="secret://jira/default",
    )


def _credentials():
    return {"email": "operator@example.com", "apiToken": "jira-token"}


def _auth_header():
    token = base64.b64encode(b"operator@example.com:jira-token").decode("ascii")
    return f"Basic {token}"


def test_resolve_jira_config_validates_site_url_and_credentials():
    config = resolve_jira_config(_connector(siteUrl="https://team.atlassian.net/"), credentials=_credentials())

    assert config.site_url == "https://team.atlassian.net"
    assert config.email == "operator@example.com"
    assert config.api_token == "jira-token"

    with pytest.raises(JiraRestError) as missing_site:
        resolve_jira_config(_connector(), credentials=_credentials())
    assert missing_site.value.code == JIRA_CONFIG_MISSING_SITE_URL

    with pytest.raises(JiraRestError) as invalid_site:
        resolve_jira_config(_connector(siteUrl="file:///tmp/jira"), credentials=_credentials())
    assert invalid_site.value.code == JIRA_CONFIG_INVALID_SITE_URL

    with pytest.raises(JiraRestError) as missing_credentials:
        resolve_jira_config(_connector(siteUrl="https://team.atlassian.net"), credentials={})
    assert missing_credentials.value.code == JIRA_CREDENTIALS_MISSING


def test_jira_text_to_adf_converts_plain_text_to_minimal_document():
    adf = jira_text_to_adf("First line\n\nSecond line")

    assert adf["type"] == "doc"
    assert adf["version"] == 1
    assert adf["content"][0]["type"] == "paragraph"
    assert adf["content"][0]["content"][0]["text"] == "First line"
    assert adf["content"][1]["content"][0]["text"] == "Second line"


@pytest.mark.asyncio
async def test_fetch_jira_issue_uses_rest_v3_and_normalizes_response():
    client = _FakeHttpClient(
        _FakeResponse(
            200,
            {
                "id": "10000",
                "key": "JIRA-123",
                "fields": {
                    "summary": "Fix daemon reconnect",
                    "status": {"name": "In Progress"},
                    "description": {
                        "type": "doc",
                        "content": [
                            {"type": "paragraph", "content": [{"type": "text", "text": "Reconnect fails."}]}
                        ],
                    },
                },
            },
        )
    )
    config = resolve_jira_config(_connector(siteUrl="https://team.atlassian.net"), credentials=_credentials())

    issue = await fetch_jira_issue(client, config, "JIRA-123")

    method, url, kwargs = client.requests[0]
    assert method == "GET"
    assert url == "https://team.atlassian.net/rest/api/3/issue/JIRA-123"
    assert kwargs["headers"]["Authorization"] == _auth_header()
    assert issue.key == "JIRA-123"
    assert issue.id == "10000"
    assert issue.summary == "Fix daemon reconnect"
    assert issue.status == "In Progress"
    assert issue.description_text == "Reconnect fails."
    assert issue.url == "https://team.atlassian.net/browse/JIRA-123"


@pytest.mark.asyncio
async def test_append_jira_comment_posts_adf_and_returns_comment_reference():
    client = _FakeHttpClient(_FakeResponse(201, {"id": "20000", "self": "https://jira/rest/comment/20000"}))
    config = resolve_jira_config(_connector(siteUrl="https://team.atlassian.net"), credentials=_credentials())

    comment = await append_jira_comment(client, config, "JIRA-123", "SmallKhoj result")

    method, url, kwargs = client.requests[0]
    assert method == "POST"
    assert url == "https://team.atlassian.net/rest/api/3/issue/JIRA-123/comment"
    assert kwargs["headers"]["Authorization"] == _auth_header()
    assert kwargs["headers"]["Content-Type"] == "application/json"
    assert kwargs["json"]["body"]["type"] == "doc"
    assert kwargs["json"]["body"]["content"][0]["content"][0]["text"] == "SmallKhoj result"
    assert comment.id == "20000"
    assert comment.url == "https://team.atlassian.net/browse/JIRA-123?focusedCommentId=20000"


@pytest.mark.asyncio
async def test_jira_mappings_use_integration_gateway_mapping_rows():
    db = _FakeSession()
    connector = _connector(siteUrl="https://team.atlassian.net")
    task_id = uuid.uuid4()
    run_id = uuid.uuid4()

    issue_mapping = await map_jira_issue(
        db,
        server_id=connector.server_id,
        connector_id=connector.id,
        local_type="task",
        local_id=task_id,
        issue_key="JIRA-123",
        issue_url="https://team.atlassian.net/browse/JIRA-123",
    )
    comment_mapping = await map_jira_comment(
        db,
        server_id=connector.server_id,
        connector_id=connector.id,
        local_type="task_run",
        local_id=run_id,
        comment_id="20000",
        comment_url="https://team.atlassian.net/browse/JIRA-123?focusedCommentId=20000",
    )

    assert isinstance(issue_mapping, ExternalMapping)
    assert issue_mapping.provider == "jira"
    assert issue_mapping.local_type == "task"
    assert issue_mapping.external_type == "issue"
    assert issue_mapping.external_id == "JIRA-123"
    assert isinstance(comment_mapping, ExternalMapping)
    assert comment_mapping.local_type == "task_run"
    assert comment_mapping.external_type == "comment"
    assert comment_mapping.external_id == "20000"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status_code", "operation", "expected_code"),
    [
        (401, "fetch", JIRA_AUTH_FAILED),
        (404, "fetch", JIRA_ISSUE_NOT_FOUND),
        (500, "fetch", "JIRA_API_FAILED"),
        (401, "comment", JIRA_AUTH_FAILED),
        (404, "comment", JIRA_ISSUE_NOT_FOUND),
        (500, "comment", JIRA_COMMENT_FAILED),
    ],
)
async def test_jira_rest_failures_have_stable_codes(status_code, operation, expected_code):
    client = _FakeHttpClient(_FakeResponse(status_code, {"errorMessages": ["Jira rejected request"]}))
    config = resolve_jira_config(_connector(siteUrl="https://team.atlassian.net"), credentials=_credentials())

    with pytest.raises(JiraRestError) as error:
        if operation == "fetch":
            await fetch_jira_issue(client, config, "JIRA-123")
        else:
            await append_jira_comment(client, config, "JIRA-123", "result")

    assert error.value.code == expected_code
    assert error.value.status_code == status_code
    assert "jira-token" not in error.value.reason
    assert "operator@example.com" not in error.value.reason


def test_jira_rest_service_does_not_import_runtime_execution_helpers():
    source = jira_rest.__dict__

    assert "daemon_control" not in source
    assert "runtime_control_command" not in source
    assert "create_task_assignment_and_run" not in source
