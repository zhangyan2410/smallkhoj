"""Task assignment and TaskRun helpers."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AgentWorkspace, Member, Task, TaskAssignment, TaskRun


RUN_READY_WORKSPACE_STATUSES = {"running", "active", "idle", "busy"}
TASK_RUN_STATUSES = {"queued", "dispatched", "running", "awaiting_input", "completed", "failed", "cancelled"}
TERMINAL_TASK_RUN_STATUSES = {"completed", "failed", "cancelled"}


def _as_uuid(value: Any) -> uuid.UUID | None:
    if isinstance(value, uuid.UUID):
        return value
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _thread_root_message_id(task: Task) -> uuid.UUID | None:
    data = getattr(task, "data", None) or {}
    source = data.get("source") if isinstance(data, dict) else None
    if isinstance(source, dict):
        parsed = _as_uuid(source.get("threadId"))
        if parsed:
            return parsed
    return _as_uuid(getattr(task, "message_id", None))


def _prompt_profile(role: str) -> str:
    if role == "leader":
        return "task.leader"
    if role == "reviewer":
        return "task.reviewer"
    if role == "participant":
        return "task.participant"
    return "task.worker"


def _context_session_id(*, task_id: uuid.UUID, run_id: uuid.UUID, role: str) -> str:
    return f"task:{task_id}:role:{role}:run:{run_id}"


def _merge_json(current: Any, patch: dict[str, Any] | None) -> dict[str, Any]:
    base = dict(current or {}) if isinstance(current, dict) else {}
    if patch:
        base.update(patch)
    return base


async def _latest_ready_workspace(db: AsyncSession, agent_id: uuid.UUID) -> AgentWorkspace | None:
    result = await db.execute(
        select(AgentWorkspace)
        .where(
            AgentWorkspace.agent_id == agent_id,
            AgentWorkspace.status.in_(RUN_READY_WORKSPACE_STATUSES),
        )
        .order_by(AgentWorkspace.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def create_task_assignment_and_run(
    db: AsyncSession,
    *,
    task: Task,
    assignee: Member | None,
    assigned_by_id: uuid.UUID | None,
    role: str = "worker",
    assignment_mode: str = "task_created",
    trigger_type: str = "task_created",
) -> tuple[TaskAssignment | None, TaskRun | None]:
    if assignee is None or getattr(assignee, "kind", None) != "agent":
        return None, None

    workspace = await _latest_ready_workspace(db, assignee.id)
    assignment_id = uuid.uuid4()
    run_id = uuid.uuid4()
    assignment = TaskAssignment(
        id=assignment_id,
        task_id=task.id,
        assignee_id=assignee.id,
        assignee_type="agent",
        role=role,
        assignment_mode=assignment_mode,
        status="active",
        created_by=assigned_by_id,
    )
    source_message_id = _as_uuid(getattr(task, "message_id", None))
    run = TaskRun(
        id=run_id,
        task_id=task.id,
        assignment_id=assignment_id,
        agent_id=assignee.id,
        channel_id=task.channel_id,
        source_message_id=source_message_id,
        thread_root_message_id=_thread_root_message_id(task),
        attempt=1,
        status="queued",
        trigger_type=trigger_type,
        runtime_workspace_id=getattr(workspace, "id", None) if workspace else None,
        computer_id=getattr(workspace, "computer_id", None) if workspace else None,
        runtime=getattr(workspace, "runtime", None) if workspace else None,
        runtime_model=getattr(workspace, "runtime_model", None) if workspace else None,
        prompt_profile=_prompt_profile(role),
        workspace_session_id=getattr(workspace, "session_id", None) if workspace else None,
        runtime_session_id=None,
        context_session_id=_context_session_id(task_id=task.id, run_id=run_id, role=role),
        cwd=getattr(workspace, "cwd", None) if workspace else None,
        context_scope="task",
        context_summary={
            "role": role,
            "assignmentMode": assignment_mode,
            "triggerType": trigger_type,
            "sourceMessageId": str(source_message_id) if source_message_id else None,
        },
    )
    db.add(assignment)
    db.add(run)
    await db.flush()
    return assignment, run


async def update_task_run_lifecycle(
    db: AsyncSession,
    *,
    run_id: uuid.UUID,
    agent_id: uuid.UUID,
    status: str,
    runtime_session_id: str | None = None,
    workspace_session_id: str | None = None,
    context_session_id: str | None = None,
    context_usage: dict[str, Any] | None = None,
    token_usage: dict[str, Any] | None = None,
    tool_usage_summary: dict[str, Any] | None = None,
    output_message_id: uuid.UUID | None = None,
    failure_code: str | None = None,
    failure_reason: str | None = None,
) -> TaskRun | None:
    if status not in TASK_RUN_STATUSES:
        raise ValueError(f"Invalid TaskRun status: {status}")

    result = await db.execute(
        select(TaskRun).where(
            TaskRun.id == run_id,
            TaskRun.agent_id == agent_id,
        )
    )
    run = result.scalar_one_or_none()
    if run is None:
        return None

    now = datetime.utcnow()
    run.status = status
    if status == "running" and not run.started_at:
        run.started_at = now
    if status in TERMINAL_TASK_RUN_STATUSES:
        if not run.started_at:
            run.started_at = now
        if not run.completed_at:
            run.completed_at = now

    if runtime_session_id is not None:
        run.runtime_session_id = runtime_session_id
    if workspace_session_id is not None:
        run.workspace_session_id = workspace_session_id
    if context_session_id is not None:
        run.context_session_id = context_session_id
    if context_usage is not None:
        run.context_usage = _merge_json(run.context_usage, context_usage)
    if token_usage is not None:
        run.token_usage = _merge_json(run.token_usage, token_usage)
    if tool_usage_summary is not None:
        run.tool_usage_summary = _merge_json(run.tool_usage_summary, tool_usage_summary)
    if output_message_id is not None:
        run.output_message_id = output_message_id
    if failure_code is not None:
        run.failure_code = failure_code
    if failure_reason is not None:
        run.failure_reason = failure_reason
    run.updated_at = now

    await db.flush()
    return run


def _iso(value: Any) -> str | None:
    return value.isoformat() if value else None


def _uuid(value: Any) -> str | None:
    return str(value) if value else None


def _number(value: Any) -> int | float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _usage_summary(run: TaskRun) -> dict[str, Any]:
    token = run.token_usage or {}
    context = run.context_usage or {}
    tools = run.tool_usage_summary or {}
    input_tokens = _number(token.get("inputTokens"))
    output_tokens = _number(token.get("outputTokens"))
    cache_read_tokens = _number(token.get("cacheReadInputTokens"))
    if cache_read_tokens is None:
        cache_read_tokens = _number(token.get("cacheReadTokens"))
    total_tokens = _number(token.get("totalTokens"))
    if total_tokens is None:
        total_tokens = sum(value for value in (input_tokens, output_tokens, cache_read_tokens) if value is not None)
        if total_tokens == 0 and all(value is None for value in (input_tokens, output_tokens, cache_read_tokens)):
            total_tokens = None
    tool_calls = _number(tools.get("toolUseCount"))
    if tool_calls is None:
        tool_calls = _number(tools.get("calls"))
    occupancy = _number(context.get("occupancyRatio"))
    context_known_tokens = _number(context.get("knownTokens"))
    if context_known_tokens is None:
        context_known_tokens = _number(context.get("usedTokens"))
    context_window = _number(context.get("contextWindow"))
    if occupancy is None and context_known_tokens is not None and context_window is not None and context_window > 0:
        occupancy = context_known_tokens / context_window
    return {
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "cacheReadInputTokens": cache_read_tokens,
        "totalTokens": total_tokens,
        "durationMs": _number(token.get("durationMs")),
        "durationApiMs": _number(token.get("durationApiMs")),
        "numTurns": _number(token.get("numTurns")),
        "totalCostUsd": _number(token.get("totalCostUsd")),
        "toolCalls": tool_calls,
        "toolResults": _number(tools.get("toolResultCount")),
        "contextKnownTokens": context_known_tokens,
        "contextWindow": context_window,
        "contextSource": context.get("source") if isinstance(context.get("source"), str) else None,
        "contextOccupancyRatio": occupancy,
        "contextOverThreshold": occupancy is not None and occupancy >= 0.5,
    }


def _evidence_issues(run: TaskRun, usage: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    status = getattr(run, "status", None)
    if not getattr(run, "runtime_workspace_id", None):
        issues.append("TASK_RUN_WORKSPACE_MISSING")
    if status in {"dispatched", "running", "awaiting_input", "completed"} and not getattr(run, "runtime_session_id", None):
        issues.append("TASK_RUN_RUNTIME_NOT_READY")
    if status == "completed" and not getattr(run, "output_message_id", None):
        issues.append("TASK_RUN_OUTPUT_MISSING")
    if status == "completed" and usage.get("totalTokens") is None:
        issues.append("TASK_RUN_TOKEN_USAGE_MISSING")
    if status == "completed" and usage.get("contextOccupancyRatio") is None:
        if usage.get("contextKnownTokens") is not None:
            issues.append("TASK_RUN_CONTEXT_WINDOW_MISSING")
        else:
            issues.append("TASK_RUN_CONTEXT_USAGE_MISSING")
    if status == "completed" and usage.get("toolCalls") is None:
        issues.append("TASK_RUN_TOOL_USAGE_MISSING")
    return issues


def _progress_state(run: TaskRun, issues: list[str]) -> tuple[str, str]:
    status = getattr(run, "status", None)
    if status == "queued":
        return "waiting", "queued"
    if status == "dispatched":
        return "working", "dispatched_runtime_activity_required"
    if status == "running":
        return "working", "running"
    if status == "awaiting_input":
        return "waiting", "awaiting_input"
    if status == "completed":
        return "completed", "completed_missing_evidence" if issues else "completed"
    if status == "failed":
        return "failed", getattr(run, "failure_code", None) or "failed"
    if status == "cancelled":
        return "cancelled", "cancelled"
    return "unknown", str(status or "unknown")


def serialize_task_run(run: TaskRun) -> dict[str, Any]:
    usage_summary = _usage_summary(run)
    evidence_issues = _evidence_issues(run, usage_summary)
    progress_state, progress_label = _progress_state(run, evidence_issues)
    return {
        "id": str(run.id),
        "taskId": str(run.task_id),
        "assignmentId": _uuid(run.assignment_id),
        "agentId": str(run.agent_id),
        "channelId": str(run.channel_id),
        "sourceMessageId": _uuid(run.source_message_id),
        "threadRootMessageId": _uuid(run.thread_root_message_id),
        "parentRunId": _uuid(getattr(run, "parent_run_id", None)),
        "attempt": run.attempt,
        "status": run.status,
        "triggerType": run.trigger_type,
        "runtimeWorkspaceId": _uuid(run.runtime_workspace_id),
        "computerId": _uuid(run.computer_id),
        "daemonId": run.daemon_id,
        "runtime": run.runtime,
        "runtimeProvider": run.runtime_provider,
        "runtimeModel": run.runtime_model,
        "promptProfile": run.prompt_profile,
        "workspaceSessionId": run.workspace_session_id,
        "runtimeSessionId": run.runtime_session_id,
        "contextSessionId": run.context_session_id,
        "cwd": run.cwd,
        "contextScope": run.context_scope,
        "contextSummary": run.context_summary or {},
        "contextUsage": run.context_usage or {},
        "tokenUsage": run.token_usage or {},
        "toolUsageSummary": run.tool_usage_summary or {},
        "usageSummary": usage_summary,
        "outputMessageId": _uuid(run.output_message_id),
        "failureCode": run.failure_code,
        "failureReason": run.failure_reason,
        "progressState": progress_state,
        "progressLabel": progress_label,
        "evidenceIssues": evidence_issues,
        "startedAt": _iso(run.started_at),
        "completedAt": _iso(run.completed_at),
        "createdAt": _iso(run.created_at),
        "updatedAt": _iso(run.updated_at),
    }
