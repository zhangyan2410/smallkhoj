"""Agent API routes — daemon-facing endpoints under /internal/agent-api/."""

import asyncio
import hashlib
import hmac
import json
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import cast

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from config import settings
from models import (
    ActivityLog,
    AgentWorkspace,
    ApiKey,
    Channel,
    ChannelMember,
    Computer,
    ConnectTicket,
    EventRecord,
    FileEntry,
    Member,
    Message,
    MessageReaction,
    Reminder,
    Server,
    Task,
    TaskRun,
    ThreadSummary,
    async_session,
    get_db,
)
from routers.auth import resolve_agent, resolve_machine
from routers.serialization_prefetch import (
    UNSET,
    MessageSerializationContext,
    TaskSerializationContext,
    load_message_serialization_context,
    load_task_serialization_context,
)
from services.agent_permissions import (
    AGENT_PERMISSION_CAPABILITIES,
    agent_permissions_for_creation,
)
from services.channel_member_references import (
    load_agent_channel_roster,
    resolve_channel_mentions,
)
from services.channel_membership import (
    add_channel_member as add_channel_member_record,
)
from services.channel_membership import (
    remove_channel_member as remove_channel_member_record,
)
from services.daemon_control import (
    PENDING_RUNTIME_START_STATUS,
    daemon_control_hub,
    event_visible_to_agent,
    initial_daemon_event_cursor,
    mark_missing_runtimes_pending_start,
    pending_runtime_commands,
    push_latest_events_for_server,
)
from services.feishu_reply_orchestration import (
    send_task_run_feishu_terminal_reply,
    serialize_feishu_reply_orchestration_outcome,
)
from services.integration_runtime import (
    build_feishu_reply_dependencies,
    build_task_run_writeback_dependencies,
    close_feishu_reply_dependencies,
    close_task_run_writeback_dependencies,
)
from services.latency_trace import LatencyTrace, trace_id_from_request
from services.llm_run_leases import (
    acquire_run_lease,
    get_owned_run_lease,
    heartbeat_run_lease,
    release_run_lease,
    require_active_lease,
    serialize_run_lease,
)
from services.member_identity import MemberIdentityError, normalize_handle
from services.memory_api import (
    create_memory_proposal,
    delete_memory_entry,
    get_memory_entry,
    list_memory_entries,
    list_memory_proposals,
    promote_task_memory_to_channel,
    resolve_memory_proposal,
    resolve_memory_scope,
    search_memory,
    serialize_memory_entry,
    serialize_memory_proposal,
    write_memory_entry,
    write_task_memory_summary,
)
from services.memory_store import build_memory_context_manifest
from services.pagination import (
    PaginationCursorError,
    decode_task_cursor,
    decode_thread_cursor,
    encode_task_cursor,
    encode_thread_cursor,
)
from services.pi_llm_relay import (
    require_pi_runtime_member,
    resolve_pi_llm_config,
    validate_pi_relay_request,
)
from services.task_memory_request import add_task_memory_request_event, normalize_output_directions
from services.task_run_writeback import handle_terminal_task_run_writeback, serialize_task_run_writeback_outcome
from services.task_runs import (
    TERMINAL_TASK_RUN_STATUSES,
    create_task_assignment_and_run,
    serialize_task_run,
    update_task_run_lifecycle,
)
from services.thread_summary import (
    SUMMARY_MAX_CHARS,
    serialize_thread_summary,
    thread_participant_ids,
    thread_reply_count,
)
from services.upload_storage import (
    close_upload,
    rollback_and_cleanup_upload,
    stage_upload,
)

router = APIRouter(prefix="/internal/agent-api", tags=["agent-api"])
UPLOAD_ROOT = Path(__file__).resolve().parents[1] / ".data" / "uploads"
MAX_UPLOAD_SIZE = settings.upload_max_bytes
DAEMON_LEASE_SECONDS = 90


@dataclass(frozen=True)
class AgentEventStreamClaims:
    member_id: uuid.UUID
    server_id: uuid.UUID


async def resolve_agent_event_stream_claims(
    authorization: str = Header(..., alias="Authorization"),
    x_agent_id: str = Header(..., alias="X-Agent-Id"),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> AgentEventStreamClaims:
    member, server = await resolve_agent(
        authorization=authorization,
        x_agent_id=x_agent_id,
        db=db,
    )
    return AgentEventStreamClaims(member_id=member.id, server_id=server.id)


async def _load_agent_event_stream_entities(
    db: AsyncSession,
    claims: AgentEventStreamClaims,
) -> tuple[Member, Server]:
    member_result = await db.execute(
        select(Member).where(
            Member.id == claims.member_id,
            Member.origin_server_id == claims.server_id,
        )
    )
    member = member_result.scalar_one_or_none()
    server_result = await db.execute(select(Server).where(Server.id == claims.server_id))
    server = server_result.scalar_one_or_none()
    if member is None or server is None:
        raise HTTPException(401, "Agent event stream identity no longer exists")
    return member, server


async def _push_committed_events(db: AsyncSession, *, server_id: uuid.UUID) -> int:
    return await push_latest_events_for_server(db, server_id=server_id)


# ── Schemas ──────────────────────────────────────────────────

class SendRequest(BaseModel):
    target: str
    content: str
    threadId: str | None = None
    parentId: str | None = None
    seenUpToSeq: int | None = None
    traceId: str | None = None


class TaskClaimRequest(BaseModel):
    taskNumber: int | None = None
    messageId: str | None = None


class TaskUpdateRequest(BaseModel):
    status: str
    taskNumber: int | None = None


class TaskRunLifecycleRequest(BaseModel):
    status: str
    workspaceId: str | None = None
    runtimeSessionId: str | None = None
    workspaceSessionId: str | None = None
    contextSessionId: str | None = None
    contextUsage: dict | None = None
    tokenUsage: dict | None = None
    toolUsageSummary: dict | None = None
    outputMessageId: str | None = None
    failureCode: str | None = None
    failureReason: str | None = None


class DaemonWorkspacePayload(BaseModel):
    workspaceId: str | None = None
    id: str | None = None
    agentId: str | None = None
    agentHandle: str | None = None
    runtime: str = "claude_code"
    runtimeCommand: str | None = None
    runtimeModel: str | None = None
    runtimeProvider: str | None = None
    status: str = "running"
    sessionId: str | None = None
    cwd: str | None = None
    pid: int | None = None
    startedAt: str | None = None
    stoppedAt: str | None = None
    backend: str | None = None


class DaemonRegisterRequest(BaseModel):
    daemonId: str | None = None
    name: str | None = None
    os: str | None = None
    daemonVersion: str | None = None
    status: str = "online"
    detectedRuntimes: list | None = None
    workspaces: list[DaemonWorkspacePayload] = []


class DaemonHeartbeatRequest(BaseModel):
    daemonId: str | None = None
    daemonVersion: str | None = None
    status: str = "online"
    detectedRuntimes: list | None = None
    workspaces: list[DaemonWorkspacePayload] = []


class DaemonShutdownRequest(BaseModel):
    daemonId: str | None = None
    status: str = "offline"


class DaemonConnectRequest(BaseModel):
    daemonId: str | None = None
    machineId: str
    name: str | None = None
    os: str | None = None
    daemonVersion: str | None = None
    status: str = "online"
    detectedRuntimes: list | None = None


class LlmRunAcquireRequest(BaseModel):
    runId: str


class LlmRunReleaseRequest(BaseModel):
    runId: str
    failed: bool = False
    failureCode: str | None = None


def _utcnow() -> datetime:
    return datetime.utcnow()


def _utcnow_aware() -> datetime:
    return datetime.now(timezone.utc)


def _pi_member_computer_id(member: Member) -> uuid.UUID:
    raw = member.computer_id or (member.config or {}).get("computerId")
    try:
        return raw if isinstance(raw, uuid.UUID) else uuid.UUID(str(raw))
    except (TypeError, ValueError):
        raise HTTPException(409, "Pi Agent is not bound to a Computer")


def _validated_run_id(value: str) -> str:
    run_id = (value or "").strip()
    if not run_id or len(run_id) > 120 or not re.fullmatch(r"[A-Za-z0-9_.:-]+", run_id):
        raise HTTPException(400, "Invalid LLM run id")
    return run_id


def _parse_version_tuple(value: str | None) -> tuple[int, ...] | None:
    if not value:
        return None
    raw = value.strip()
    if raw.startswith("v"):
        raw = raw[1:]
    parsed: list[int] = []
    for part in raw.split("."):
        match = re.match(r"^(\d+)", part)
        if not match:
            return None
        parsed.append(int(match.group(1)))
    return tuple(parsed)


def _version_less_than(version: str, minimum: str) -> bool:
    parsed = _parse_version_tuple(version)
    parsed_minimum = _parse_version_tuple(minimum)
    if parsed is None or parsed_minimum is None:
        return True
    width = max(len(parsed), len(parsed_minimum))
    return parsed + (0,) * (width - len(parsed)) < parsed_minimum + (0,) * (width - len(parsed_minimum))


def _require_supported_daemon_version(version: str | None) -> None:
    minimum = settings.minimum_daemon_version.strip()
    if not minimum:
        return
    if not version or _version_less_than(version, minimum):
        current = version or "unknown"
        raise HTTPException(
            426,
            f"Unsupported daemon version {current}; minimum supported daemon version is {minimum}",
        )


def _now_for(value: datetime) -> datetime:
    return datetime.now(value.tzinfo) if value.tzinfo else _utcnow()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _lease_active(computer: Computer, now: datetime) -> bool:
    lease_expires_at = computer.daemon_lease_expires_at
    if lease_expires_at and lease_expires_at.tzinfo and now.tzinfo is None:
        now = datetime.now(lease_expires_at.tzinfo)
    return (
        computer.status in {"online", "active"}
        and computer.active_daemon_id is not None
        and lease_expires_at is not None
        and lease_expires_at > now
    )


def daemon_lease_conflict_detail(computer: Computer, now: datetime) -> dict[str, object]:
    """Return a machine-readable, actionable conflict without exposing a token."""
    expires_at = computer.daemon_lease_expires_at
    lease_now = _now_for(expires_at) if expires_at is not None else now
    retry_after = None
    if expires_at is not None:
        retry_after = max(1, int((expires_at - lease_now).total_seconds()))
    return {
        "reasonCode": "DAEMON_LEASE_ACTIVE",
        "message": "Computer already has an active daemon; stop it gracefully, wait for the lease to expire, then retry.",
        "computerId": str(computer.id),
        "activeDaemonId": computer.active_daemon_id,
        "leaseExpiresAt": expires_at.isoformat() if expires_at else None,
        "retryAfterSeconds": retry_after,
        "recoveryActions": ["stop", "wait", "retry"],
    }


def _daemon_lease_conflicts(computer: Computer, daemon_id: str | None, now: datetime) -> bool:
    return bool(
        daemon_id
        and computer.active_daemon_id
        and computer.active_daemon_id != daemon_id
        and _lease_active(computer, now)
    )


def _daemon_shutdown_can_release(computer: Computer, daemon_id: str | None) -> bool:
    return not computer.active_daemon_id or not daemon_id or computer.active_daemon_id == daemon_id


def _apply_daemon_ws_activity(computer: Computer, daemon_id: str | None, now: datetime) -> bool:
    if daemon_id and _daemon_lease_conflicts(computer, daemon_id, now):
        return False
    if not daemon_id and _lease_active(computer, now):
        return False
    computer.last_heartbeat_at = now
    computer.status = "online"
    if daemon_id:
        computer.active_daemon_id = daemon_id
    computer.daemon_lease_expires_at = now + timedelta(seconds=DAEMON_LEASE_SECONDS)
    return True


def _new_machine_token() -> str:
    return f"sk_machine_{secrets.token_urlsafe(32)}"


def _parse_datetime(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "Invalid datetime")


def _display_channel(channel: Channel) -> str:
    if channel.kind in {"public", "private"}:
        return f"#{channel.name}"
    return channel.name


def _normalize_channel_name(target: str) -> str:
    return target.lstrip("#")


def _split_thread_target(target: str) -> tuple[str, str | None]:
    if target.startswith("#"):
        body = target[1:]
        if ":" in body:
            channel, thread_ref = body.rsplit(":", 1)
            if channel and thread_ref:
                return f"#{channel}", thread_ref
    if target.startswith("dm:"):
        body = target[3:]
        if ":" in body:
            peer, thread_ref = body.rsplit(":", 1)
            if peer and thread_ref:
                return f"dm:{peer}", thread_ref
    return target, None


def _dm_channel_name(member: Member, peer: Member) -> str:
    return f"dm:{min(str(member.id), str(peer.id))}-{max(str(member.id), str(peer.id))}"


EVENT_TYPE_ALIASES = {
    "message.created": "message_received",
    "task.created": "task_created",
    "task.claimed": "task_claimed",
    "task.updated": "task_updated",
    "task.memory_requested": "task_memory_requested",
    "task.unclaimed": "task_updated",
    "member.updated": "member_updated",
    "member.profile_updated": "member_profile_updated",
    "message.reaction_added": "message_reaction_added",
    "message.reaction_removed": "message_reaction_removed",
    "channel.member_joined": "channel_member_joined",
    "channel.member_left": "channel_member_left",
    "workspace.registered": "workspace_registered",
    "workspace.updated": "workspace_updated",
    "workspace.heartbeat": "workspace_heartbeat",
    "reminder.fired": "reminder_fired",
    "reminder.created": "reminder_created",
    "reminder.updated": "reminder_updated",
    "integration.connected": "integration_connected",
    "thread.followed": "thread_followed",
    "thread.unfollowed": "thread_unfollowed",
    "thread.summary_requested": "thread_summary_requested",
    "thread.summary_updated": "thread_summary_updated",
}


LEGACY_EVENT_TYPES = {value: key for key, value in EVENT_TYPE_ALIASES.items()}


VALID_TASK_TRANSITIONS = {
    "todo": {"in_progress", "closed"},
    "in_progress": {"in_review", "todo"},
    "in_review": {"done", "in_progress"},
    "done": {"closed"},
    "closed": set(),
}


async def _resolve_dm_channel(
    db: AsyncSession,
    server: Server,
    member: Member,
    target: str,
    create: bool = False,
) -> Channel:
    peer_name = target.replace("dm:", "", 1).lstrip("@")
    if not peer_name:
        raise HTTPException(400, "Missing DM peer")
    try:
        peer_identity = normalize_handle(peer_name)
    except MemberIdentityError as error:
        raise HTTPException(404, f"Peer {peer_name} not found") from error

    peer_result = await db.execute(
        select(Member).where(
            Member.origin_server_id == server.id,
            Member.handle_key == peer_identity.handle_key,
            Member.deleted_at.is_(None),
        )
    )
    peer = peer_result.scalar_one_or_none()
    if not peer:
        raise HTTPException(404, f"Peer {peer_name} not found")

    channel_name = _dm_channel_name(member, peer)
    dm_result = await db.execute(
        select(Channel).where(
            Channel.server_id == server.id,
            Channel.kind == "dm",
            Channel.name == channel_name,
        )
    )
    channel = dm_result.scalar_one_or_none()
    if channel or not create:
        if channel:
            return channel
        raise HTTPException(404, f"DM {target} not found")

    channel = Channel(
        server_id=server.id,
        name=channel_name,
        kind="dm",
        creator_id=member.id,
    )
    db.add(channel)
    await db.flush()
    await add_channel_member_record(
        db,
        channel_id=channel.id,
        member_id=member.id,
        actor_id=member.id,
    )
    await add_channel_member_record(
        db,
        channel_id=channel.id,
        member_id=peer.id,
        actor_id=member.id,
    )
    return channel


async def _member_can_use_channel(
    db: AsyncSession,
    channel: Channel,
    member: Member | None,
    *,
    allow_public_unjoined: bool = False,
) -> bool:
    if channel.kind == "public" and allow_public_unjoined:
        return True
    if not member:
        return False
    result = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel.id,
            ChannelMember.member_id == member.id,
        )
    )
    return result.scalar_one_or_none() is not None


async def _resolve_existing_channel_ref(
    db: AsyncSession,
    server: Server,
    target: str,
    member: Member | None = None,
    allow_public_unjoined: bool = False,
) -> Channel | None:
    channel_name = _normalize_channel_name(target)
    parsed_channel_id = None
    try:
        parsed_channel_id = uuid.UUID(channel_name)
    except ValueError:
        pass

    if parsed_channel_id:
        result = await db.execute(
            select(Channel).where(
                Channel.server_id == server.id,
                Channel.id == parsed_channel_id,
            )
        )
        channel = result.scalar_one_or_none()
        if channel:
            if not await _member_can_use_channel(
                db,
                channel,
                member,
                allow_public_unjoined=allow_public_unjoined,
            ):
                raise HTTPException(403, f"Agent cannot access channel {target}")
            return channel

    result = await db.execute(
        select(Channel).where(
            Channel.server_id == server.id,
            Channel.name == channel_name,
        )
    )
    channel = result.scalar_one_or_none()
    if not channel:
        return None
    if not await _member_can_use_channel(
        db,
        channel,
        member,
        allow_public_unjoined=allow_public_unjoined,
    ):
        raise HTTPException(403, f"Agent cannot access channel {target}")
    return channel


