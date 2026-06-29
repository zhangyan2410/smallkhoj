"""Service-level release loop orchestration for Feishu -> Jira -> TaskRun."""

import secrets
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy import func, select

from models import Member, Message, Task
from services.feishu_adapter import FeishuDispatchOutcome
from services.integration_gateway import link_external_event
from services.jira_rest import (
    JiraRestError,
    append_jira_comment,
    fetch_jira_issue,
    map_jira_comment,
    map_jira_issue,
    resolve_jira_config,
)
from services.task_runs import create_task_assignment_and_run


RELEASE_LOOP_FEISHU_OUTCOME_NOT_ACCEPTED = "RELEASE_LOOP_FEISHU_OUTCOME_NOT_ACCEPTED"
RELEASE_LOOP_UNSUPPORTED_COMMAND = "RELEASE_LOOP_UNSUPPORTED_COMMAND"
RELEASE_LOOP_ROUTE_CHANNEL_MISSING = "RELEASE_LOOP_ROUTE_CHANNEL_MISSING"
RELEASE_LOOP_ASSIGNEE_MISSING = "RELEASE_LOOP_ASSIGNEE_MISSING"
RELEASE_LOOP_JIRA_LOOKUP_FAILED = "RELEASE_LOOP_JIRA_LOOKUP_FAILED"
RELEASE_LOOP_JIRA_WRITEBACK_FAILED = "RELEASE_LOOP_JIRA_WRITEBACK_FAILED"


TaskNumberAllocator = Callable[[Any, uuid.UUID], Awaitable[int] | int]


@dataclass(frozen=True)
class ReleaseLoopStartResult:
    message: Message
    task: Task
    assignment: Any
    task_run: Any
    jira_issue: Any
    jira_issue_mapping: Any


class ReleaseLoopError(Exception):
    def __init__(self, code: str, reason: str, *, cause_code: str | None = None):
        super().__init__(reason)
        self.code = code
        self.reason = reason
        self.cause_code = cause_code


def _short_id() -> str:
    return secrets.token_hex(4)


async def default_task_number_allocator(db: Any, channel_id: uuid.UUID) -> int:
    result = await db.execute(select(func.max(Task.task_number)).where(Task.channel_id == channel_id))
    value = result.scalar()
    return int(value or 0) + 1


async def _maybe_await(value: Awaitable[int] | int) -> int:
    if hasattr(value, "__await__"):
        return int(await value)  # type: ignore[arg-type]
    return int(value)


def _require_accepted_jira_outcome(outcome: FeishuDispatchOutcome) -> None:
    if outcome.status != "accepted":
        raise ReleaseLoopError(
            RELEASE_LOOP_FEISHU_OUTCOME_NOT_ACCEPTED,
            "Feishu outcome must be accepted before starting the Jira analysis loop.",
        )
    if not outcome.command or outcome.command.kind != "jira_analysis" or not outcome.command.jira_issue_key:
        raise ReleaseLoopError(
            RELEASE_LOOP_UNSUPPORTED_COMMAND,
            "Feishu outcome does not contain a supported jira_analysis command.",
        )
    if not outcome.route or not outcome.route.channel_id:
        raise ReleaseLoopError(
            RELEASE_LOOP_ROUTE_CHANNEL_MISSING,
            "Accepted Feishu route must resolve to a SmallKhoj channel.",
        )
    if not getattr(outcome.route, "default_assignee_id", None):
        raise ReleaseLoopError(
            RELEASE_LOOP_ASSIGNEE_MISSING,
            "Accepted Feishu route must provide a default assignee for TaskRun creation.",
        )


def _task_description(issue: Any) -> str:
    parts = [
        f"Jira issue: {issue.key}",
        f"URL: {issue.url}",
    ]
    if issue.status:
        parts.append(f"Status: {issue.status}")
    if issue.description_text:
        parts.append("")
        parts.append(issue.description_text)
    return "\n".join(parts)


def _task_data(outcome: FeishuDispatchOutcome, issue: Any) -> dict[str, Any]:
    event = outcome.event
    normalized = getattr(event, "normalized", None) or {}
    return {
        "source": {
            "provider": "feishu",
            "externalEventId": str(getattr(event, "id", "")) if event else None,
            "feishuChatId": normalized.get("chatId"),
            "feishuMessageId": normalized.get("messageId") or getattr(event, "source_message_id", None),
        },
        "jira": {
            "issueKey": issue.key,
            "issueId": issue.id,
            "issueUrl": issue.url,
            "status": issue.status,
            "summary": issue.summary,
        },
    }


