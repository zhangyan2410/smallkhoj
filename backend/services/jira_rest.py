"""Jira Cloud REST helpers for outbound issue lookup and comment write-back."""

import base64
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlparse

from models import ExternalConnector, ExternalMapping
from services.integration_gateway import create_external_mapping

JIRA_CONFIG_MISSING_SITE_URL = "JIRA_CONFIG_MISSING_SITE_URL"
JIRA_CONFIG_INVALID_SITE_URL = "JIRA_CONFIG_INVALID_SITE_URL"
JIRA_CREDENTIALS_MISSING = "JIRA_CREDENTIALS_MISSING"
JIRA_ISSUE_NOT_FOUND = "JIRA_ISSUE_NOT_FOUND"
JIRA_AUTH_FAILED = "JIRA_AUTH_FAILED"
JIRA_API_FAILED = "JIRA_API_FAILED"
JIRA_COMMENT_FAILED = "JIRA_COMMENT_FAILED"


@dataclass(frozen=True)
class JiraConfig:
    site_url: str
    email: str
    api_token: str


@dataclass(frozen=True)
class JiraIssue:
    id: str | None
    key: str
    url: str
    summary: str | None
    status: str | None
    description_text: str | None


@dataclass(frozen=True)
class JiraComment:
    id: str
    url: str
    self_url: str | None = None


class JiraRestError(Exception):
    def __init__(self, code: str, reason: str, *, status_code: int | None = None):
        super().__init__(reason)
        self.code = code
        self.reason = reason
        self.status_code = status_code


