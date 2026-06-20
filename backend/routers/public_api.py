"""Public API routes — frontend-facing endpoints under /api/v1/."""

import hashlib
import hmac
import json
import re
import secrets
import shlex
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException
from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    get_db, Account, AgentWorkspace, ActivityLog, ApiKey, Channel, ChannelMember,
    Computer, ConnectTicket, Member, Message, MessageReaction, EventRecord, FileEntry, Reminder, SavedItem,
    Server, Task, ThreadSummary,
)
from routers.member_serialization import member_backend, member_computer_id, serialize_member
from services.daemon_control import (
    clear_workspace_reference,
    mark_runtime_provider_unavailable,
    PENDING_RUNTIME_START_STATUS,
    RUNTIME_ACTIVE_STATUSES,
    daemon_control_hub,
    push_latest_events_for_server,
    runtime_provider_available,
    runtime_provider_available_for,
    runtime_provider_unavailable_message,
    runtime_provider_unavailable_message_for,
    runtime_control_command,
    runtime_start_command,
)
from services.latency_trace import LatencyTrace, trace_id_from_request
from services.thread_summary import (
    load_thread_metadata,
    resolve_thread_root,
    serialize_thread_summary,
    thread_reply_count,
)

router = APIRouter(prefix="/api/v1", tags=["public"])

PUBLIC_API_KEY = "sk_public_local"
DEFAULT_LOCAL_DAEMON_DIR = Path(__file__).resolve().parents[2] / "agent" / "daemon" / "aaa-daemon"
DEFAULT_DAEMON_LAUNCHER = Path(__file__).resolve().parents[2] / "smallkhoj-daemon"
CONNECT_TICKET_TTL_SECONDS = 300
DEFAULT_SERVER_ID = uuid.UUID("3893c518-c8f8-43ba-af0d-54a7773bbb6d")
DEFAULT_SERVER_NAME = "Slock Server"
SESSION_COOKIE_NAME = "smallkhoj_session"
UPLOAD_ROOT = Path(__file__).resolve().parents[1] / ".data" / "uploads"
MAX_UPLOAD_SIZE = 50 * 1024 * 1024
DANGEROUS_MIME_TYPES = {
    "application/x-msdownload",
    "application/x-executable",
    "application/x-sh",
    "text/x-shellscript",
    "application/x-msdos-program",
    "application/x-dosexec",
    "application/x-php",
    "application/x-python-code",
    "application/javascript",
    "text/javascript",
}
ACCOUNT_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
TASK_NUMBER_RETRY_LIMIT = 5
DELETE_BLOCKING_WORKSPACE_STATUSES = RUNTIME_ACTIVE_STATUSES | {"busy", "starting", "restarting"}

PUBLIC_ACTIVITY_EVENT_TYPES = {
    "supervisor_message_sent": "message.created",
    "supervisor_task_created": "task.created",
    "supervisor_task_updated": "task.updated",
    "supervisor_member_updated": "member.updated",
    "supervisor_reminder_created": "reminder.created",
    "supervisor_reminder_updated": "reminder.updated",
    "workspace_lifecycle": "workspace.updated",
}

HEARTBEAT_ACTIVITY_TYPES = {"workspace_heartbeat"}

EVENT_TYPE_ALIASES = {
    "message.created": "message_received",
    "task.created": "task_created",
    "task.updated": "task_updated",
    "member.updated": "member_updated",
    "reminder.created": "reminder_created",
    "reminder.updated": "reminder_updated",
}


def _computer_connection_command(
    token: str,
    server_url: str,
    daemon_dir: Path = DEFAULT_LOCAL_DAEMON_DIR,
) -> str:
    """Command shown in the UI for connecting this repo's local daemon."""
    del daemon_dir
    return " ".join(
        [
            shlex.quote(str(DEFAULT_DAEMON_LAUNCHER)),
            "start",
            "--machine-token",
            shlex.quote(token),
            "--server",
            shlex.quote(server_url),
        ]
    )


def _computer_connect_command(connect_token: str, server_url: str, daemon_dir: Path = DEFAULT_LOCAL_DAEMON_DIR) -> str:
    """Command shown in the UI for connecting a daemon with a one-time ticket."""
    del daemon_dir
    return " ".join(
        [
            shlex.quote(str(DEFAULT_DAEMON_LAUNCHER)),
            "connect",
            "--token",
            shlex.quote(connect_token),
            "--server",
            shlex.quote(server_url),
        ]
    )

MENTION_RE = re.compile(r"(?<![\w@])@([A-Za-z0-9_.-]+)")


def _utcnow() -> datetime:
    return datetime.utcnow()


def _utcnow_aware() -> datetime:
    return datetime.now(timezone.utc)


def _lease_expired(value: datetime | None) -> bool:
    if not value:
        return False
    now = datetime.now(value.tzinfo) if value.tzinfo else _utcnow()
    return value <= now


async def verify_public_api_key(request: Request, db: AsyncSession = Depends(get_db)):
    """Validate public API key from X-Public-Key header or ?api_key query param."""
    key = request.headers.get("X-Public-Key") or request.query_params.get("api_key")
    if not key:
        raise HTTPException(401, "Missing API key: set X-Public-Key header or api_key param")
    # Check against seed public key
    if key == PUBLIC_API_KEY:
        return
    token_hash = hashlib.sha256(key.encode()).hexdigest()
    result = await db.execute(select(ApiKey).where(ApiKey.key_prefix == key[:20], ApiKey.revoked_at.is_(None)))
    for api_key in result.scalars().all():
        if api_key.token_hash and hmac.compare_digest(api_key.token_hash, token_hash):
            return
    raise HTTPException(401, "Invalid API key")


async def _get_server(db: AsyncSession) -> Server:
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(404, "Server not found")
    return server


async def _ensure_server(db: AsyncSession) -> Server:
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if server:
        return server
    server = Server(id=DEFAULT_SERVER_ID, name=DEFAULT_SERVER_NAME)
    db.add(server)
    await db.flush()
    return server


async def _resolve_member(db: AsyncSession, server: Server, handle_or_id: str | None) -> Member | None:
    if not handle_or_id:
        return None
    try:
        parsed_id = uuid.UUID(handle_or_id)
    except ValueError:
        parsed_id = None
    if parsed_id:
        result = await db.execute(
            select(Member).where(Member.id == parsed_id, Member.server_id == server.id)
        )
    else:
        result = await db.execute(
            select(Member).where(
                Member.server_id == server.id,
                Member.display_name == handle_or_id.lstrip("@"),
            )
        )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(404, f"Member {handle_or_id} not found")
    return member


async def _ensure_human_member(db: AsyncSession, server: Server, handle_or_id: str) -> Member:
    name = handle_or_id.lstrip("@").strip()
    if not name:
        raise HTTPException(400, "Missing human member")

    result = await db.execute(
        select(Member).where(
            Member.server_id == server.id,
            Member.display_name == name,
        )
    )
    member = result.scalar_one_or_none()
    if member:
        return member

    member = Member(
        server_id=server.id,
        kind="human",
        display_name=name,
        status="online",
    )
    db.add(member)
    await db.flush()
    return member


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _normalize_account_name(raw_name: str | None) -> str:
    name = (raw_name or "").strip().lstrip("@")
    if not name:
        raise HTTPException(400, "Missing account name")
    if not ACCOUNT_NAME_RE.fullmatch(name):
        raise HTTPException(400, "Account name must use letters, numbers, dot, underscore, or dash")
    return name


async def _account_from_token(db: AsyncSession, token: str | None) -> Account | None:
    if not token:
        return None
    result = await db.execute(select(Account).where(Account.session_token_hash == _hash_token(token)))
    return result.scalar_one_or_none()


async def _current_account(db: AsyncSession, request: Request) -> Account | None:
    token = request.headers.get("X-Account-Token") or request.cookies.get(SESSION_COOKIE_NAME)
    return await _account_from_token(db, token)


async def _bootstrap_account(
    db: AsyncSession,
    *,
    name: str,
    display_name: str | None = None,
) -> tuple[Account, Server, Member, str]:
    account_name = _normalize_account_name(name)
    server = await _ensure_server(db)
    result = await db.execute(select(Account).where(Account.name == account_name))
    account = result.scalar_one_or_none()
    if account:
        member_result = await db.execute(select(Member).where(Member.id == account.member_id))
        member = member_result.scalar_one_or_none()
        if not member:
            member = await _ensure_human_member(db, server, account_name)
            account.member_id = member.id
        account.server_id = server.id
    else:
        member = await _ensure_human_member(db, server, account_name)
        account = Account(
            name=account_name,
            display_name=display_name or account_name,
            server_id=server.id,
            member_id=member.id,
        )
        db.add(account)
        await db.flush()

    member.status = "online"
    if display_name:
        account.display_name = display_name
    token = f"sk_session_{secrets.token_urlsafe(32)}"
    account.session_token_hash = _hash_token(token)
    account.last_login_at = _utcnow_aware()
    await db.flush()
    return account, server, member, token


async def _resolve_human_actor(
    db: AsyncSession,
    server: Server,
    request: Request,
    explicit_name: str | None,
    *,
    role: str,
    required: bool = True,
) -> Member | None:
    if explicit_name:
        return await _ensure_human_member(db, server, explicit_name)
    account = await _current_account(db, request)
    if account:
        member_result = await db.execute(
            select(Member).where(Member.id == account.member_id, Member.server_id == server.id)
        )
        member = member_result.scalar_one_or_none()
        if member:
            return member
        return await _ensure_human_member(db, server, account.name)
    if required:
        raise HTTPException(401, f"Login required for {role}")
    return None


async def _serialize_account(db: AsyncSession, account: Account, server: Server, member: Member) -> dict:
    return {
        "account": {
            "id": str(account.id),
            "name": account.name,
            "displayName": account.display_name or account.name,
        },
        "server": {
            "id": str(server.id),
            "name": server.name,
        },
        "member": await serialize_member(db, member),
    }


async def _api_key_owner(db: AsyncSession, api_key: ApiKey) -> dict | None:
    if api_key.resource_type == "computer":
        result = await db.execute(select(Computer).where(Computer.id == api_key.resource_id))
        computer = result.scalar_one_or_none()
        if computer:
            return {"id": str(computer.id), "name": computer.name, "type": "computer"}
    if api_key.resource_type in {"agent", "human", "admin"}:
        result = await db.execute(select(Member).where(Member.id == api_key.resource_id))
        member = result.scalar_one_or_none()
        if member:
            return {"id": str(member.id), "name": member.display_name, "type": member.kind}
    return None


async def _serialize_api_key(db: AsyncSession, api_key: ApiKey) -> dict:
    return {
        "id": str(api_key.id),
        "prefix": api_key.key_prefix,
        "resourceType": api_key.resource_type,
        "resourceId": str(api_key.resource_id),
        "owner": await _api_key_owner(db, api_key),
        "createdAt": api_key.created_at.isoformat() if api_key.created_at else None,
        "revokedAt": api_key.revoked_at.isoformat() if api_key.revoked_at else None,
        "revoked": api_key.revoked_at is not None,
    }


async def _parse_mentions(db: AsyncSession, server: Server, content: str) -> list[uuid.UUID]:
    handles = sorted({match.group(1) for match in MENTION_RE.finditer(content or "")})
    if not handles:
        return []
    result = await db.execute(
        select(Member.id).where(
            Member.server_id == server.id,
            Member.display_name.in_(handles),
        )
    )
    return list(result.scalars().all())


def _display_channel_target(channel: Channel) -> str:
    if channel.kind in {"public", "private"}:
        return f"#{channel.name}"
    return channel.name


