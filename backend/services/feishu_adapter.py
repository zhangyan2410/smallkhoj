"""Feishu/Lark inbound message adapter boundary."""

import json
import re
import uuid
from dataclasses import dataclass
from typing import Any

from models import ExternalEvent, ExternalRoute, ExternalSession
from services.integration_gateway import (
    claim_external_event,
    get_or_create_external_session,
    link_external_event,
    mark_external_event_dropped,
    resolve_external_route,
)


FEISHU_UNADDRESSED_GROUP = "FEISHU_UNADDRESSED_GROUP"
FEISHU_COMMAND_UNKNOWN = "FEISHU_COMMAND_UNKNOWN"
FEISHU_ROUTE_NOT_FOUND = "FEISHU_ROUTE_NOT_FOUND"
FEISHU_ROUTE_DISABLED = "FEISHU_ROUTE_DISABLED"

JIRA_ISSUE_KEY_RE = re.compile(r"\b([A-Z][A-Z0-9]+-\d+)\b")


@dataclass(frozen=True)
class FeishuInboundMessage:
    event_id: str
    event_type: str
    app_id: str | None
    message_id: str
    chat_id: str
    chat_type: str
    sender_open_id: str | None
    text: str
    mentions: list[dict[str, Any]] | None = None
    thread_id: str | None = None
    root_id: str | None = None
    parent_id: str | None = None
    create_time: str | None = None
    addressed_to_bot: bool | None = None


@dataclass(frozen=True)
class FeishuCommand:
    kind: str
    jira_issue_key: str | None = None


@dataclass(frozen=True)
class FeishuDispatchOutcome:
    status: str
    event: ExternalEvent | None = None
    command: FeishuCommand | None = None
    route: ExternalRoute | None = None
    session: ExternalSession | None = None
    failure_code: str | None = None
    failure_reason: str | None = None


def _nested(value: dict[str, Any], *keys: str) -> Any:
    current: Any = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _parse_text_content(content: Any) -> str:
    if isinstance(content, dict):
        value = content.get("text") or content.get("content") or ""
        return str(value)
    if isinstance(content, str):
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            return content
        if isinstance(parsed, dict):
            return str(parsed.get("text") or parsed.get("content") or "")
        return content
    return ""


def normalize_feishu_message(raw_event: dict[str, Any]) -> FeishuInboundMessage:
    event = raw_event.get("event") if isinstance(raw_event.get("event"), dict) else raw_event
    header = raw_event.get("header") if isinstance(raw_event.get("header"), dict) else {}
    message = event.get("message") if isinstance(event.get("message"), dict) else {}
    sender = event.get("sender") if isinstance(event.get("sender"), dict) else {}
    sender_id = sender.get("sender_id") if isinstance(sender.get("sender_id"), dict) else {}
    mentions = message.get("mentions") if isinstance(message.get("mentions"), list) else []
    return FeishuInboundMessage(
        event_id=str(header.get("event_id") or event.get("event_id") or message.get("message_id") or ""),
        event_type=str(header.get("event_type") or event.get("event_type") or "im.message.receive_v1"),
        app_id=header.get("app_id") or event.get("app_id"),
        message_id=str(message.get("message_id") or ""),
        chat_id=str(message.get("chat_id") or ""),
        chat_type=str(message.get("chat_type") or "unknown"),
        sender_open_id=sender_id.get("open_id") or sender.get("open_id"),
        text=_parse_text_content(message.get("content")),
        mentions=mentions,
        thread_id=message.get("thread_id"),
        root_id=message.get("root_id"),
        parent_id=message.get("parent_id"),
        create_time=message.get("create_time"),
        addressed_to_bot=None,
    )


def is_message_addressed_to_bot(
    message: FeishuInboundMessage,
    *,
    bot_open_id: str | None = None,
    bot_name: str | None = None,
) -> bool:
    if message.chat_type == "p2p":
        return True
    mentions = message.mentions or []
    for mention in mentions:
        name = str(mention.get("name") or mention.get("key") or "")
        open_id = _nested(mention, "id", "open_id") or mention.get("open_id")
        if bot_open_id and open_id == bot_open_id:
            return True
        if bot_name and name.strip("@") == bot_name.strip("@"):
            return True
    if bot_name and f"@{bot_name.strip('@')}" in message.text:
        return True
    return False


