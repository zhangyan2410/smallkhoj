from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from models import Channel, EventRecord, Member, Server, Task

OUTPUT_DIRECTION_LABELS = {
    "final_summary": "final summary",
    "evidence": "evidence",
    "artifacts": "artifacts/screenshots",
    "next_steps": "next steps",
    "channel_memory": "durable channel memory proposal",
}


def normalize_output_directions(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    directions: list[str] = []
    for item in raw:
        value = str(item or "").strip()
        if value in OUTPUT_DIRECTION_LABELS and value not in directions:
            directions.append(value)
    return directions


def build_task_memory_request_content(
    task: Task,
    *,
    instruction: str | None = None,
    output_directions: list[str] | None = None,
) -> str:
    directions = output_directions or []
    lines = [
        "This task is now in review. Before waiting for human review, write a recoverable task result memory.",
        f"Run `slock task summary --id {task.id} --summary \"...\"` and include evidence/artifact/next-step options when available.",
    ]
    if "channel_memory" in directions:
        lines.append(
            f"If the result contains durable channel knowledge, run `slock task promote --id {task.id} --source-path final-summary.md --proposal`."
        )
    if directions:
        readable = ", ".join(OUTPUT_DIRECTION_LABELS[item] for item in directions)
        lines.append(f"Requested output direction: {readable}.")
    if instruction:
        lines.append(f"Operator instruction: {instruction.strip()}")
    lines.append(f"Task: #{task.task_number} {task.title}")
    return "\n".join(lines)


def _task_target(task: Task, channel: Channel | None) -> str | None:
    data = task.data or {}
    source = data.get("source") if isinstance(data, dict) else None
    if isinstance(source, dict):
        channel_target = source.get("channel")
        thread_id = source.get("messageShortId") or source.get("threadShortId")
        if isinstance(channel_target, str) and channel_target:
            return f"{channel_target}:{thread_id}" if thread_id else channel_target
    if not channel:
        return None
    if channel.kind in {"public", "private"}:
        return f"#{channel.name}"
    return channel.name


async def add_task_memory_request_event(
    db: AsyncSession,
    server: Server,
    task: Task,
    *,
    actor: Member | None,
    instruction: str | None = None,
    output_directions: list[str] | None = None,
    trigger: str = "manual",
) -> EventRecord | None:
    if not task.assignee_id:
        return None

    assignee = await db.get(Member, task.assignee_id)
    if not assignee or assignee.kind != "agent":
        return None

    channel = await db.get(Channel, task.channel_id) if task.channel_id else None
    directions = normalize_output_directions(output_directions)
    content = build_task_memory_request_content(
        task,
        instruction=instruction,
        output_directions=directions,
    )
    target = _task_target(task, channel)
    event = EventRecord(
        server_id=server.id,
        event_type="task.memory_requested",
        actor_id=actor.id if actor else None,
        channel_id=task.channel_id,
        task_id=task.id,
        payload={
            "type": "task.memory_requested",
            "legacyType": "task_memory_requested",
            "targetAgentId": str(assignee.id),
            "assigneeId": str(assignee.id),
            "taskId": str(task.id),
            "taskNumber": task.task_number,
            "title": task.title,
            "status": task.status,
            "target": target,
            "channel": target,
            "content": content,
            "instruction": instruction.strip() if instruction else None,
            "outputDirections": directions,
            "trigger": trigger,
        },
    )
    db.add(event)
    return event
