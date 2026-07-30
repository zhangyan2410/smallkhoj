"""Orchestrate Feishu replies from release-loop and TaskRun state."""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from models import ExternalEvent, ExternalMapping, Message
from services.feishu_adapter import FeishuDispatchOutcome
from services.feishu_replies import FeishuReplyConfig, FeishuReplyError, send_feishu_text_reply
from services.integration_gateway import list_external_mappings_for_local

FEISHU_REPLY_SENT = "FEISHU_REPLY_SENT"
FEISHU_REPLY_ALREADY_SENT = "FEISHU_REPLY_ALREADY_SENT"
FEISHU_REPLY_NO_SOURCE_CONTEXT = "FEISHU_REPLY_NO_SOURCE_CONTEXT"
FEISHU_REPLY_SEND_FAILED = "FEISHU_REPLY_SEND_FAILED"
FEISHU_REPLY_UNSUPPORTED_OUTCOME = "FEISHU_REPLY_UNSUPPORTED_OUTCOME"
FEISHU_REPLY_UNSUPPORTED_TASK_RUN_STATUS = "FEISHU_REPLY_UNSUPPORTED_TASK_RUN_STATUS"

TERMINAL_REPLY_STATUSES = {"completed", "failed", "cancelled"}


@dataclass(frozen=True)
class FeishuReplyOrchestrationOutcome:
    status: str
    reason_code: str
    reason: str
    mapping: ExternalMapping | Any | None = None


def _outcome(
    status: str,
    reason_code: str,
    reason: str,
    *,
    mapping: ExternalMapping | Any | None = None,
) -> FeishuReplyOrchestrationOutcome:
    return FeishuReplyOrchestrationOutcome(status=status, reason_code=reason_code, reason=reason, mapping=mapping)


def _source_context(event: Any) -> tuple[str | None, str | None]:
    normalized = getattr(event, "normalized", None) or {}
    if not isinstance(normalized, dict):
        normalized = {}
    chat_id = normalized.get("chatId") or normalized.get("chat_id")
    message_id = normalized.get("messageId") or normalized.get("message_id") or getattr(event, "source_message_id", None)
    chat_id = str(chat_id).strip() if chat_id else None
    message_id = str(message_id).strip() if message_id else None
    return chat_id, message_id


