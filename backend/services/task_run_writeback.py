"""TaskRun terminal-state external write-back hooks."""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from models import ExternalConnector, ExternalEvent, ExternalMapping, Message, Task
from services.integration_gateway import (
    list_external_mappings_for_local,
    mark_external_event_completed,
    mark_external_event_writeback_failed,
)
from services.jira_rest import JIRA_CREDENTIALS_MISSING, JiraRestError
from services.release_loop import ReleaseLoopError, write_back_task_run_to_jira
from services.task_runs import TERMINAL_TASK_RUN_STATUSES

TASK_RUN_WRITEBACK_NON_TERMINAL = "TASK_RUN_WRITEBACK_NON_TERMINAL"
TASK_RUN_WRITEBACK_ALREADY_WRITTEN = "TASK_RUN_WRITEBACK_ALREADY_WRITTEN"
TASK_RUN_WRITEBACK_NO_JIRA_ISSUE = "TASK_RUN_WRITEBACK_NO_JIRA_ISSUE"
TASK_RUN_WRITEBACK_NO_JIRA_CONNECTOR = "TASK_RUN_WRITEBACK_NO_JIRA_CONNECTOR"
TASK_RUN_WRITEBACK_NO_JIRA_HTTP_CLIENT = "TASK_RUN_WRITEBACK_NO_JIRA_HTTP_CLIENT"
TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS = "TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS"
TASK_RUN_WRITEBACK_JIRA_FAILED = "TASK_RUN_WRITEBACK_JIRA_FAILED"
TASK_RUN_WRITEBACK_WRITTEN = "TASK_RUN_WRITEBACK_WRITTEN"


JiraCredentialsResolver = Callable[[ExternalConnector], Awaitable[dict[str, str] | None] | dict[str, str] | None]


@dataclass(frozen=True)
class TaskRunWritebackDependencies:
    jira_http_client: Any | None = None
    jira_credentials_resolver: JiraCredentialsResolver | None = None


@dataclass(frozen=True)
class TaskRunWritebackOutcome:
    status: str
    reason_code: str
    reason: str
    mapping: ExternalMapping | Any | None = None


async def _maybe_await_credentials(value: Awaitable[dict[str, str] | None] | dict[str, str] | None) -> dict[str, str] | None:
    if hasattr(value, "__await__"):
        return await value  # type: ignore[no-any-return]
    return value