def _strip_bot_mention(text: str) -> str:
    normalized = str(text or "").strip()
    normalized = re.sub(r"^@\S+\s*", "", normalized).strip()
    return normalized


def parse_feishu_command(message: FeishuInboundMessage) -> FeishuCommand | None:
    body = _strip_bot_mention(message.text)
    if not body.startswith("分析"):
        return None
    match = JIRA_ISSUE_KEY_RE.search(body)
    if not match:
        return None
    return FeishuCommand(kind="jira_analysis", jira_issue_key=match.group(1))


def _dedup_key(message: FeishuInboundMessage) -> str:
    return f"feishu:{message.event_id or message.message_id}"


async def dispatch_feishu_message(
    db: Any,
    message: FeishuInboundMessage,
    *,
    server_id: uuid.UUID,
    connector_id: uuid.UUID,
    bot_open_id: str | None = None,
    bot_name: str | None = None,
) -> FeishuDispatchOutcome:
    addressed = is_message_addressed_to_bot(message, bot_open_id=bot_open_id, bot_name=bot_name)
    if message.chat_type != "p2p" and not addressed:
        return FeishuDispatchOutcome(
            status="unaddressed_group",
            failure_code=FEISHU_UNADDRESSED_GROUP,
            failure_reason="Feishu group message was not addressed to the bot.",
        )

    claim = await claim_external_event(
        db,
        server_id=server_id,
        connector_id=connector_id,
        provider="feishu",
        event_type=message.event_type,
        dedup_key=_dedup_key(message),
        source_event_id=message.event_id,
        source_message_id=message.message_id,
        source_thread_id=message.thread_id,
        actor_external_id=message.sender_open_id,
        normalized={
            "chatId": message.chat_id,
            "chatType": message.chat_type,
            "messageId": message.message_id,
            "threadId": message.thread_id,
            "addressedToBot": addressed,
        },
    )
    if claim.status == "duplicate":
        return FeishuDispatchOutcome(status="duplicate", event=claim.event)

    command = parse_feishu_command(message)
    if command is None:
        event = await mark_external_event_dropped(
            db,
            claim.event,
            failure_code=FEISHU_COMMAND_UNKNOWN,
            failure_reason="Feishu message did not match a supported SmallKhoj command.",
        )
        return FeishuDispatchOutcome(
            status="unknown_command",
            event=event,
            failure_code=FEISHU_COMMAND_UNKNOWN,
            failure_reason=event.failure_reason,
        )

    route_outcome = await resolve_external_route(
        db,
        connector_id=connector_id,
        source={
            "chatId": message.chat_id,
            "chatType": message.chat_type,
            "command": command.kind,
        },
    )
    if route_outcome.status != "matched" or route_outcome.route is None:
        failure_code = FEISHU_ROUTE_DISABLED if route_outcome.status == "disabled" else FEISHU_ROUTE_NOT_FOUND
        event = await mark_external_event_dropped(
            db,
            claim.event,
            failure_code=failure_code,
            failure_reason=route_outcome.failure_reason or "No active Feishu route matched this message.",
        )
        return FeishuDispatchOutcome(
            status="disabled_route" if route_outcome.status == "disabled" else "no_route",
            event=event,
            command=command,
            route=route_outcome.route,
            failure_code=failure_code,
            failure_reason=event.failure_reason,
        )

    external_scope_type = "thread" if message.thread_id else "chat"
    external_scope_id = message.thread_id or message.chat_id
    session_outcome = await get_or_create_external_session(
        db,
        server_id=server_id,
        connector_id=connector_id,
        provider="feishu",
        external_scope_type=external_scope_type,
        external_scope_id=external_scope_id,
        channel_id=route_outcome.route.channel_id,
        metadata={
            "chatId": message.chat_id,
            "chatType": message.chat_type,
            "threadId": message.thread_id,
            "messageId": message.message_id,
        },
    )
    event = await link_external_event(
        db,
        claim.event,
        route_id=route_outcome.route.id,
        session_id=session_outcome.session.id,
        channel_id=route_outcome.route.channel_id,
    )
    event.normalized = {
        **(event.normalized or {}),
        "command": command.kind,
        "jiraIssueKey": command.jira_issue_key,
    }
    return FeishuDispatchOutcome(
        status="accepted",
        event=event,
        command=command,
        route=route_outcome.route,
        session=session_outcome.session,
    )