async def _linked_external_event(db: Any, task_run_id: uuid.UUID) -> ExternalEvent | Any | None:
    result = await db.execute(
        select(ExternalEvent)
        .where(ExternalEvent.task_run_id == task_run_id)
        .order_by(ExternalEvent.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _first_feishu_message_mapping(mappings: list[Any]) -> Any | None:
    for mapping in mappings:
        if getattr(mapping, "provider", None) == "feishu" and getattr(mapping, "external_type", None) == "message":
            return mapping
    return None


async def _output_message_text(db: Any, task_run: Any) -> str | None:
    output_message_id = getattr(task_run, "output_message_id", None)
    if output_message_id is None:
        return None
    result = await db.execute(select(Message).where(Message.id == output_message_id))
    message = result.scalar_one_or_none()
    content = getattr(message, "content", None) if message is not None else None
    return content if isinstance(content, str) and content.strip() else None


def _accepted_text(feishu_outcome: FeishuDispatchOutcome, release_result: Any) -> str:
    issue_key = getattr(getattr(feishu_outcome, "command", None), "jira_issue_key", None) or "the Jira issue"
    run_id = getattr(getattr(release_result, "task_run", None), "id", None)
    if run_id:
        return f"Accepted {issue_key}. SmallKhoj TaskRun {run_id} has been created."
    return f"Accepted {issue_key}. SmallKhoj task has been created."


def _terminal_text(status: str, *, output_text: str | None, task_run: Any) -> str:
    if status == "completed":
        return output_text or "TaskRun completed without visible output."
    if status == "cancelled":
        return getattr(task_run, "failure_reason", None) or "TaskRun was cancelled."
    return getattr(task_run, "failure_reason", None) or "TaskRun failed without a recorded reason."


async def send_feishu_accepted_reply(
    db: Any,
    *,
    feishu_outcome: FeishuDispatchOutcome,
    release_result: Any,
    http_client: Any,
    config: FeishuReplyConfig,
) -> FeishuReplyOrchestrationOutcome:
    if getattr(feishu_outcome, "status", None) != "accepted" or getattr(feishu_outcome, "event", None) is None:
        return _outcome("skipped", FEISHU_REPLY_UNSUPPORTED_OUTCOME, "Feishu outcome is not accepted.")

    event = feishu_outcome.event
    chat_id, source_message_id = _source_context(event)
    if not chat_id:
        return _outcome("skipped", FEISHU_REPLY_NO_SOURCE_CONTEXT, "Feishu accepted event has no chatId.")

    try:
        reply = await send_feishu_text_reply(
            db,
            http_client=http_client,
            config=config,
            server_id=event.server_id,
            connector_id=event.connector_id,
            chat_id=chat_id,
            source_message_id=source_message_id,
            text=_accepted_text(feishu_outcome, release_result),
            local_type="external_event",
            local_id=event.id,
        )
    except FeishuReplyError as exc:
        return _outcome("failed", FEISHU_REPLY_SEND_FAILED, exc.reason)
    return _outcome("sent", FEISHU_REPLY_SENT, "Feishu accepted reply was sent.", mapping=reply.mapping)


async def send_task_run_feishu_terminal_reply(
    db: Any,
    *,
    task_run: Any,
    http_client: Any,
    config: FeishuReplyConfig,
    output_text: str | None = None,
) -> FeishuReplyOrchestrationOutcome:
    status = getattr(task_run, "status", None)
    if status not in TERMINAL_REPLY_STATUSES:
        return _outcome(
            "skipped",
            FEISHU_REPLY_UNSUPPORTED_TASK_RUN_STATUS,
            "TaskRun status is not terminal for Feishu reply.",
        )

    event = await _linked_external_event(db, task_run.id)
    if event is None:
        return _outcome("skipped", FEISHU_REPLY_NO_SOURCE_CONTEXT, "TaskRun has no linked Feishu external event.")

    existing_mappings = await list_external_mappings_for_local(
        db,
        server_id=event.server_id,
        local_type="task_run",
        local_id=task_run.id,
    )
    existing = _first_feishu_message_mapping(existing_mappings)
    if existing is not None:
        return _outcome(
            "skipped",
            FEISHU_REPLY_ALREADY_SENT,
            "TaskRun already has a Feishu message mapping.",
            mapping=existing,
        )

    chat_id, source_message_id = _source_context(event)
    if not chat_id:
        return _outcome("skipped", FEISHU_REPLY_NO_SOURCE_CONTEXT, "Feishu event has no chatId.")

    resolved_output_text = output_text if output_text is not None else await _output_message_text(db, task_run)
    try:
        reply = await send_feishu_text_reply(
            db,
            http_client=http_client,
            config=config,
            server_id=event.server_id,
            connector_id=event.connector_id,
            chat_id=chat_id,
            source_message_id=source_message_id,
            text=_terminal_text(status, output_text=resolved_output_text, task_run=task_run),
            local_type="task_run",
            local_id=task_run.id,
        )
    except FeishuReplyError as exc:
        return _outcome("failed", FEISHU_REPLY_SEND_FAILED, exc.reason)
    return _outcome("sent", FEISHU_REPLY_SENT, "Feishu terminal TaskRun reply was sent.", mapping=reply.mapping)


def serialize_feishu_reply_orchestration_outcome(outcome: FeishuReplyOrchestrationOutcome) -> dict[str, Any]:
    mapping = outcome.mapping
    return {
        "status": outcome.status,
        "reasonCode": outcome.reason_code,
        "reason": outcome.reason,
        "mappingId": str(getattr(mapping, "id", "")) if mapping is not None and getattr(mapping, "id", None) else None,
        "externalType": getattr(mapping, "external_type", None) if mapping is not None else None,
        "externalId": getattr(mapping, "external_id", None) if mapping is not None else None,
        "externalUrl": getattr(mapping, "external_url", None) if mapping is not None else None,
    }
