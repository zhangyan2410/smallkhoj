"""Feishu outbound reply helpers for release integrations."""

import json
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from models import ExternalMapping
from services.integration_gateway import create_external_mapping

FEISHU_REPLY_CONFIG_MISSING_BASE_URL = "FEISHU_REPLY_CONFIG_MISSING_BASE_URL"
FEISHU_REPLY_CREDENTIALS_MISSING = "FEISHU_REPLY_CREDENTIALS_MISSING"
FEISHU_REPLY_CHAT_MISSING = "FEISHU_REPLY_CHAT_MISSING"
FEISHU_REPLY_TEXT_MISSING = "FEISHU_REPLY_TEXT_MISSING"
FEISHU_REPLY_API_FAILED = "FEISHU_REPLY_API_FAILED"
FEISHU_REPLY_RESPONSE_MISSING_MESSAGE_ID = "FEISHU_REPLY_RESPONSE_MISSING_MESSAGE_ID"


@dataclass(frozen=True)
class FeishuReplyConfig:
    base_url: str = "https://open.feishu.cn"
    access_token: str = ""


@dataclass(frozen=True)
class FeishuReplyResult:
    message_id: str
    mapping: ExternalMapping | Any


class FeishuReplyError(Exception):
    def __init__(self, code: str, reason: str, *, status_code: int | None = None):
        super().__init__(reason)
        self.code = code
        self.reason = reason
        self.status_code = status_code


def _normalized_base_url(config: FeishuReplyConfig) -> str:
    base_url = str(config.base_url or "").strip().rstrip("/")
    if not base_url:
        raise FeishuReplyError(FEISHU_REPLY_CONFIG_MISSING_BASE_URL, "Feishu base URL is required.")
    return base_url


def _headers(config: FeishuReplyConfig) -> dict[str, str]:
    token = str(config.access_token or "").strip()
    if not token:
        raise FeishuReplyError(FEISHU_REPLY_CREDENTIALS_MISSING, "Feishu access token is required.")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _text_content(text: str) -> str:
    value = str(text or "").strip()
    if not value:
        raise FeishuReplyError(FEISHU_REPLY_TEXT_MISSING, "Feishu reply text is required.")
    return json.dumps({"text": value}, ensure_ascii=False, separators=(",", ":"))


def _request(base_url: str, *, chat_id: str, source_message_id: str | None, content: str) -> tuple[str, dict[str, Any]]:
    chat = str(chat_id or "").strip()
    if not chat:
        raise FeishuReplyError(FEISHU_REPLY_CHAT_MISSING, "Feishu chat_id is required.")
    if source_message_id:
        return f"{base_url}/open-apis/im/v1/messages/{quote(str(source_message_id), safe='')}/reply", {
            "msg_type": "text",
            "content": content,
        }
    return f"{base_url}/open-apis/im/v1/messages?receive_id_type=chat_id", {
        "receive_id": chat,
        "msg_type": "text",
        "content": content,
    }


def _api_failure_reason(response: Any, fallback: str) -> tuple[int | None, str]:
    status_code = int(getattr(response, "status_code", 0) or 0) or None
    try:
        payload = response.json()
    except Exception:
        payload = None
    if isinstance(payload, dict):
        msg = payload.get("msg") or payload.get("message")
        code = payload.get("code")
        if msg:
            return status_code, f"Feishu API failed: code={code} msg={msg}"
    return status_code, str(getattr(response, "text", None) or fallback)


async def send_feishu_text_reply(
    db: Any,
    *,
    http_client: Any,
    config: FeishuReplyConfig,
    server_id: uuid.UUID,
    connector_id: uuid.UUID,
    chat_id: str,
    text: str,
    local_type: str,
    local_id: uuid.UUID,
    source_message_id: str | None = None,
) -> FeishuReplyResult:
    base_url = _normalized_base_url(config)
    content = _text_content(text)
    url, body = _request(base_url, chat_id=chat_id, source_message_id=source_message_id, content=content)
    response = await http_client.post(url, headers=_headers(config), json=body)
    status_code = int(getattr(response, "status_code", 0) or 0)
    if not 200 <= status_code < 300:
        _, reason = _api_failure_reason(response, "Feishu HTTP request failed.")
        raise FeishuReplyError(FEISHU_REPLY_API_FAILED, reason, status_code=status_code)

    payload = response.json()
    if not isinstance(payload, dict):
        raise FeishuReplyError(FEISHU_REPLY_API_FAILED, "Feishu response was not a JSON object.", status_code=status_code)
    code = int(payload.get("code", 0) or 0)
    if code != 0:
        _, reason = _api_failure_reason(response, "Feishu API returned a non-zero code.")
        raise FeishuReplyError(FEISHU_REPLY_API_FAILED, reason, status_code=status_code)
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    message_id = str(data.get("message_id") or "").strip()
    if not message_id:
        raise FeishuReplyError(
            FEISHU_REPLY_RESPONSE_MISSING_MESSAGE_ID,
            "Feishu reply response did not include message_id.",
            status_code=status_code,
        )

    mapping = await create_external_mapping(
        db,
        server_id=server_id,
        connector_id=connector_id,
        provider="feishu",
        local_type=local_type,
        local_id=local_id,
        external_type="message",
        external_id=message_id,
        metadata={
            "chatId": chat_id,
            "sourceMessageId": source_message_id,
        },
    )
    return FeishuReplyResult(message_id=message_id, mapping=mapping)