async def _linked_external_event(db: Any, task_run_id: uuid.UUID) -> ExternalEvent | Any | None:
    result = await db.execute(
        select(ExternalEvent)
        .where(ExternalEvent.task_run_id == task_run_id)
        .order_by(ExternalEvent.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _first_mapping(mappings: list[Any], *, provider: str, external_type: str) -> Any | None:
    for mapping in mappings:
        if getattr(mapping, "provider", None) == provider and getattr(mapping, "external_type", None) == external_type:
            return mapping
    return None


async def _task(db: Any, task_id: uuid.UUID) -> Task | Any | None:
    result = await db.execute(select(Task).where(Task.id == task_id))
    return result.scalar_one_or_none()


async def _output_message_text(db: Any, task_run: Any) -> str | None:
    output_message_id = getattr(task_run, "output_message_id", None)
    if output_message_id is None:
        return None
    result = await db.execute(select(Message).where(Message.id == output_message_id))
    message = result.scalar_one_or_none()
    content = getattr(message, "content", None) if message is not None else None
    return content if isinstance(content, str) and content.strip() else None


async def _connector(db: Any, connector_id: uuid.UUID) -> ExternalConnector | Any | None:
    result = await db.execute(select(ExternalConnector).where(ExternalConnector.id == connector_id))
    return result.scalar_one_or_none()


def _outcome(status: str, reason_code: str, reason: str, *, mapping: Any | None = None) -> TaskRunWritebackOutcome:
    return TaskRunWritebackOutcome(status=status, reason_code=reason_code, reason=reason, mapping=mapping)


async def handle_terminal_task_run_writeback(
    db: Any,
    *,
    task_run: Any,
    output_text: str | None = None,
    dependencies: TaskRunWritebackDependencies | None = None,
) -> TaskRunWritebackOutcome:
    if getattr(task_run, "status", None) not in TERMINAL_TASK_RUN_STATUSES:
        return _outcome(
            "not_applicable",
            TASK_RUN_WRITEBACK_NON_TERMINAL,
            "TaskRun is not in a terminal state.",
        )

    event = await _linked_external_event(db, task_run.id)
    server_id = getattr(event, "server_id", None)
    task_id = getattr(event, "task_id", None) or getattr(task_run, "task_id", None)
    if server_id is None or task_id is None:
        return _outcome(
            "skipped",
            TASK_RUN_WRITEBACK_NO_JIRA_ISSUE,
            "TaskRun has no linked external event with task/server context.",
        )

    existing_writebacks = await list_external_mappings_for_local(
        db,
        server_id=server_id,
        local_type="task_run",
        local_id=task_run.id,
    )
    existing_comment = _first_mapping(existing_writebacks, provider="jira", external_type="comment")
    if existing_comment is not None:
        return _outcome(
            "skipped",
            TASK_RUN_WRITEBACK_ALREADY_WRITTEN,
            "TaskRun already has a Jira comment mapping.",
            mapping=existing_comment,
        )

    task_mappings = await list_external_mappings_for_local(
        db,
        server_id=server_id,
        local_type="task",
        local_id=task_id,
    )
    issue_mapping = _first_mapping(task_mappings, provider="jira", external_type="issue")
    if issue_mapping is None:
        return _outcome(
            "skipped",
            TASK_RUN_WRITEBACK_NO_JIRA_ISSUE,
            "TaskRun task has no Jira issue mapping.",
        )

    task = await _task(db, task_id)
    if task is None:
        return _outcome(
            "skipped",
            TASK_RUN_WRITEBACK_NO_JIRA_ISSUE,
            "TaskRun task could not be loaded for Jira write-back.",
        )
    resolved_output_text = output_text if output_text is not None else await _output_message_text(db, task_run)

    connector = await _connector(db, issue_mapping.connector_id)
    if connector is None:
        return _outcome(
            "skipped",
            TASK_RUN_WRITEBACK_NO_JIRA_CONNECTOR,
            "Jira connector for the issue mapping could not be loaded.",
        )

    dependencies = dependencies or TaskRunWritebackDependencies()
    if dependencies.jira_http_client is None:
        return _outcome(
            "skipped",
            TASK_RUN_WRITEBACK_NO_JIRA_HTTP_CLIENT,
            "Jira HTTP client was not configured for TaskRun write-back.",
        )
    if dependencies.jira_credentials_resolver is None:
        return _outcome(
            "skipped",
            TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS,
            "Jira credentials resolver was not configured for TaskRun write-back.",
        )

    credentials = await _maybe_await_credentials(dependencies.jira_credentials_resolver(connector))
    if not credentials:
        return _outcome(
            "skipped",
            TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS,
            "Jira credentials were not available for TaskRun write-back.",
        )

    try:
        comment_mapping = await write_back_task_run_to_jira(
            db,
            jira_http_client=dependencies.jira_http_client,
            jira_connector=connector,
            jira_credentials=credentials,
            issue_key=issue_mapping.external_id,
            task_run=task_run,
            task=task,
            output_text=resolved_output_text,
        )
    except ReleaseLoopError as exc:
        if event is not None:
            await mark_external_event_writeback_failed(
                db,
                event,
                failure_code=TASK_RUN_WRITEBACK_JIRA_FAILED,
                failure_reason=exc.reason,
            )
        return _outcome("failed", TASK_RUN_WRITEBACK_JIRA_FAILED, exc.reason)
    except JiraRestError as exc:
        if exc.code == JIRA_CREDENTIALS_MISSING:
            return _outcome("skipped", TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS, exc.reason)
        if event is not None:
            await mark_external_event_writeback_failed(
                db,
                event,
                failure_code=TASK_RUN_WRITEBACK_JIRA_FAILED,
                failure_reason=exc.reason,
            )
        return _outcome("failed", TASK_RUN_WRITEBACK_JIRA_FAILED, exc.reason)

    if event is not None:
        await mark_external_event_completed(db, event)
    return _outcome(
        "written",
        TASK_RUN_WRITEBACK_WRITTEN,
        "TaskRun result was written back to Jira.",
        mapping=comment_mapping,
    )


def serialize_task_run_writeback_outcome(outcome: TaskRunWritebackOutcome) -> dict[str, Any]:
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