async def _resolve_channel(
    db: AsyncSession,
    server: Server,
    target: str,
    member: Member | None = None,
    create_dm: bool = False,
    allow_public_unjoined: bool = False,
) -> Channel:
    channel = await _resolve_existing_channel_ref(
        db,
        server,
        target,
        member=member,
        allow_public_unjoined=allow_public_unjoined,
    )
    if channel:
        return channel

    if target.startswith("dm:"):
        if not member:
            raise HTTPException(400, "DM target requires an agent context")
        return await _resolve_dm_channel(db, server, member, target, create=create_dm)

    raise HTTPException(404, f"Channel {target} not found")


async def _resolve_message_ref(
    db: AsyncSession,
    server: Server,
    message_ref: str,
) -> Message:
    try:
        parsed_id = uuid.UUID(message_ref)
    except ValueError:
        parsed_id = None

    if parsed_id:
        result = await db.execute(
            select(Message).join(Channel).where(
                Channel.server_id == server.id,
                Message.id == parsed_id,
            )
        )
        message = result.scalar_one_or_none()
        if message:
            return message

    result = await db.execute(
        select(Message).join(Channel).where(
            Channel.server_id == server.id,
            Message.short_id == message_ref,
        )
    )
    message = result.scalar_one_or_none()
    if message:
        return message

    raise HTTPException(404, f"Message {message_ref} not found")


async def _resolve_member_by_handle(db: AsyncSession, server: Server, handle: str | None) -> Member | None:
    if not handle:
        return None
    raw_name = handle.lstrip("@")
    try:
        identity = normalize_handle(raw_name)
    except MemberIdentityError as error:
        raise HTTPException(404, f"Member {handle} not found") from error
    result = await db.execute(
        select(Member).where(
            Member.origin_server_id == server.id,
            Member.handle_key == identity.handle_key,
            Member.deleted_at.is_(None),
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(404, f"Member {handle} not found")
    return member


async def _parse_mentions(db: AsyncSession, channel: Channel, content: str) -> list[uuid.UUID]:
    roster = await load_agent_channel_roster(db, channel_id=channel.id)
    return resolve_channel_mentions(content, roster)


async def _message_target_for_member(
    db: AsyncSession,
    channel: Channel,
    recipient: Member,
    *,
    thread_ref: str | None = None,
) -> str:
    if channel.kind in {"public", "private"}:
        base = _display_channel(channel)
    elif channel.kind == "dm":
        peer_result = await db.execute(
            select(Member)
            .join(ChannelMember, ChannelMember.member_id == Member.id)
            .where(
                ChannelMember.channel_id == channel.id,
                Member.id != recipient.id,
                Member.deleted_at.is_(None),
            )
            .order_by(Member.kind.desc(), Member.handle)
            .limit(1)
        )
        peer = peer_result.scalar_one_or_none()
        base = f"dm:@{peer.handle}" if peer else channel.name
    else:
        base = _display_channel(channel)
    return f"{base}:{thread_ref}" if thread_ref else base


def _legacy_event_type(event_type: str) -> str:
    return EVENT_TYPE_ALIASES.get(event_type, event_type.replace(".", "_"))


def _dotted_event_type(event_type: str) -> str:
    return LEGACY_EVENT_TYPES.get(event_type, event_type)


def _validate_task_transition(current_status: str, new_status: str) -> None:
    if current_status == new_status:
        return
    allowed = VALID_TASK_TRANSITIONS.get(current_status, set())
    if new_status not in allowed:
        raise HTTPException(
            409,
            f"Invalid task transition: {current_status} -> {new_status}",
        )


def _ensure_agent_owns_task(member: Member, task: Task) -> None:
    if task.assignee_id != member.id:
        raise HTTPException(403, "Agent can only operate on tasks it owns")


def _is_agent_allowed_task_status(status: str) -> bool:
    return status in {"in_progress", "todo", "in_review"}


async def _resolve_workspace_agent(
    db: AsyncSession,
    server: Server,
    item: DaemonWorkspacePayload,
) -> Member:
    if item.agentId:
        try:
            parsed_agent_id = uuid.UUID(item.agentId)
        except ValueError:
            raise HTTPException(400, "Invalid agentId")
        result = await db.execute(
            select(Member).where(
                Member.id == parsed_agent_id,
                Member.origin_server_id == server.id,
                Member.kind == "agent",
            )
        )
        agent = result.scalar_one_or_none()
        if agent:
            return agent
        raise HTTPException(404, f"Agent {item.agentId} not found")

    agent = await _resolve_member_by_handle(db, server, item.agentHandle)
    if agent and agent.kind == "agent":
        return agent
    raise HTTPException(400, "Missing agentId or agentHandle")


async def _serialize_task(
    db: AsyncSession,
    task: Task,
    *,
    _context: TaskSerializationContext | object = UNSET,
) -> dict:
    if _context is UNSET:
        channel_result = await db.execute(select(Channel).where(Channel.id == task.channel_id))
        channel = channel_result.scalar_one_or_none()
        creator_result = await db.execute(select(Member).where(Member.id == task.creator_id))
        creator = creator_result.scalar_one_or_none()
        assignee = None
        if task.assignee_id:
            assignee_result = await db.execute(select(Member).where(Member.id == task.assignee_id))
            assignee = assignee_result.scalar_one_or_none()
        runs_result = await db.execute(
            select(TaskRun).where(TaskRun.task_id == task.id).order_by(TaskRun.created_at.desc())
        )
        runs = list(runs_result.scalars().all())
    else:
        context = cast(TaskSerializationContext, _context)
        channel = context.channels.get(task.channel_id)
        creator = context.members.get(task.creator_id)
        assignee = context.members.get(task.assignee_id) if task.assignee_id else None
        runs = context.runs.get(task.id, [])

    return {
        "id": str(task.id),
        "number": task.task_number,
        "taskNumber": task.task_number,
        "channel": _display_channel(channel) if channel else None,
        "channelId": str(task.channel_id),
        "messageId": str(task.message_id) if task.message_id else None,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "creator": f"@{creator.handle}" if creator else None,
        "creatorId": str(task.creator_id),
        "assignee": f"@{assignee.handle}" if assignee else None,
        "assigneeId": str(task.assignee_id) if task.assignee_id else None,
        "runs": [serialize_task_run(run) for run in runs],
        "data": task.data or {},
        "createdAt": task.created_at.isoformat() if task.created_at else None,
        "updatedAt": task.updated_at.isoformat() if task.updated_at else None,
    }


async def _next_task_number(db: AsyncSession, channel_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Task.task_number), 0)).where(Task.channel_id == channel_id)
    )
    return (result.scalar() or 0) + 1