def resolve_jira_config(
    connector: ExternalConnector,
    *,
    credentials: dict[str, str] | None = None,
) -> JiraConfig:
    config = connector.config or {}
    raw_site_url = str(config.get("siteUrl") or config.get("site_url") or "").strip()
    if not raw_site_url:
        raise JiraRestError(JIRA_CONFIG_MISSING_SITE_URL, "Jira connector config is missing siteUrl.")

    site_url = raw_site_url.rstrip("/")
    parsed = urlparse(site_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise JiraRestError(JIRA_CONFIG_INVALID_SITE_URL, "Jira siteUrl must be an https URL.")

    credentials = credentials or {}
    email = str(credentials.get("email") or "").strip()
    api_token = str(credentials.get("apiToken") or credentials.get("api_token") or "").strip()
    if not email or not api_token:
        raise JiraRestError(JIRA_CREDENTIALS_MISSING, "Jira email and API token are required.")

    return JiraConfig(site_url=site_url, email=email, api_token=api_token)


def jira_issue_url(config: JiraConfig, issue_key: str) -> str:
    return f"{config.site_url}/browse/{quote(issue_key, safe='-')}"


def _auth_header(config: JiraConfig) -> str:
    token = base64.b64encode(f"{config.email}:{config.api_token}".encode()).decode("ascii")
    return f"Basic {token}"


def _headers(config: JiraConfig, *, json_body: bool = False) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Authorization": _auth_header(config),
    }
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def jira_text_to_adf(text: str) -> dict[str, Any]:
    paragraphs = []
    for raw_line in str(text or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        paragraphs.append({
            "type": "paragraph",
            "content": [{"type": "text", "text": line}],
        })
    if not paragraphs:
        paragraphs.append({"type": "paragraph", "content": []})
    return {
        "type": "doc",
        "version": 1,
        "content": paragraphs,
    }


def _extract_text(value: Any) -> str:
    if isinstance(value, dict):
        parts: list[str] = []
        text = value.get("text")
        if isinstance(text, str):
            parts.append(text)
        for item in value.get("content") or []:
            extracted = _extract_text(item)
            if extracted:
                parts.append(extracted)
        return " ".join(parts).strip()
    if isinstance(value, list):
        return " ".join(part for part in (_extract_text(item) for item in value) if part).strip()
    if isinstance(value, str):
        return value
    return ""


def _jira_error_reason(response: Any, fallback: str) -> str:
    try:
        payload = response.json()
    except Exception:
        payload = None
    if isinstance(payload, dict):
        messages = payload.get("errorMessages")
        if isinstance(messages, list) and messages:
            return "; ".join(str(item) for item in messages)
        errors = payload.get("errors")
        if isinstance(errors, dict) and errors:
            return "; ".join(str(item) for item in errors.values())
    text = getattr(response, "text", None)
    return str(text or fallback)


def _raise_for_jira_response(response: Any, *, operation: str) -> None:
    status_code = int(getattr(response, "status_code", 0) or 0)
    if 200 <= status_code < 300:
        return
    if status_code in {401, 403}:
        raise JiraRestError(
            JIRA_AUTH_FAILED,
            "Jira authentication failed or the configured user lacks permission.",
            status_code=status_code,
        )
    if status_code == 404:
        raise JiraRestError(
            JIRA_ISSUE_NOT_FOUND,
            _jira_error_reason(response, "Jira issue was not found."),
            status_code=status_code,
        )
    code = JIRA_COMMENT_FAILED if operation == "comment" else JIRA_API_FAILED
    raise JiraRestError(
        code,
        _jira_error_reason(response, "Jira API request failed."),
        status_code=status_code,
    )


async def fetch_jira_issue(http_client: Any, config: JiraConfig, issue_key: str) -> JiraIssue:
    safe_issue = quote(issue_key, safe="-")
    response = await http_client.get(
        f"{config.site_url}/rest/api/3/issue/{safe_issue}",
        headers=_headers(config),
    )
    _raise_for_jira_response(response, operation="fetch")
    payload = response.json()
    fields = payload.get("fields") if isinstance(payload, dict) else {}
    fields = fields if isinstance(fields, dict) else {}
    key = str(payload.get("key") or issue_key)
    status = fields.get("status") if isinstance(fields.get("status"), dict) else {}
    return JiraIssue(
        id=str(payload.get("id")) if payload.get("id") is not None else None,
        key=key,
        url=jira_issue_url(config, key),
        summary=fields.get("summary") if isinstance(fields.get("summary"), str) else None,
        status=status.get("name") if isinstance(status.get("name"), str) else None,
        description_text=_extract_text(fields.get("description")) or None,
    )


async def append_jira_comment(
    http_client: Any,
    config: JiraConfig,
    issue_key: str,
    text: str,
) -> JiraComment:
    safe_issue = quote(issue_key, safe="-")
    response = await http_client.post(
        f"{config.site_url}/rest/api/3/issue/{safe_issue}/comment",
        headers=_headers(config, json_body=True),
        json={"body": jira_text_to_adf(text)},
    )
    _raise_for_jira_response(response, operation="comment")
    payload = response.json()
    comment_id = str(payload.get("id") or "")
    if not comment_id:
        raise JiraRestError(JIRA_COMMENT_FAILED, "Jira comment response did not include an id.")
    return JiraComment(
        id=comment_id,
        url=f"{jira_issue_url(config, issue_key)}?focusedCommentId={quote(comment_id, safe='')}",
        self_url=payload.get("self") if isinstance(payload.get("self"), str) else None,
    )


async def map_jira_issue(
    db: Any,
    *,
    server_id: uuid.UUID,
    connector_id: uuid.UUID,
    local_type: str,
    local_id: uuid.UUID,
    issue_key: str,
    issue_url: str,
) -> ExternalMapping:
    return await create_external_mapping(
        db,
        server_id=server_id,
        connector_id=connector_id,
        provider="jira",
        local_type=local_type,
        local_id=local_id,
        external_type="issue",
        external_id=issue_key,
        external_url=issue_url,
    )


async def map_jira_comment(
    db: Any,
    *,
    server_id: uuid.UUID,
    connector_id: uuid.UUID,
    local_type: str,
    local_id: uuid.UUID,
    comment_id: str,
    comment_url: str,
) -> ExternalMapping:
    return await create_external_mapping(
        db,
        server_id=server_id,
        connector_id=connector_id,
        provider="jira",
        local_type=local_type,
        local_id=local_id,
        external_type="comment",
        external_id=comment_id,
        external_url=comment_url,
    )