async def start_feishu_jira_analysis(
    db: Any,
    *,
    feishu_outcome: FeishuDispatchOutcome,
    jira_http_client: Any,
    jira_connector: Any,
    jira_credentials: dict[str, str],
    creator_id: uuid.UUID,
    task_number_allocator: TaskNumberAllocator = default_task_number_allocator,
) -> ReleaseLoopStartResult:
    _require_accepted_jira_outcome(feishu_outcome)
    assert feishu_outcome.command is not None
    assert feishu_outcome.route is not None
    assert feishu_outcome.event is not None

    config = resolve_jira_config(jira_connector, credentials=jira_credentials)
    try:
        issue = await fetch_jira_issue(jira_http_client, config, feishu_outcome.command.jira_issue_key or "")
    except JiraRestError as exc:
        raise ReleaseLoopError(
            RELEASE_LOOP_JIRA_LOOKUP_FAILED,
            f"Jira lookup failed: {exc.reason}",
            cause_code=exc.code,
        ) from exc

    channel_id = feishu_outcome.route.channel_id
    assignee = Member(
        id=feishu_outcome.route.default_assignee_id,
        server_id=getattr(jira_connector, "server_id", getattr(feishu_outcome.event, "server_id", uuid.uuid4())),
        kind="agent",
        display_name="Jira analysis agent",
    )
    message = Message(
        short_id=_short_id(),
        channel_id=channel_id,
        sender_id=creator_id,
        content=f"Feishu requested Jira analysis for {issue.key}: {issue.summary or ''}".strip(),
        channel_type="channel",
        mentions=[assignee.id],
    )
    db.add(message)
    await db.flush()

    task_number = await _maybe_await(task_number_allocator(db, channel_id))
    task = Task(
        task_number=task_number,
        channel_id=channel_id,
        message_id=message.id,
        title=f"Analyze {issue.key}: {issue.summary or 'Untitled'}",
        description=_task_description(issue),
        status="todo",
        creator_id=creator_id,
        assignee_id=assignee.id,
        data=_task_data(feishu_outcome, issue),
    )
    db.add(task)
    await db.flush()

    assignment, task_run = await create_task_assignment_and_run(
        db,
        task=task,
        assignee=assignee,
        assigned_by_id=creator_id,
        role="worker",
        assignment_mode="external_feishu",
        trigger_type="feishu_jira_analysis",
    )
    issue_mapping = await map_jira_issue(
        db,
        server_id=getattr(jira_connector, "server_id", feishu_outcome.event.server_id),
        connector_id=getattr(jira_connector, "id", feishu_outcome.event.connector_id),
        local_type="task",
        local_id=task.id,
        issue_key=issue.key,
        issue_url=issue.url,
    )
    await link_external_event(
        db,
        feishu_outcome.event,
        route_id=getattr(feishu_outcome.route, "id", None),
        session_id=getattr(feishu_outcome.session, "id", None),
        channel_id=channel_id,
        message_id=message.id,
        task_id=task.id,
        task_run_id=getattr(task_run, "id", None),
    )
    return ReleaseLoopStartResult(
        message=message,
        task=task,
        assignment=assignment,
        task_run=task_run,
        jira_issue=issue,
        jira_issue_mapping=issue_mapping,
    )


def _comment_text(*, task: Any, task_run: Any, output_text: str | None = None) -> str:
    lines = [
        f"SmallKhoj result for {getattr(task, 'title', 'task')}",
        f"TaskRun status: {getattr(task_run, 'status', 'unknown')}",
    ]
    if output_text:
        lines.extend(["", output_text])
    elif getattr(task_run, "failure_reason", None):
        lines.extend(["", f"Failure: {task_run.failure_reason}"])
    else:
        lines.extend(["", "No output text was recorded."])
    lines.append("")
    lines.append(f"TaskRun id: {getattr(task_run, 'id', '')}")
    return "\n".join(lines)


async def write_back_task_run_to_jira(
    db: Any,
    *,
    jira_http_client: Any,
    jira_connector: Any,
    jira_credentials: dict[str, str],
    issue_key: str,
    task_run: Any,
    task: Any,
    output_text: str | None = None,
) -> Any:
    config = resolve_jira_config(jira_connector, credentials=jira_credentials)
    try:
        comment = await append_jira_comment(
            jira_http_client,
            config,
            issue_key,
            _comment_text(task=task, task_run=task_run, output_text=output_text),
        )
    except JiraRestError as exc:
        raise ReleaseLoopError(
            RELEASE_LOOP_JIRA_WRITEBACK_FAILED,
            f"Jira write-back failed: {exc.reason}",
            cause_code=exc.code,
        ) from exc
    return await map_jira_comment(
        db,
        server_id=jira_connector.server_id,
        connector_id=jira_connector.id,
        local_type="task_run",
        local_id=task_run.id,
        comment_id=comment.id,
        comment_url=comment.url,
    )