async def _resolve_task_by_id(db: AsyncSession, server: Server, task_id: str) -> Task:
    try:
        parsed_task_id = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(400, "Invalid task id")

    result = await db.execute(
        select(Task).join(Channel).where(
            Task.id == parsed_task_id,
            Channel.server_id == server.id,
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    return task


def _apply_agent_status_transition(task: Task, new_status: str, member: Member) -> tuple[str, str]:
    if new_status not in VALID_TASK_TRANSITIONS:
        raise HTTPException(400, f"Invalid status: {new_status}")
    _ensure_agent_owns_task(member, task)
    old_status = task.status
    if old_status == new_status:
        return old_status, new_status
    if (old_status, new_status) not in {
        ("todo", "in_progress"),
        ("in_progress", "todo"),
        ("in_progress", "in_review"),
    }:
        raise HTTPException(403, f"Agent cannot change task status from {old_status} to {new_status}")
    if not _is_agent_allowed_task_status(new_status):
        raise HTTPException(403, f"Agent cannot set task status to {new_status}")
    _validate_task_transition(old_status, new_status)
    task.status = new_status
    if new_status == "todo":
        task.assignee_id = None
    return old_status, new_status


async def _serialize_message(
    db: AsyncSession,
    msg: Message,
    *,
    _context: MessageSerializationContext | object = UNSET,
) -> dict:
    if _context is UNSET:
        channel_result = await db.execute(select(Channel).where(Channel.id == msg.channel_id))
        channel = channel_result.scalar_one_or_none()
        sender_result = await db.execute(select(Member).where(Member.id == msg.sender_id))
        sender = sender_result.scalar_one_or_none()
        reply_count_result = await db.execute(
            select(func.count()).select_from(Message).where(Message.parent_id == msg.id)
        )
        reply_count = int(reply_count_result.scalar() or 0)
    else:
        context = cast(MessageSerializationContext, _context)
        channel = context.channels.get(msg.channel_id)
        sender = context.members.get(msg.sender_id)
        reply_count = context.reply_counts.get(msg.id, 0)
    thread_root_id = msg.parent_id or msg.id
    reactions = await _serialize_reactions(db, msg.id, _context=_context)

    return {
        "id": str(msg.id),
        "messageId": str(msg.id),
        "shortId": msg.short_id,
        "seq": msg.seq,
        "channelId": str(msg.channel_id),
        "channel": _display_channel(channel) if channel else None,
        "senderId": str(msg.sender_id),
        "sender": f"@{sender.handle}" if sender else "unknown",
        "senderType": sender.kind if sender else "unknown",
        "content": msg.content,
        "mentions": [str(item) for item in (msg.mentions or [])],
        "parentId": str(msg.parent_id) if msg.parent_id else None,
        "threadId": str(thread_root_id),
        "threadRootId": str(thread_root_id),
        "replyCount": reply_count,
        "reactions": reactions["items"],
        "reactionCounts": reactions["counts"],
        "channelType": "thread" if msg.parent_id else msg.channel_type,
        "createdAt": msg.created_at.isoformat() if msg.created_at else None,
        "updatedAt": msg.updated_at.isoformat() if msg.updated_at else None,
    }


async def _serialize_reactions(
    db: AsyncSession,
    message_id: uuid.UUID,
    *,
    _context: MessageSerializationContext | object = UNSET,
) -> dict:
    if _context is UNSET:
        reactions_result = await db.execute(
            select(MessageReaction).where(MessageReaction.message_id == message_id)
            .order_by(MessageReaction.created_at)
        )
        reactions = list(reactions_result.scalars().all())
        members = None
    else:
        context = cast(MessageSerializationContext, _context)
        reactions = context.reactions.get(message_id, [])
        members = context.members

    items = []
    counts: dict[str, int] = {}
    for reaction in reactions:
        if members is None:
            member_result = await db.execute(select(Member).where(Member.id == reaction.member_id))
            member = member_result.scalar_one_or_none()
        else:
            member = members.get(reaction.member_id)
        counts[reaction.reaction] = counts.get(reaction.reaction, 0) + 1
        items.append({
            "id": str(reaction.id),
            "reaction": reaction.reaction,
            "memberId": str(reaction.member_id),
            "member": f"@{member.handle}" if member else None,
            "createdAt": reaction.created_at.isoformat() if reaction.created_at else None,
        })

    return {"items": items, "counts": counts}


async def _visible_channel_ids(db: AsyncSession, member: Member) -> list[uuid.UUID]:
    result = await db.execute(
        select(ChannelMember.channel_id).where(ChannelMember.member_id == member.id)
    )
    return [row[0] for row in result.all()]


def _message_event(msg: Message) -> dict:
    return {
        "type": "message.created",
        "legacyType": "message_received",
        "seq": msg.seq,
        "messageId": str(msg.id),
        "shortId": msg.short_id,
        "senderId": str(msg.sender_id),
        "content": msg.content,
        "channelId": str(msg.channel_id),
        "channelType": msg.channel_type,
        "mentions": [str(item) for item in (msg.mentions or [])],
        "parentId": str(msg.parent_id) if msg.parent_id else None,
        "threadId": str(msg.parent_id or msg.id),
        "createdAt": msg.created_at.isoformat() if msg.created_at else None,
    }


ACTIVITY_EVENT_TYPES = {
    "message_sent": "message.created",
    "supervisor_message_sent": "message.created",
    "task_created": "task.created",
    "task_claimed": "task.claimed",
    "task_unclaimed": "task.unclaimed",
    "task_status_changed": "task.updated",
    "task_updated": "task.updated",
    "supervisor_task_created": "task.created",
    "supervisor_task_updated": "task.updated",
    "supervisor_member_updated": "member.updated",
    "message_reaction_added": "message.reaction_added",
    "message_reaction_removed": "message.reaction_removed",
    "channel_joined": "channel.member_joined",
    "channel_left": "channel.member_left",
    "workspace_registered": "workspace.registered",
    "workspace_updated": "workspace.updated",
    "reminder_fired": "reminder.fired",
    "profile_updated": "member.profile_updated",
    "integration_connected": "integration.connected",
    "thread_followed": "thread.followed",
    "thread_unfollowed": "thread.unfollowed",
}


def _activity_cursor_value(activity: ActivityLog) -> str:
    timestamp = activity.occurred_at.isoformat() if activity.occurred_at else ""
    return f"{timestamp}|{activity.id}"


def _activity_cursor_filter(cursor: str | None):
    if not cursor:
        return None
    timestamp = cursor.split("|", 1)[0]
    if not timestamp:
        return None
    try:
        return _parse_datetime(timestamp)
    except HTTPException:
        return None


def _activity_event(activity: ActivityLog) -> dict:
    event_type = ACTIVITY_EVENT_TYPES.get(activity.kind, activity.kind)
    return {
        "type": event_type,
        "legacyType": _legacy_event_type(event_type),
        "activityId": str(activity.id),
        "actorId": str(activity.agent_id),
        "agentId": str(activity.agent_id),
        "channelId": str(activity.channel_id) if activity.channel_id else None,
        "taskId": str(activity.task_id) if activity.task_id else None,
        "description": activity.description,
        "details": activity.details or {},
        "occurredAt": activity.occurred_at.isoformat() if activity.occurred_at else None,
        "activityCursor": _activity_cursor_value(activity),
    }


async def _event_record_event(db: AsyncSession, record: EventRecord, recipient: Member) -> dict:
    payload = dict(record.payload or {})
    event_type = _dotted_event_type(record.event_type)
    payload["type"] = event_type
    payload["legacyType"] = payload.get("legacyType") or _legacy_event_type(event_type)
    payload["eventId"] = str(record.id)
    payload["eventSeq"] = record.seq
    payload["eventCursor"] = str(record.seq)
    payload["eventLogCursor"] = str(record.seq)
    payload["actorId"] = str(record.actor_id) if record.actor_id else payload.get("actorId")
    payload["agentId"] = str(record.actor_id) if record.actor_id else payload.get("agentId") or payload.get("targetAgentId")
    payload["channelId"] = str(record.channel_id) if record.channel_id else payload.get("channelId")
    payload["taskId"] = str(record.task_id) if record.task_id else payload.get("taskId")
    payload["messageId"] = str(record.message_id) if record.message_id else payload.get("messageId")
    payload["createdAt"] = record.created_at.isoformat() if record.created_at else payload.get("createdAt")
    payload["activityCursor"] = str(record.seq)
    if event_type == "message.created":
        await _backfill_message_event_target(db, payload, record, recipient)
    return payload


async def _backfill_message_event_target(
    db: AsyncSession,
    payload: dict,
    record: EventRecord,
    recipient: Member,
) -> None:
    """Recover reply-safe runtime targets for historical message event records."""
    raw_target = str(payload.get("target") or payload.get("channel") or "")
    if record.message_id is None:
        return

    result = await db.execute(
        select(Message, Channel).join(Channel, Channel.id == Message.channel_id).where(
            Message.id == record.message_id,
        )
    )
    row = result.one_or_none()
    if not row:
        return

    msg, channel = row
    root = msg
    if msg.parent_id:
        root_result = await db.execute(select(Message).where(Message.id == msg.parent_id))
        root = root_result.scalar_one_or_none() or msg

    thread_ref = root.short_id if msg.parent_id else None
    event_target = await _message_target_for_member(db, channel, recipient, thread_ref=thread_ref)
    if not raw_target or (thread_ref and not raw_target.endswith(f":{thread_ref}")):
        payload["target"] = event_target
        payload["channel"] = event_target


def _event_record_message_seq(record: EventRecord) -> int | None:
    if _dotted_event_type(record.event_type) != "message.created":
        return None
    payload = record.payload or {}
    raw_seq = payload.get("seq") or payload.get("messageSeq")
    try:
        return int(raw_seq)
    except (TypeError, ValueError):
        return None


async def _visible_event_records(
    db: AsyncSession,
    server: Server,
    member: Member,
    channel_ids: list[uuid.UUID],
    event_cursor: str | None,
    limit: int = 100,
) -> list[EventRecord]:
    query = select(EventRecord).where(
        EventRecord.server_id == server.id,
    )
    if event_cursor:
        try:
            query = query.where(EventRecord.seq > int(event_cursor))
        except (TypeError, ValueError):
            query = query.where(EventRecord.seq > 0)

    visibility = [
        EventRecord.channel_id.is_(None),
        EventRecord.payload["removedAgentId"].as_string() == str(member.id),
    ]
    if channel_ids:
        visibility.append(EventRecord.channel_id.in_(channel_ids))
    query = query.where(or_(*visibility))

    result = await db.execute(query.order_by(EventRecord.seq).limit(limit))
    records = result.scalars().all()
    visible = []
    for record in records:
        if not event_visible_to_agent(record, member, set(channel_ids)):
            continue
        visible.append(record)
    return visible


def _thread_subscription_config(member: Member) -> dict:
    config = member.config or {}
    subscriptions = config.get("threadSubscriptions") or {}
    if not isinstance(subscriptions, dict):
        return {}
    return subscriptions


def _unfollowed_thread_ids(member: Member) -> set[str]:
    raw = _thread_subscription_config(member).get("unfollowed") or []
    if not isinstance(raw, list):
        return set()
    return {str(item) for item in raw if item}


def _is_thread_following(member: Member, root_id: uuid.UUID | str) -> bool:
    return str(root_id) not in _unfollowed_thread_ids(member)


def _should_suppress_thread_event(member: Member, record: EventRecord) -> bool:
    if _dotted_event_type(record.event_type) != "message.created":
        return False
    payload = record.payload or {}
    if not payload.get("parentId"):
        return False
    thread_id = payload.get("threadId")
    return bool(thread_id and str(thread_id) in _unfollowed_thread_ids(member))


def _set_thread_following(member: Member, root_id: uuid.UUID, following: bool) -> None:
    config = dict(member.config or {})
    subscriptions = dict(config.get("threadSubscriptions") or {})
    unfollowed = [str(item) for item in subscriptions.get("unfollowed") or [] if item]
    root = str(root_id)
    if following:
        unfollowed = [item for item in unfollowed if item != root]
    elif root not in unfollowed:
        unfollowed.append(root)
    subscriptions["unfollowed"] = sorted(unfollowed)
    config["threadSubscriptions"] = subscriptions
    member.config = config


def _sse_frame(event: str, data: dict, event_id: str | None = None) -> str:
    lines = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    lines.append(f"data: {json.dumps(data, separators=(',', ':'))}")
    return "\n".join(lines) + "\n\n"


def _serialize_member(member: Member) -> dict:
    config = member.config or {}
    workspace_id = config.get("workspaceId")
    if member.kind == "agent" and member.workspaces:
        latest_workspace = max(member.workspaces, key=lambda item: item.updated_at)
        workspace_id = str(latest_workspace.id)
    payload = {
        "id": str(member.id),
        "name": member.handle,
        "handle": member.handle,
        "reference": f"@{member.handle}",
        "kind": member.kind,
        "status": member.status,
        "avatarUrl": member.avatar_url,
        "skills": member.skills or [],
        "config": config,
        "computerId": str(member.computer_id) if member.computer_id else config.get("computerId"),
        "workspaceId": workspace_id,
        "backend": member.backend or config.get("backend"),
        "runtimeProvider": config.get("runtimeProvider"),
        "permissions": config.get("permissions") or {},
        "actions": config.get("actions") or {},
    }
    if member.kind == "agent":
        payload["description"] = member.description
    return payload


def _public_runtime(value: str | None) -> str:
    raw = (str(value).strip().lower() if value else "") or "claude_code"
    if raw in {"codex", "codex_cli", "codex-acp", "codex_acp"}:
        return "codex"
    if raw in {"claude", "claude_code"}:
        return "claude_code"
    return raw


async def _serialize_workspace(db: AsyncSession, workspace: AgentWorkspace) -> dict:
    agent_result = await db.execute(select(Member).where(Member.id == workspace.agent_id))
    agent = agent_result.scalar_one_or_none()
    return {
        "id": str(workspace.id),
        "computerId": str(workspace.computer_id),
        "agentId": str(workspace.agent_id),
        "agentName": agent.handle if agent else None,
        "runtime": _public_runtime(workspace.runtime),
        "runtimeCommand": workspace.runtime_command,
        "runtimeModel": workspace.runtime_model,
        "runtimeProvider": (agent.config or {}).get("runtimeProvider") if agent else None,
        "status": workspace.status,
        "sessionId": workspace.session_id,
        "cwd": workspace.cwd,
        "pid": workspace.pid,
        "startedAt": workspace.started_at.isoformat() if workspace.started_at else None,
        "stoppedAt": workspace.stopped_at.isoformat() if workspace.stopped_at else None,
    }


async def _serialize_computer(db: AsyncSession, computer: Computer) -> dict:
    workspaces_result = await db.execute(
        select(AgentWorkspace).where(AgentWorkspace.computer_id == computer.id)
    )
    workspaces = workspaces_result.scalars().all()
    status = computer.status
    if (
        computer.daemon_lease_expires_at
        and computer.daemon_lease_expires_at <= _now_for(computer.daemon_lease_expires_at)
        and status in {"online", "active"}
    ):
        status = "offline"
    return {
        "id": str(computer.id),
        "serverId": str(computer.server_id),
        "name": computer.name,
        "machineId": computer.machine_id,
        "os": computer.os,
        "daemonVersion": computer.daemon_version,
        "apiKeyPrefix": computer.api_key_prefix,
        "status": status,
        "activeDaemonId": computer.active_daemon_id,
        "daemonLeaseExpiresAt": computer.daemon_lease_expires_at.isoformat() if computer.daemon_lease_expires_at else None,
        "detectedRuntimes": computer.detected_runtimes or [],
        "agentWorkspaces": [await _serialize_workspace(db, workspace) for workspace in workspaces],
        "createdAt": computer.created_at.isoformat() if computer.created_at else None,
        "updatedAt": computer.updated_at.isoformat() if computer.updated_at else None,
        "lastHeartbeatAt": computer.last_heartbeat_at.isoformat() if computer.last_heartbeat_at else None,
    }


async def _upsert_daemon_workspace(
    db: AsyncSession,
    server: Server,
    computer: Computer,
    item: DaemonWorkspacePayload,
) -> tuple[AgentWorkspace, Member, bool]:
    agent_member = await _resolve_workspace_agent(db, server, item)
    workspace_ref = item.workspaceId or item.id
    workspace = None

    if workspace_ref:
        try:
            parsed_workspace_id = uuid.UUID(workspace_ref)
        except ValueError:
            raise HTTPException(400, "Invalid workspaceId")
        result = await db.execute(
            select(AgentWorkspace).where(
                AgentWorkspace.id == parsed_workspace_id,
                AgentWorkspace.computer_id == computer.id,
            )
        )
        workspace = result.scalar_one_or_none()

    runtime = _public_runtime(item.runtime)

    if workspace is None:
        query = select(AgentWorkspace).where(
            AgentWorkspace.computer_id == computer.id,
            AgentWorkspace.agent_id == agent_member.id,
            AgentWorkspace.runtime == runtime,
        )
        if item.cwd:
            query = query.where(AgentWorkspace.cwd == item.cwd)
        result = await db.execute(query.order_by(AgentWorkspace.updated_at.desc()).limit(1))
        workspace = result.scalar_one_or_none()

    created = workspace is None
    previous_runtime_state = None
    if workspace is not None:
        previous_runtime_state = (
            workspace.runtime,
            workspace.runtime_command,
            workspace.runtime_model,
            workspace.status,
            workspace.session_id,
            workspace.cwd,
            workspace.pid,
        )
    if workspace is None:
        workspace = AgentWorkspace(
            id=uuid.UUID(workspace_ref) if workspace_ref else uuid.uuid4(),
            computer_id=computer.id,
            agent_id=agent_member.id,
            runtime=runtime,
        )
        db.add(workspace)

    workspace.runtime = runtime
    workspace.runtime_command = None if runtime == "codex" else item.runtimeCommand
    workspace.runtime_model = item.runtimeModel
    workspace.status = item.status
    workspace.session_id = item.sessionId or workspace.session_id
    workspace.cwd = item.cwd if item.cwd is not None else workspace.cwd
    if item.status in {"stopped", "offline", "exited"}:
        workspace.pid = None
    elif item.pid is not None:
        workspace.pid = item.pid
    if item.startedAt:
        workspace.started_at = _parse_datetime(item.startedAt)
    elif workspace.started_at is None and item.status in {"running", "active", "idle"}:
        workspace.started_at = _utcnow()
    if item.stoppedAt:
        workspace.stopped_at = _parse_datetime(item.stoppedAt)
    elif item.status in {"stopped", "offline", "exited"}:
        workspace.stopped_at = _utcnow()

    config = {
        **(agent_member.config or {}),
        "computerId": str(computer.id),
        "workspaceId": str(workspace.id),
    }
    if item.backend:
        config["backend"] = item.backend
    if item.runtimeProvider:
        config["runtimeProvider"] = item.runtimeProvider
    agent_member.config = config
    agent_member.computer_id = computer.id
    if item.backend:
        agent_member.backend = item.backend
    previous_member_status = agent_member.status
    if item.status in {"running", "active", "idle"}:
        agent_member.status = "online"
    elif item.status in {"stopped", "offline", "exited"}:
        agent_member.status = "offline"
    # Surface the status change to the caller (daemon_heartbeat) so it can emit
    # a member.updated event — mirrors the _smallkhoj_realtime_changed pattern below.
    agent_member._smallkhoj_member_status_changed = (
        previous_member_status != agent_member.status
    )
    agent_member._smallkhoj_previous_member_status = previous_member_status

    current_runtime_state = (
        workspace.runtime,
        workspace.runtime_command,
        workspace.runtime_model,
        workspace.status,
        workspace.session_id,
        workspace.cwd,
        workspace.pid,
    )
    workspace._smallkhoj_realtime_changed = bool(
        previous_runtime_state is not None and previous_runtime_state != current_runtime_state
    )

    return workspace, agent_member, created


async def _record_activity(
    db: AsyncSession,
    server: Server,
    agent: Member,
    kind: str,
    description: str,
    details: dict | None = None,
    channel_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
) -> ActivityLog:
    activity = ActivityLog(
        server_id=server.id,
        agent_id=agent.id,
        kind=kind,
        description=description,
        details=details or {},
        channel_id=channel_id,
        task_id=task_id,
    )
    db.add(activity)
    await db.flush()

    event_type = ACTIVITY_EVENT_TYPES.get(kind)
    if event_type:
        event_details = details or {}
        message_id = None
        raw_message_id = event_details.get("messageId") or event_details.get("message_id")
        if raw_message_id:
            try:
                message_id = uuid.UUID(str(raw_message_id))
            except ValueError:
                message_id = None
        payload = _activity_event(activity)
        payload.update({key: value for key, value in event_details.items() if key not in payload or payload[key] is None})
        db.add(EventRecord(
            server_id=server.id,
            event_type=event_type,
            actor_id=agent.id,
            channel_id=channel_id,
            task_id=task_id,
            message_id=message_id,
            payload=payload,
        ))
    return activity


async def _record_computer_status_event(
    db: AsyncSession,
    server: Server,
    computer: Computer,
    *,
    action: str,
    previous_status: str | None = None,
) -> None:
    db.add(EventRecord(
        server_id=server.id,
        event_type="computer.status.updated",
        actor_id=None,
        payload={
            "type": "computer.status.updated",
            "legacyType": "computer_status_updated",
            "computerId": str(computer.id),
            "computerName": computer.name,
            "status": computer.status,
            "previousStatus": previous_status,
            "action": action,
            "daemonId": computer.active_daemon_id,
            "leaseExpiresAt": computer.daemon_lease_expires_at.isoformat() if computer.daemon_lease_expires_at else None,
            "lastHeartbeatAt": computer.last_heartbeat_at.isoformat() if computer.last_heartbeat_at else None,
        },
    ))


async def _record_member_status_event(
    db: AsyncSession,
    server: Server,
    member: Member,
    *,
    previous_status: str | None,
    action: str,
) -> None:
    """Push a member.updated event when an agent's status changes via daemon lifecycle.

    Uses a bare EventRecord (not _record_activity) to avoid polluting the supervisor
    activity feed with "@agent updated @agent" spam on every heartbeat/shutdown.
    Mirrors _record_computer_status_event's pattern. Frontend already listens for
    member.updated / member.status.updated and will re-fetch member data on receipt.
    """
    db.add(EventRecord(
        server_id=server.id,
        event_type="member.updated",
        actor_id=None,
        payload={
            "type": "member.updated",
            "memberId": str(member.id),
            "memberName": member.handle,
            "status": member.status,
            "previousStatus": previous_status,
            "action": action,
        },
    ))


def _require_permission(member: Member, permission: str) -> None:
    if permission not in AGENT_PERMISSION_CAPABILITIES:
        raise HTTPException(403, f"Permission denied: {permission}")
    permissions = (member.config or {}).get("permissions")
    if not isinstance(permissions, dict) or permissions.get(permission) is not True:
        raise HTTPException(403, f"Permission denied: {permission}")


def _agent_permissions_for_creation(requested: object) -> dict[str, bool]:
    if requested is not None and not isinstance(requested, dict):
        raise HTTPException(400, "Agent permissions must be an object")
    try:
        return agent_permissions_for_creation(requested)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _serialize_file(file_entry: FileEntry) -> dict:
    return {
        "id": str(file_entry.id),
        "attachmentId": str(file_entry.id),
        "serverId": str(file_entry.server_id),
        "channelId": str(file_entry.channel_id) if file_entry.channel_id else None,
        "messageId": str(file_entry.message_id) if file_entry.message_id else None,
        "uploadedBy": str(file_entry.uploaded_by),
        "fileName": file_entry.file_name,
        "originalName": file_entry.original_name,
        "mimeType": file_entry.mime_type,
        "size": file_entry.size,
        "url": f"/api/attachments/{file_entry.id}/download",
        "previewUrl": f"/api/attachments/{file_entry.id}" if file_entry.mime_type.startswith("image/") else None,
        "metadata": file_entry.metadata_json or {},
        "createdAt": file_entry.created_at.isoformat() if file_entry.created_at else None,
    }


async def _serialize_reminder(db: AsyncSession, reminder: Reminder) -> dict:
    channel = None
    if reminder.channel_id:
        result = await db.execute(select(Channel).where(Channel.id == reminder.channel_id))
        channel = result.scalar_one_or_none()
    return {
        "id": str(reminder.id),
        "serverId": str(reminder.server_id),
        "agentId": str(reminder.agent_id),
        "title": reminder.title,
        "description": reminder.description,
        "fireAt": reminder.fire_at.isoformat() if reminder.fire_at else None,
        "status": reminder.status,
        "repeat": reminder.repeat,
        "channelId": str(reminder.channel_id) if reminder.channel_id else None,
        "channel": _display_channel(channel) if channel else None,
        "messageId": str(reminder.message_id) if reminder.message_id else None,
        "taskId": str(reminder.task_id) if reminder.task_id else None,
        "data": reminder.data or {},
        "createdAt": reminder.created_at.isoformat() if reminder.created_at else None,
        "updatedAt": reminder.updated_at.isoformat() if reminder.updated_at else None,
        "firedAt": reminder.fired_at.isoformat() if reminder.fired_at else None,
    }


def _serialize_activity_log(activity: ActivityLog) -> dict:
    return {
        "id": str(activity.id),
        "type": activity.kind,
        "description": activity.description,
        "details": activity.details or {},
        "channelId": str(activity.channel_id) if activity.channel_id else None,
        "taskId": str(activity.task_id) if activity.task_id else None,
        "occurredAt": activity.occurred_at.isoformat() if activity.occurred_at else None,
    }


# ── Server info ──────────────────────────────────────────────

@router.get("/server")
async def get_server(
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent

    channels_result = await db.execute(
        select(Channel, ChannelMember.member_id)
        .outerjoin(
            ChannelMember,
            and_(
                ChannelMember.channel_id == Channel.id,
                ChannelMember.member_id == member.id,
            ),
        )
        .where(
            Channel.server_id == server.id,
            or_(Channel.kind == "public", ChannelMember.member_id == member.id),
        )
        .order_by(Channel.name, Channel.id)
    )

    channels_list = []
    for ch, joined_member_id in channels_result.all():
        channels_list.append({
            "id": str(ch.id),
            "name": ch.name,
            "type": ch.kind,
            "private": ch.kind == "private",
            "joined": joined_member_id is not None,
            "description": ch.description or "",
        })

    computers_result = await db.execute(select(Computer).where(Computer.server_id == server.id))
    computers = computers_result.scalars().all()

    return {
        "serverId": str(server.id),
        "serverName": server.name,
        "serverHandle": server.server_handle,
        "channels": channels_list,
        "computers": [await _serialize_computer(db, computer) for computer in computers],
    }


# ── Daemon computer/workspace lifecycle ──────────────────────


@router.post("/daemon/connect")
async def connect_daemon(
    body: DaemonConnectRequest,
    authorization: str = Header(..., alias="Authorization"),
    db: AsyncSession = Depends(get_db),
):
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Bearer token")
    connect_token = authorization[7:]
    if not connect_token:
        raise HTTPException(401, "Missing Bearer token")

    token_hash = _token_hash(connect_token)
    ticket_result = await db.execute(
        select(ConnectTicket).where(
            ConnectTicket.key_prefix == connect_token[:20],
        )
    )
    ticket = None
    for candidate in ticket_result.scalars().all():
        if hmac.compare_digest(candidate.token_hash, token_hash):
            ticket = candidate
            break
    if not ticket:
        raise HTTPException(401, "Invalid connect token")

    now = _now_for(ticket.expires_at)
    if ticket.revoked_at is not None:
        raise HTTPException(401, "Connect token revoked")
    if ticket.consumed_at is not None:
        raise HTTPException(409, "Connect token already used")
    if ticket.expires_at <= now:
        raise HTTPException(401, "Connect token expired")

    server_result = await db.execute(select(Server).where(Server.id == ticket.server_id))
    server = server_result.scalar_one_or_none()
    if not server:
        raise HTTPException(401, "Server not found")

    _require_supported_daemon_version(body.daemonVersion)

    machine_id = body.machineId.strip()
    if not machine_id:
        raise HTTPException(400, "Missing machineId")
    daemon_id = (body.daemonId or str(uuid.uuid4())).strip()
    requested_name = (ticket.requested_name or body.name or "unregistered-computer").strip()

    machine_result = await db.execute(
        select(Computer).where(Computer.server_id == server.id, Computer.machine_id == machine_id)
    )
    computer = machine_result.scalar_one_or_none()

    name_result = await db.execute(
        select(Computer).where(Computer.server_id == server.id, Computer.name == requested_name)
    )
    name_owner = name_result.scalar_one_or_none()
    if name_owner and (computer is None or name_owner.id != computer.id):
        if computer is None:
            computer = name_owner
        else:
            raise HTTPException(409, f"Computer name {requested_name} already exists")

    if computer and _lease_active(computer, now):
        raise HTTPException(409, detail=daemon_lease_conflict_detail(computer, now))

    if computer is None:
        computer = Computer(
            server_id=server.id,
            machine_id=machine_id,
            name=requested_name,
            os=body.os or "unknown",
            daemon_version=body.daemonVersion or "unknown",
            status=body.status,
            detected_runtimes=body.detectedRuntimes or [],
        )
        db.add(computer)
        await db.flush()
    else:
        computer.machine_id = machine_id
        computer.name = requested_name
        computer.os = body.os or computer.os
        computer.daemon_version = body.daemonVersion or computer.daemon_version
        computer.status = body.status
        if body.detectedRuntimes is not None:
            computer.detected_runtimes = body.detectedRuntimes

    machine_token = _new_machine_token()
    await db.execute(
        ApiKey.__table__.delete().where(
            ApiKey.server_id == server.id,
            ApiKey.resource_type == "computer",
            ApiKey.resource_id == computer.id,
        )
    )
    db.add(ApiKey(
        key_prefix=machine_token[:20],
        token_hash=_token_hash(machine_token),
        resource_type="computer",
        resource_id=computer.id,
        server_id=server.id,
    ))
    computer.api_key_prefix = machine_token[:20]
    computer.active_daemon_id = daemon_id
    computer.daemon_lease_expires_at = now + timedelta(seconds=DAEMON_LEASE_SECONDS)
    computer.last_heartbeat_at = now
    ticket.consumed_at = now

    await _record_computer_status_event(
        db,
        server,
        computer,
        action="connect",
        previous_status=None,
    )

    await db.commit()
    await db.refresh(computer)
    await _push_committed_events(db, server_id=server.id)
    return {
        "connected": True,
        "daemonId": daemon_id,
        "machineToken": machine_token,
        "leaseExpiresAt": computer.daemon_lease_expires_at.isoformat() if computer.daemon_lease_expires_at else None,
        "computer": await _serialize_computer(db, computer),
    }


@router.post("/daemon/register")
async def register_daemon(
    body: DaemonRegisterRequest,
    machine: tuple[Computer, Server, object] = Depends(resolve_machine),
    db: AsyncSession = Depends(get_db),
):
    computer, server, api_key = machine
    _require_supported_daemon_version(body.daemonVersion)
    now = _utcnow_aware()
    if _daemon_lease_conflicts(computer, body.daemonId, now):
        raise HTTPException(409, "Computer is leased by another daemon")
    previous_computer_status = computer.status
    computer.name = body.name or computer.name
    computer.os = body.os or computer.os
    computer.daemon_version = body.daemonVersion or computer.daemon_version
    computer.api_key_prefix = api_key.key_prefix
    computer.status = body.status
    computer.active_daemon_id = body.daemonId or computer.active_daemon_id
    computer.daemon_lease_expires_at = now + timedelta(seconds=DAEMON_LEASE_SECONDS)
    computer.last_heartbeat_at = now
    if body.detectedRuntimes is not None:
        computer.detected_runtimes = body.detectedRuntimes

    upserted = []
    reported_workspace_ids: set[uuid.UUID] = set()
    for item in body.workspaces:
        workspace, agent_member, created = await _upsert_daemon_workspace(db, server, computer, item)
        reported_workspace_ids.add(workspace.id)
        await db.flush()
        await _record_activity(
            db,
            server,
            agent_member,
            "workspace_registered" if created else "workspace_updated",
            f"@{agent_member.handle} workspace {'registered' if created else 'updated'} on {computer.name}",
            {
                "computerId": str(computer.id),
                "workspaceId": str(workspace.id),
                "runtime": _public_runtime(workspace.runtime),
                "status": workspace.status,
                "sessionId": workspace.session_id,
            },
        )
        upserted.append(await _serialize_workspace(db, workspace))

    if previous_computer_status != computer.status:
        await _record_computer_status_event(
            db,
            server,
            computer,
            action="register",
            previous_status=previous_computer_status,
        )

    await mark_missing_runtimes_pending_start(
        db,
        server_id=server.id,
        computer_id=computer.id,
        reported_workspace_ids=reported_workspace_ids,
    )
    control_commands = await pending_runtime_commands(
        db,
        server_id=server.id,
        computer_id=computer.id,
    )

    await db.commit()
    await db.refresh(computer)
    await _push_committed_events(db, server_id=server.id)
    return {
        "registered": True,
        "computer": await _serialize_computer(db, computer),
        "workspaces": upserted,
        "controlCommands": control_commands,
    }


@router.post("/daemon/heartbeat")
async def daemon_heartbeat(
    body: DaemonHeartbeatRequest,
    machine: tuple[Computer, Server, object] = Depends(resolve_machine),
    db: AsyncSession = Depends(get_db),
):
    computer, server, _api_key = machine
    _require_supported_daemon_version(body.daemonVersion)
    now = _utcnow_aware()
    if _daemon_lease_conflicts(computer, body.daemonId, now):
        raise HTTPException(409, "Computer is leased by another daemon")
    previous_computer_status = computer.status
    computer.status = body.status
    computer.active_daemon_id = body.daemonId or computer.active_daemon_id
    computer.daemon_lease_expires_at = now + timedelta(seconds=DAEMON_LEASE_SECONDS)
    computer.last_heartbeat_at = now
    if body.detectedRuntimes is not None:
        computer.detected_runtimes = body.detectedRuntimes

    upserted = []
    reported_workspace_ids: set[uuid.UUID] = set()
    for item in body.workspaces:
        workspace, agent_member, created = await _upsert_daemon_workspace(db, server, computer, item)
        reported_workspace_ids.add(workspace.id)
        await db.flush()
        if created:
            await _record_activity(
                db,
                server,
                agent_member,
                "workspace_registered",
                f"@{agent_member.handle} workspace registered on {computer.name}",
                {
                    "computerId": str(computer.id),
                    "workspaceId": str(workspace.id),
                    "runtime": _public_runtime(workspace.runtime),
                    "status": workspace.status,
                    "sessionId": workspace.session_id,
                    "pid": workspace.pid,
                },
            )
        elif getattr(workspace, "_smallkhoj_realtime_changed", False):
            await _record_activity(
                db,
                server,
                agent_member,
                "workspace_updated",
                f"@{agent_member.handle} workspace updated on {computer.name}",
                {
                    "computerId": str(computer.id),
                    "workspaceId": str(workspace.id),
                    "runtime": _public_runtime(workspace.runtime),
                    "status": workspace.status,
                    "sessionId": workspace.session_id,
                    "pid": workspace.pid,
                },
            )
        if getattr(agent_member, "_smallkhoj_member_status_changed", False):
            await _record_member_status_event(
                db,
                server,
                agent_member,
                previous_status=getattr(agent_member, "_smallkhoj_previous_member_status", None),
                action="heartbeat",
            )
        upserted.append(await _serialize_workspace(db, workspace))

    if previous_computer_status != computer.status:
        await _record_computer_status_event(
            db,
            server,
            computer,
            action="heartbeat",
            previous_status=previous_computer_status,
        )

    await mark_missing_runtimes_pending_start(
        db,
        server_id=server.id,
        computer_id=computer.id,
        reported_workspace_ids=reported_workspace_ids,
    )
    control_commands = await pending_runtime_commands(
        db,
        server_id=server.id,
        computer_id=computer.id,
    )

    await db.commit()
    await db.refresh(computer)
    await _push_committed_events(db, server_id=server.id)
    return {
        "ok": True,
        "computer": await _serialize_computer(db, computer),
        "workspaces": upserted,
        "controlCommands": control_commands,
    }


@router.post("/daemon/shutdown")
async def daemon_shutdown(
    body: DaemonShutdownRequest,
    machine: tuple[Computer, Server, object] = Depends(resolve_machine),
    db: AsyncSession = Depends(get_db),
):
    computer, server, _api_key = machine
    now = _utcnow_aware()
    if not _daemon_shutdown_can_release(computer, body.daemonId):
        return {
            "ok": True,
            "ignored": True,
            "reason": "active_daemon_id_mismatch",
            "computer": await _serialize_computer(db, computer),
        }

    previous_computer_status = computer.status
    computer.status = body.status or "offline"
    computer.active_daemon_id = None
    computer.daemon_lease_expires_at = now
    computer.last_heartbeat_at = now
    if previous_computer_status != computer.status:
        await _record_computer_status_event(
            db,
            server,
            computer,
            action="shutdown",
            previous_status=previous_computer_status,
        )

    workspace_result = await db.execute(
        select(AgentWorkspace, Member)
        .join(Member, Member.id == AgentWorkspace.agent_id)
        .where(AgentWorkspace.computer_id == computer.id)
    )
    workspaces = []
    for workspace, agent_member in workspace_result.all():
        previous_workspace_status = workspace.status
        previous_member_status = agent_member.status
        if workspace.status in {"running", "active", "idle", PENDING_RUNTIME_START_STATUS}:
            workspace.status = "stopped"
            workspace.pid = None
            workspace.stopped_at = now
        if agent_member.status in {"online", "active", "running", "idle"}:
            agent_member.status = "offline"
        if previous_member_status != agent_member.status:
            await _record_member_status_event(
                db,
                server,
                agent_member,
                previous_status=previous_member_status,
                action="shutdown",
            )
        if previous_workspace_status != workspace.status:
            await _record_activity(
                db,
                server,
                agent_member,
                "workspace_updated",
                f"@{agent_member.handle} workspace stopped on {computer.name}",
                {
                    "computerId": str(computer.id),
                    "workspaceId": str(workspace.id),
                    "runtime": _public_runtime(workspace.runtime),
                    "status": workspace.status,
                    "sessionId": workspace.session_id,
                    "pid": workspace.pid,
                },
            )
        workspaces.append(await _serialize_workspace(db, workspace))

    await db.commit()
    await db.refresh(computer)
    await _push_committed_events(db, server_id=server.id)
    return {
        "ok": True,
        "computer": await _serialize_computer(db, computer),
        "workspaces": workspaces,
    }


@router.websocket("/ws")
async def daemon_websocket(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_db),
):
    authorization = websocket.headers.get("authorization", "")
    x_computer_id = websocket.headers.get("x-computer-id")
    try:
        computer, server, _api_key = await resolve_machine(
            authorization=authorization,
            x_computer_id=x_computer_id,
            db=db,
        )
    except HTTPException as exc:
        await websocket.close(code=1008, reason=str(exc.detail))
        return

    await websocket.accept()
    raw_cursor = websocket.query_params.get("eventLogCursor") or websocket.query_params.get("activityCursor")
    daemon_id = websocket.query_params.get("daemonId")
    event_cursor = await initial_daemon_event_cursor(db, server_id=server.id, raw_cursor=raw_cursor)
    daemon_control_hub.add(computer.id, websocket, event_cursor)
    try:
        for event in await pending_runtime_commands(
            db,
            server_id=server.id,
            computer_id=computer.id,
        ):
            await websocket.send_json(event)
        await daemon_control_hub.push_events(
            db,
            server_id=server.id,
            computer_id=computer.id,
        )

        while True:
            raw_message = await websocket.receive_text()
            try:
                message = json.loads(raw_message)
            except ValueError:
                message = {"type": "raw", "content": raw_message}
            message_type = message.get("type") if isinstance(message, dict) else None
            if message_type in {"activity", "ack"}:
                now = _utcnow_aware()
                if _apply_daemon_ws_activity(computer, daemon_id, now):
                    await db.commit()
    except WebSocketDisconnect:
        pass
    finally:
        daemon_control_hub.remove(computer.id, websocket)


# ── Send message ─────────────────────────────────────────────

@router.post("/send")
async def send_message(
    body: SendRequest,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    trace = LatencyTrace(
        trace_id_from_request(request, {"traceId": body.traceId}, prefix="agent-send"),
        "agent_message_send",
        agentId=str(member.id),
        target=body.target,
    )
    trace.mark("backend.agent_send.request_received")
    _require_permission(member, "sendMessage")
    target = body.target
    with trace.time("backend.agent_send.resolve"):
        base_target, target_thread_ref = _split_thread_target(target)
        thread_ref = body.threadId or body.parentId or target_thread_ref

        channel = await _resolve_channel(db, server, base_target, member=member, create_dm=True)
        current_membership = await db.execute(
            select(ChannelMember).where(
                ChannelMember.channel_id == channel.id,
                ChannelMember.member_id == member.id,
            )
        )
        if current_membership.scalar_one_or_none() is None:
            raise HTTPException(403, "Agent is no longer a member of this Channel")

        parent_id = None
        thread_target_short_id = None
        if thread_ref:
            parent = await _resolve_message_ref(db, server, thread_ref)
            if parent.channel_id != channel.id:
                raise HTTPException(400, "Thread root belongs to a different channel")
            parent_id = parent.parent_id or parent.id
            root = parent
            if parent.parent_id:
                root = await _resolve_message_ref(db, server, str(parent.parent_id))
            thread_target_short_id = root.short_id

    with trace.time("backend.agent_send.db_flush"):
        # Generate short_id
        short_id = uuid.uuid4().hex[:8]

        msg = Message(
            short_id=short_id,
            channel_id=channel.id,
            sender_id=member.id,
            parent_id=parent_id,
            content=body.content,
            channel_type="thread" if parent_id else channel.kind,
            mentions=await _parse_mentions(db, channel, body.content),
        )
        db.add(msg)
        await db.flush()
    event_target = await _message_target_for_member(
        db,
        channel,
        member,
        thread_ref=thread_target_short_id,
    )
    with trace.time("backend.agent_send.event_record", messageId=str(msg.id), shortId=msg.short_id):
        await _record_activity(
            db,
            server,
            member,
            "message_sent",
            f"@{member.handle} sent a message to {target}",
            {
                "traceId": trace.trace_id,
                "messageId": str(msg.id),
                "shortId": msg.short_id,
                "seq": msg.seq,
                "messageSeq": msg.seq,
                "senderId": str(member.id),
                "content": msg.content,
                "messageSnippet": body.content[:200],
                "target": event_target,
                "channel": event_target,
                "channelType": msg.channel_type,
                "mentions": [str(item) for item in (msg.mentions or [])],
                "parentId": str(parent_id) if parent_id else None,
                "threadId": str(parent_id or msg.id),
            },
            channel_id=channel.id,
        )
    with trace.time("backend.agent_send.commit", messageId=str(msg.id), shortId=msg.short_id):
        await db.commit()
        await db.refresh(msg)
    with trace.time("backend.agent_send.push_events", messageId=str(msg.id), shortId=msg.short_id):
        delivered = await _push_committed_events(db, server_id=server.id)
    trace.finish("backend.agent_send.response_ready", messageId=str(msg.id), shortId=msg.short_id, delivered=delivered)

    return {
        "state": "sent",
        "traceId": trace.trace_id,
        "messageId": str(msg.id),
        "messageSeq": msg.seq,
        "shortId": msg.short_id,
        "target": target,
        "mentions": [str(item) for item in (msg.mentions or [])],
        "parentId": str(parent_id) if parent_id else None,
        "threadId": str(parent_id or msg.id),
    }


# ── Events (poll) ────────────────────────────────────────────

@router.get("/events")
async def get_events(
    request: Request,
    since: str = Query("0", alias="since"),
    eventLogCursor: str | None = Query(None),
    activityCursor: str | None = Query(None),
    stream: bool = Query(False),
    intervalSeconds: float = Query(1.0),
    heartbeatSeconds: float = Query(15.0),
    claims: AgentEventStreamClaims = Depends(resolve_agent_event_stream_claims),
    db: AsyncSession = Depends(get_db, scope="function"),
):
    member, server = await _load_agent_event_stream_entities(db, claims)
    cursor_key = "eventCursor"
    activity_cursor_key = "activityCursor"
    event_log_cursor_key = "eventLogCursor"
    wants_sse = stream or "text/event-stream" in request.headers.get("accept", "")
    config = member.config or {}
    raw_event_log_cursor = eventLogCursor or activityCursor or config.get(event_log_cursor_key) or config.get(activity_cursor_key)
    control_events: list[dict] = []
    member_computer_id = member.computer_id or config.get("computerId")
    if member.kind == "agent" and member_computer_id:
        try:
            parsed_computer_id = uuid.UUID(str(member_computer_id))
        except ValueError:
            parsed_computer_id = None
        if parsed_computer_id:
            control_events = await pending_runtime_commands(
                db,
                server_id=server.id,
                computer_id=parsed_computer_id,
                agent_id=member.id,
            )

    if since == "latest":
        raw_cursor = config.get(cursor_key)
        if raw_cursor is None:
            max_result = await db.execute(select(func.coalesce(func.max(Message.seq), 0)))
            cursor = int(max_result.scalar() or 0)
            max_event_result = await db.execute(
                select(func.coalesce(func.max(EventRecord.seq), 0)).where(EventRecord.server_id == server.id)
            )
            raw_event_log_cursor = str(int(max_event_result.scalar() or 0))
            if wants_sse:
                raw_cursor = cursor
            else:
                new_config = {**config, cursor_key: cursor}
                new_config[event_log_cursor_key] = raw_event_log_cursor
                new_config[activity_cursor_key] = raw_event_log_cursor
                member.config = new_config
                await db.commit()
                return {
                    "ok": True,
                    "events": control_events,
                    "nextCursor": str(cursor),
                    "eventLogCursor": raw_event_log_cursor,
                    "activityCursor": raw_event_log_cursor,
                    "count": len(control_events),
                }
        if raw_cursor is not None:
            try:
                cursor = int(raw_cursor)
            except (TypeError, ValueError):
                cursor = 0
        if raw_event_log_cursor is None:
            max_event_result = await db.execute(
                select(func.coalesce(func.max(EventRecord.seq), 0)).where(EventRecord.server_id == server.id)
            )
            raw_event_log_cursor = str(int(max_event_result.scalar() or 0))
    else:
        try:
            cursor = int(since)
        except ValueError:
            raise HTTPException(400, "Invalid since cursor")
        raw_event_log_cursor = raw_event_log_cursor or "0"

    if wants_sse:
        interval = max(0.25, min(intervalSeconds, 30.0))
        heartbeat = max(interval, min(max(heartbeatSeconds, 1.0), 120.0))
        event_log_cursor = raw_event_log_cursor or "0"

        async def event_stream():
            nonlocal cursor, event_log_cursor
            last_heartbeat = _utcnow()
            yield _sse_frame(
                "ready",
                {
                    "ok": True,
                    "nextCursor": str(cursor),
                    "eventLogCursor": event_log_cursor,
                    "activityCursor": event_log_cursor,
                    "count": 0,
                },
                str(cursor),
            )
            while not await request.is_disconnected():
                frames: list[str] = []
                async with async_session() as poll_db:
                    poll_member, poll_server = await _load_agent_event_stream_entities(
                        poll_db,
                        claims,
                    )
                    poll_channel_ids = await _visible_channel_ids(poll_db, poll_member)
                    records = await _visible_event_records(
                        poll_db,
                        poll_server,
                        poll_member,
                        poll_channel_ids,
                        event_log_cursor,
                    )
                    for record in records:
                        event_log_cursor = str(record.seq)
                        if _should_suppress_thread_event(poll_member, record):
                            continue
                        message_seq = _event_record_message_seq(record)
                        if message_seq is not None:
                            cursor = max(cursor, message_seq)
                        event = await _event_record_event(poll_db, record, poll_member)
                        frames.append(_sse_frame(event["type"], event, f"event:{record.seq}"))

                for frame in frames:
                    yield frame

                now = _utcnow()
                if (now - last_heartbeat).total_seconds() >= heartbeat:
                    last_heartbeat = now
                    yield _sse_frame(
                        "heartbeat",
                        {
                            "ok": True,
                            "nextCursor": str(cursor),
                            "eventLogCursor": event_log_cursor,
                            "activityCursor": event_log_cursor,
                        },
                        str(cursor),
                    )

                await asyncio.sleep(interval)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    channel_ids = await _visible_channel_ids(db, member)
    events = [*control_events]
    next_cursor = cursor
    event_log_cursor = raw_event_log_cursor or "0"
    records = await _visible_event_records(
        db,
        server,
        member,
        channel_ids,
        event_log_cursor,
    )
    for record in records:
        event_log_cursor = str(record.seq)
        if _should_suppress_thread_event(member, record):
            continue
        message_seq = _event_record_message_seq(record)
        if message_seq is not None:
            next_cursor = max(next_cursor, message_seq)
        events.append(await _event_record_event(db, record, member))

    events.sort(key=lambda item: (
        int(item.get("eventSeq") or 0),
    ))

    if next_cursor > cursor or event_log_cursor != (raw_event_log_cursor or "0"):
        new_config = {**(member.config or {}), cursor_key: next_cursor}
        new_config[event_log_cursor_key] = event_log_cursor
        new_config[activity_cursor_key] = event_log_cursor
        member.config = new_config
        await db.commit()

    return {
        "ok": True,
        "events": events,
        "nextCursor": str(next_cursor),
        "eventLogCursor": event_log_cursor,
        "activityCursor": event_log_cursor,
        "count": len(events),
    }


@router.get("/events/stream")
async def get_events_stream(
    request: Request,
    since: str = Query("latest", alias="since"),
    intervalSeconds: float = Query(1.0),
    heartbeatSeconds: float = Query(15.0),
    claims: AgentEventStreamClaims = Depends(resolve_agent_event_stream_claims),
    db: AsyncSession = Depends(get_db, scope="function"),
):
    return await get_events(
        request=request,
        since=since,
        eventLogCursor=None,
        activityCursor=None,
        stream=True,
        intervalSeconds=intervalSeconds,
        heartbeatSeconds=heartbeatSeconds,
        claims=claims,
        db=db,
    )


# ── History ──────────────────────────────────────────────────

@router.get("/history")
async def get_history(
    channel: str = Query(...),
    limit: int = Query(50),
    before: int | None = Query(None),
    after: int | None = Query(None),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent

    try:
        ch = await _resolve_channel(db, server, channel, member=member)
    except HTTPException as exc:
        if exc.status_code == 404:
            return {"messages": [], "count": 0}
        raise

    visible_ids = await _visible_channel_ids(db, member)
    if ch.id not in visible_ids:
        return {"messages": [], "count": 0}

    q = select(Message).where(Message.channel_id == ch.id)
    if before:
        q = q.where(Message.seq < before)
    if after:
        q = q.where(Message.seq > after)
    q = q.order_by(Message.seq.desc()).limit(limit)

    msgs_result = await db.execute(q)
    messages = list(reversed(msgs_result.scalars().all()))

    sender_ids = {message.sender_id for message in messages}
    sender_result = await db.execute(
        select(Member).options(noload("*")).where(Member.id.in_(sender_ids))
    ) if sender_ids else None
    senders = {
        sender.id: sender
        for sender in (sender_result.scalars().all() if sender_result is not None else [])
    }
    result_messages = []
    for msg in messages:
        sender = senders.get(msg.sender_id)

        result_messages.append({
            "seq": msg.seq,
            "msg": msg.short_id,
            "messageId": str(msg.id),
            "time": msg.created_at.strftime("%Y-%m-%d %H:%M:%S") if msg.created_at else "",
            "type": sender.kind if sender else "unknown",
            "sender": f"@{sender.handle}" if sender else "unknown",
            "content": msg.content,
            "mentions": [str(item) for item in (msg.mentions or [])],
            "parentId": str(msg.parent_id) if msg.parent_id else None,
            "threadId": str(msg.parent_id or msg.id),
        })

    return {"messages": result_messages, "count": len(result_messages)}


# ── Search / reactions ───────────────────────────────────────

@router.get("/search")
async def search_messages(
    q: str | None = Query(None),
    query: str | None = Query(None),
    channel: str | None = Query(None),
    target: str | None = Query(None),
    limit: int = Query(20),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    term = (q or query or "").strip()
    if not term:
        raise HTTPException(400, "Missing query")

    visible_ids = await _visible_channel_ids(db, member)
    if not visible_ids:
        return {"messages": [], "results": [], "count": 0}

    safe_term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    q_stmt = select(Message).join(Channel).where(
        Channel.server_id == server.id,
        Message.channel_id.in_(visible_ids),
        Message.content.ilike(f"%{safe_term}%", escape="\\"),
    )
    channel_target = channel or target
    if channel_target:
        ch = await _resolve_channel(db, server, channel_target, member=member)
        if ch.id not in visible_ids:
            return {"messages": [], "results": [], "count": 0}
        q_stmt = q_stmt.where(Message.channel_id == ch.id)

    result = await db.execute(q_stmt.order_by(Message.seq.desc()).limit(min(limit, 100)))
    messages = list(reversed(result.scalars().all()))
    context = await load_message_serialization_context(db, messages)
    items = [await _serialize_message(db, item, _context=context) for item in messages]
    return {"messages": items, "results": items, "count": len(items), "query": term}


@router.get("/messages/{message_ref}/resolve")
async def resolve_message(
    message_ref: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    message = await _resolve_message_ref(db, server, message_ref)
    visible_ids = await _visible_channel_ids(db, member)
    if message.channel_id not in visible_ids:
        raise HTTPException(403, "Message is not visible to this agent")
    serialized = await _serialize_message(db, message)
    return {
        "ok": True,
        "resolved": True,
        "message": serialized,
        "messageId": serialized["messageId"],
        "shortId": serialized["shortId"],
    }


@router.post("/messages/{message_ref}/reactions")
async def add_message_reaction(
    message_ref: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "sendMessage")
    body = await request.json()
    reaction_text = (body.get("reaction") or body.get("emoji") or "").strip()
    if not reaction_text:
        raise HTTPException(400, "Missing reaction")

    message = await _resolve_message_ref(db, server, message_ref)
    visible_ids = await _visible_channel_ids(db, member)
    if message.channel_id not in visible_ids:
        raise HTTPException(403, "Message is not visible to this agent")

    existing_result = await db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message.id,
            MessageReaction.member_id == member.id,
            MessageReaction.reaction == reaction_text,
        )
    )
    reaction = existing_result.scalar_one_or_none()
    created = reaction is None
    if reaction is None:
        reaction = MessageReaction(
            message_id=message.id,
            member_id=member.id,
            reaction=reaction_text,
        )
        db.add(reaction)
        await db.flush()
        await _record_activity(
            db,
            server,
            member,
            "message_reaction_added",
            f"@{member.handle} reacted {reaction_text} to message {message.short_id}",
            {"messageId": str(message.id), "shortId": message.short_id, "reaction": reaction_text},
            channel_id=message.channel_id,
        )
    await db.commit()
    return {
        "created": created,
        "messageId": str(message.id),
        "shortId": message.short_id,
        "reaction": reaction_text,
        "reactions": await _serialize_reactions(db, message.id),
    }


@router.delete("/messages/{message_ref}/reactions")
async def remove_message_reaction(
    message_ref: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "sendMessage")
    body = await request.json()
    reaction_text = (body.get("reaction") or body.get("emoji") or "").strip()
    if not reaction_text:
        raise HTTPException(400, "Missing reaction")

    message = await _resolve_message_ref(db, server, message_ref)
    visible_ids = await _visible_channel_ids(db, member)
    if message.channel_id not in visible_ids:
        raise HTTPException(403, "Message is not visible to this agent")

    result = await db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message.id,
            MessageReaction.member_id == member.id,
            MessageReaction.reaction == reaction_text,
        )
    )
    reaction = result.scalar_one_or_none()
    removed = reaction is not None
    if reaction:
        await db.delete(reaction)
        await _record_activity(
            db,
            server,
            member,
            "message_reaction_removed",
            f"@{member.handle} removed {reaction_text} from message {message.short_id}",
            {"messageId": str(message.id), "shortId": message.short_id, "reaction": reaction_text},
            channel_id=message.channel_id,
        )
    await db.commit()
    return {
        "removed": removed,
        "messageId": str(message.id),
        "shortId": message.short_id,
        "reaction": reaction_text,
        "reactions": await _serialize_reactions(db, message.id),
    }


# ── Tasks ────────────────────────────────────────────────────

@router.get("/tasks")
async def list_tasks(
    channel: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = Query(None),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent

    q = select(Task).join(Channel).where(Channel.server_id == server.id)
    channel_id = None
    if channel:
        ch = await _resolve_channel(db, server, channel, member=member)
        channel_id = ch.id
        q = q.where(Task.channel_id == channel_id)
    if status:
        q = q.where(Task.status == status)

    if cursor:
        try:
            cursor_number, cursor_channel_id, cursor_id = decode_task_cursor(
                cursor,
                endpoint="agent.tasks",
                server_id=server.id,
                channel_id=channel_id,
                status=status,
            )
        except PaginationCursorError:
            raise HTTPException(400, "Invalid pagination cursor")
        q = q.where(or_(
            Task.task_number > cursor_number,
            and_(
                Task.task_number == cursor_number,
                Task.channel_id > cursor_channel_id,
            ),
            and_(
                Task.task_number == cursor_number,
                Task.channel_id == cursor_channel_id,
                Task.id > cursor_id,
            ),
        ))

    result = await db.execute(
        q.options(noload("*")).order_by(
            Task.task_number.asc(),
            Task.channel_id.asc(),
            Task.id.asc(),
        ).limit(limit + 1)
    )
    rows = list(result.scalars().all())
    tasks = rows[:limit]
    context = await load_task_serialization_context(db, tasks)
    next_cursor = None
    if len(rows) > limit and tasks:
        last = tasks[-1]
        next_cursor = encode_task_cursor(
            endpoint="agent.tasks",
            server_id=server.id,
            channel_id=channel_id,
            status=status,
            task_number=last.task_number,
            position_channel_id=last.channel_id,
            task_id=last.id,
        )
    return {
        "tasks": [await _serialize_task(db, task, _context=context) for task in tasks],
        "count": len(tasks),
        "nextCursor": next_cursor,
    }


@router.post("/tasks")
async def create_tasks(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "createTask")
    body = await request.json()

    channel_target = body.get("channel")
    if not channel_target:
        raise HTTPException(400, "Missing channel")
    channel = await _resolve_channel(db, server, channel_target, member=member)

    raw_tasks = body.get("tasks")
    if raw_tasks is None:
        title = body.get("title")
        if not title:
            raise HTTPException(400, "Missing title")
        raw_tasks = [body]
    if not isinstance(raw_tasks, list) or not raw_tasks:
        raise HTTPException(400, "Missing tasks")

    created: list[tuple[Task, Member | None]] = []
    next_number = await _next_task_number(db, channel.id)
    for item in raw_tasks:
        if not isinstance(item, dict):
            raise HTTPException(400, "Invalid task item")
        title = item.get("title")
        if not title:
            raise HTTPException(400, "Missing task title")

        assignee_handle = item.get("assignee") or body.get("assignee")
        assignee = await _resolve_member_by_handle(db, server, assignee_handle)

        message_id = item.get("messageId") or body.get("messageId")
        parsed_message_id = None
        if message_id:
            try:
                parsed_message_id = uuid.UUID(message_id)
            except ValueError:
                raise HTTPException(400, "Invalid messageId")

        task = Task(
            task_number=next_number,
            channel_id=channel.id,
            message_id=parsed_message_id,
            title=title,
            description=item.get("description") or body.get("description"),
            status=item.get("status") or body.get("status") or "todo",
            creator_id=member.id,
            assignee_id=assignee.id if assignee else None,
            data=item.get("data") or body.get("data") or {},
        )
        next_number += 1
        created.append((task, assignee))
        db.add(task)

    await db.flush()
    for task, assignee in created:
        _assignment, task_run = await create_task_assignment_and_run(
            db,
            task=task,
            assignee=assignee,
            assigned_by_id=member.id,
            role="worker",
            assignment_mode="agent_delegated",
            trigger_type="leader_delegated",
        )
        assignee_handle = f"@{assignee.handle}" if assignee else None
        await _record_activity(
            db,
            server,
            member,
            "task_created",
            f"@{member.handle} created task #{task.task_number}",
            {
                "taskNumber": task.task_number,
                "title": task.title,
                "status": task.status,
                "assignee": assignee_handle,
                "assigneeId": str(assignee.id) if assignee else None,
                "targetAgentId": str(assignee.id) if assignee and assignee.kind == "agent" else None,
                "target": _display_channel(channel),
                "channel": _display_channel(channel),
                "messageId": str(task.message_id) if task.message_id else None,
                "taskRunId": str(task_run.id) if task_run else None,
            },
            channel_id=task.channel_id,
            task_id=task.id,
        )

    await db.commit()
    task_rows = [task for task, _assignee in created]
    for task in task_rows:
        await db.refresh(task)
    await _push_committed_events(db, server_id=server.id)

    return {
        "created": True,
        "tasks": [await _serialize_task(db, task) for task in task_rows],
        "count": len(task_rows),
    }


@router.post("/tasks/claim")
async def claim_task(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "claimTask")

    body = await request.json()
    task_numbers = body.get("task_numbers") or body.get("taskNumbers")
    task_number = body.get("taskNumber") or body.get("task_number") or body.get("number")
    if task_numbers and not task_number:
        task_number = task_numbers[0]
    message_id = body.get("messageId")
    message_ids = body.get("message_ids") or body.get("messageIds")
    if message_ids and not message_id:
        message_id = message_ids[0]
    channel_target = body.get("channel")

    q = select(Task).join(Channel).where(
        Task.assignee_id.is_(None),
        Task.status == "todo",
        Channel.server_id == server.id,
    )
    if channel_target:
        ch = await _resolve_channel(db, server, channel_target, member=member)
        q = q.where(Task.channel_id == ch.id)
    if task_number:
        q = q.where(Task.task_number == task_number)
    if message_id:
        try:
            q = q.where(Task.message_id == uuid.UUID(message_id))
        except ValueError:
            pass

    q = q.limit(1)
    result = await db.execute(q)
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(404, "No unclaimed task found")

    _validate_task_transition(task.status, "in_progress")
    task.assignee_id = member.id
    task.status = "in_progress"
    await _record_activity(
        db,
        server,
        member,
        "task_claimed",
        f"@{member.handle} claimed task #{task.task_number}",
        {"taskNumber": task.task_number, "title": task.title},
        channel_id=task.channel_id,
        task_id=task.id,
    )
    await db.commit()
    await db.refresh(task)
    await _push_committed_events(db, server_id=server.id)

    return {
        "claimed": True,
        "task": await _serialize_task(db, task),
        "taskNumber": task.task_number,
        "title": task.title,
        "status": task.status,
        "assigneeId": str(task.assignee_id),
    }


@router.post("/tasks/update-status")
async def update_task_status(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "updateTask")

    body = await request.json()
    new_status = body.get("status")
    task_number = body.get("taskNumber") or body.get("task_number") or body.get("number")
    channel_target = body.get("channel")

    if not new_status:
        raise HTTPException(400, "Missing status")
    if not task_number:
        raise HTTPException(400, "Missing taskNumber")

    q = select(Task).join(Channel).where(
        Task.task_number == task_number,
        Channel.server_id == server.id,
    )
    if channel_target:
        ch = await _resolve_channel(db, server, channel_target, member=member)
        q = q.where(Task.channel_id == ch.id)
    result = await db.execute(q)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, f"Task {task_number} not found")

    previous_status = task.status
    _apply_agent_status_transition(task, new_status, member)
    await _record_activity(
        db,
        server,
        member,
        "task_unclaimed" if new_status == "todo" else "task_status_changed",
        f"@{member.handle} changed task #{task.task_number} to {new_status}",
        {"taskNumber": task.task_number, "status": new_status, "title": task.title},
        channel_id=task.channel_id,
        task_id=task.id,
    )
    if previous_status != "in_review" and task.status == "in_review":
        await add_task_memory_request_event(
            db,
            server,
            task,
            actor=member,
            instruction=str(body.get("memoryInstruction") or "").strip() or None,
            output_directions=normalize_output_directions(body.get("outputDirections")),
            trigger="status_in_review",
        )
    await db.commit()
    await db.refresh(task)
    await _push_committed_events(db, server_id=server.id)

    return {
        "updated": True,
        "task": await _serialize_task(db, task),
        "taskNumber": task.task_number,
        "status": task.status,
    }


@router.post("/tasks/{task_id}/claim")
async def claim_task_by_id(
    task_id: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "claimTask")
    body = await request.json()

    task = await _resolve_task_by_id(db, server, task_id)
    if task.assignee_id:
        if task.assignee_id != member.id:
            raise HTTPException(409, "Task already assigned")
        if task.status == "todo":
            _apply_agent_status_transition(task, "in_progress", member)
            await _record_activity(
                db,
                server,
                member,
                "task_claimed",
                f"@{member.handle} started assigned task #{task.task_number}",
                {"taskNumber": task.task_number, "title": task.title},
                channel_id=task.channel_id,
                task_id=task.id,
            )
            await db.commit()
            await db.refresh(task)
            await _push_committed_events(db, server_id=server.id)
            return {
                "claimed": True,
                "task": await _serialize_task(db, task),
            }
        raise HTTPException(409, f"Task already assigned with status {task.status}")
    if task.status != "todo":
        raise HTTPException(409, f"Task cannot be claimed from status {task.status}")

    if body.get("assignee"):
        assignee = await _resolve_member_by_handle(db, server, body.get("assignee"))
        if assignee and assignee.id != member.id:
            raise HTTPException(403, "Agent cannot claim task for another member")
    _validate_task_transition(task.status, "in_progress")
    task.assignee_id = member.id
    task.status = "in_progress"
    await _record_activity(
        db,
        server,
        member,
        "task_claimed",
        f"@{member.handle} claimed task #{task.task_number}",
        {"taskNumber": task.task_number, "title": task.title},
        channel_id=task.channel_id,
        task_id=task.id,
    )
    await db.commit()
    await db.refresh(task)
    await _push_committed_events(db, server_id=server.id)

    return {
        "claimed": True,
        "task": await _serialize_task(db, task),
    }


@router.post("/tasks/{task_id}/unclaim")
async def unclaim_task_by_id(
    task_id: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "claimTask")
    task = await _resolve_task_by_id(db, server, task_id)
    _apply_agent_status_transition(task, "todo", member)
    await _record_activity(
        db,
        server,
        member,
        "task_unclaimed",
        f"@{member.handle} unclaimed task #{task.task_number}",
        {"taskNumber": task.task_number, "status": task.status, "title": task.title},
        channel_id=task.channel_id,
        task_id=task.id,
    )
    await db.commit()
    await db.refresh(task)
    await _push_committed_events(db, server_id=server.id)
    return {"unclaimed": True, "task": await _serialize_task(db, task)}


@router.post("/tasks/{task_id}/submit")
async def submit_task_by_id(
    task_id: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "updateTask")
    body = await request.json()
    task = await _resolve_task_by_id(db, server, task_id)
    previous_status = task.status
    _apply_agent_status_transition(task, "in_review", member)
    if body.get("data"):
        task.data = {**(task.data or {}), **body["data"]}
    await _record_activity(
        db,
        server,
        member,
        "task_status_changed",
        f"@{member.handle} submitted task #{task.task_number} for review",
        {"taskNumber": task.task_number, "status": task.status, "title": task.title},
        channel_id=task.channel_id,
        task_id=task.id,
    )
    if previous_status != "in_review":
        await add_task_memory_request_event(
            db,
            server,
            task,
            actor=member,
            instruction=str(body.get("memoryInstruction") or "").strip() or None,
            output_directions=normalize_output_directions(body.get("outputDirections")),
            trigger="status_in_review",
        )
    await db.commit()
    await db.refresh(task)
    await _push_committed_events(db, server_id=server.id)
    return {"submitted": True, "task": await _serialize_task(db, task)}


@router.post("/tasks/{task_id}/memory/summary")
async def write_task_memory_summary_route(
    task_id: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "updateTask")
    body = await request.json()
    result = await write_task_memory_summary(db, server, task_id, body, author=member)
    await db.commit()
    await db.refresh(result["summaryEntry"])
    if result.get("progressEntry"):
        await db.refresh(result["progressEntry"])
    await _push_committed_events(db, server_id=server.id)
    task = result["task"]
    return {
        "created": result["created"],
        "task": {
            "id": str(task.id),
            "data": task.data or {},
        },
        "entry": serialize_memory_entry(result["summaryEntry"]),
        "progressEntry": serialize_memory_entry(result["progressEntry"]) if result.get("progressEntry") else None,
    }


@router.post("/tasks/{task_id}/memory/promote")
async def promote_task_memory_route(
    task_id: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "updateTask")
    body = await request.json()
    result = await promote_task_memory_to_channel(db, server, task_id, body, author=member)
    await db.commit()
    if result.get("channelEntry"):
        await db.refresh(result["channelEntry"])
    if result.get("proposal"):
        await db.refresh(result["proposal"])
    await _push_committed_events(db, server_id=server.id)
    return {
        "created": result["created"],
        "sourceEntry": serialize_memory_entry(result["sourceEntry"]),
        "channelEntry": serialize_memory_entry(result["channelEntry"]) if result.get("channelEntry") else None,
        "proposal": serialize_memory_proposal(result["proposal"]) if result.get("proposal") else None,
    }


@router.patch("/tasks/{task_id}")
async def update_task_by_id(
    task_id: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "updateTask")
    body = await request.json()

    task = await _resolve_task_by_id(db, server, task_id)
    previous_status = task.status

    disallowed_fields = {"title", "description", "assignee"}
    if disallowed_fields.intersection(body):
        raise HTTPException(403, "Agent cannot edit task title, description, or assignee")
    if "status" in body:
        _apply_agent_status_transition(task, body["status"], member)
    else:
        _ensure_agent_owns_task(member, task)
    if "data" in body:
        task.data = body["data"] or {}

    await _record_activity(
        db,
        server,
        member,
        "task_unclaimed" if body.get("status") == "todo" else "task_status_changed" if "status" in body else "task_updated",
        f"@{member.handle} updated task #{task.task_number}",
        {"taskNumber": task.task_number, "updates": body},
        channel_id=task.channel_id,
        task_id=task.id,
    )
    if previous_status != "in_review" and task.status == "in_review":
        await add_task_memory_request_event(
            db,
            server,
            task,
            actor=member,
            instruction=str(body.get("memoryInstruction") or "").strip() or None,
            output_directions=normalize_output_directions(body.get("outputDirections")),
            trigger="status_in_review",
        )
    await db.commit()
    await db.refresh(task)
    await _push_committed_events(db, server_id=server.id)

    return {
        "updated": True,
        "task": await _serialize_task(db, task),
    }


# ── Channel helpers ──────────────────────────────────────────

@router.get("/channel-members")
async def list_channel_members(
    channel: str = Query(...),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    ch = await _resolve_channel(db, server, channel, member=member)
    roster = await load_agent_channel_roster(db, channel_id=ch.id)
    return {
        "channel": _display_channel(ch),
        "channelId": str(ch.id),
        "rosterRevision": int(ch.membership_revision or 0),
        "members": [item.agent_payload(include_description=True) for item in roster],
        "count": len(roster),
    }


@router.get("/resolve-channel")
async def resolve_channel(
    channel: str = Query(...),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    ch = await _resolve_channel(db, server, channel, member=member)
    return {
        "id": str(ch.id),
        "channelId": str(ch.id),
        "name": _display_channel(ch),
        "type": ch.kind,
        "description": ch.description or "",
    }


@router.post("/resolve-channel")
async def resolve_channel_post(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "createReminder")
    body = await request.json()
    target = body.get("target") or body.get("channel")
    if not target:
        raise HTTPException(400, "Missing target")
    ch = await _resolve_channel(db, server, target, member=member, create_dm=True)
    return {
        "id": str(ch.id),
        "channelId": str(ch.id),
        "name": _display_channel(ch),
        "type": ch.kind,
        "description": ch.description or "",
    }


@router.post("/channels/{channel_ref}/join")
async def join_channel(
    channel_ref: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    ch = await _resolve_channel(
        db,
        server,
        channel_ref,
        member=member,
        allow_public_unjoined=True,
    )
    if ch.kind == "dm":
        raise HTTPException(400, "Cannot join a DM channel explicitly")

    mutation = await add_channel_member_record(
        db,
        channel_id=ch.id,
        member_id=member.id,
        actor_id=member.id,
    )
    await db.commit()
    await _push_committed_events(db, server_id=server.id)
    return {
        "joined": mutation.changed,
        "channel": _display_channel(ch),
        "channelId": str(ch.id),
        "memberId": str(member.id),
        "rosterRevision": mutation.roster_revision,
    }


@router.post("/channels/{channel_ref}/leave")
async def leave_channel(
    channel_ref: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    ch = await _resolve_channel(db, server, channel_ref, member=member)
    if ch.kind == "dm":
        raise HTTPException(400, "Cannot leave a DM channel explicitly")

    mutation = await remove_channel_member_record(
        db,
        channel_id=ch.id,
        member_id=member.id,
        actor_id=member.id,
    )
    await db.commit()
    await _push_committed_events(db, server_id=server.id)
    return {
        "left": mutation.changed,
        "channel": _display_channel(ch),
        "channelId": str(ch.id),
        "memberId": str(member.id),
        "rosterRevision": mutation.roster_revision,
    }


# ── Threads ──────────────────────────────────────────────────

@router.get("/threads")
async def list_threads(
    channel: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = Query(None),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    channel_ids = None
    channel_id = None
    if channel:
        ch = await _resolve_channel(db, server, channel, member=member)
        channel_id = ch.id
        channel_ids = [ch.id]
    else:
        channel_result = await db.execute(
            select(Channel.id).where(Channel.server_id == server.id)
        )
        channel_ids = [row[0] for row in channel_result.all()]

    if not channel_ids:
        return {"threads": [], "count": 0, "nextCursor": None}

    reply_counts = (
        select(Message.parent_id.label("root_id"), func.count().label("reply_count"))
        .where(Message.parent_id.is_not(None))
        .group_by(Message.parent_id)
        .subquery()
    )
    roots_query = select(Message).join(reply_counts, reply_counts.c.root_id == Message.id).where(
            Message.channel_id.in_(channel_ids),
            Message.parent_id.is_(None),
        )
    if cursor:
        try:
            cursor_created_at, cursor_id = decode_thread_cursor(
                cursor,
                endpoint="agent.threads",
                server_id=server.id,
                channel_id=channel_id,
            )
        except PaginationCursorError:
            raise HTTPException(400, "Invalid pagination cursor")
        roots_query = roots_query.where(or_(
            Message.created_at < cursor_created_at,
            and_(
                Message.created_at == cursor_created_at,
                Message.id < cursor_id,
            ),
        ))
    roots_result = await db.execute(
        roots_query.order_by(Message.created_at.desc(), Message.id.desc()).limit(limit + 1)
    )
    rows = list(roots_result.scalars().all())
    roots = rows[:limit]
    context = await load_message_serialization_context(db, roots)

    threads: list[dict] = []
    for root in roots:
        serialized = await _serialize_message(db, root, _context=context)
        serialized["following"] = _is_thread_following(member, root.id)
        threads.append(serialized)

    next_cursor = None
    if len(rows) > limit and roots:
        last = roots[-1]
        next_cursor = encode_thread_cursor(
            endpoint="agent.threads",
            server_id=server.id,
            channel_id=channel_id,
            created_at=last.created_at,
            message_id=last.id,
        )
    return {"threads": threads, "count": len(threads), "nextCursor": next_cursor}


@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    message = await _resolve_message_ref(db, server, thread_id)
    root_id = message.parent_id or message.id

    root_result = await db.execute(select(Message).where(Message.id == root_id))
    root = root_result.scalar_one_or_none()
    if not root:
        raise HTTPException(404, "Thread root not found")

    replies_result = await db.execute(
        select(Message).where(Message.parent_id == root.id).order_by(Message.seq)
    )
    replies = replies_result.scalars().all()
    summary_result = await db.execute(
        select(ThreadSummary).where(ThreadSummary.root_message_id == root.id)
    )
    summary = summary_result.scalar_one_or_none()
    messages = [root, *replies]
    context = await load_message_serialization_context(db, messages)
    serialized_messages = [
        await _serialize_message(db, item, _context=context)
        for item in messages
    ]

    return {
        "thread": serialized_messages[0],
        "replies": serialized_messages[1:],
        "messages": serialized_messages,
        "replyCount": len(replies),
        "following": _is_thread_following(member, root.id),
        "threadSummary": serialize_thread_summary(summary),
    }


@router.post("/threads/{thread_id}/summary")
async def update_thread_summary(
    thread_id: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    text = str(body.get("summary") or "").strip()
    if not text:
        raise HTTPException(400, "Missing summary")
    if len(text) > SUMMARY_MAX_CHARS:
        raise HTTPException(400, f"Summary must be at most {SUMMARY_MAX_CHARS} characters")

    message = await _resolve_message_ref(db, server, thread_id)
    root_id = message.parent_id or message.id
    root_result = await db.execute(select(Message).where(Message.id == root_id))
    root = root_result.scalar_one_or_none()
    if not root:
        raise HTTPException(404, "Thread root not found")

    summary_result = await db.execute(
        select(ThreadSummary).where(ThreadSummary.root_message_id == root.id)
    )
    summary = summary_result.scalar_one_or_none()
    participant_ids = await thread_participant_ids(db, root.id)
    if summary and summary.requested_agent_id and summary.requested_agent_id != member.id and member.id not in participant_ids:
        raise HTTPException(403, "Agent is not allowed to summarize this thread")
    if not summary and member.id not in participant_ids:
        raise HTTPException(403, "Agent is not allowed to summarize this thread")

    reply_count = await thread_reply_count(db, root.id)
    now = _utcnow()
    if summary is None:
        summary = ThreadSummary(
            server_id=server.id,
            channel_id=root.channel_id,
            root_message_id=root.id,
        )
        db.add(summary)
    summary.summary = text
    summary.status = "ready"
    summary.updated_by = member.id
    summary.reply_count_at_summary = reply_count
    summary.summarized_at = now

    await _record_activity(
        db,
        server,
        member,
        "thread_summary_updated",
        f"@{member.handle} summarized thread {root.short_id}",
        {
            "threadId": str(root.id),
            "threadShortId": root.short_id,
            "messageId": str(root.id),
            "summary": text,
            "replyCount": reply_count,
        },
        channel_id=root.channel_id,
    )
    db.add(EventRecord(
        server_id=server.id,
        event_type="thread.summary_updated",
        actor_id=member.id,
        channel_id=root.channel_id,
        message_id=root.id,
        payload={
            "type": "thread.summary_updated",
            "legacyType": "thread_summary_updated",
            "actorId": str(member.id),
            "agentId": str(member.id),
            "threadId": str(root.id),
            "threadShortId": root.short_id,
            "messageId": str(root.id),
            "summary": text,
            "replyCount": reply_count,
        },
    ))
    await db.commit()
    await db.refresh(summary)
    await _push_committed_events(db, server_id=server.id)
    return {
        "updated": True,
        "threadSummary": serialize_thread_summary(summary),
    }


@router.post("/threads/unfollow")
async def unfollow_thread(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    thread_id = body.get("threadId") or body.get("thread_id") or body.get("messageId")
    if not thread_id:
        raise HTTPException(400, "Missing threadId")

    _, thread_ref = _split_thread_target(str(thread_id))
    message = await _resolve_message_ref(db, server, thread_ref or str(thread_id))
    root_id = message.parent_id or message.id
    _set_thread_following(member, root_id, False)
    await _record_activity(
        db,
        server,
        member,
        "thread_unfollowed",
        f"@{member.handle} unfollowed thread {root_id}",
        {"threadId": str(root_id), "messageId": str(root_id)},
        channel_id=message.channel_id,
    )
    await db.commit()
    return {"ok": True, "unfollowed": True, "following": False, "threadId": str(root_id)}


@router.post("/threads/follow")
async def follow_thread(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    thread_id = body.get("threadId") or body.get("thread_id") or body.get("messageId")
    if not thread_id:
        raise HTTPException(400, "Missing threadId")

    _, thread_ref = _split_thread_target(str(thread_id))
    message = await _resolve_message_ref(db, server, thread_ref or str(thread_id))
    root_id = message.parent_id or message.id
    _set_thread_following(member, root_id, True)
    await _record_activity(
        db,
        server,
        member,
        "thread_followed",
        f"@{member.handle} followed thread {root_id}",
        {"threadId": str(root_id), "messageId": str(root_id)},
        channel_id=message.channel_id,
    )
    await db.commit()
    return {"ok": True, "followed": True, "following": True, "threadId": str(root_id)}


# ── Reminders ────────────────────────────────────────────────

@router.get("/reminders")
async def list_reminders(
    status: str | None = Query(None),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    q = select(Reminder).where(Reminder.server_id == server.id, Reminder.agent_id == member.id)
    if status:
        q = q.where(Reminder.status == status)
    result = await db.execute(q.order_by(Reminder.fire_at))
    reminders = result.scalars().all()
    return {
        "reminders": [await _serialize_reminder(db, reminder) for reminder in reminders],
        "count": len(reminders),
    }


@router.post("/reminders")
async def create_reminder(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    title = body.get("title")
    if not title:
        raise HTTPException(400, "Missing title")

    if body.get("fireAt"):
        fire_at = _parse_datetime(body["fireAt"])
    elif body.get("delaySeconds") is not None:
        fire_at = _utcnow() + timedelta(seconds=int(body["delaySeconds"]))
    else:
        raise HTTPException(400, "Missing fireAt or delaySeconds")

    channel_id = None
    if body.get("channel"):
        channel = await _resolve_channel(db, server, body["channel"], member=member, create_dm=True)
        channel_id = channel.id

    message_id = None
    if body.get("msgId") or body.get("messageId"):
        try:
            message_id = uuid.UUID(body.get("msgId") or body.get("messageId"))
        except ValueError:
            raise HTTPException(400, "Invalid messageId")

    repeat = None
    if body.get("repeat"):
        repeat = {"cadence": body["repeat"]} if isinstance(body["repeat"], str) else body["repeat"]

    reminder = Reminder(
        server_id=server.id,
        agent_id=member.id,
        title=title,
        description=body.get("description"),
        fire_at=fire_at,
        repeat=repeat,
        channel_id=channel_id,
        message_id=message_id,
        data=body.get("data") or {},
    )
    db.add(reminder)
    await db.flush()
    await _record_activity(
        db,
        server,
        member,
        "custom",
        f"@{member.handle} scheduled reminder: {title}",
        {"reminderId": str(reminder.id), "fireAt": reminder.fire_at.isoformat()},
        channel_id=channel_id,
    )
    await db.commit()
    await db.refresh(reminder)
    return {"created": True, "reminder": await _serialize_reminder(db, reminder)}


@router.patch("/reminders/{reminder_id}")
async def update_reminder(
    reminder_id: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "updateReminder")
    try:
        parsed_id = uuid.UUID(reminder_id)
    except ValueError:
        raise HTTPException(400, "Invalid reminder id")

    result = await db.execute(
        select(Reminder).where(Reminder.id == parsed_id, Reminder.server_id == server.id, Reminder.agent_id == member.id)
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(404, "Reminder not found")

    body = await request.json()
    if "title" in body:
        reminder.title = body["title"]
    if "description" in body:
        reminder.description = body["description"]
    if "fireAt" in body:
        reminder.fire_at = _parse_datetime(body["fireAt"])
        if reminder.status != "cancelled":
            reminder.status = "pending"
    if "delaySeconds" in body:
        reminder.fire_at = _utcnow() + timedelta(seconds=int(body["delaySeconds"]))
        if reminder.status != "cancelled":
            reminder.status = "pending"
    if "repeat" in body:
        reminder.repeat = {"cadence": body["repeat"]} if isinstance(body["repeat"], str) else body["repeat"]
    if "channel" in body:
        channel = await _resolve_channel(db, server, body["channel"], member=member, create_dm=True)
        reminder.channel_id = channel.id
    if "data" in body:
        reminder.data = body["data"] or {}
    if body.get("done"):
        reminder.status = "fired"
        reminder.fired_at = _utcnow()

    await _record_activity(
        db,
        server,
        member,
        "custom",
        f"@{member.handle} updated reminder: {reminder.title}",
        {"reminderId": str(reminder.id), "updates": body},
        channel_id=reminder.channel_id,
    )
    await db.commit()
    await db.refresh(reminder)
    return {"updated": True, "reminder": await _serialize_reminder(db, reminder)}


@router.get("/reminders/{reminder_id}/log")
async def reminder_log(
    reminder_id: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    try:
        parsed_id = uuid.UUID(reminder_id)
    except ValueError:
        raise HTTPException(400, "Invalid reminder id")

    result = await db.execute(
        select(Reminder).where(Reminder.id == parsed_id, Reminder.server_id == server.id, Reminder.agent_id == member.id)
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(404, "Reminder not found")

    activity_result = await db.execute(
        select(ActivityLog)
        .where(
            ActivityLog.server_id == server.id,
            ActivityLog.agent_id == member.id,
            ActivityLog.details.contains({"reminderId": str(parsed_id)}),
        )
        .order_by(ActivityLog.occurred_at)
    )
    entries = [_serialize_activity_log(item) for item in activity_result.scalars().all()]
    return {
        "reminderId": str(reminder.id),
        "entries": entries,
        "count": len(entries),
    }


@router.delete("/reminders/{reminder_id}")
async def cancel_reminder(
    reminder_id: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "updateReminder")
    try:
        parsed_id = uuid.UUID(reminder_id)
    except ValueError:
        raise HTTPException(400, "Invalid reminder id")

    result = await db.execute(
        select(Reminder).where(Reminder.id == parsed_id, Reminder.server_id == server.id, Reminder.agent_id == member.id)
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(404, "Reminder not found")
    reminder.status = "cancelled"
    await _record_activity(
        db,
        server,
        member,
        "custom",
        f"@{member.handle} cancelled reminder: {reminder.title}",
        {"reminderId": str(reminder.id)},
        channel_id=reminder.channel_id,
    )
    await db.commit()
    await db.refresh(reminder)
    return {"cancelled": True, "reminder": await _serialize_reminder(db, reminder)}


# ── Attachments / files ──────────────────────────────────────

@router.post("/upload")
async def upload_attachment(
    file: UploadFile = File(...),
    channelId: str | None = Form(None),
    mimeType: str | None = Form(None),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    try:
        member, server = agent
        _require_permission(member, "fileWrite")
        channel_id = None
        if channelId:
            try:
                channel_id = uuid.UUID(channelId)
            except ValueError:
                raise HTTPException(400, "Invalid channelId")
            result = await db.execute(
                select(Channel).where(Channel.id == channel_id, Channel.server_id == server.id)
            )
            if not result.scalar_one_or_none():
                raise HTTPException(404, "Channel not found")

        file_id = uuid.uuid4()
        safe_name = Path(file.filename or "attachment").name
        storage_path = UPLOAD_ROOT / str(server.id) / f"{file_id}-{safe_name}"
        staged = await stage_upload(
            file,
            final_path=storage_path,
            max_bytes=MAX_UPLOAD_SIZE,
            empty_detail="Empty file",
        )

        entry = FileEntry(
            id=file_id,
            server_id=server.id,
            channel_id=channel_id,
            uploaded_by=member.id,
            file_name=safe_name,
            original_name=safe_name,
            mime_type=mimeType or file.content_type or "application/octet-stream",
            size=staged.size,
            storage_path=str(storage_path),
            metadata_json={},
        )
        try:
            db.add(entry)
            await db.flush()
            await _record_activity(
                db,
                server,
                member,
                "file_created",
                f"@{member.handle} uploaded {safe_name}",
                {
                    "attachmentId": str(entry.id),
                    "fileName": safe_name,
                    "size": staged.size,
                },
                channel_id=channel_id,
            )
            staged.promote()
            await db.commit()
        except BaseException:
            await rollback_and_cleanup_upload(db, staged)
            raise

        await db.refresh(entry)
        serialized = _serialize_file(entry)
        return {"uploaded": True, "attachment": serialized, "file": serialized}
    finally:
        await close_upload(file)


@router.get("/attachments/{attachment_id}")
async def view_attachment(
    attachment_id: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    try:
        parsed_id = uuid.UUID(attachment_id)
    except ValueError:
        raise HTTPException(400, "Invalid attachment id")
    result = await db.execute(
        select(FileEntry).where(FileEntry.id == parsed_id, FileEntry.server_id == server.id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Attachment not found")
    return {"attachment": _serialize_file(entry)}


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    try:
        parsed_id = uuid.UUID(attachment_id)
    except ValueError:
        raise HTTPException(400, "Invalid attachment id")
    result = await db.execute(
        select(FileEntry).where(FileEntry.id == parsed_id, FileEntry.server_id == server.id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Attachment not found")
    path = Path(entry.storage_path).resolve()
    upload_root = UPLOAD_ROOT.resolve()
    if path != upload_root and not str(path).startswith(str(upload_root) + "/"):
        raise HTTPException(403, "Invalid file path")
    if not path.exists():
        raise HTTPException(404, "Attachment file missing")
    return FileResponse(path, media_type=entry.mime_type, filename=entry.original_name)


# ── Scoped Memory ────────────────────────────────────────────

@router.post("/memory/context-manifest")
async def build_agent_memory_context_manifest_route(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    scope_type = str(body.get("scopeType") or body.get("scope") or "").strip()
    scope_id = str(body.get("scopeId") or body.get("id") or "").strip()
    if not scope_type or not scope_id:
        raise HTTPException(400, "Missing scopeType or scopeId")
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=member)
    prompt = str(body.get("prompt") or body.get("query") or "")
    top_k = int(body.get("topK") or body.get("limit") or 3)

    channel_entries = []
    task_entries = []
    if context.scope.type == "channel":
        channel_entries = await list_memory_entries(db, server, context)
    else:
        task_entries = await list_memory_entries(db, server, context)
        if context.channel:
            try:
                channel_context = await resolve_memory_scope(
                    db,
                    server,
                    "channel",
                    str(context.channel.id),
                    viewer=member,
                )
            except HTTPException as exc:
                if exc.status_code != 403:
                    raise
            else:
                channel_entries = await list_memory_entries(db, server, channel_context)

    return build_memory_context_manifest(
        session_scope=context.scope,
        prompt=prompt,
        channel_entries=channel_entries,
        task_entries=task_entries,
        top_k=top_k,
    )


@router.get("/memory/scopes/{scope_type}/{scope_id}")
async def list_agent_scoped_memory(
    scope_type: str,
    scope_id: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=member)
    entries = await list_memory_entries(db, server, context)
    return {"scope": context.scope.as_dict(), "entries": [serialize_memory_entry(entry) for entry in entries]}


@router.get("/memory/scopes/{scope_type}/{scope_id}/path/{path:path}")
async def read_agent_scoped_memory_path(
    scope_type: str,
    scope_id: str,
    path: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=member)
    entry = await get_memory_entry(db, server, context, path)
    return {"entry": serialize_memory_entry(entry)}


@router.get("/memory/scopes/{scope_type}/{scope_id}/search")
async def search_agent_scoped_memory_get(
    scope_type: str,
    scope_id: str,
    q: str = Query(""),
    limit: int = Query(10),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=member)
    entries = await search_memory(db, server, context, q, limit=limit)
    return {"scope": context.scope.as_dict(), "entries": [serialize_memory_entry(entry) for entry in entries]}


@router.post("/memory/scopes/{scope_type}/{scope_id}/search")
async def search_agent_scoped_memory_post(
    scope_type: str,
    scope_id: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=member)
    entries = await search_memory(
        db,
        server,
        context,
        str(body.get("query") or body.get("q") or ""),
        limit=int(body.get("limit") or 10),
    )
    return {"scope": context.scope.as_dict(), "entries": [serialize_memory_entry(entry) for entry in entries]}


@router.put("/memory/scopes/{scope_type}/{scope_id}/path/{path:path}")
async def write_agent_scoped_memory_path(
    scope_type: str,
    scope_id: str,
    path: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=member)
    entry, created = await write_memory_entry(db, server, context, path, body, author=member)
    await db.commit()
    await db.refresh(entry)
    await _push_committed_events(db, server_id=server.id)
    return {"created": created, "entry": serialize_memory_entry(entry)}


@router.post("/memory/scopes/{scope_type}/{scope_id}/proposals")
async def propose_agent_scoped_memory(
    scope_type: str,
    scope_id: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=member)
    proposal = await create_memory_proposal(db, server, context, body, author=member)
    await db.commit()
    await db.refresh(proposal)
    await _push_committed_events(db, server_id=server.id)
    return {"proposal": serialize_memory_proposal(proposal)}


@router.get("/memory/scopes/{scope_type}/{scope_id}/proposals")
async def list_agent_scoped_memory_proposals(
    scope_type: str,
    scope_id: str,
    status: str = Query("open"),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=member)
    proposals = await list_memory_proposals(db, server, context, status=status)
    return {"scope": context.scope.as_dict(), "proposals": [serialize_memory_proposal(proposal) for proposal in proposals]}


@router.post("/memory/proposals/{proposal_id}/accept")
async def accept_agent_memory_proposal(
    proposal_id: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    result = await resolve_memory_proposal(
        db,
        server,
        proposal_id,
        {**body, "status": "accepted"},
        reviewer=member,
    )
    await db.commit()
    await db.refresh(result["proposal"])
    if result.get("entry"):
        await db.refresh(result["entry"])
    await _push_committed_events(db, server_id=server.id)
    return {
        "proposal": serialize_memory_proposal(result["proposal"]),
        "entry": serialize_memory_entry(result["entry"]) if result.get("entry") else None,
    }


@router.post("/memory/proposals/{proposal_id}/reject")
async def reject_agent_memory_proposal(
    proposal_id: str,
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    result = await resolve_memory_proposal(
        db,
        server,
        proposal_id,
        {**body, "status": "rejected"},
        reviewer=member,
    )
    await db.commit()
    await db.refresh(result["proposal"])
    await _push_committed_events(db, server_id=server.id)
    return {"proposal": serialize_memory_proposal(result["proposal"]), "entry": None}


@router.delete("/memory/scopes/{scope_type}/{scope_id}/path/{path:path}")
async def delete_agent_scoped_memory_path(
    scope_type: str,
    scope_id: str,
    path: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=member)
    entry = await delete_memory_entry(db, server, context, path, author=member)
    await db.commit()
    await db.refresh(entry)
    await _push_committed_events(db, server_id=server.id)
    return {"deleted": True, "entry": serialize_memory_entry(entry)}


# ── Profiles ─────────────────────────────────────────────────

@router.get("/profile")
async def get_self_profile(agent: tuple[Member, Server] = Depends(resolve_agent)):
    member, server = agent
    return {"profile": _serialize_member(member)}


@router.get("/profile/{handle}")
async def get_profile(
    handle: str,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    target = await _resolve_member_by_handle(db, server, handle)
    return {"profile": _serialize_member(target)}


@router.post("/profile")
async def update_profile(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "updateProfile")
    body = await request.json()

    if {"name", "handle", "displayName", "description"}.intersection(body):
        raise HTTPException(403, "Agent Name and Description are human-managed and immutable here")
    if "avatarUrl" in body:
        member.avatar_url = body["avatarUrl"]
    if "status" in body:
        member.status = body["status"]
    if "data" in body:
        member.config = {**(member.config or {}), **(body["data"] or {})}

    await _record_activity(
        db,
        server,
        member,
        "profile_updated",
        f"@{member.handle} updated profile",
        {"updates": body},
    )
    await db.commit()
    await db.refresh(member)
    return {"updated": True, "profile": _serialize_member(member)}


@router.post("/profile/avatar")
async def update_profile_avatar(
    avatar: UploadFile = File(...),
    mimeType: str | None = Form(None),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    try:
        member, server = agent
        _require_permission(member, "updateProfile")

        avatar_id = uuid.uuid4()
        safe_name = Path(avatar.filename or "avatar").name
        storage_path = UPLOAD_ROOT / str(server.id) / "avatars" / f"{avatar_id}-{safe_name}"
        staged = await stage_upload(
            avatar,
            final_path=storage_path,
            max_bytes=MAX_UPLOAD_SIZE,
            empty_detail="Empty avatar",
        )

        entry = FileEntry(
            id=avatar_id,
            server_id=server.id,
            uploaded_by=member.id,
            file_name=safe_name,
            original_name=safe_name,
            mime_type=mimeType or avatar.content_type or "application/octet-stream",
            size=staged.size,
            storage_path=str(storage_path),
            metadata_json={"kind": "avatar", "memberId": str(member.id)},
        )
        try:
            db.add(entry)
            await db.flush()

            member.avatar_url = f"/api/attachments/{entry.id}/download"
            await _record_activity(
                db,
                server,
                member,
                "profile_updated",
                f"@{member.handle} updated avatar",
                {"attachmentId": str(entry.id), "avatarUrl": member.avatar_url},
            )
            staged.promote()
            await db.commit()
        except BaseException:
            await rollback_and_cleanup_upload(db, staged)
            raise

        await db.refresh(member)
        await db.refresh(entry)
        return {
            "updated": True,
            "profile": _serialize_member(member),
            "avatar": _serialize_file(entry),
        }
    finally:
        await close_upload(avatar)


# ── Integrations ─────────────────────────────────────────────

def _integration_catalog(configured: dict) -> list[dict]:
    known = ["github", "linear", "notion", "slack"]
    services = sorted(set(known) | set(configured.keys()))
    integrations = []
    for service in services:
        item = configured.get(service) or {}
        integrations.append({
            "service": service,
            "status": item.get("status") or "available",
            "connected": bool(item.get("connected")),
            "scopes": item.get("scopes") or [],
            "redirectUrl": item.get("redirectUrl"),
            "connectedAt": item.get("connectedAt"),
        })
    return integrations


@router.get("/integrations")
async def list_integrations(agent: tuple[Member, Server] = Depends(resolve_agent)):
    member, server = agent
    configured = ((member.config or {}).get("integrations") or {})
    integrations = _integration_catalog(configured)
    return {"integrations": integrations, "count": len(integrations)}


@router.post("/integrations/login")
async def login_integration(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    _require_permission(member, "manageIntegration")
    body = await request.json()
    service = (body.get("service") or body.get("provider") or "").strip()
    if not service:
        raise HTTPException(400, "Missing service")

    raw_scopes = body.get("scopes") or []
    if isinstance(raw_scopes, str):
        scopes = [item.strip() for item in raw_scopes.split(",") if item.strip()]
    elif isinstance(raw_scopes, list):
        scopes = [str(item).strip() for item in raw_scopes if str(item).strip()]
    else:
        raise HTTPException(400, "Invalid scopes")

    config = dict(member.config or {})
    integrations = dict(config.get("integrations") or {})
    integration = {
        "service": service,
        "status": "connected",
        "connected": True,
        "scopes": scopes,
        "redirectUrl": body.get("redirectUrl"),
        "connectedAt": _utcnow().isoformat(),
    }
    integrations[service] = integration
    config["integrations"] = integrations
    member.config = config

    await _record_activity(
        db,
        server,
        member,
        "integration_connected",
        f"@{member.handle} connected {service}",
        {"service": service, "scopes": scopes},
    )
    await db.commit()
    await db.refresh(member)
    return {"connected": True, "login": service, "integration": integration}


# ── Activity / heartbeat ─────────────────────────────────────

@router.get("/activity")
async def list_agent_activity(
    limit: int = Query(50),
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    result = await db.execute(
        select(ActivityLog).where(
            ActivityLog.server_id == server.id,
            ActivityLog.agent_id == member.id,
        ).order_by(ActivityLog.occurred_at.desc()).limit(limit)
    )
    rows = result.scalars().all()
    return {
        "activity": [
            {
                "id": str(item.id),
                "type": item.kind,
                "description": item.description,
                "details": item.details or {},
                "channelId": str(item.channel_id) if item.channel_id else None,
                "taskId": str(item.task_id) if item.task_id else None,
                "timestamp": item.occurred_at.isoformat() if item.occurred_at else None,
            }
            for item in rows
        ],
        "count": len(rows),
    }


RUNTIME_BUSY_MEMBER_STATUS_BY_KIND = {
    "runtime_working": "working",
    "runtime_thinking": "thinking",
}


async def _apply_runtime_activity_member_status(
    db: AsyncSession,
    server: Server,
    member: Member,
    kind: str,
) -> None:
    """Chat-turn busy signal: runtime activity drives the agent member status.

    The frontend status model (thinking/working buckets) expects live busy
    states, but only Task lifecycle set them before. Runtime activities now
    flip the agent to working/thinking for the duration of a turn and back to
    online on idle — without touching task-driven or offline/stopped states.
    """
    next_status = RUNTIME_BUSY_MEMBER_STATUS_BY_KIND.get(kind)
    if next_status is None and kind == "runtime_idle":
        if member.status in {"working", "thinking"}:
            next_status = "online"
    if next_status is None or member.status == next_status:
        return
    previous_status = member.status
    member.status = next_status
    await _record_member_status_event(
        db,
        server,
        member,
        previous_status=previous_status,
        action="runtime_activity",
    )


@router.post("/activity")
async def create_agent_activity(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    kind = body.get("type") or body.get("kind") or "custom"
    description = body.get("description") or f"@{member.handle} reported {kind}"

    channel_id = None
    if body.get("channelId"):
        try:
            channel_id = uuid.UUID(body["channelId"])
        except ValueError:
            raise HTTPException(400, "Invalid channelId")

    task_id = None
    if body.get("taskId"):
        try:
            task_id = uuid.UUID(body["taskId"])
        except ValueError:
            raise HTTPException(400, "Invalid taskId")

    activity = await _record_activity(
        db,
        server,
        member,
        kind,
        description,
        body.get("details") or {},
        channel_id=channel_id,
        task_id=task_id,
    )
    if member.kind == "agent":
        await _apply_runtime_activity_member_status(db, server, member, kind)
    await db.commit()
    # Push recorded events to the public SSE hub — without this the
    # member.status.updated frames sit in event_records and realtime clients
    # (chat busy state, sidebar) never see them until a reconnect catch-up.
    await _push_committed_events(db, server_id=server.id)
    await db.refresh(activity)
    return {
        "created": True,
        "activity": {
            "id": str(activity.id),
            "type": activity.kind,
            "description": activity.description,
            "details": activity.details or {},
            "timestamp": activity.occurred_at.isoformat() if activity.occurred_at else None,
        },
    }


@router.post("/task-runs/{run_id}/lifecycle")
async def update_task_run_lifecycle_endpoint(
    run_id: str,
    body: TaskRunLifecycleRequest,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, _server = agent
    try:
        parsed_run_id = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(400, "Invalid task run id")

    output_message_id = None
    if body.outputMessageId:
        try:
            output_message_id = uuid.UUID(body.outputMessageId)
        except ValueError:
            raise HTTPException(400, "Invalid outputMessageId")
    workspace_id = None
    body_workspace_id = getattr(body, "workspaceId", None)
    if body_workspace_id:
        try:
            workspace_id = uuid.UUID(body_workspace_id)
        except ValueError:
            raise HTTPException(400, "Invalid workspaceId")

    try:
        run = await update_task_run_lifecycle(
            db,
            run_id=parsed_run_id,
            agent_id=member.id,
            status=body.status,
            workspace_id=workspace_id,
            runtime_session_id=body.runtimeSessionId,
            workspace_session_id=body.workspaceSessionId,
            context_session_id=body.contextSessionId,
            context_usage=body.contextUsage,
            token_usage=body.tokenUsage,
            tool_usage_summary=body.toolUsageSummary,
            output_message_id=output_message_id,
            failure_code=body.failureCode,
            failure_reason=body.failureReason,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    if run is None:
        raise HTTPException(404, "TaskRun not found")

    writeback_outcome = None
    feishu_reply_outcome = None
    if run.status in TERMINAL_TASK_RUN_STATUSES:
        writeback_dependencies = build_task_run_writeback_dependencies()
        try:
            writeback_outcome = await handle_terminal_task_run_writeback(
                db,
                task_run=run,
                dependencies=writeback_dependencies,
            )
        finally:
            await close_task_run_writeback_dependencies(writeback_dependencies)
        feishu_reply_dependencies = build_feishu_reply_dependencies()
        try:
            feishu_reply_outcome = await send_task_run_feishu_terminal_reply(
                db,
                task_run=run,
                http_client=feishu_reply_dependencies.http_client,
                config=feishu_reply_dependencies.config,
            )
        finally:
            await close_feishu_reply_dependencies(feishu_reply_dependencies)

    await db.commit()
    await db.refresh(run)
    response = {"ok": True, "run": serialize_task_run(run)}
    if writeback_outcome is not None:
        response["writeBack"] = serialize_task_run_writeback_outcome(writeback_outcome)
    if feishu_reply_outcome is not None:
        response["feishuReply"] = serialize_feishu_reply_orchestration_outcome(feishu_reply_outcome)
    return response


@router.post("/heartbeat")
async def heartbeat(
    request: Request,
    agent: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent
    body = await request.json()
    status = body.get("status") or "active"
    member.status = status

    config = member.config or {}
    computer_id = body.get("computerId") or config.get("computerId")
    workspace_id = body.get("workspaceId") or config.get("workspaceId")

    if computer_id:
        try:
            parsed_computer_id = uuid.UUID(computer_id)
        except ValueError:
            raise HTTPException(400, "Invalid computerId")
        result = await db.execute(
            select(Computer).where(Computer.id == parsed_computer_id, Computer.server_id == server.id)
        )
        computer = result.scalar_one_or_none()
        if computer:
            computer.status = body.get("computerStatus") or "online"
            computer.last_heartbeat_at = _utcnow()
            if "detectedRuntimes" in body:
                computer.detected_runtimes = body["detectedRuntimes"] or []

    if workspace_id:
        try:
            parsed_workspace_id = uuid.UUID(workspace_id)
        except ValueError:
            raise HTTPException(400, "Invalid workspaceId")
        result = await db.execute(
            select(AgentWorkspace).where(AgentWorkspace.id == parsed_workspace_id)
        )
        workspace = result.scalar_one_or_none()
        if workspace:
            workspace.status = body.get("workspaceStatus") or "running"
            workspace.session_id = body.get("sessionId") or workspace.session_id
            workspace.pid = body.get("pid") or workspace.pid
            if "cwd" in body:
                workspace.cwd = body["cwd"]
            if workspace.started_at is None:
                workspace.started_at = _utcnow()

    await db.commit()
    return {"ok": True, "status": status}


@router.post("/llm/runs/acquire")
async def acquire_builtin_llm_run(
    body: LlmRunAcquireRequest,
    agent_ctx: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent_ctx
    require_pi_runtime_member(member)
    run_id = _validated_run_id(body.runId)
    lease, leases = await acquire_run_lease(
        db,
        run_id=run_id,
        server_id=server.id,
        computer_id=_pi_member_computer_id(member),
        agent_id=member.id,
        capacity=max(0, settings.pi_llm_max_active_runs),
        lease_seconds=max(1, settings.pi_llm_lease_seconds),
    )
    await db.commit()
    return serialize_run_lease(lease, leases=leases)


@router.post("/llm/runs/heartbeat")
async def heartbeat_builtin_llm_run(
    body: LlmRunAcquireRequest,
    agent_ctx: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent_ctx
    require_pi_runtime_member(member)
    lease = await get_owned_run_lease(
        db,
        run_id=_validated_run_id(body.runId),
        server_id=server.id,
        computer_id=_pi_member_computer_id(member),
        agent_id=member.id,
    )
    await heartbeat_run_lease(db, lease=lease, lease_seconds=max(1, settings.pi_llm_lease_seconds))
    await db.commit()
    return serialize_run_lease(lease)


@router.post("/llm/runs/release")
async def release_builtin_llm_run(
    body: LlmRunReleaseRequest,
    agent_ctx: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    member, server = agent_ctx
    require_pi_runtime_member(member)
    lease = await get_owned_run_lease(
        db,
        run_id=_validated_run_id(body.runId),
        server_id=server.id,
        computer_id=_pi_member_computer_id(member),
        agent_id=member.id,
    )
    await release_run_lease(
        db,
        lease=lease,
        capacity=max(0, settings.pi_llm_max_active_runs),
        lease_seconds=max(1, settings.pi_llm_lease_seconds),
        failed=body.failed,
        failure_code=(body.failureCode or "")[:80] or None,
    )
    await db.commit()
    return serialize_run_lease(lease)


@router.post("/llm/anthropic/{path:path}")
async def relay_builtin_pi_anthropic_llm(
    path: str,
    request: Request,
    x_smallkhoj_llm_run_id: str = Header(..., alias="X-SmallKhoj-Llm-Run-Id"),
    agent_ctx: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    return await _relay_builtin_pi_llm_impl(path, request, x_smallkhoj_llm_run_id, agent_ctx, db)


@router.post("/llm/openai/v1/{path:path}")
async def relay_builtin_pi_openai_llm(
    path: str,
    request: Request,
    x_smallkhoj_llm_run_id: str = Header(..., alias="X-SmallKhoj-Llm-Run-Id"),
    agent_ctx: tuple[Member, Server] = Depends(resolve_agent),
    db: AsyncSession = Depends(get_db),
):
    return await _relay_builtin_pi_llm_impl(path, request, x_smallkhoj_llm_run_id, agent_ctx, db)


async def _relay_builtin_pi_llm_impl(
    path: str,
    request: Request,
    x_smallkhoj_llm_run_id: str,
    agent_ctx: tuple[Member, Server],
    db: AsyncSession,
):
    member, server = agent_ctx
    require_pi_runtime_member(member)
    lease = await get_owned_run_lease(
        db,
        run_id=_validated_run_id(x_smallkhoj_llm_run_id),
        server_id=server.id,
        computer_id=_pi_member_computer_id(member),
        agent_id=member.id,
    )
    require_active_lease(lease)
    try:
        body = await request.json()
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(400, "Invalid LLM request body")
    if not isinstance(body, dict):
        raise HTTPException(400, "Invalid LLM request body")
    config = resolve_pi_llm_config(settings)
    upstream_url, payload = validate_pi_relay_request(path=path, body=body, config=config)
    # Anthropic 用 x-api-key + anthropic-version，OpenAI 用 Authorization Bearer
    is_anthropic = path.strip("/") in ("messages", "v1/messages")
    headers = {
        "Content-Type": "application/json",
        "Accept": request.headers.get("accept", "application/json"),
    }
    if is_anthropic:
        headers["x-api-key"] = config.api_key
        headers["anthropic-version"] = request.headers.get("anthropic-version", "2023-06-01")
    else:
        headers["Authorization"] = f"Bearer {config.api_key}"
    client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0), trust_env=False)
    upstream_request = client.build_request(
        "POST",
        upstream_url,
        headers=headers,
        json=payload,
    )
    try:
        upstream = await client.send(upstream_request, stream=True)
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(502, "Built-in LLM provider is temporarily unavailable")

    async def stream_upstream():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    response_headers = {}
    if cache_control := upstream.headers.get("cache-control"):
        response_headers["cache-control"] = cache_control
    return StreamingResponse(
        stream_upstream(),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
        headers=response_headers,
    )
