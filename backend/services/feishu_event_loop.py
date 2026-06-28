"""Service-level Feishu raw event loop boundary."""

import uuid
from dataclasses import dataclass
from typing import Any

from services.feishu_adapter import (
    FeishuDispatchOutcome,
    dispatch_feishu_message,
    normalize_feishu_message,
)
from services.feishu_reply_orchestration import send_feishu_accepted_reply
from services.integration_gateway import mark_external_event_failed
from services.release_loop import ReleaseLoopError, start_feishu_jira_analysis


FEISHU_EVENT_LOOP_ACCEPTED = "FEISHU_EVENT_LOOP_ACCEPTED"
FEISHU_EVENT_LOOP_ACCEPTED_REPLY_FAILED = "FEISHU_EVENT_LOOP_ACCEPTED_REPLY_FAILED"
FEISHU_EVENT_LOOP_DISPATCH_PASSTHROUGH = "FEISHU_EVENT_LOOP_DISPATCH_PASSTHROUGH"
FEISHU_EVENT_LOOP_RELEASE_FAILED = "FEISHU_EVENT_LOOP_RELEASE_FAILED"


@dataclass(frozen=True)
class FeishuEventLoopOutcome:
    status: str
    reason_code: str
    reason: str
    dispatch_outcome: FeishuDispatchOutcome | None = None
    release_result: Any | None = None
    accepted_reply: Any | None = None
    failure_code: str | None = None
    failure_reason: str | None = None


def _outcome(
    status: str,
    reason_code: str,
    reason: str,
    *,
    dispatch_outcome: FeishuDispatchOutcome | None = None,
    release_result: Any | None = None,
    accepted_reply: Any | None = None,
    failure_code: str | None = None,
    failure_reason: str | None = None,
) -> FeishuEventLoopOutcome:
    return FeishuEventLoopOutcome(
        status=status,
        reason_code=reason_code,
        reason=reason,
        dispatch_outcome=dispatch_outcome,
        release_result=release_result,
        accepted_reply=accepted_reply,
        failure_code=failure_code,
        failure_reason=failure_reason,
    )


async def process_feishu_raw_event(
    db: Any,
    *,
    raw_event: dict[str, Any],
    server_id: uuid.UUID,
    feishu_connector_id: uuid.UUID,
    jira_connector: Any,
    creator_id: uuid.UUID,
    jira_http_client: Any,
    jira_credentials: dict[str, str],
    feishu_http_client: Any,
    feishu_reply_config: Any,
    bot_open_id: str | None = None,
    bot_name: str | None = None,
) -> FeishuEventLoopOutcome:
    message = normalize_feishu_message(raw_event)
    dispatch_outcome = await dispatch_feishu_message(
        db,
        message,
        server_id=server_id,
        connector_id=feishu_connector_id,
        bot_open_id=bot_open_id,
        bot_name=bot_name,
    )
    if dispatch_outcome.status != "accepted":
        return _outcome(
            dispatch_outcome.status,
            FEISHU_EVENT_LOOP_DISPATCH_PASSTHROUGH,
            "Feishu dispatch did not create local work.",
            dispatch_outcome=dispatch_outcome,
            failure_code=dispatch_outcome.failure_code,
            failure_reason=dispatch_outcome.failure_reason,
        )

    try:
        release_result = await start_feishu_jira_analysis(
            db,
            feishu_outcome=dispatch_outcome,
            jira_http_client=jira_http_client,
            jira_connector=jira_connector,
            jira_credentials=jira_credentials,
            creator_id=creator_id,
        )
    except ReleaseLoopError as exc:
        if dispatch_outcome.event is not None:
            await mark_external_event_failed(
                db,
                dispatch_outcome.event,
                failure_code=exc.code,
                failure_reason=exc.reason,
            )
        return _outcome(
            "failed",
            FEISHU_EVENT_LOOP_RELEASE_FAILED,
            "Feishu event was accepted but release-loop startup failed.",
            dispatch_outcome=dispatch_outcome,
            failure_code=exc.code,
            failure_reason=exc.reason,
        )

    accepted_reply = await send_feishu_accepted_reply(
        db,
        feishu_outcome=dispatch_outcome,
        release_result=release_result,
        http_client=feishu_http_client,
        config=feishu_reply_config,
    )
    if getattr(accepted_reply, "status", None) == "failed":
        return _outcome(
            "accepted_reply_failed",
            FEISHU_EVENT_LOOP_ACCEPTED_REPLY_FAILED,
            "Local release-loop state was created, but the Feishu accepted reply failed.",
            dispatch_outcome=dispatch_outcome,
            release_result=release_result,
            accepted_reply=accepted_reply,
            failure_code=getattr(accepted_reply, "reason_code", None),
            failure_reason=getattr(accepted_reply, "reason", None),
        )

    return _outcome(
        "accepted",
        FEISHU_EVENT_LOOP_ACCEPTED,
        "Feishu event was accepted and local release-loop state was created.",
        dispatch_outcome=dispatch_outcome,
        release_result=release_result,
        accepted_reply=accepted_reply,
    )
