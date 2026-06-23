"""Database-backed scoped memory API helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Channel, ChannelMember, EventRecord, MemoryEntry, MemoryProposal, Member, Message, Server, Task
from services.memory_store import (
    MemoryConflict,
    MemoryScope,
    content_sha256,
    ensure_scope_visible,
    normalize_memory_path,
    parse_memory_content_payload,
    require_matching_base_sha,
    search_memory_entries,
)


@dataclass
class MemoryScopeContext:
    scope: MemoryScope
    channel: Channel | None = None
    task: Task | None = None
    thread_root: Message | None = None


async def resolve_memory_scope(
    db: AsyncSession,
    server: Server,
    scope_type: str,
    scope_id: str,
    *,
    viewer: Member | None = None,
) -> MemoryScopeContext:
    if scope_type == "channel":
        channel = await _resolve_channel_scope(db, server, scope_id)
        scope = MemoryScope("channel", channel.id)
        if viewer:
            ensure_scope_visible(
                scope,
                viewer,
                channel=channel,
                is_channel_member=await _is_channel_member(db, channel.id, viewer.id),
            )
        return MemoryScopeContext(scope=scope, channel=channel)

    if scope_type == "task":
        task = await _resolve_task_scope(db, server, scope_id)
        channel = await _channel_by_id(db, task.channel_id)
        scope = MemoryScope("task", task.id)
        if viewer:
            visible = _task_actor_can_view(task, viewer) or (
                channel is not None
                and (channel.kind == "public" or await _is_channel_member(db, channel.id, viewer.id))
            )
            ensure_scope_visible(scope, viewer, channel=channel, task=task, is_task_visible=visible)
        return MemoryScopeContext(scope=scope, channel=channel, task=task)

    if scope_type == "thread":
        root = await _resolve_thread_scope(db, server, scope_id)
        channel = await _channel_by_id(db, root.channel_id)
        scope = MemoryScope("thread", root.id)
        if viewer:
            visible = channel is not None and (
                channel.kind == "public" or await _is_channel_member(db, channel.id, viewer.id)
            )
            ensure_scope_visible(scope, viewer, channel=channel, task=root, is_task_visible=visible)
        return MemoryScopeContext(scope=scope, channel=channel, thread_root=root)

    if scope_type == "agent":
        parsed = _parse_uuid(scope_id, "agent scope id")
        scope = MemoryScope("agent", parsed)
        if viewer:
            ensure_scope_visible(scope, viewer)
        return MemoryScopeContext(scope=scope)

    raise HTTPException(400, f"Unsupported memory scope: {scope_type}")


async def list_memory_entries(db: AsyncSession, server: Server, context: MemoryScopeContext) -> list[MemoryEntry]:
    result = await db.execute(
        select(MemoryEntry)
        .where(
            MemoryEntry.server_id == server.id,
            MemoryEntry.scope_type == context.scope.type,
            MemoryEntry.scope_id == context.scope.id,
            MemoryEntry.deleted_at.is_(None),
        )
        .order_by(MemoryEntry.path)
    )
    return list(result.scalars().all())


async def get_memory_entry(
    db: AsyncSession,
    server: Server,
    context: MemoryScopeContext,
    path: str,
) -> MemoryEntry:
    entry = await _memory_entry_by_path(db, server, context, normalize_memory_path(path))
    if not entry:
        raise HTTPException(404, "Memory entry not found")
    return entry


async def search_memory(
    db: AsyncSession,
    server: Server,
    context: MemoryScopeContext,
    query: str,
    *,
    limit: int = 10,
) -> list[MemoryEntry]:
    entries = await list_memory_entries(db, server, context)
    return search_memory_entries(entries, query, limit=limit)


async def write_memory_entry(
    db: AsyncSession,
    server: Server,
    context: MemoryScopeContext,
    path: str,
    body: dict,
    *,
    author: Member | None,
) -> tuple[MemoryEntry, bool]:
    if author is not None:
        await ensure_scope_writable(db, context, author)
    normalized_path = normalize_memory_path(path)
    payload = parse_memory_content_payload(body)

    entry = await _memory_entry_by_path(db, server, context, normalized_path)
    base_sha = body.get("baseSha256") or body.get("baseSha")
    current_sha = entry.content_sha256 if entry else content_sha256("")
    try:
        require_matching_base_sha(current_sha, base_sha)
    except MemoryConflict as exc:
        raise HTTPException(
            409,
            {
                "code": "MEMORY_CONFLICT",
                "currentSha256": exc.current_sha,
                "instruction": exc.agent_message,
            },
        )

    sha = content_sha256(payload.content_text)
    created = entry is None
    if entry is None:
        entry = MemoryEntry(
            server_id=server.id,
            scope_type=context.scope.type,
            scope_id=context.scope.id,
            path=normalized_path,
            content_sha256=sha,
            version=1,
        )
        db.add(entry)
    else:
        entry.version += 1

    entry.title = body.get("title") or entry.title or normalized_path
    entry.entry_kind = body.get("entryKind") or body.get("kind") or entry.entry_kind or "note"
    entry.content_text = payload.content_text
    entry.blob_key = payload.blob_key
    entry.file_id = payload.file_id
    entry.content_sha256 = sha
    entry.mime_type = payload.mime_type or entry.mime_type or "text/markdown"
    entry.size_bytes = payload.size_bytes
    entry.source_path = body.get("sourcePath") or entry.source_path
    entry.author_member_id = author.id if author else entry.author_member_id
    entry.metadata_json = body.get("metadata") or entry.metadata_json or {}
    _apply_source_ids(entry, body, context)
    await db.flush()
    _add_memory_event(db, server, entry, author=author, created=created, context=context)
    return entry, created


async def create_memory_proposal(
    db: AsyncSession,
    server: Server,
    context: MemoryScopeContext,
    body: dict,
    *,
    author: Member,
) -> MemoryProposal:
    await ensure_scope_writable(db, context, author)
    path = normalize_memory_path(str(body.get("path") or ""))
    content_text = body.get("contentText")
    if content_text is None:
        content_text = body.get("content")
    if content_text is None:
        raise HTTPException(400, "Missing contentText")
    if not isinstance(content_text, str):
        raise HTTPException(400, "contentText must be a string")

    base_entry = await _memory_entry_by_path(db, server, context, path)
    proposal = MemoryProposal(
        server_id=server.id,
        scope_type=context.scope.type,
        scope_id=context.scope.id,
        path=path,
        base_entry_id=base_entry.id if base_entry else None,
        base_sha256=body.get("baseSha256") or body.get("baseSha") or (base_entry.content_sha256 if base_entry else None),
        proposed_content_text=content_text,
        author_member_id=author.id,
        reason=body.get("reason"),
        metadata_json=body.get("metadata") or {},
    )
    db.add(proposal)
    await db.flush()
    _add_memory_proposal_event(db, server, proposal, author=author, context=context)
    return proposal


async def list_memory_proposals(
    db: AsyncSession,
    server: Server,
    context: MemoryScopeContext,
    *,
    status: str | None = "open",
) -> list[MemoryProposal]:
    q = select(MemoryProposal).where(
        MemoryProposal.server_id == server.id,
        MemoryProposal.scope_type == context.scope.type,
        MemoryProposal.scope_id == context.scope.id,
    )
    if status and status != "all":
        q = q.where(MemoryProposal.status == status)
    result = await db.execute(q.order_by(MemoryProposal.updated_at.desc()))
    return list(result.scalars().all())


async def get_memory_proposal(
    db: AsyncSession,
    server: Server,
    proposal_id: str,
    *,
    viewer: Member,
) -> tuple[MemoryProposal, MemoryScopeContext]:
    parsed_id = _parse_uuid(proposal_id, "proposal id")
    result = await db.execute(
        select(MemoryProposal).where(
            MemoryProposal.id == parsed_id,
            MemoryProposal.server_id == server.id,
        )
    )
    proposal = result.scalar_one_or_none()
    if not proposal:
        raise HTTPException(404, "Memory proposal not found")
    context = await resolve_memory_scope(db, server, proposal.scope_type, str(proposal.scope_id), viewer=viewer)
    return proposal, context


async def resolve_memory_proposal(
    db: AsyncSession,
    server: Server,
    proposal_id: str,
    body: dict,
    *,
    reviewer: Member,
) -> dict:
    proposal, context = await get_memory_proposal(db, server, proposal_id, viewer=reviewer)
    await ensure_scope_writable(db, context, reviewer)
    if proposal.status != "open":
        raise HTTPException(409, "Memory proposal is already resolved")

    status = str(body.get("status") or body.get("decision") or "").strip().lower()
    if status in {"accept", "approve", "approved"}:
        status = "accepted"
    if status in {"reject", "decline", "declined"}:
        status = "rejected"
    if status not in {"accepted", "rejected"}:
        raise HTTPException(400, "status must be accepted or rejected")

    entry = None
    if status == "accepted":
        content_text = proposal.proposed_content_text or ""
        if not content_text:
            raise HTTPException(400, "Accepted proposal has no proposed content")
        metadata = dict(proposal.metadata_json or {})
        metadata.update({
            "proposalId": str(proposal.id),
            "proposalStatus": "accepted",
            "reviewNote": body.get("reviewNote") or body.get("note"),
        })
        entry_kind = str(metadata.get("kind") or metadata.get("entryKind") or "proposal_acceptance")
        base_sha = getattr(proposal, "base_sha256", None)
        entry, _created = await write_memory_entry(
            db,
            server,
            context,
            proposal.path,
            {
                "title": body.get("title") or proposal.path,
                "entryKind": entry_kind,
                "contentText": content_text,
                "baseSha": body.get("baseSha") or body.get("baseSha256") or base_sha or content_sha256(""),
                "metadata": metadata,
            },
            author=reviewer,
        )

    proposal.status = status
    proposal.reviewer_member_id = reviewer.id
    proposal.review_note = body.get("reviewNote") or body.get("note")
    proposal.resolved_at = datetime.now(timezone.utc)
    await db.flush()
    _add_memory_proposal_resolved_event(db, server, proposal, reviewer, context)
    return {"proposal": proposal, "entry": entry}


async def delete_memory_entry(
    db: AsyncSession,
    server: Server,
    context: MemoryScopeContext,
    path: str,
    *,
    author: Member,
) -> MemoryEntry:
    await ensure_scope_writable(db, context, author)
    entry = await get_memory_entry(db, server, context, path)
    if entry.deleted_at is None:
        entry.deleted_at = datetime.now(timezone.utc)
        entry.version = int(getattr(entry, "version", 0) or 0) + 1
    await db.flush()
    _add_memory_deleted_event(db, server, entry, author, context)
    return entry


async def write_task_memory_summary(
    db: AsyncSession,
    server: Server,
    task_id: str,
    body: dict,
    *,
    author: Member,
) -> dict:
    context = await resolve_memory_scope(db, server, "task", task_id, viewer=author)
    task = context.task
    if task is None:
        raise HTTPException(404, "Task not found")

    final_summary = _first_text(body, "finalSummary", "summary", "contentText", "content")
    if not final_summary:
        raise HTTPException(400, "Missing finalSummary")

    evidence = _string_list(body.get("evidence"))
    artifacts = _string_list(body.get("artifacts"))
    next_steps = _string_list(body.get("nextSteps"))
    progress_text = _first_text(body, "progress", "progressText")
    summary_path = normalize_memory_path(str(body.get("path") or "final-summary.md"))
    progress_path = normalize_memory_path(str(body.get("progressPath") or "progress.md"))

    summary_entry, created = await write_memory_entry(
        db,
        server,
        context,
        summary_path,
        {
            "title": body.get("title") or f"Task #{task.task_number} final summary",
            "entryKind": "final_summary",
            "contentText": _format_task_summary_markdown(
                task,
                final_summary,
                progress=progress_text,
                evidence=evidence,
                artifacts=artifacts,
                next_steps=next_steps,
            ),
            "sourceTaskId": str(task.id),
            "metadata": {
                "kind": "final_summary",
                "recoverySignal": "output",
                "taskNumber": task.task_number,
                "evidence": evidence,
                "artifacts": artifacts,
                "nextSteps": next_steps,
                "promotable": bool(body.get("promotable", True)),
            },
        },
        author=author,
    )

    progress_entry = None
    if progress_text:
        progress_entry, _ = await write_memory_entry(
            db,
            server,
            context,
            progress_path,
            {
                "title": body.get("progressTitle") or f"Task #{task.task_number} progress",
                "entryKind": "progress",
                "contentText": progress_text,
                "sourceTaskId": str(task.id),
                "metadata": {
                    "kind": "progress",
                    "recoverySignal": "progress",
                    "taskNumber": task.task_number,
                },
            },
            author=author,
        )

    task.data = _merge_task_memory_data(
        task.data or {},
        {
            "scope": "task",
            "summaryPath": summary_path,
            "finalSummaryPath": summary_path,
            "progressPath": progress_path if progress_entry else (task.data or {}).get("memory", {}).get("progressPath"),
            "evidence": evidence,
            "artifacts": artifacts,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        },
    )
    await db.flush()
    return {
        "task": task,
        "summaryEntry": summary_entry,
        "progressEntry": progress_entry,
        "created": created,
    }


async def promote_task_memory_to_channel(
    db: AsyncSession,
    server: Server,
    task_id: str,
    body: dict,
    *,
    author: Member,
) -> dict:
    task_context = await resolve_memory_scope(db, server, "task", task_id, viewer=author)
    task = task_context.task
    channel = task_context.channel
    if task is None or channel is None:
        raise HTTPException(404, "Task not found")

    source_path = normalize_memory_path(str(body.get("sourcePath") or "final-summary.md"))
    source_entry = await get_memory_entry(db, server, task_context, source_path)
    content_text = _first_text(body, "contentText", "content") or source_entry.content_text or ""
    if not content_text:
        raise HTTPException(400, "Task memory source is empty")

    channel_path = normalize_memory_path(
        str(body.get("channelPath") or f"tasks/{str(task.id).split('-')[0]}/final-summary.md")
    )
    channel_context = MemoryScopeContext(scope=MemoryScope("channel", channel.id), channel=channel)
    metadata = {
        "kind": "task_output",
        "promotion": True,
        "sourceTaskId": str(task.id),
        "sourcePath": source_path,
        "taskNumber": task.task_number,
    }
    reason = body.get("reason") or f"Promote task #{task.task_number} durable output"

    if body.get("proposal"):
        proposal = await create_memory_proposal(
            db,
            server,
            channel_context,
            {
                "path": channel_path,
                "contentText": content_text,
                "reason": reason,
                "metadata": metadata,
            },
            author=author,
        )
        return {
            "sourceEntry": source_entry,
            "channelEntry": None,
            "proposal": proposal,
            "created": False,
        }

    channel_entry, created = await write_memory_entry(
        db,
        server,
        channel_context,
        channel_path,
        {
            "title": body.get("title") or f"Task #{task.task_number} output",
            "entryKind": "task_output",
            "contentText": content_text,
            "sourceTaskId": str(task.id),
            "sourceChannelId": str(channel.id),
            "sourcePath": f"task:{task.id}/{source_path}",
            "metadata": metadata,
        },
        author=author,
    )
    return {
        "sourceEntry": source_entry,
        "channelEntry": channel_entry,
        "proposal": None,
        "created": created,
    }


def serialize_memory_entry(entry: MemoryEntry) -> dict:
    return {
        "id": str(entry.id),
        "serverId": str(entry.server_id),
        "scopeType": entry.scope_type,
        "scopeId": str(entry.scope_id),
        "path": entry.path,
        "title": entry.title,
        "entryKind": entry.entry_kind,
        "contentText": entry.content_text,
        "blobKey": entry.blob_key,
        "fileId": str(entry.file_id) if entry.file_id else None,
        "mimeType": entry.mime_type,
        "sizeBytes": entry.size_bytes,
        "contentSha256": entry.content_sha256,
        "version": entry.version,
        "sourceMessageId": str(entry.source_message_id) if entry.source_message_id else None,
        "sourceChannelId": str(entry.source_channel_id) if entry.source_channel_id else None,
        "sourceThreadId": str(entry.source_thread_id) if entry.source_thread_id else None,
        "sourceTaskId": str(entry.source_task_id) if entry.source_task_id else None,
        "sourcePath": entry.source_path,
        "authorMemberId": str(entry.author_member_id) if entry.author_member_id else None,
        "visibility": entry.visibility,
        "metadata": entry.metadata_json or {},
        "createdAt": entry.created_at.isoformat() if entry.created_at else None,
        "updatedAt": entry.updated_at.isoformat() if entry.updated_at else None,
        "deletedAt": entry.deleted_at.isoformat() if entry.deleted_at else None,
    }


def serialize_memory_proposal(proposal: MemoryProposal) -> dict:
    return {
        "id": str(proposal.id),
        "serverId": str(proposal.server_id),
        "scopeType": proposal.scope_type,
        "scopeId": str(proposal.scope_id),
        "path": proposal.path,
        "baseEntryId": str(proposal.base_entry_id) if proposal.base_entry_id else None,
        "baseSha256": proposal.base_sha256,
        "proposedContentText": proposal.proposed_content_text,
        "authorMemberId": str(proposal.author_member_id),
        "reason": proposal.reason,
        "status": proposal.status,
        "reviewerMemberId": str(proposal.reviewer_member_id) if proposal.reviewer_member_id else None,
        "reviewNote": proposal.review_note,
        "metadata": proposal.metadata_json or {},
        "createdAt": proposal.created_at.isoformat() if proposal.created_at else None,
        "updatedAt": proposal.updated_at.isoformat() if proposal.updated_at else None,
        "resolvedAt": proposal.resolved_at.isoformat() if proposal.resolved_at else None,
    }


def _first_text(body: dict, *keys: str) -> str:
    for key in keys:
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _string_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    raise HTTPException(400, "Expected a string list")


def _format_task_summary_markdown(
    task: Task,
    final_summary: str,
    *,
    progress: str,
    evidence: list[str],
    artifacts: list[str],
    next_steps: list[str],
) -> str:
    lines = [
        f"# Task #{task.task_number} Final Summary",
        "",
        final_summary,
    ]
    if progress:
        lines.extend(["", "## Progress", "", progress])
    if evidence:
        lines.extend(["", "## Evidence", "", *[f"- {item}" for item in evidence]])
    if artifacts:
        lines.extend(["", "## Artifacts", "", *[f"- {item}" for item in artifacts]])
    if next_steps:
        lines.extend(["", "## Follow-ups", "", *[f"- {item}" for item in next_steps]])
    return "\n".join(lines).strip() + "\n"


def _merge_task_memory_data(existing: dict, memory: dict) -> dict:
    result = dict(existing)
    current_memory = dict(result.get("memory") or {})
    result["memory"] = {**current_memory, **{k: v for k, v in memory.items() if v is not None}}
    review = dict(result.get("review") or {})
    review.setdefault("state", "pending_review")
    result["review"] = review
    return result


async def _memory_entry_by_path(
    db: AsyncSession,
    server: Server,
    context: MemoryScopeContext,
    path: str,
) -> MemoryEntry | None:
    result = await db.execute(
        select(MemoryEntry).where(
            MemoryEntry.server_id == server.id,
            MemoryEntry.scope_type == context.scope.type,
            MemoryEntry.scope_id == context.scope.id,
            MemoryEntry.path == path,
            MemoryEntry.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def _resolve_channel_scope(db: AsyncSession, server: Server, value: str) -> Channel:
    parsed = _try_uuid(value)
    q = select(Channel).where(Channel.server_id == server.id)
    q = q.where(Channel.id == parsed) if parsed else q.where(Channel.name == value.lstrip("#"))
    result = await db.execute(q)
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(404, "Channel not found")
    return channel


async def _resolve_task_scope(db: AsyncSession, server: Server, value: str) -> Task:
    parsed = _try_uuid(value)
    q = select(Task).join(Channel).where(Channel.server_id == server.id)
    if parsed:
        q = q.where(Task.id == parsed)
    else:
        try:
            q = q.where(Task.task_number == int(value))
        except ValueError:
            raise HTTPException(400, "Invalid task id")
    result = await db.execute(q)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    return task


async def _resolve_thread_scope(db: AsyncSession, server: Server, value: str) -> Message:
    parsed = _parse_uuid(value, "thread scope id")
    result = await db.execute(
        select(Message)
        .join(Channel)
        .where(Message.id == parsed, Channel.server_id == server.id)
    )
    root = result.scalar_one_or_none()
    if not root:
        raise HTTPException(404, "Thread root not found")
    return root


async def _channel_by_id(db: AsyncSession, channel_id: uuid.UUID) -> Channel | None:
    result = await db.execute(select(Channel).where(Channel.id == channel_id))
    return result.scalar_one_or_none()


async def _is_channel_member(db: AsyncSession, channel_id: uuid.UUID, member_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(ChannelMember).where(ChannelMember.channel_id == channel_id, ChannelMember.member_id == member_id)
    )
    return result.scalar_one_or_none() is not None


async def ensure_scope_writable(db: AsyncSession, context: MemoryScopeContext, member: Member) -> None:
    if _member_has_memory_write_capability(member):
        return

    if context.scope.type == "agent":
        if str(context.scope.id) != str(member.id):
            raise HTTPException(403, "Agent memory is private")
        return

    if context.scope.type == "channel":
        if context.channel is None:
            raise HTTPException(404, "Channel not found")
        if await _is_channel_member(db, context.channel.id, member.id):
            return
        raise HTTPException(403, "Channel memory writes require channel membership")

    if context.scope.type == "task":
        if context.task is None:
            raise HTTPException(404, "Task not found")
        if _task_actor_can_view(context.task, member):
            return
        channel = context.channel
        if channel is not None and await _is_channel_member(db, channel.id, member.id):
            return
        raise HTTPException(403, "Task memory writes require task assignment, creator, or channel membership")

    if context.scope.type == "thread":
        if context.channel is None:
            raise HTTPException(404, "Thread channel not found")
        if await _is_channel_member(db, context.channel.id, member.id):
            return
        raise HTTPException(403, "Thread memory writes require channel membership")

    raise HTTPException(400, f"Unsupported memory scope: {context.scope.type}")


def _member_has_memory_write_capability(member: Member) -> bool:
    config = getattr(member, "config", None) or {}
    permissions = config.get("permissions") if isinstance(config, dict) else None
    if not isinstance(permissions, dict):
        return False
    return any(
        bool(permissions.get(key))
        for key in (
            "memory.write",
            "memoryWrite",
            "writeMemory",
            "channelMemory.write",
            "taskMemory.write",
        )
    )


def _task_actor_can_view(task: Task, viewer: Member) -> bool:
    return task.creator_id == viewer.id or task.assignee_id == viewer.id


def _try_uuid(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _parse_uuid(value: str, label: str) -> uuid.UUID:
    parsed = _try_uuid(value)
    if not parsed:
        raise HTTPException(400, f"Invalid {label}")
    return parsed


def _apply_source_ids(entry: MemoryEntry, body: dict, context: MemoryScopeContext) -> None:
    entry.source_channel_id = _try_uuid(str(body.get("sourceChannelId"))) if body.get("sourceChannelId") else (
        context.channel.id if context.channel else entry.source_channel_id
    )
    entry.source_task_id = _try_uuid(str(body.get("sourceTaskId"))) if body.get("sourceTaskId") else (
        context.task.id if context.task else entry.source_task_id
    )
    entry.source_thread_id = _try_uuid(str(body.get("sourceThreadId"))) if body.get("sourceThreadId") else (
        context.thread_root.id if context.thread_root else entry.source_thread_id
    )
    entry.source_message_id = _try_uuid(str(body.get("sourceMessageId"))) if body.get("sourceMessageId") else entry.source_message_id


def _memory_event_payload(entry: MemoryEntry, *, context: MemoryScopeContext) -> dict:
    channel_name = f"#{context.channel.name}" if context.channel and context.channel.kind == "public" else (
        context.channel.name if context.channel else None
    )
    return {
        "memoryId": str(entry.id),
        "scopeType": entry.scope_type,
        "scopeId": str(entry.scope_id),
        "path": entry.path,
        "contentSha256": entry.content_sha256,
        "version": entry.version,
        "channelId": str(context.channel.id) if context.channel else None,
        "channel": channel_name,
        "taskId": str(context.task.id) if context.task else None,
    }


def _add_memory_event(
    db: AsyncSession,
    server: Server,
    entry: MemoryEntry,
    *,
    author: Member | None,
    created: bool,
    context: MemoryScopeContext,
) -> None:
    db.add(EventRecord(
        server_id=server.id,
        event_type="memory.created" if created else "memory.updated",
        actor_id=author.id if author else None,
        channel_id=context.channel.id if context.channel else None,
        task_id=context.task.id if context.task else None,
        payload=_memory_event_payload(entry, context=context),
    ))


def _add_memory_proposal_event(
    db: AsyncSession,
    server: Server,
    proposal: MemoryProposal,
    *,
    author: Member,
    context: MemoryScopeContext,
) -> None:
    channel_name = f"#{context.channel.name}" if context.channel and context.channel.kind == "public" else (
        context.channel.name if context.channel else None
    )
    db.add(EventRecord(
        server_id=server.id,
        event_type="memory.proposal.created",
        actor_id=author.id,
        channel_id=context.channel.id if context.channel else None,
        task_id=context.task.id if context.task else None,
        payload={
            "proposalId": str(proposal.id),
            "scopeType": proposal.scope_type,
            "scopeId": str(proposal.scope_id),
            "path": proposal.path,
            "status": proposal.status,
            "channelId": str(context.channel.id) if context.channel else None,
            "channel": channel_name,
            "taskId": str(context.task.id) if context.task else None,
        },
    ))


def _add_memory_deleted_event(
    db: AsyncSession,
    server: Server,
    entry: MemoryEntry,
    author: Member,
    context: MemoryScopeContext,
) -> None:
    db.add(EventRecord(
        server_id=server.id,
        event_type="memory.deleted",
        actor_id=author.id,
        channel_id=context.channel.id if context.channel else None,
        task_id=context.task.id if context.task else None,
        payload=_memory_event_payload(entry, context=context),
    ))


def _add_memory_proposal_resolved_event(
    db: AsyncSession,
    server: Server,
    proposal: MemoryProposal,
    reviewer: Member,
    context: MemoryScopeContext,
) -> None:
    channel_name = f"#{context.channel.name}" if context.channel and context.channel.kind == "public" else (
        context.channel.name if context.channel else None
    )
    db.add(EventRecord(
        server_id=server.id,
        event_type="memory.proposal.resolved",
        actor_id=reviewer.id,
        channel_id=context.channel.id if context.channel else None,
        task_id=context.task.id if context.task else None,
        payload={
            "proposalId": str(proposal.id),
            "scopeType": proposal.scope_type,
            "scopeId": str(proposal.scope_id),
            "path": proposal.path,
            "status": proposal.status,
            "reviewerMemberId": str(reviewer.id),
            "channelId": str(context.channel.id) if context.channel else None,
            "channel": channel_name,
            "taskId": str(context.task.id) if context.task else None,
        },
    ))