def _message_target_for_runtime(channel: Channel, sender: Member, *, thread_ref: str | None = None) -> str:
    base = f"dm:@{sender.display_name}" if channel.kind == "dm" else _display_channel_target(channel)
    return f"{base}:{thread_ref}" if thread_ref else base


async def _resolve_channel(db: AsyncSession, server: Server, channel_name: str) -> Channel:
    result = await db.execute(
        select(Channel).where(
            Channel.server_id == server.id,
            Channel.name == channel_name.lstrip("#"),
        )
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(404, f"Channel {channel_name} not found")
    return channel


async def _resolve_message_ref(db: AsyncSession, server: Server, message_ref: str) -> Message:
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


@router.post("/auth/register")
async def register_account(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    body = await request.json()
    account, server, member, token = await _bootstrap_account(
        db,
        name=body.get("name"),
        display_name=body.get("displayName"),
    )
    await db.commit()
    payload = await _serialize_account(db, account, server, member)
    payload["sessionToken"] = token
    return payload


@router.post("/auth/login")
async def login_account(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    body = await request.json()
    account, server, member, token = await _bootstrap_account(
        db,
        name=body.get("name"),
        display_name=body.get("displayName"),
    )
    await db.commit()
    payload = await _serialize_account(db, account, server, member)
    payload["sessionToken"] = token
    return payload


@router.get("/auth/me")
async def current_account(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    account = await _current_account(db, request)
    if not account:
        raise HTTPException(401, "Not logged in")
    server_result = await db.execute(select(Server).where(Server.id == account.server_id))
    server = server_result.scalar_one_or_none()
    member_result = await db.execute(select(Member).where(Member.id == account.member_id))
    member = member_result.scalar_one_or_none()
    if not server or not member:
        raise HTTPException(401, "Account is not linked to a server member")
    return await _serialize_account(db, account, server, member)


@router.post("/auth/logout")
async def logout_account(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    account = await _current_account(db, request)
    if account:
        account.session_token_hash = None
        await db.commit()
    return {"ok": True}


@router.get("/api-keys")
async def list_api_keys(
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    account = await _current_account(db, request)
    if not account or account.server_id != server.id:
        raise HTTPException(401, "Login required for API key management")
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.server_id == server.id)
        .order_by(ApiKey.created_at.desc(), ApiKey.id)
    )
    keys = result.scalars().all()
    return {"apiKeys": [await _serialize_api_key(db, api_key) for api_key in keys], "count": len(keys)}


@router.post("/api-keys")
async def create_api_key(
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    account = await _current_account(db, request)
    if not account or account.server_id != server.id:
        raise HTTPException(401, "Login required for API key management")
    body = await request.json()
    resource_type = str(body.get("resourceType") or "human").strip().lower()
    if resource_type not in {"human", "admin"}:
        raise HTTPException(400, "Only human or admin API keys can be created from Settings")

    token = f"sk_{resource_type}_{secrets.token_urlsafe(32)}"
    api_key = ApiKey(
        key_prefix=token[:20],
        token_hash=_hash_token(token),
        resource_type=resource_type,
        resource_id=account.member_id,
        server_id=server.id,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)
    return {
        "created": True,
        "secret": token,
        "apiKey": await _serialize_api_key(db, api_key),
    }


@router.post("/api-keys/{key_id}/revoke")
async def revoke_api_key(
    key_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    account = await _current_account(db, request)
    if not account or account.server_id != server.id:
        raise HTTPException(401, "Login required for API key management")
    try:
        parsed_key_id = uuid.UUID(key_id)
    except ValueError:
        raise HTTPException(400, "Invalid API key id")

    result = await db.execute(
        select(ApiKey).where(ApiKey.id == parsed_key_id, ApiKey.server_id == server.id)
    )
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(404, "API key not found")
    if api_key.revoked_at is None:
        api_key.revoked_at = _utcnow_aware()
        api_key.token_hash = None
    await db.commit()
    await db.refresh(api_key)
    return {"revoked": True, "apiKey": await _serialize_api_key(db, api_key)}


async def _next_task_number(db: AsyncSession, channel_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Task.task_number), 0)).where(Task.channel_id == channel_id)
    )
    return int(result.scalar() or 0) + 1


def _serialize_workspace(
    workspace: AgentWorkspace,
    agent: Member | None = None,
    *,
    effective_status: str | None = None,
) -> dict:
    status = effective_status or workspace.status
    agent_payload = None
    if agent:
        agent_payload = {
            "id": str(agent.id),
            "name": agent.display_name,
            "displayName": agent.display_name,
            "handle": f"@{agent.display_name}",
            "kind": agent.kind,
            "type": agent.kind,
            "status": agent.status,
            "backend": member_backend(agent),
            "runtimeProvider": (agent.config or {}).get("runtimeProvider"),
            "runtimeLastError": (agent.config or {}).get("runtimeLastError"),
            "computerId": member_computer_id(agent) or str(workspace.computer_id),
            "workspaceId": str(workspace.id),
            "profile": {
                "displayName": agent.display_name,
                "description": agent.description,
                "avatarUrl": agent.avatar_url,
            },
        }
    return {
        "id": str(workspace.id),
        "workspaceId": str(workspace.id),
        "computerId": str(workspace.computer_id),
        "agentId": str(workspace.agent_id),
        "agentName": agent.display_name if agent else None,
        "agentHandle": f"@{agent.display_name}" if agent else None,
        "agentStatus": agent.status if agent else None,
        "backend": member_backend(agent) if agent else None,
        "agent": agent_payload,
        "runtime": _public_runtime(workspace.runtime),
        "runtimeCommand": workspace.runtime_command,
        "runtimeModel": workspace.runtime_model,
        "runtimeProvider": (agent.config or {}).get("runtimeProvider") if agent else None,
        "runtimeLastError": (agent.config or {}).get("runtimeLastError") if agent else None,
        "status": status,
        "sessionId": workspace.session_id,
        "cwd": workspace.cwd,
        "pid": workspace.pid,
        "startedAt": workspace.started_at.isoformat() if workspace.started_at else None,
        "stoppedAt": workspace.stopped_at.isoformat() if workspace.stopped_at else None,
    }


def _delete_blocking_workspace_statuses(workspaces: list[AgentWorkspace]) -> list[str]:
    return sorted({workspace.status for workspace in workspaces if workspace.status in DELETE_BLOCKING_WORKSPACE_STATUSES})


def _detach_agent_from_computer(agent: Member) -> None:
    agent.computer_id = None
    agent.status = "offline"
    config = dict(agent.config or {})
    config.pop("computerId", None)
    config.pop("workspaceId", None)
    config["runtimeAutostart"] = False
    config["runtimeDesiredStatus"] = "stopped"
    agent.config = config


async def _channel_related_ids(db: AsyncSession, channel_ids: list[uuid.UUID]) -> dict[str, list[uuid.UUID]]:
    if not channel_ids:
        return {"message_ids": [], "task_ids": []}
    message_result = await db.execute(select(Message.id).where(Message.channel_id.in_(channel_ids)))
    task_result = await db.execute(select(Task.id).where(Task.channel_id.in_(channel_ids)))
    return {
        "message_ids": list(message_result.scalars().all()),
        "task_ids": list(task_result.scalars().all()),
    }


async def _delete_saved_item_references(
    db: AsyncSession,
    *,
    channel_ids: list[uuid.UUID] | None = None,
    message_ids: list[uuid.UUID] | None = None,
    task_ids: list[uuid.UUID] | None = None,
) -> None:
    conditions = []
    if channel_ids:
        conditions.append((SavedItem.item_type == "channel") & SavedItem.item_id.in_(channel_ids))
    if message_ids:
        conditions.append((SavedItem.item_type == "message") & SavedItem.item_id.in_(message_ids))
    if task_ids:
        conditions.append((SavedItem.item_type == "task") & SavedItem.item_id.in_(task_ids))
    if conditions:
        await db.execute(delete(SavedItem).where(or_(*conditions)))


async def _delete_channels_by_id(db: AsyncSession, channel_ids: list[uuid.UUID]) -> dict[str, int]:
    if not channel_ids:
        return {"channels": 0, "messages": 0, "tasks": 0}
    related = await _channel_related_ids(db, channel_ids)
    await _delete_saved_item_references(
        db,
        channel_ids=channel_ids,
        message_ids=related["message_ids"],
        task_ids=related["task_ids"],
    )
    await db.execute(delete(FileEntry).where(FileEntry.channel_id.in_(channel_ids)))
    await db.execute(delete(Channel).where(Channel.id.in_(channel_ids)))
    return {
        "channels": len(channel_ids),
        "messages": len(related["message_ids"]),
        "tasks": len(related["task_ids"]),
    }


async def _delete_messages_by_id(db: AsyncSession, message_ids: list[uuid.UUID]) -> dict[str, int]:
    if not message_ids:
        return {"messages": 0, "tasks": 0}
    reply_result = await db.execute(select(Message.id).where(Message.parent_id.in_(message_ids)))
    all_message_ids = list(dict.fromkeys([*message_ids, *reply_result.scalars().all()]))
    task_result = await db.execute(select(Task.id).where(Task.message_id.in_(all_message_ids)))
    task_ids = list(task_result.scalars().all())

    await _delete_saved_item_references(db, message_ids=all_message_ids, task_ids=task_ids)
    await db.execute(delete(FileEntry).where(FileEntry.message_id.in_(all_message_ids)))
    await db.execute(delete(Task).where(Task.id.in_(task_ids)))
    await db.execute(delete(ThreadSummary).where(ThreadSummary.root_message_id.in_(all_message_ids)))
    await db.execute(delete(MessageReaction).where(MessageReaction.message_id.in_(all_message_ids)))
    await db.execute(delete(Message).where(Message.parent_id.in_(all_message_ids)))
    await db.execute(delete(Message).where(Message.id.in_(all_message_ids)))
    return {"messages": len(all_message_ids), "tasks": len(task_ids)}


async def _member_dm_channel_ids(db: AsyncSession, server: Server, member_id: uuid.UUID) -> list[uuid.UUID]:
    result = await db.execute(
        select(ChannelMember.channel_id)
        .join(Channel, Channel.id == ChannelMember.channel_id)
        .where(
            Channel.server_id == server.id,
            Channel.kind == "dm",
            ChannelMember.member_id == member_id,
        )
    )
    return list(result.scalars().all())


async def _serialize_computer(db: AsyncSession, computer: Computer) -> dict:
    workspaces_result = await db.execute(
        select(AgentWorkspace).where(AgentWorkspace.computer_id == computer.id)
    )
    workspaces = workspaces_result.scalars().all()

    status = computer.status
    if (
        _lease_expired(computer.daemon_lease_expires_at)
        and status in {"online", "active"}
    ):
        status = "offline"

    workspace_items = []
    for workspace in workspaces:
        agent_result = await db.execute(select(Member).where(Member.id == workspace.agent_id))
        agent = agent_result.scalar_one_or_none()
        effective_status = (
            "offline"
            if status == "offline" and workspace.status in RUNTIME_ACTIVE_STATUSES
            else workspace.status
        )
        workspace_items.append(_serialize_workspace(workspace, agent, effective_status=effective_status))

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
        "agentWorkspaces": workspace_items,
        "createdAt": computer.created_at.isoformat() if computer.created_at else None,
        "updatedAt": computer.updated_at.isoformat() if computer.updated_at else None,
        "lastHeartbeatAt": computer.last_heartbeat_at.isoformat() if computer.last_heartbeat_at else None,
    }


async def _serialize_activity(db: AsyncSession, activity: ActivityLog) -> dict:
    agent_result = await db.execute(select(Member).where(Member.id == activity.agent_id))
    agent = agent_result.scalar_one_or_none()
    return {
        "id": str(activity.id),
        "serverId": str(activity.server_id),
        "agentId": str(activity.agent_id),
        "agentName": agent.display_name if agent else None,
        "type": activity.kind,
        "description": activity.description,
        "details": activity.details or {},
        "channelId": str(activity.channel_id) if activity.channel_id else None,
        "taskId": str(activity.task_id) if activity.task_id else None,
        "timestamp": activity.occurred_at.isoformat() if activity.occurred_at else None,
    }


def compact_activity_feed(items: list[ActivityLog], limit: int) -> list[ActivityLog]:
    latest_heartbeats_by_agent: dict[uuid.UUID, ActivityLog] = {}
    visible_items: list[ActivityLog] = []
    sort_key = lambda item: item.occurred_at or datetime.min.replace(tzinfo=timezone.utc)

    for item in items:
        if item.kind in HEARTBEAT_ACTIVITY_TYPES:
            latest_heartbeats_by_agent.setdefault(item.agent_id, item)
        else:
            visible_items.append(item)

    visible_items.sort(key=sort_key, reverse=True)
    heartbeats = sorted(latest_heartbeats_by_agent.values(), key=sort_key, reverse=True)
    remaining = max(limit - len(visible_items), 0)
    return [*visible_items[:limit], *heartbeats[:remaining]]


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
        "url": f"/api/v1/attachments/{file_entry.id}/download",
        "previewUrl": f"/api/v1/attachments/{file_entry.id}" if file_entry.mime_type.startswith("image/") else None,
        "metadata": file_entry.metadata_json or {},
        "createdAt": file_entry.created_at.isoformat() if file_entry.created_at else None,
    }


def _safe_attachment_path(entry: FileEntry) -> Path:
    path = Path(entry.storage_path).resolve()
    upload_root = UPLOAD_ROOT.resolve()
    if path != upload_root and not str(path).startswith(str(upload_root) + "/"):
        raise HTTPException(403, "Invalid file path")
    if not path.exists():
        raise HTTPException(404, "Attachment file missing")
    return path


async def _serialize_reminder(db: AsyncSession, reminder: Reminder) -> dict:
    agent_result = await db.execute(select(Member).where(Member.id == reminder.agent_id))
    agent = agent_result.scalar_one_or_none()
    return {
        "id": str(reminder.id),
        "serverId": str(reminder.server_id),
        "agentId": str(reminder.agent_id),
        "agentName": agent.display_name if agent else None,
        "title": reminder.title,
        "description": reminder.description,
        "fireAt": reminder.fire_at.isoformat() if reminder.fire_at else None,
        "status": reminder.status,
        "repeat": reminder.repeat,
        "channelId": str(reminder.channel_id) if reminder.channel_id else None,
        "messageId": str(reminder.message_id) if reminder.message_id else None,
        "taskId": str(reminder.task_id) if reminder.task_id else None,
        "data": reminder.data or {},
        "createdAt": reminder.created_at.isoformat() if reminder.created_at else None,
        "updatedAt": reminder.updated_at.isoformat() if reminder.updated_at else None,
        "firedAt": reminder.fired_at.isoformat() if reminder.fired_at else None,
    }


async def _serialize_public_message(
    db: AsyncSession,
    msg: Message,
    thread_metadata: dict[uuid.UUID, dict] | None = None,
) -> dict:
    sender_result = await db.execute(select(Member).where(Member.id == msg.sender_id))
    sender = sender_result.scalar_one_or_none()
    sender_member = await serialize_member(db, sender) if sender else None
    root_id = msg.parent_id or msg.id
    metadata = (thread_metadata or {}).get(root_id, {})
    reactions = await _serialize_public_reactions(db, msg.id)
    return {
        "seq": msg.seq,
        "id": str(msg.id),
        "shortId": msg.short_id,
        "channelId": str(msg.channel_id),
        "sender": f"@{sender.display_name}" if sender else "unknown",
        "senderId": str(msg.sender_id),
        "senderType": sender.kind if sender else "unknown",
        "senderMember": sender_member,
        "content": msg.content,
        "mentions": [str(item) for item in (msg.mentions or [])],
        "parentId": str(msg.parent_id) if msg.parent_id else None,
        "threadId": str(root_id),
        "threadShortId": msg.short_id if not msg.parent_id else None,
        "channelType": msg.channel_type,
        "replyCount": int(metadata.get("replyCount") or 0) if not msg.parent_id else 0,
        "threadSummary": metadata.get("threadSummary") if not msg.parent_id else None,
        "reactions": reactions["items"],
        "reactionCounts": reactions["counts"],
        "time": msg.created_at.strftime("%Y-%m-%d %H:%M:%S") if msg.created_at else "",
        "createdAt": msg.created_at.isoformat() if msg.created_at else None,
    }


async def _serialize_public_reactions(db: AsyncSession, message_id: uuid.UUID) -> dict:
    reactions_result = await db.execute(
        select(MessageReaction)
        .where(MessageReaction.message_id == message_id)
        .order_by(MessageReaction.created_at)
    )
    reactions = reactions_result.scalars().all()

    items = []
    counts: dict[str, int] = {}
    for reaction in reactions:
        member_result = await db.execute(select(Member).where(Member.id == reaction.member_id))
        member = member_result.scalar_one_or_none()
        counts[reaction.reaction] = counts.get(reaction.reaction, 0) + 1
        items.append({
            "id": str(reaction.id),
            "reaction": reaction.reaction,
            "memberId": str(reaction.member_id),
            "member": f"@{member.display_name}" if member else None,
            "createdAt": reaction.created_at.isoformat() if reaction.created_at else None,
        })

    return {"items": items, "counts": counts}


async def _dm_channel_payload(db: AsyncSession, channel: Channel, viewer: Member) -> dict:
    peer_result = await db.execute(
        select(Member)
        .join(ChannelMember, ChannelMember.member_id == Member.id)
        .where(
            ChannelMember.channel_id == channel.id,
            Member.id != viewer.id,
        )
        .order_by(Member.kind.desc(), Member.display_name)
        .limit(1)
    )
    peer = peer_result.scalar_one_or_none()
    return {
        "id": str(channel.id),
        "name": channel.name,
        "type": "dm",
        "displayName": f"DM @{peer.display_name}" if peer else "DM",
        "peer": await serialize_member(db, peer) if peer else None,
    }


async def _serialize_task(db: AsyncSession, task: Task) -> dict:
    creator_result = await db.execute(select(Member).where(Member.id == task.creator_id))
    creator = creator_result.scalar_one_or_none()
    creator_member = await serialize_member(db, creator) if creator else None
    assignee = None
    assignee_member = None
    if task.assignee_id:
        assignee_result = await db.execute(select(Member).where(Member.id == task.assignee_id))
        assignee = assignee_result.scalar_one_or_none()
        assignee_member = await serialize_member(db, assignee) if assignee else None
    channel_result = await db.execute(select(Channel).where(Channel.id == task.channel_id))
    channel = channel_result.scalar_one_or_none()
    return {
        "id": str(task.id),
        "number": task.task_number,
        "taskNumber": task.task_number,
        "channelId": str(task.channel_id),
        "messageId": str(task.message_id) if task.message_id else None,
        "channel": f"#{channel.name}" if channel and channel.kind == "public" else channel.name if channel else None,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "creator": creator.display_name if creator else "unknown",
        "creatorId": str(task.creator_id),
        "creatorMember": creator_member,
        "assignee": assignee.display_name if assignee else None,
        "assigneeId": str(task.assignee_id) if task.assignee_id else None,
        "assigneeMember": assignee_member,
        "data": task.data or {},
        "createdAt": task.created_at.isoformat() if task.created_at else None,
        "updatedAt": task.updated_at.isoformat() if task.updated_at else None,
    }


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
    details = details or {}
    activity = ActivityLog(
        server_id=server.id,
        agent_id=agent.id,
        kind=kind,
        description=description,
        details=details,
        channel_id=channel_id,
        task_id=task_id,
    )
    db.add(activity)
    await db.flush()

    event_type = PUBLIC_ACTIVITY_EVENT_TYPES.get(kind)
    if event_type:
        message_id = None
        raw_message_id = details.get("messageId") or details.get("message_id")
        if raw_message_id:
            try:
                message_id = uuid.UUID(str(raw_message_id))
            except ValueError:
                message_id = None
        payload = {
            "type": event_type,
            "legacyType": EVENT_TYPE_ALIASES.get(event_type, event_type.replace(".", "_")),
            "activityId": str(activity.id),
            "actorId": str(agent.id),
            "agentId": str(agent.id),
            "channelId": str(channel_id) if channel_id else None,
            "taskId": str(task_id) if task_id else None,
            "messageId": str(message_id) if message_id else details.get("messageId"),
            "description": description,
            "details": details,
            "createdAt": activity.occurred_at.isoformat() if activity.occurred_at else None,
            "occurredAt": activity.occurred_at.isoformat() if activity.occurred_at else None,
        }
        payload.update({key: value for key, value in details.items() if key not in payload or payload[key] is None})
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


@router.get("/channels")
async def list_channels(_auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"channels": []}

    result = await db.execute(
        select(Channel).where(Channel.server_id == server.id, Channel.kind != "dm")
    )
    channels = result.scalars().all()

    return {
        "channels": [
            {
                "id": str(ch.id),
                "name": f"#{ch.name}" if ch.kind == "public" else ch.name,
                "type": ch.kind,
                "description": ch.description or "",
            }
            for ch in channels
        ]
    }


@router.get("/channels/{channel_name}/messages")
async def get_channel_messages(
    channel_name: str,
    limit: int = Query(50),
    threadMode: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    name = channel_name.lstrip("#")
    ch_result = await db.execute(
        select(Channel).where(Channel.name == name)
    )
    ch = ch_result.scalar_one_or_none()
    if not ch:
        return {"messages": []}

    q = select(Message).where(Message.channel_id == ch.id)
    if threadMode == "roots":
        q = q.where(Message.parent_id.is_(None))
    msgs_result = await db.execute(q.order_by(Message.seq.desc()).limit(limit))
    messages = list(reversed(msgs_result.scalars().all()))

    root_ids = [msg.id for msg in messages if msg.parent_id is None]
    metadata = await load_thread_metadata(db, root_ids)
    result = [await _serialize_public_message(db, msg, metadata) for msg in messages]

    return {"messages": result, "channelName": name}


@router.get("/threads/{thread_id}")
async def get_public_thread(
    thread_id: str,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    root = await resolve_thread_root(db, server.id, thread_id)
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
    metadata = {
        root.id: {
            "replyCount": len(replies),
            "threadSummary": serialize_thread_summary(summary),
        }
    }
    return {
        "thread": await _serialize_public_message(db, root, metadata),
        "replies": [
            await _serialize_public_message(db, item, metadata)
            for item in replies
        ],
        "messages": [
            await _serialize_public_message(db, item, metadata)
            for item in [root, *replies]
        ],
        "replyCount": len(replies),
        "threadSummary": serialize_thread_summary(summary),
    }


@router.post("/channels/{channel_name}/messages")
async def create_channel_message(
    channel_name: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    body = await request.json()
    trace = LatencyTrace(
        trace_id_from_request(request, body, prefix="message"),
        "public_message_create",
        channel=channel_name,
    )
    trace.mark("backend.public_message.request_received")
    server = await _get_server(db)
    content = body.get("content")
    if not content:
        raise HTTPException(400, "Missing content")
    with trace.time("backend.public_message.resolve"):
        channel = await _resolve_channel(db, server, channel_name)
        sender = await _resolve_human_actor(db, server, request, body.get("sender"), role="message sender")
        parent_id = None
        thread_target_short_id = None
        thread_ref = body.get("threadId") or body.get("parentId")
        if thread_ref:
            try:
                parsed_thread_id = uuid.UUID(thread_ref)
            except ValueError:
                parsed_thread_id = None
            if parsed_thread_id:
                result = await db.execute(
                    select(Message).where(Message.id == parsed_thread_id, Message.channel_id == channel.id)
                )
            else:
                result = await db.execute(
                    select(Message).where(Message.short_id == thread_ref, Message.channel_id == channel.id)
                )
            parent = result.scalar_one_or_none()
            if not parent:
                raise HTTPException(404, "Thread root not found")
            parent_id = parent.parent_id or parent.id
            root = parent
            if parent.parent_id:
                root_result = await db.execute(select(Message).where(Message.id == parent.parent_id))
                root = root_result.scalar_one_or_none() or parent
            thread_target_short_id = root.short_id

    with trace.time("backend.public_message.db_flush"):
        seq_result = await db.execute(select(func.coalesce(func.max(Message.seq), 0)))
        msg = Message(
            short_id=uuid.uuid4().hex[:8],
            channel_id=channel.id,
            sender_id=sender.id,
            parent_id=parent_id,
            content=content,
            channel_type="thread" if parent_id else channel.kind,
            mentions=await _parse_mentions(db, server, content),
            seq=int(seq_result.scalar() or 0) + 1,
        )
        db.add(msg)
        await db.flush()

    event_target = _message_target_for_runtime(channel, sender, thread_ref=thread_target_short_id)
    with trace.time("backend.public_message.event_record", messageId=str(msg.id), shortId=msg.short_id):
        await _record_activity(
            db,
            server,
            sender,
            "supervisor_message_sent",
            f"@{sender.display_name} sent supervisor message to #{channel.name}",
            {
                "traceId": trace.trace_id,
                "messageId": str(msg.id),
                "shortId": msg.short_id,
                "seq": msg.seq,
                "messageSeq": msg.seq,
                "senderId": str(sender.id),
                "content": msg.content,
                "messageSnippet": content[:200],
                "target": event_target,
                "channel": event_target,
                "channelType": msg.channel_type,
                "mentions": [str(item) for item in (msg.mentions or [])],
                "parentId": str(parent_id) if parent_id else None,
                "threadId": str(parent_id or msg.id),
            },
            channel_id=channel.id,
        )
    with trace.time("backend.public_message.commit", messageId=str(msg.id), shortId=msg.short_id):
        await db.commit()
        await db.refresh(msg)
    with trace.time("backend.public_message.push_events", messageId=str(msg.id), shortId=msg.short_id):
        delivered = await push_latest_events_for_server(db, server_id=server.id)
    trace.finish("backend.public_message.response_ready", messageId=str(msg.id), shortId=msg.short_id, delivered=delivered)
    return {
        "created": True,
        "traceId": trace.trace_id,
        "message": {
            "id": str(msg.id),
            "shortId": msg.short_id,
            "seq": msg.seq,
            "channelId": str(channel.id),
            "channel": f"#{channel.name}",
            "sender": f"@{sender.display_name}",
            "senderId": str(sender.id),
            "senderType": sender.kind,
            "senderMember": await serialize_member(db, sender),
            "content": msg.content,
            "parentId": str(parent_id) if parent_id else None,
            "threadId": str(parent_id or msg.id),
            "channelType": msg.channel_type,
            "createdAt": msg.created_at.isoformat() if msg.created_at else None,
        },
    }


@router.post("/messages/{message_ref}/reactions")
async def add_public_message_reaction(
    message_ref: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    body = await request.json()
    reaction_text = (body.get("reaction") or body.get("emoji") or "").strip()
    if not reaction_text:
        raise HTTPException(400, "Missing reaction")

    actor = await _resolve_human_actor(db, server, request, body.get("actor"), role="message reaction actor")
    message = await _resolve_message_ref(db, server, message_ref)
    existing_result = await db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message.id,
            MessageReaction.member_id == actor.id,
            MessageReaction.reaction == reaction_text,
        )
    )
    reaction = existing_result.scalar_one_or_none()
    created = reaction is None
    if reaction is None:
        reaction = MessageReaction(
            message_id=message.id,
            member_id=actor.id,
            reaction=reaction_text,
        )
        db.add(reaction)
        await db.flush()
        await _record_activity(
            db,
            server,
            actor,
            "message_reaction_added",
            f"@{actor.display_name} reacted {reaction_text} to message {message.short_id}",
            {"messageId": str(message.id), "shortId": message.short_id, "reaction": reaction_text},
            channel_id=message.channel_id,
        )

    await db.commit()
    return {
        "created": created,
        "messageId": str(message.id),
        "shortId": message.short_id,
        "reaction": reaction_text,
        "reactions": await _serialize_public_reactions(db, message.id),
    }


@router.delete("/messages/{message_ref}/reactions")
async def remove_public_message_reaction(
    message_ref: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    body = await request.json()
    reaction_text = (body.get("reaction") or body.get("emoji") or "").strip()
    if not reaction_text:
        raise HTTPException(400, "Missing reaction")

    actor = await _resolve_human_actor(db, server, request, body.get("actor"), role="message reaction actor")
    message = await _resolve_message_ref(db, server, message_ref)
    result = await db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message.id,
            MessageReaction.member_id == actor.id,
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
            actor,
            "message_reaction_removed",
            f"@{actor.display_name} removed {reaction_text} from message {message.short_id}",
            {"messageId": str(message.id), "shortId": message.short_id, "reaction": reaction_text},
            channel_id=message.channel_id,
        )

    await db.commit()
    return {
        "removed": removed,
        "messageId": str(message.id),
        "shortId": message.short_id,
        "reaction": reaction_text,
        "reactions": await _serialize_public_reactions(db, message.id),
    }


async def _saved_message_context(db: AsyncSession, server: Server, item_id: uuid.UUID) -> dict:
    result = await db.execute(
        select(Message, Channel)
        .join(Channel, Message.channel_id == Channel.id)
        .where(Channel.server_id == server.id, Message.id == item_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Message not found")
    message, channel = row
    sender_result = await db.execute(select(Member).where(Member.id == message.sender_id))
    sender = sender_result.scalar_one_or_none()
    channel_segment = quote(channel.name, safe="")
    message_query = f"thread={message.parent_id}&message={message.id}" if message.parent_id else f"message={message.id}"
    return {
        "type": "message",
        "itemId": str(message.id),
        "title": (message.content or "")[:120],
        "content": message.content,
        "href": f"/chat/{channel_segment}?{message_query}",
        "channel": _display_channel_target(channel),
        "channelId": str(channel.id),
        "sender": sender.display_name if sender else None,
        "timestamp": message.created_at.isoformat() if message.created_at else None,
    }


async def _saved_task_context(db: AsyncSession, server: Server, item_id: uuid.UUID) -> dict:
    result = await db.execute(
        select(Task)
        .join(Channel, Task.channel_id == Channel.id)
        .where(Channel.server_id == server.id, Task.id == item_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    serialized = await _serialize_task(db, task)
    return {
        "type": "task",
        "itemId": str(task.id),
        "title": task.title,
        "description": task.description,
        "href": f"/tasks?task={task.id}",
        "channel": serialized.get("channel"),
        "status": task.status,
        "taskNumber": task.task_number,
        "timestamp": task.created_at.isoformat() if task.created_at else None,
    }


async def _saved_file_context(db: AsyncSession, server: Server, item_id: uuid.UUID) -> dict:
    result = await db.execute(
        select(FileEntry, Channel)
        .outerjoin(Channel, FileEntry.channel_id == Channel.id)
        .where(FileEntry.server_id == server.id, FileEntry.id == item_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "File not found")
    file_entry, channel = row
    serialized = _serialize_file(file_entry)
    return {
        "type": "file",
        "itemId": str(file_entry.id),
        "title": file_entry.original_name or file_entry.file_name,
        "href": serialized["url"],
        "downloadUrl": serialized["url"],
        "previewUrl": serialized["previewUrl"],
        "channel": _display_channel_target(channel) if channel else None,
        "channelId": str(channel.id) if channel else None,
        "mimeType": file_entry.mime_type,
        "size": file_entry.size,
        "timestamp": file_entry.created_at.isoformat() if file_entry.created_at else None,
    }


async def _saved_item_context(db: AsyncSession, server: Server, item_type: str, item_id: uuid.UUID) -> dict:
    if item_type == "message":
        return await _saved_message_context(db, server, item_id)
    if item_type == "task":
        return await _saved_task_context(db, server, item_id)
    if item_type == "file":
        return await _saved_file_context(db, server, item_id)
    raise HTTPException(400, "Unsupported saved item type")


async def _serialize_saved_item(db: AsyncSession, server: Server, item: SavedItem) -> dict:
    context = await _saved_item_context(db, server, item.item_type, item.item_id)
    return {
        **context,
        "id": str(item.id),
        "serverId": str(item.server_id),
        "accountId": str(item.account_id),
        "memberId": str(item.member_id),
        "itemType": item.item_type,
        "itemId": str(item.item_id),
        "createdAt": item.created_at.isoformat() if item.created_at else None,
    }


@router.get("/saved")
async def list_saved_items(
    request: Request,
    limit: int = Query(20),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    account = await _current_account(db, request)
    if not account or account.server_id != server.id:
        raise HTTPException(401, "Login required")
    requested_limit = max(1, min(limit, 50))
    result = await db.execute(
        select(SavedItem)
        .where(SavedItem.server_id == server.id, SavedItem.account_id == account.id)
        .order_by(SavedItem.created_at.desc())
        .limit(requested_limit)
    )
    items = result.scalars().all()
    return {
        "saved": [await _serialize_saved_item(db, server, item) for item in items],
        "count": len(items),
    }


@router.post("/saved")
async def create_saved_item(
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    account = await _current_account(db, request)
    if not account or account.server_id != server.id:
        raise HTTPException(401, "Login required")
    body = await request.json()
    item_type = str(body.get("itemType") or body.get("type") or "").strip().lower()
    if item_type not in {"message", "task", "file"}:
        raise HTTPException(400, "Unsupported saved item type")
    try:
        item_id = uuid.UUID(str(body.get("itemId") or body.get("id") or ""))
    except ValueError:
        raise HTTPException(400, "Invalid itemId")

    await _saved_item_context(db, server, item_type, item_id)
    existing_result = await db.execute(
        select(SavedItem).where(
            SavedItem.account_id == account.id,
            SavedItem.item_type == item_type,
            SavedItem.item_id == item_id,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        return {"created": False, "saved": await _serialize_saved_item(db, server, existing)}

    item = SavedItem(
        server_id=server.id,
        account_id=account.id,
        member_id=account.member_id,
        item_type=item_type,
        item_id=item_id,
    )
    db.add(item)
    await db.flush()
    await db.commit()
    await db.refresh(item)
    return {"created": True, "saved": await _serialize_saved_item(db, server, item)}


@router.delete("/saved/{saved_id}")
async def delete_saved_item(
    saved_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    account = await _current_account(db, request)
    if not account or account.server_id != server.id:
        raise HTTPException(401, "Login required")
    try:
        parsed_id = uuid.UUID(saved_id)
    except ValueError:
        raise HTTPException(400, "Invalid saved id")
    result = await db.execute(
        select(SavedItem).where(
            SavedItem.server_id == server.id,
            SavedItem.account_id == account.id,
            SavedItem.id == parsed_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Saved item not found")
    await db.delete(item)
    await db.commit()
    return {"removed": True, "id": saved_id}


@router.delete("/saved")
async def delete_saved_item_by_target(
    request: Request,
    item_type: str = Query(..., alias="itemType"),
    item_id: str = Query(..., alias="itemId"),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    account = await _current_account(db, request)
    if not account or account.server_id != server.id:
        raise HTTPException(401, "Login required")
    normalized_type = item_type.strip().lower()
    if normalized_type not in {"message", "task", "file"}:
        raise HTTPException(400, "Unsupported saved item type")
    try:
        parsed_item_id = uuid.UUID(item_id)
    except ValueError:
        raise HTTPException(400, "Invalid itemId")
    result = await db.execute(
        select(SavedItem).where(
            SavedItem.server_id == server.id,
            SavedItem.account_id == account.id,
            SavedItem.item_type == normalized_type,
            SavedItem.item_id == parsed_item_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        return {"removed": False}
    await db.delete(item)
    await db.commit()
    return {"removed": True, "id": str(item.id)}


@router.get("/tasks")
async def list_tasks(_auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Task).order_by(Task.task_number))
    tasks = result.scalars().all()

    task_list = [await _serialize_task(db, task) for task in tasks]

    return {"tasks": task_list}


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    server = await _get_server(db)
    try:
        parsed_task_id = uuid.UUID(task_id)
    except ValueError:
        parsed_task_id = None

    q = select(Task).join(Channel).where(Channel.server_id == server.id)
    if parsed_task_id:
        q = q.where(Task.id == parsed_task_id)
    else:
        try:
            q = q.where(Task.task_number == int(task_id))
        except ValueError:
            raise HTTPException(400, "Invalid task id")

    result = await db.execute(q)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")

    return await _serialize_task(db, task)


@router.post("/tasks")
async def create_task(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    server = await _get_server(db)
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    title = body.get("title")
    if not title:
        raise HTTPException(400, "Missing title")
    channel = await _resolve_channel(db, server, body.get("channel") or "#all")
    creator = await _resolve_human_actor(db, server, request, body.get("creator"), role="task creator")
    assignee = await _resolve_member(db, server, body.get("assignee"))
    channel_id = channel.id
    channel_target = f"#{channel.name}" if channel.kind == "public" else channel.name
    creator_id = creator.id
    creator_name = creator.display_name
    assignee_id = assignee.id if assignee else None
    assignee_name = assignee.display_name if assignee else None
    assignee_kind = assignee.kind if assignee else None
    parsed_message_id = None
    source_payload = None
    if body.get("messageId"):
        try:
            parsed_message_id = uuid.UUID(str(body.get("messageId")))
        except ValueError:
            raise HTTPException(400, "Invalid messageId")
        message_result = await db.execute(
            select(Message).where(Message.id == parsed_message_id, Message.channel_id == channel_id)
        )
        source_message = message_result.scalar_one_or_none()
        if not source_message:
            raise HTTPException(404, "Source message not found in task channel")
        source_payload = {
            "type": "message",
            "messageId": str(source_message.id),
            "messageShortId": source_message.short_id,
            "threadId": str(source_message.parent_id or source_message.id),
            "channelId": str(channel_id),
            "channel": channel_target,
        }
    task_data = body.get("data") or {}
    if source_payload:
        task_data = {**task_data, "source": source_payload}
    status = body.get("status") or "todo"

    task = None
    rolled_back = False
    for attempt in range(TASK_NUMBER_RETRY_LIMIT):
        task = Task(
            task_number=await _next_task_number(db, channel_id),
            channel_id=channel_id,
            message_id=parsed_message_id,
            title=title,
            description=body.get("description"),
            status=status,
            creator_id=creator_id,
            assignee_id=assignee_id,
            data=task_data,
        )
        db.add(task)
        try:
            await db.flush()
            break
        except IntegrityError as exc:
            await db.rollback()
            rolled_back = True
            if "tasks_channel_id_task_number_key" not in str(exc) or attempt == TASK_NUMBER_RETRY_LIMIT - 1:
                raise
    if task is None:
        raise HTTPException(500, "Task creation failed")

    if rolled_back:
        server = await _get_server(db)
        channel_result = await db.execute(select(Channel).where(Channel.id == channel_id))
        channel = channel_result.scalar_one()
        creator_result = await db.execute(select(Member).where(Member.id == creator_id))
        creator = creator_result.scalar_one()
        if assignee_id:
            assignee_result = await db.execute(select(Member).where(Member.id == assignee_id))
            assignee = assignee_result.scalar_one_or_none()
        channel_target = f"#{channel.name}" if channel.kind == "public" else channel.name

    assignee_handle = f"@{assignee_name}" if assignee_name else None

    await _record_activity(
        db,
        server,
        creator,
        "supervisor_task_created",
        f"@{creator_name} created task #{task.task_number}",
        {
            "taskNumber": task.task_number,
            "title": task.title,
            "status": task.status,
            "assignee": assignee_handle,
            "assigneeId": str(assignee_id) if assignee_id else None,
            "targetAgentId": str(assignee_id) if assignee_id and assignee_kind == "agent" else None,
            "target": channel_target,
            "channel": channel_target,
            "messageId": str(parsed_message_id) if parsed_message_id else None,
            "source": source_payload,
        },
        channel_id=channel_id,
        task_id=task.id,
    )

    await db.commit()
    await db.refresh(task)
    await push_latest_events_for_server(db, server_id=server.id)
    return {"created": True, "task": await _serialize_task(db, task)}


@router.patch("/tasks/{task_id}")
async def update_task(task_id: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    server = await _get_server(db)
    body = await request.json()
    try:
        parsed_task_id = uuid.UUID(task_id)
    except ValueError:
        parsed_task_id = None

    q = select(Task).join(Channel).where(Channel.server_id == server.id)
    if parsed_task_id:
        q = q.where(Task.id == parsed_task_id)
    else:
        try:
            q = q.where(Task.task_number == int(task_id))
        except ValueError:
            raise HTTPException(400, "Invalid task id")
    result = await db.execute(q)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")

    if "title" in body:
        task.title = body["title"]
    if "description" in body:
        task.description = body["description"]
    if "status" in body:
        task.status = body["status"]
    if "assignee" in body:
        assignee = await _resolve_member(db, server, body.get("assignee"))
        task.assignee_id = assignee.id if assignee else None
    if "data" in body:
        task.data = body["data"] or {}

    actor = await _resolve_human_actor(db, server, request, body.get("actor"), role="task actor")
    assignee = None
    if task.assignee_id:
        assignee_result = await db.execute(select(Member).where(Member.id == task.assignee_id))
        assignee = assignee_result.scalar_one_or_none()
    await _record_activity(
        db,
        server,
        actor,
        "supervisor_task_updated",
        f"@{actor.display_name} updated task #{task.task_number}",
        {
            "taskNumber": task.task_number,
            "title": task.title,
            "status": task.status,
            "updates": body,
            "assignee": f"@{assignee.display_name}" if assignee else None,
            "assigneeId": str(assignee.id) if assignee else None,
            "targetAgentId": str(assignee.id) if assignee and assignee.kind == "agent" else None,
        },
        channel_id=task.channel_id,
        task_id=task.id,
    )
    await db.commit()
    await db.refresh(task)
    await push_latest_events_for_server(db, server_id=server.id)
    return {"updated": True, "task": await _serialize_task(db, task)}


@router.get("/computers")
async def list_computers(_auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"computers": []}

    result = await db.execute(select(Computer).where(Computer.server_id == server.id))
    computers = result.scalars().all()
    return {
        "computers": [await _serialize_computer(db, computer) for computer in computers],
        "count": len(computers),
    }


@router.delete("/computers/{computer_id}")
async def delete_computer(
    computer_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_computer_id = uuid.UUID(computer_id)
    except ValueError:
        raise HTTPException(400, "Invalid computer id")

    result = await db.execute(
        select(Computer).where(Computer.id == parsed_computer_id, Computer.server_id == server.id)
    )
    computer = result.scalar_one_or_none()
    if not computer:
        raise HTTPException(404, "Computer not found")

    actor = await _resolve_human_actor(db, server, request, None, role="computer deletion actor")
    workspaces_result = await db.execute(
        select(AgentWorkspace).where(AgentWorkspace.computer_id == computer.id)
    )
    workspaces = list(workspaces_result.scalars().all())
    blocking_statuses = _delete_blocking_workspace_statuses(workspaces)
    if blocking_statuses:
        raise HTTPException(409, f"Stop runtimes before deleting computer; blocking statuses: {', '.join(blocking_statuses)}")

    members_result = await db.execute(select(Member).where(Member.computer_id == computer.id))
    bound_members = list(members_result.scalars().all())
    for member in bound_members:
        _detach_agent_from_computer(member)

    await db.execute(delete(ApiKey).where(
        ApiKey.server_id == server.id,
        ApiKey.resource_type == "computer",
        ApiKey.resource_id == computer.id,
    ))
    for workspace in workspaces:
        await db.delete(workspace)
    await db.delete(computer)
    await _record_activity(
        db,
        server,
        actor,
        "workspace_lifecycle",
        f"@{actor.display_name} deleted computer {computer.name}",
        {
            "computerId": str(computer.id),
            "computerName": computer.name,
            "action": "delete_computer",
            "deletedWorkspaces": len(workspaces),
            "detachedAgents": len(bound_members),
        },
    )
    await db.commit()
    await push_latest_events_for_server(db, server_id=server.id)
    return {
        "ok": True,
        "deleted": True,
        "computerId": str(computer.id),
        "computerName": computer.name,
        "workspaces": len(workspaces),
        "detachedAgents": len(bound_members),
    }


@router.get("/activity")
async def list_activity(
    agent_id: str | None = Query(None, alias="agentId"),
    task_id: str | None = Query(None, alias="taskId"),
    limit: int = Query(50),
    compact: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"activity": [], "count": 0}

    requested_limit = max(1, min(limit, 100))
    query_limit = min(max(requested_limit * 20, 250), 500) if compact else requested_limit
    q = select(ActivityLog).where(ActivityLog.server_id == server.id)
    if agent_id:
        try:
            parsed_agent_id = uuid.UUID(agent_id)
        except ValueError:
            raise HTTPException(400, "Invalid agentId")
        q = q.where(ActivityLog.agent_id == parsed_agent_id)
    if task_id:
        try:
            parsed_task_id = uuid.UUID(task_id)
        except ValueError:
            raise HTTPException(400, "Invalid taskId")
        q = q.where(ActivityLog.task_id == parsed_task_id)
    q = q.order_by(ActivityLog.occurred_at.desc()).limit(query_limit)

    result = await db.execute(q)
    items = result.scalars().all()
    if compact:
        items = compact_activity_feed(items, requested_limit)
    return {
        "activity": [await _serialize_activity(db, item) for item in items],
        "count": len(items),
    }


@router.get("/search")
async def global_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(20),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    if not server:
        return {"results": [], "count": 0}

    requested_limit = max(1, min(limit, 50))
    safe_term = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{safe_term}%"
    results = []

    msg_stmt = (
        select(Message, Channel)
        .join(Channel, Message.channel_id == Channel.id)
        .where(Channel.server_id == server.id, Message.content.ilike(pattern, escape="\\"))
        .order_by(Message.created_at.desc())
        .limit(requested_limit)
    )
    for msg, ch in (await db.execute(msg_stmt)).all():
        sender = (await db.execute(select(Member).where(Member.id == msg.sender_id))).scalar_one_or_none()
        channel_segment = quote(ch.name if ch else "", safe="")
        message_query = f"thread={msg.parent_id}&message={msg.id}" if msg.parent_id else f"message={msg.id}"
        results.append({
            "type": "message",
            "id": str(msg.id),
            "title": (msg.content or "")[:120],
            "content": msg.content,
            "href": f"/chat/{channel_segment}?{message_query}" if ch else None,
            "channel": _display_channel_target(ch) if ch else None,
            "channelId": str(ch.id) if ch else None,
            "sender": sender.display_name if sender else None,
            "timestamp": msg.created_at.isoformat() if msg.created_at else None,
        })

    task_stmt = (
        select(Task, Channel)
        .join(Channel, Task.channel_id == Channel.id)
        .where(
            Channel.server_id == server.id,
            or_(
                Task.title.ilike(pattern, escape="\\"),
                Task.description.ilike(pattern, escape="\\"),
            ),
        )
        .order_by(Task.created_at.desc())
        .limit(requested_limit)
    )
    for task, ch in (await db.execute(task_stmt)).all():
        results.append({
            "type": "task",
            "id": str(task.id),
            "taskNumber": task.task_number,
            "title": task.title,
            "description": task.description,
            "status": task.status,
            "channel": _display_channel_target(ch),
            "href": f"/tasks?task={task.id}",
        })

    member_stmt = select(Member).where(
        Member.server_id == server.id,
        or_(
            Member.display_name.ilike(pattern, escape="\\"),
            Member.description.ilike(pattern, escape="\\"),
        ),
    ).limit(requested_limit)
    for member in (await db.execute(member_stmt)).scalars().all():
        results.append({
            "type": "member",
            "id": str(member.id),
            "title": member.display_name,
            "description": member.description,
            "handle": f"@{member.display_name}",
            "kind": member.kind,
            "href": f"/members?member={member.id}",
        })

    channel_stmt = select(Channel).where(
        Channel.server_id == server.id,
        or_(
            Channel.name.ilike(pattern, escape="\\"),
            Channel.description.ilike(pattern, escape="\\"),
        ),
    ).limit(requested_limit)
    for ch in (await db.execute(channel_stmt)).scalars().all():
        channel_segment = quote(ch.name, safe="")
        results.append({
            "type": "channel",
            "id": str(ch.id),
            "title": _display_channel_target(ch),
            "description": ch.description,
            "channelType": ch.kind,
            "href": f"/chat/{channel_segment}",
        })

    file_stmt = (
        select(FileEntry, Channel)
        .outerjoin(Channel, FileEntry.channel_id == Channel.id)
        .where(
            FileEntry.server_id == server.id,
            or_(
                FileEntry.original_name.ilike(pattern, escape="\\"),
                FileEntry.file_name.ilike(pattern, escape="\\"),
            ),
        )
        .order_by(FileEntry.created_at.desc())
        .limit(requested_limit)
    )
    for f, ch in (await db.execute(file_stmt)).all():
        serialized = _serialize_file(f)
        channel_segment = quote(ch.name, safe="") if ch else ""
        results.append({
            "type": "file",
            "id": str(f.id),
            "title": f.original_name or f.file_name,
            "mimeType": f.mime_type,
            "size": f.size,
            "channel": _display_channel_target(ch) if ch else None,
            "channelId": str(ch.id) if ch else None,
            "href": serialized["url"],
            "downloadUrl": serialized["url"],
            "previewUrl": serialized["previewUrl"],
            "createdAt": serialized["createdAt"],
        })

    return {"results": results, "count": len(results), "query": q}


@router.get("/files")
async def list_files(
    channel_id: str | None = Query(None, alias="channelId"),
    limit: int = Query(50),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"files": [], "count": 0}

    q = select(FileEntry).where(FileEntry.server_id == server.id)
    if channel_id:
        try:
            parsed_channel_id = uuid.UUID(channel_id)
        except ValueError:
            raise HTTPException(400, "Invalid channelId")
        q = q.where(FileEntry.channel_id == parsed_channel_id)
    q = q.order_by(FileEntry.created_at.desc()).limit(limit)

    result = await db.execute(q)
    files = result.scalars().all()
    return {"files": [_serialize_file(item) for item in files], "count": len(files)}


@router.post("/files")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    channel_id: str = Query(..., alias="channelId"),
    message_id: str | None = Query(None, alias="messageId"),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    if not server:
        raise HTTPException(500, "Server not initialized")

    try:
        parsed_channel_id = uuid.UUID(channel_id)
    except ValueError:
        raise HTTPException(400, "Invalid channelId")

    channel_result = await db.execute(
        select(Channel).where(Channel.id == parsed_channel_id, Channel.server_id == server.id)
    )
    channel = channel_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(404, "Channel not found")

    parsed_message_id = None
    if message_id:
        try:
            parsed_message_id = uuid.UUID(message_id)
        except ValueError:
            raise HTTPException(400, "Invalid messageId")
        message_result = await db.execute(
            select(Message).where(Message.id == parsed_message_id, Message.channel_id == parsed_channel_id)
        )
        if not message_result.scalar_one_or_none():
            raise HTTPException(404, "Message not found in channel")

    member = await _resolve_human_actor(db, server, request, None, role="file upload")
    if not member:
        raise HTTPException(401, "Login required")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, f"File exceeds {MAX_UPLOAD_SIZE // (1024 * 1024)} MB limit")

    mime_type = file.content_type or "application/octet-stream"
    if mime_type in DANGEROUS_MIME_TYPES:
        raise HTTPException(400, f"File type '{mime_type}' is not allowed")

    file_id = uuid.uuid4()
    safe_name = Path(file.filename or "attachment").name
    storage_dir = UPLOAD_ROOT / str(server.id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    storage_path = storage_dir / f"{file_id}-{safe_name}"
    storage_path.write_bytes(data)

    entry = FileEntry(
        id=file_id,
        server_id=server.id,
        channel_id=parsed_channel_id,
        message_id=parsed_message_id,
        uploaded_by=member.id,
        file_name=safe_name,
        original_name=safe_name,
        mime_type=mime_type,
        size=len(data),
        storage_path=str(storage_path),
        metadata_json={},
    )
    db.add(entry)
    await db.flush()
    await db.commit()
    await db.refresh(entry)

    return _serialize_file(entry)


async def _get_public_attachment(db: AsyncSession, server: Server, attachment_id: str) -> FileEntry:
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
    return entry


@router.get("/attachments/{attachment_id}")
async def preview_attachment(
    attachment_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    await _resolve_human_actor(db, server, request, None, role="attachment viewer")
    entry = await _get_public_attachment(db, server, attachment_id)
    path = _safe_attachment_path(entry)
    return FileResponse(path, media_type=entry.mime_type)


@router.get("/attachments/{attachment_id}/download")
async def download_public_attachment(
    attachment_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    await _resolve_human_actor(db, server, request, None, role="attachment viewer")
    entry = await _get_public_attachment(db, server, attachment_id)
    path = _safe_attachment_path(entry)
    return FileResponse(path, media_type=entry.mime_type, filename=entry.original_name)


@router.get("/reminders")
async def list_reminders(
    status: str | None = Query(None),
    limit: int = Query(50),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"reminders": [], "count": 0}

    q = select(Reminder).where(Reminder.server_id == server.id)
    if status:
        q = q.where(Reminder.status == status)
    q = q.order_by(Reminder.fire_at).limit(limit)
    result = await db.execute(q)
    reminders = result.scalars().all()
    return {
        "reminders": [await _serialize_reminder(db, item) for item in reminders],
        "count": len(reminders),
    }


@router.get("/members")
async def list_members(_auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Server).limit(1))
    server = result.scalar_one_or_none()
    if not server:
        return {"members": []}

    result = await db.execute(select(Member).where(Member.server_id == server.id))
    members = result.scalars().all()

    agent_computer_ids = [m.computer_id for m in members if m.kind == "agent" and m.computer_id]
    computers_map: dict[uuid.UUID, Computer] = {}
    if agent_computer_ids:
        comp_result = await db.execute(
            select(Computer).where(Computer.id.in_(agent_computer_ids))
        )
        computers_map = {c.id: c for c in comp_result.scalars().all()}

    return {
        "members": [
            await serialize_member(db, member, _computer=computers_map.get(member.computer_id))
            for member in members
        ],
        "count": len(members),
    }


@router.patch("/members/{member_id}")
async def update_member(member_id: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    server = await _get_server(db)
    member = await _resolve_member(db, server, member_id)
    if not member:
        raise HTTPException(404, "Member not found")
    body = await request.json()

    if "status" in body:
        member.status = body["status"]
    if "description" in body:
        member.description = body["description"]
    config = dict(member.config or {})
    if "permissions" in body:
        config["permissions"] = body.get("permissions") or {}
    if "actions" in body:
        config["actions"] = body.get("actions") or {}
    if "backend" in body:
        config["backend"] = body["backend"]
        member.backend = body["backend"]
    if "runtimeProvider" in body:
        runtime_provider = str(body["runtimeProvider"]).strip() if body["runtimeProvider"] is not None else ""
        config["runtimeProvider"] = runtime_provider or None
    member.config = config

    actor = await _resolve_human_actor(db, server, request, body.get("actor"), role="member actor")
    await _record_activity(
        db,
        server,
        actor,
        "supervisor_member_updated",
        f"@{actor.display_name} updated @{member.display_name}",
        {
            "memberId": str(member.id),
            "status": member.status,
            "permissions": body.get("permissions") or {},
            "actions": body.get("actions") or {},
        },
    )
    await db.commit()
    await db.refresh(member)
    return {"updated": True, "member": await serialize_member(db, member)}


@router.delete("/members/{member_id}")
async def delete_member(
    member_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    member = await _resolve_member(db, server, member_id)
    if not member:
        raise HTTPException(404, "Member not found")
    if member.kind != "agent":
        raise HTTPException(400, "Only agent deletion is supported from this surface")

    actor = await _resolve_human_actor(db, server, request, None, role="member deletion actor")
    workspaces_result = await db.execute(select(AgentWorkspace).where(AgentWorkspace.agent_id == member.id))
    workspaces = list(workspaces_result.scalars().all())
    blocking_statuses = _delete_blocking_workspace_statuses(workspaces)
    if blocking_statuses:
        raise HTTPException(409, f"Stop runtime before deleting agent; blocking statuses: {', '.join(blocking_statuses)}")

    dm_channel_ids = await _member_dm_channel_ids(db, server, member.id)
    deleted_channels = await _delete_channels_by_id(db, dm_channel_ids)

    authored_messages_result = await db.execute(
        select(Message.id)
        .join(Channel, Channel.id == Message.channel_id)
        .where(Channel.server_id == server.id, Message.sender_id == member.id)
    )
    deleted_messages = await _delete_messages_by_id(db, list(authored_messages_result.scalars().all()))

    task_ids_result = await db.execute(select(Task.id).where(Task.creator_id == member.id))
    created_task_ids = list(task_ids_result.scalars().all())
    await _delete_saved_item_references(db, task_ids=created_task_ids)
    await db.execute(delete(Task).where(Task.creator_id == member.id))
    await db.execute(update(Task).where(Task.assignee_id == member.id).values(assignee_id=None))
    await db.execute(update(Channel).where(Channel.creator_id == member.id).values(creator_id=None))
    await db.execute(update(ThreadSummary).where(ThreadSummary.requested_agent_id == member.id).values(requested_agent_id=None))
    await db.execute(update(ThreadSummary).where(ThreadSummary.updated_by == member.id).values(updated_by=None))
    await db.execute(delete(ApiKey).where(
        ApiKey.server_id == server.id,
        ApiKey.resource_type == "agent",
        ApiKey.resource_id == member.id,
    ))
    for workspace in workspaces:
        await db.delete(workspace)
    await db.delete(member)
    await _record_activity(
        db,
        server,
        actor,
        "supervisor_member_updated",
        f"@{actor.display_name} deleted agent @{member.display_name}",
        {
            "memberId": str(member.id),
            "memberName": member.display_name,
            "action": "delete",
            "deletedWorkspaces": len(workspaces),
            "deletedDmChannels": deleted_channels["channels"],
            "deletedMessages": deleted_channels["messages"] + deleted_messages["messages"],
            "deletedTasks": deleted_channels["tasks"] + deleted_messages["tasks"] + len(created_task_ids),
        },
    )
    await db.commit()
    await push_latest_events_for_server(db, server_id=server.id)
    return {
        "ok": True,
        "deleted": True,
        "memberId": str(member.id),
        "memberName": member.display_name,
        "workspaces": len(workspaces),
        "dmChannels": deleted_channels["channels"],
        "messages": deleted_channels["messages"] + deleted_messages["messages"],
        "tasks": deleted_channels["tasks"] + deleted_messages["tasks"] + len(created_task_ids),
    }


@router.post("/reminders")
async def create_public_reminder(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    server = await _get_server(db)
    body = await request.json()
    title = body.get("title")
    if not title:
        raise HTTPException(400, "Missing title")
    agent_ref = body.get("agent") or body.get("agentId")
    if not agent_ref:
        raise HTTPException(400, "Missing agent")
    agent = await _resolve_member(db, server, agent_ref)
    if not agent or agent.kind != "agent":
        raise HTTPException(400, "Reminder owner must be an agent")
    if body.get("fireAt"):
        try:
            fire_at = datetime.fromisoformat(str(body["fireAt"]).replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "Invalid fireAt")
    elif body.get("delaySeconds") is not None:
        fire_at = _utcnow() + timedelta(seconds=int(body["delaySeconds"]))
    else:
        raise HTTPException(400, "Missing fireAt or delaySeconds")

    channel_id = None
    if body.get("channel"):
        channel = await _resolve_channel(db, server, body["channel"])
        channel_id = channel.id
    reminder = Reminder(
        server_id=server.id,
        agent_id=agent.id,
        title=title,
        description=body.get("description"),
        fire_at=fire_at,
        repeat=body.get("repeat"),
        channel_id=channel_id,
        data=body.get("data") or {},
    )
    db.add(reminder)
    await db.flush()
    await _record_activity(
        db,
        server,
        agent,
        "supervisor_reminder_created",
        f"Supervisor scheduled reminder for @{agent.display_name}: {title}",
        {"reminderId": str(reminder.id), "fireAt": reminder.fire_at.isoformat()},
        channel_id=channel_id,
    )
    await db.commit()
    await db.refresh(reminder)
    return {"created": True, "reminder": await _serialize_reminder(db, reminder)}


@router.patch("/reminders/{reminder_id}")
async def update_public_reminder(reminder_id: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    server = await _get_server(db)
    try:
        parsed_id = uuid.UUID(reminder_id)
    except ValueError:
        raise HTTPException(400, "Invalid reminder id")
    result = await db.execute(
        select(Reminder).where(Reminder.id == parsed_id, Reminder.server_id == server.id)
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(404, "Reminder not found")
    body = await request.json()
    if "status" in body:
        reminder.status = body["status"]
    if "title" in body:
        reminder.title = body["title"]
    if "description" in body:
        reminder.description = body["description"]
    if "fireAt" in body:
        try:
            reminder.fire_at = datetime.fromisoformat(str(body["fireAt"]).replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "Invalid fireAt")
    if "delaySeconds" in body:
        reminder.fire_at = _utcnow() + timedelta(seconds=int(body["delaySeconds"]))
    if "repeat" in body:
        reminder.repeat = body["repeat"]
    if body.get("cancel"):
        reminder.status = "cancelled"
    await db.commit()
    await db.refresh(reminder)
    return {"updated": True, "reminder": await _serialize_reminder(db, reminder)}


# ── Computer Credential ───────────────────────────────────────


@router.post("/computers/connect-command")
async def generate_computer_connect_command(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    server = await _ensure_server(db)
    body = await request.json()
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Missing name")

    token = f"sk_connect_{secrets.token_urlsafe(32)}"
    expires_at = _utcnow_aware() + timedelta(seconds=CONNECT_TICKET_TTL_SECONDS)
    db.add(ConnectTicket(
        server_id=server.id,
        key_prefix=token[:20],
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        requested_name=name,
        expires_at=expires_at,
    ))
    server_url = body.get("serverUrl", "http://localhost:8000")
    await db.commit()
    return {
        "connectToken": token,
        "command": _computer_connect_command(token, server_url),
        "expiresAt": expires_at.isoformat(),
    }


@router.post("/computers/{computer_id}/reconnect-command")
async def generate_computer_reconnect_command(
    computer_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_computer_id = uuid.UUID(computer_id)
    except ValueError:
        raise HTTPException(400, "Invalid computer id")

    result = await db.execute(
        select(Computer).where(Computer.id == parsed_computer_id, Computer.server_id == server.id)
    )
    computer = result.scalar_one_or_none()
    if not computer:
        raise HTTPException(404, "Computer not found")

    token = f"sk_connect_{secrets.token_urlsafe(32)}"
    expires_at = _utcnow_aware() + timedelta(seconds=CONNECT_TICKET_TTL_SECONDS)
    db.add(ConnectTicket(
        server_id=server.id,
        key_prefix=token[:20],
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        requested_name=computer.name,
        expires_at=expires_at,
    ))
    server_url = (await request.json()).get("serverUrl", "http://localhost:8000")
    await db.commit()
    return {
        "connectToken": token,
        "computerId": str(computer.id),
        "name": computer.name,
        "command": _computer_connect_command(token, server_url),
        "expiresAt": expires_at.isoformat(),
    }


@router.post("/workspaces/{workspace_id}/lifecycle")
async def control_workspace_lifecycle(
    workspace_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_workspace_id = uuid.UUID(workspace_id)
    except ValueError:
        raise HTTPException(400, "Invalid workspace id")

    body = await request.json()
    action = str(body.get("action") or "").strip().lower()
    command_by_action = {
        "start": "start_runtime",
        "stop": "stop_runtime",
        "restart": "restart_runtime",
    }
    command_type = command_by_action.get(action)
    if command_type is None:
        raise HTTPException(400, "Unsupported lifecycle action")

    result = await db.execute(
        select(AgentWorkspace, Member, Computer)
        .join(Member, Member.id == AgentWorkspace.agent_id)
        .join(Computer, Computer.id == AgentWorkspace.computer_id)
        .where(
            AgentWorkspace.id == parsed_workspace_id,
            Member.server_id == server.id,
            Computer.server_id == server.id,
        )
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Workspace not found")
    workspace, agent, computer = row

    if computer.status not in {"online", "active"} or _lease_expired(computer.daemon_lease_expires_at):
        raise HTTPException(409, "Daemon is offline; reconnect the computer before controlling runtimes")

    config = dict(agent.config or {})
    now = _utcnow_aware()
    if action in {"start", "restart"} and not runtime_provider_available(workspace, agent, computer):
        mark_runtime_provider_unavailable(workspace, agent)
        message = runtime_provider_unavailable_message(workspace, agent)
        await _record_activity(
            db,
            server,
            agent,
            "workspace_lifecycle",
            f"@{agent.display_name} runtime configuration failed on {computer.name}",
            {
                "computerId": str(computer.id),
                "workspaceId": str(workspace.id),
                "runtime": _public_runtime(workspace.runtime),
                "status": workspace.status,
                "action": action,
                "error": message,
            },
        )
        await db.commit()
        await push_latest_events_for_server(db, server_id=server.id)
        raise HTTPException(400, message)

    if action == "start":
        config["runtimeDesiredStatus"] = "running"
        workspace.status = PENDING_RUNTIME_START_STATUS
        workspace.pid = None
        workspace.stopped_at = None
        if agent.status == "offline":
            agent.status = "idle"
    elif action == "stop":
        config["runtimeDesiredStatus"] = "stopped"
        workspace.status = "stopped"
        workspace.pid = None
        workspace.stopped_at = now
        agent.status = "offline"
    else:
        config["runtimeDesiredStatus"] = "running"
        workspace.status = PENDING_RUNTIME_START_STATUS
        workspace.pid = None
        workspace.stopped_at = now
        if agent.status == "offline":
            agent.status = "idle"
    agent.config = config

    event = runtime_control_command(workspace, agent, command_type)
    delivered = await daemon_control_hub.push(computer.id, event)
    await _record_activity(
        db,
        server,
        agent,
        "workspace_lifecycle",
        f"@{agent.display_name} runtime {action} requested on {computer.name}",
        {
            "computerId": str(computer.id),
            "workspaceId": str(workspace.id),
            "runtime": _public_runtime(workspace.runtime),
            "status": workspace.status,
            "action": action,
            "delivered": delivered,
        },
    )

    await db.commit()
    await db.refresh(workspace)
    await db.refresh(computer)
    await push_latest_events_for_server(db, server_id=server.id)
    return {
        "ok": True,
        "action": action,
        "delivered": delivered,
        "message": (
            "Command delivered to the connected daemon"
            if delivered
            else "Command queued in workspace state; daemon heartbeat is required to observe it"
        ),
        "workspace": _serialize_workspace(workspace, agent),
        "computer": await _serialize_computer(db, computer),
    }


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace(
    workspace_id: str,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_workspace_id = uuid.UUID(workspace_id)
    except ValueError:
        raise HTTPException(400, "Invalid workspace id")

    result = await db.execute(
        select(AgentWorkspace, Member, Computer)
        .join(Member, Member.id == AgentWorkspace.agent_id)
        .join(Computer, Computer.id == AgentWorkspace.computer_id)
        .where(
            AgentWorkspace.id == parsed_workspace_id,
            Member.server_id == server.id,
            Computer.server_id == server.id,
        )
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Workspace not found")
    workspace, agent, computer = row

    if workspace.status in RUNTIME_ACTIVE_STATUSES or workspace.status in {"busy", "starting", "restarting"}:
        raise HTTPException(409, "Stop the runtime before deleting this workspace")

    deleted = _serialize_workspace(workspace, agent)
    clear_workspace_reference(agent, workspace.id)
    agent.status = "offline"
    await db.delete(workspace)
    await _record_activity(
        db,
        server,
        agent,
        "workspace_lifecycle",
        f"@{agent.display_name} workspace deleted on {computer.name}",
        {
            "computerId": str(computer.id),
            "workspaceId": str(parsed_workspace_id),
            "runtime": _public_runtime(deleted.get("runtime")),
            "status": "deleted",
            "action": "delete",
        },
    )
    await db.commit()
    await push_latest_events_for_server(db, server_id=server.id)
    return {
        "ok": True,
        "deleted": True,
        "workspace": deleted,
        "member": await serialize_member(db, agent),
    }


@router.post("/computers/credential")
async def generate_computer_credential(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    server = await _ensure_server(db)
    body = await request.json()
    name = body.get("name", "unregistered-computer")
    existing = (await db.execute(
        select(Computer).where(Computer.server_id == server.id, Computer.name == name)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"Computer name {name} already exists")

    token = f"sk_machine_{secrets.token_urlsafe(32)}"
    key_prefix = token[:20]
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    computer_id = uuid.uuid4()
    computer = Computer(
        id=computer_id,
        server_id=server.id,
        name=name,
        os="unknown",
        daemon_version="unknown",
        api_key_prefix=key_prefix,
        status="offline",
        detected_runtimes=[],
    )
    db.add(computer)

    db.add(ApiKey(
        key_prefix=key_prefix,
        token_hash=token_hash,
        resource_type="computer",
        resource_id=computer_id,
        server_id=server.id,
    ))

    server_url = body.get("serverUrl", "http://localhost:8000")
    await db.commit()
    return {
        "created": True,
        "computerId": str(computer_id),
        "apiKey": token,
        "command": _computer_connection_command(token, server_url),
    }


# ── Agent Creation ────────────────────────────────────────────


def _normalize_runtime(value: str | None) -> str:
    """Normalize public agent runtime identifiers.

    Product surfaces expose Codex as `codex`; the daemon decides the current
    implementation mode (ACP by default). Historical `codex_acp` values are
    accepted only as aliases and normalized away.
    """
    aliases = {
        "claude": "claude_code",
        "claude_code": "claude_code",
        "codex": "codex",
        "codex_cli": "codex",
        "codex-acp": "codex",
        "codex_acp": "codex",
    }
    raw = (str(value).strip().lower() if value else "") or "claude_code"
    normalized = aliases.get(raw)
    if not normalized:
        raise HTTPException(400, f"Unsupported runtime: {value}")
    return normalized


def _public_runtime(value: str | None) -> str:
    return _normalize_runtime(value)


@router.post("/members/agents")
async def create_agent(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    body = await request.json()
    name = body.get("name")
    if not name:
        raise HTTPException(400, "Missing name")
    existing_agent = (await db.execute(
        select(Member).where(Member.server_id == server.id, Member.display_name == name)
    )).scalar_one_or_none()
    if existing_agent:
        raise HTTPException(409, f"Member name {name} already exists")

    computer_id = body.get("computerId")
    if not computer_id:
        raise HTTPException(400, "Missing computerId")
    try:
        computer_id = uuid.UUID(computer_id)
    except ValueError:
        raise HTTPException(400, "Invalid computerId")

    computer_result = await db.execute(
        select(Computer).where(Computer.id == computer_id, Computer.server_id == server.id)
    )
    computer = computer_result.scalar_one_or_none()
    if not computer:
        raise HTTPException(404, "Computer not found")

    runtime = _normalize_runtime(body.get("runtime", "claude_code"))
    runtime_command = body.get("runtimeCommand")
    runtime_model = body.get("runtimeModel")
    raw_runtime_provider = body.get("runtimeProvider")
    runtime_provider = str(raw_runtime_provider).strip() if raw_runtime_provider is not None else None
    if not runtime_provider:
        runtime_provider = None
    raw_provider_name = body.get("provider")
    provider_name = str(raw_provider_name).strip() if raw_provider_name is not None else None
    if not provider_name:
        provider_name = None
    if not runtime_provider_available_for(runtime, runtime_provider, computer):
        raise HTTPException(400, runtime_provider_unavailable_message_for(runtime, runtime_provider))

    agent = Member(
        server_id=server.id,
        kind="agent",
        display_name=name,
        status=body.get("status", "offline"),
        computer_id=computer_id,
        backend=body.get("backend"),
        config={
            "computerId": str(computer_id),
            "backend": body.get("backend"),
            "runtimeProvider": runtime_provider,
            "provider": provider_name,
            "runtimeDesiredStatus": "running",
        },
    )
    db.add(agent)
    await db.flush()

    workspace = AgentWorkspace(
        computer_id=computer_id,
        agent_id=agent.id,
        runtime=runtime,
        runtime_command=runtime_command,
        runtime_model=runtime_model,
        status=PENDING_RUNTIME_START_STATUS,
        cwd=body.get("cwd"),
    )
    db.add(workspace)
    await db.flush()

    agent.config = {**(agent.config or {}), "workspaceId": str(workspace.id)}

    await db.commit()
    await db.refresh(agent)
    await db.refresh(workspace)
    await daemon_control_hub.push(computer.id, runtime_start_command(workspace, agent))
    return {
        "created": True,
        "member": await serialize_member(db, agent),
        "workspace": _serialize_workspace(workspace, agent),
    }


# ── Channel Creation ─────────────────────────────────────────


@router.post("/channels")
async def create_channel(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    body = await request.json()
    name = body.get("name")
    if not name:
        raise HTTPException(400, "Missing name")

    name = name.lstrip("#")
    kind = body.get("type") or body.get("kind", "public")
    if kind not in ("public", "private"):
        raise HTTPException(400, "Invalid channel type")

    existing = await db.execute(
        select(Channel).where(Channel.server_id == server.id, Channel.name == name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"Channel #{name} already exists")

    creator = await _resolve_human_actor(db, server, request, body.get("creator"), role="channel creator")

    channel = Channel(
        server_id=server.id,
        name=name,
        kind=kind,
        description=body.get("description", ""),
        creator_id=creator.id,
    )
    db.add(channel)
    await db.flush()

    db.add(ChannelMember(channel_id=channel.id, member_id=creator.id))

    member_ids = body.get("memberIds") or []
    for mid in member_ids:
        try:
            parsed_mid = uuid.UUID(mid)
        except ValueError:
            continue
        member = await db.execute(
            select(Member).where(Member.id == parsed_mid, Member.server_id == server.id)
        )
        if member.scalar_one_or_none():
            db.add(ChannelMember(channel_id=channel.id, member_id=parsed_mid))

    await db.commit()
    await db.refresh(channel)
    return {
        "created": True,
        "channel": {
            "id": str(channel.id),
            "name": f"#{channel.name}" if channel.kind == "public" else channel.name,
            "type": channel.kind,
            "description": channel.description or "",
        },
    }


@router.delete("/channels/{channel_id}")
async def delete_channel(
    channel_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_channel_id = uuid.UUID(channel_id)
    except ValueError:
        raise HTTPException(400, "Invalid channel id")

    result = await db.execute(
        select(Channel).where(Channel.id == parsed_channel_id, Channel.server_id == server.id)
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(404, "Channel not found")
    if channel.kind == "dm":
        raise HTTPException(400, "Delete the agent/member to remove its DM channel")

    actor = await _resolve_human_actor(db, server, request, None, role="channel deletion actor")
    deleted = await _delete_channels_by_id(db, [channel.id])
    await _record_activity(
        db,
        server,
        actor,
        "supervisor_member_updated",
        f"@{actor.display_name} deleted channel #{channel.name}",
        {
            "channelId": str(channel.id),
            "channelName": channel.name,
            "action": "delete_channel",
            "deletedMessages": deleted["messages"],
            "deletedTasks": deleted["tasks"],
        },
    )
    await db.commit()
    await push_latest_events_for_server(db, server_id=server.id)
    return {
        "ok": True,
        "deleted": True,
        "channelId": str(channel.id),
        "channelName": channel.name,
        "messages": deleted["messages"],
        "tasks": deleted["tasks"],
    }


# ── Channel Members ──────────────────────────────────────────


@router.post("/channels/{channel_id}/members")
async def add_channel_member(
    channel_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_channel_id = uuid.UUID(channel_id)
    except ValueError:
        raise HTTPException(400, "Invalid channel id")

    channel = await db.execute(
        select(Channel).where(Channel.id == parsed_channel_id, Channel.server_id == server.id)
    )
    ch = channel.scalar_one_or_none()
    if not ch:
        raise HTTPException(404, "Channel not found")

    body = await request.json()
    member_id = body.get("memberId")
    if not member_id:
        raise HTTPException(400, "Missing memberId")
    try:
        parsed_member_id = uuid.UUID(member_id)
    except ValueError:
        raise HTTPException(400, "Invalid memberId")

    member = await db.execute(
        select(Member).where(Member.id == parsed_member_id, Member.server_id == server.id)
    )
    if not member.scalar_one_or_none():
        raise HTTPException(404, "Member not found")

    existing = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == parsed_channel_id,
            ChannelMember.member_id == parsed_member_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"added": False, "reason": "already_member"}

    db.add(ChannelMember(channel_id=parsed_channel_id, member_id=parsed_member_id))
    await db.commit()
    return {"added": True, "channelId": str(parsed_channel_id), "memberId": str(parsed_member_id)}


@router.delete("/channels/{channel_id}/members/{member_id}")
async def remove_channel_member(
    channel_id: str,
    member_id: str,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_channel_id = uuid.UUID(channel_id)
        parsed_member_id = uuid.UUID(member_id)
    except ValueError:
        raise HTTPException(400, "Invalid id format")

    channel = await db.execute(
        select(Channel).where(Channel.id == parsed_channel_id, Channel.server_id == server.id)
    )
    if not channel.scalar_one_or_none():
        raise HTTPException(404, "Channel not found")

    existing = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == parsed_channel_id,
            ChannelMember.member_id == parsed_member_id,
        )
    )
    cm = existing.scalar_one_or_none()
    if not cm:
        return {"removed": False, "reason": "not_member"}

    await db.delete(cm)
    await db.commit()
    return {"removed": True, "channelId": str(parsed_channel_id), "memberId": str(parsed_member_id)}


# ── DM ───────────────────────────────────────────────────────


@router.get("/channels/{channel_id}/members")
async def list_channel_members(
    channel_id: str,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    try:
        parsed_channel_id = uuid.UUID(channel_id)
    except ValueError:
        raise HTTPException(400, "Invalid channel id")

    channel = await db.execute(
        select(Channel).where(Channel.id == parsed_channel_id, Channel.server_id == server.id)
    )
    if not channel.scalar_one_or_none():
        raise HTTPException(404, "Channel not found")

    result = await db.execute(
        select(ChannelMember).where(ChannelMember.channel_id == parsed_channel_id)
    )
    cms = result.scalars().all()
    member_ids = [cm.member_id for cm in cms]
    members_result = await db.execute(
        select(Member).where(Member.id.in_(member_ids))
    )
    members = members_result.scalars().all()

    agent_computer_ids = [m.computer_id for m in members if m.kind == "agent" and m.computer_id]
    computers_map: dict[uuid.UUID, Computer] = {}
    if agent_computer_ids:
        comp_result = await db.execute(
            select(Computer).where(Computer.id.in_(agent_computer_ids))
        )
        computers_map = {c.id: c for c in comp_result.scalars().all()}

    member_list = [
        await serialize_member(db, member, _computer=computers_map.get(member.computer_id))
        for member in members
    ]
    return {"members": member_list}


@router.get("/dms")
async def list_dms(
    request: Request,
    sender: str | None = Query(None),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    viewer = await _resolve_human_actor(db, server, request, sender, role="DM viewer")
    result = await db.execute(
        select(Channel)
        .join(ChannelMember, ChannelMember.channel_id == Channel.id)
        .where(
            Channel.server_id == server.id,
            Channel.kind == "dm",
            ChannelMember.member_id == viewer.id,
        )
        .order_by(Channel.updated_at.desc(), Channel.created_at.desc())
    )
    channels = result.scalars().all()
    return {
        "dms": [await _dm_channel_payload(db, channel, viewer) for channel in channels],
        "count": len(channels),
    }


@router.post("/dm")
async def create_or_get_dm(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    server = await _get_server(db)
    body = await request.json()
    peer_name = body.get("peer")
    if not peer_name:
        raise HTTPException(400, "Missing peer")

    sender = await _resolve_human_actor(db, server, request, body.get("sender"), role="DM sender")
    peer = await _resolve_member(db, server, peer_name)

    dm_name = f"dm:{min(str(sender.id), str(peer.id))}-{max(str(sender.id), str(peer.id))}"
    result = await db.execute(
        select(Channel).where(Channel.server_id == server.id, Channel.kind == "dm", Channel.name == dm_name)
    )
    channel = result.scalar_one_or_none()

    if not channel:
        channel = Channel(
            server_id=server.id,
            name=dm_name,
            kind="dm",
            creator_id=sender.id,
        )
        db.add(channel)
        await db.flush()
        db.add(ChannelMember(channel_id=channel.id, member_id=sender.id))
        db.add(ChannelMember(channel_id=channel.id, member_id=peer.id))
        await db.commit()
        await db.refresh(channel)

    return {
        "channel": await _dm_channel_payload(db, channel, sender),
    }
