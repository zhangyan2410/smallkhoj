"""Public API routes — frontend-facing endpoints under /api/v1/."""

import asyncio
import hashlib
import hmac
import json
import logging
import re
import secrets
import shlex
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit

from fastapi import HTTPException
from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models import (
    get_db, Account, AgentWorkspace, ActivityLog, ApiKey, Channel, ChannelMember,
    ChatThreadReadCursor, Computer, ConnectTicket, Member, Message, MessageReaction, EventRecord, FileEntry, Reminder, SavedItem,
    Server, ServerMembership, Task, TaskRun, ThreadSummary,
)
from routers.member_serialization import member_backend, member_computer_id, serialize_member
from services.agent_permissions import agent_permissions_for_creation
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
from services.memory_api import (
    create_memory_proposal,
    delete_memory_entry,
    get_memory_entry,
    list_memory_entries,
    list_memory_proposals,
    resolve_memory_scope,
    resolve_memory_proposal,
    search_memory,
    serialize_memory_entry,
    serialize_memory_proposal,
    write_memory_entry,
)
from services.public_events import (
    public_event_heartbeat_frame,
    public_event_hub,
    public_event_sse_frame,
    should_deliver_public_event,
)
from services.server_membership import (
    create_server_for_account,
    ensure_account_membership,
    ensure_channel_access,
    ensure_server_scoped_computer,
    is_channel_member,
    list_account_memberships,
    parse_server_id,
    require_admin_role,
    resolve_active_server_context,
)
from services.server_invites import (
    accept_server_invite as accept_server_invite_record,
    create_server_invite as create_server_invite_record,
    inspect_server_invite,
)
from services.task_memory_request import add_task_memory_request_event, normalize_output_directions
from services.task_run_templates import (
    create_template,
    disable_template,
    get_template_by_ref,
    list_templates,
    serialize_task_run_template,
    template_snapshot as task_run_template_snapshot,
    update_template,
)
from services.task_runs import create_task_assignment_and_run, serialize_task_run
from services.chat_read_cursors import (
    mark_channel_read,
    read_state_from_message_seq,
    serialize_channel_read_cursor,
    serialize_thread_read_cursor,
    upsert_thread_read_cursor,
)
from services.thread_summary import (
    load_thread_metadata,
    resolve_thread_root,
    serialize_thread_summary,
)

router = APIRouter(prefix="/api/v1", tags=["public"])

logger = logging.getLogger(__name__)

PUBLIC_API_KEY = settings.public_api_key
DAEMON_CLI_COMMAND = "aura"
DAEMON_DOWNLOAD_PATH = "/downloads/smallkhoj-daemon"
DAEMON_NPX_PACKAGE_PREFIX = "smallkhoj-smallkhoj-daemon"
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
AUTH_BRIDGE_SECRET_HEADER = "X-Auth-Bridge-Secret"
TASK_NUMBER_RETRY_LIMIT = 5
BOOTSTRAP_OWNER_LOCK_NAMESPACE = 0x534B484A
BOOTSTRAP_OWNER_LOCK_SCOPE = 1
DELETE_BLOCKING_WORKSPACE_STATUSES = RUNTIME_ACTIVE_STATUSES | {"busy", "starting", "restarting"}
STALE_STARTING_WORKSPACE_GRACE = timedelta(minutes=5)

PUBLIC_ACTIVITY_EVENT_TYPES = {
    "supervisor_message_sent": "message.created",
    "supervisor_task_created": "task.created",
    "supervisor_task_assigned": "task.created",
    "supervisor_task_updated": "task.updated",
    "supervisor_task_deleted": "task.deleted",
    "supervisor_file_deleted": "file.deleted",
    "supervisor_member_updated": "member.updated",
    "supervisor_member_created": "member.created",
    "message_reaction_added": "reaction.updated",
    "message_reaction_removed": "reaction.updated",
    "supervisor_reminder_created": "reminder.created",
    "supervisor_reminder_updated": "reminder.updated",
    "workspace_lifecycle": "workspace.updated",
}

HEARTBEAT_ACTIVITY_TYPES = {"workspace_heartbeat"}

EVENT_TYPE_ALIASES = {
    "message.created": "message_received",
    "reaction.updated": "reaction_updated",
    "task.created": "task_created",
    "task.updated": "task_updated",
    "task.deleted": "task_deleted",
    "file.deleted": "file_deleted",
    "task.memory_requested": "task_memory_requested",
    "member.updated": "member_updated",
    "member.created": "member_created",
    "member.status.updated": "member_updated",
    "reminder.created": "reminder_created",
    "reminder.updated": "reminder_updated",
}


async def _push_committed_events(db: AsyncSession, *, server_id: uuid.UUID) -> int:
    return await push_latest_events_for_server(db, server_id=server_id)


def _shell_comment_label(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip()[:80]


def _with_server_comment(command: str, server_label: str | None) -> str:
    label = _shell_comment_label(server_label)
    return f"{command} # {label}" if label else command


def _daemon_npx_package(server_url: str) -> str:
    configured = settings.daemon_npx_package.strip()
    if configured:
        return configured
    version = settings.daemon_release_version.strip() or settings.minimum_daemon_version.strip() or "0.2.1"
    return f"{_daemon_download_base_url(server_url)}/{DAEMON_NPX_PACKAGE_PREFIX}-{version}.tgz"


def _computer_connection_command(token: str, server_url: str, server_label: str | None = None) -> str:
    """One-line product command for reconnecting this computer's daemon."""
    package = _daemon_npx_package(server_url)
    command = " ".join(
        [
            "npx",
            "-y",
            "--package",
            shlex.quote(package),
            DAEMON_CLI_COMMAND,
            "--server-url",
            shlex.quote(server_url),
            "--api-key",
            shlex.quote(token),
        ]
    )
    return _with_server_comment(command, server_label)


def _daemon_download_base_url(server_url: str) -> str:
    configured = settings.daemon_download_base_url.strip()
    if configured:
        return configured.rstrip("/")
    return f"{server_url.rstrip('/')}{DAEMON_DOWNLOAD_PATH}"


def _daemon_install_metadata(server_url: str) -> dict[str, str]:
    download_base_url = _daemon_download_base_url(server_url)
    install_script_url = f"{download_base_url}/install.sh"
    return {
        "commandName": DAEMON_CLI_COMMAND,
        "downloadBaseUrl": download_base_url,
        "installScriptUrl": install_script_url,
        "installCommand": (
            f"curl -fsSL {shlex.quote(install_script_url)} "
            f"| SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL={shlex.quote(download_base_url)} bash"
        ),
    }


def _computer_connect_command(connect_token: str, server_url: str, server_label: str | None = None) -> str:
    """One-line product command for connecting this computer with a one-time ticket."""
    package = _daemon_npx_package(server_url)
    command = " ".join(
        [
            "npx",
            "-y",
            "--package",
            shlex.quote(package),
            DAEMON_CLI_COMMAND,
            "--server-url",
            shlex.quote(server_url),
            "--api-key",
            shlex.quote(connect_token),
        ]
    )
    return _with_server_comment(command, server_label)

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
    """Validate a public API key transported only in the X-Public-Key header."""
    key = request.headers.get("X-Public-Key")
    if not key:
        raise HTTPException(401, "Missing API key: set X-Public-Key header")
    # Check against seed public key
    if hmac.compare_digest(key, PUBLIC_API_KEY):
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


def _public_frontend_base_url(request: Request) -> str:
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")
    referer = request.headers.get("referer")
    if referer:
        parsed = urlsplit(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
    forwarded_host = request.headers.get("x-forwarded-host")
    forwarded_proto = request.headers.get("x-forwarded-proto") or "https"
    if forwarded_host:
        return f"{forwarded_proto.split(',')[0].strip()}://{forwarded_host.split(',')[0].strip()}"
    host = request.headers.get("host")
    if host:
        return f"http://{host}"
    return "http://localhost:3000"


def _serialize_invite_payload(invite, server: Server, *, join_url: str | None = None, already_member: bool | None = None) -> dict:
    payload = {
        "id": str(invite.id),
        "serverId": str(server.id),
        "serverName": server.name,
        "role": invite.role,
        "invitedName": invite.invited_name,
        "expiresAt": invite.expires_at.isoformat() if invite.expires_at else None,
        "acceptedAt": invite.accepted_at.isoformat() if invite.accepted_at else None,
    }
    if join_url is not None:
        payload["joinUrl"] = join_url
    if already_member is not None:
        payload["alreadyMember"] = already_member
    return payload


def _normalize_account_name(raw_name: str | None) -> str:
    name = (raw_name or "").strip().lstrip("@")
    if not name:
        raise HTTPException(400, "Missing account name")
    if not ACCOUNT_NAME_RE.fullmatch(name):
        raise HTTPException(400, "Account name must use letters, numbers, dot, underscore, or dash")
    return name


def _better_auth_account_name(external_user_id: str) -> str:
    user_id = (external_user_id or "").strip()
    if not user_id:
        raise HTTPException(400, "Missing Better Auth user id")
    return f"ba_{hashlib.sha256(user_id.encode('utf-8')).hexdigest()[:24]}"


def _better_auth_display_name(*, email: str | None, display_name: str | None, account_name: str) -> str:
    candidate = (display_name or "").strip().lstrip("@")
    if not candidate and email and "@" in email:
        candidate = email.split("@", 1)[0].strip().lstrip("@")
    if not candidate:
        candidate = account_name
    return candidate[:80]


def _better_auth_personal_server_name(visible_name: str) -> str:
    return f"{visible_name}的服务器"


def _verify_auth_bridge_secret(request: Request) -> None:
    configured_secret = getattr(settings, "auth_bridge_secret", "") or ""
    if not configured_secret:
        raise HTTPException(503, "Auth bridge secret is not configured")
    provided_secret = request.headers.get(AUTH_BRIDGE_SECRET_HEADER)
    if not provided_secret or not hmac.compare_digest(provided_secret, configured_secret):
        raise HTTPException(401, "Invalid auth bridge secret")


async def _account_from_token(db: AsyncSession, token: str | None) -> Account | None:
    if not token:
        return None
    result = await db.execute(select(Account).where(Account.session_token_hash == _hash_token(token)))
    return result.scalar_one_or_none()


async def _current_account(db: AsyncSession, request: Request) -> Account | None:
    headers = getattr(request, "headers", {}) or {}
    cookies = getattr(request, "cookies", {}) or {}
    token = headers.get("X-Account-Token") or cookies.get(SESSION_COOKIE_NAME)
    return await _account_from_token(db, token)


async def _resolve_active_server_context(db: AsyncSession, request: Request):
    account = await _current_account(db, request)
    if not account:
        raise HTTPException(401, "Login required for Server access")
    headers = getattr(request, "headers", {}) or {}
    requested_server_id = parse_server_id(headers.get("X-Server-Id"))
    return await resolve_active_server_context(db, account=account, requested_server_id=requested_server_id)


async def _bootstrap_account(
    db: AsyncSession,
    *,
    name: str,
    display_name: str | None = None,
) -> tuple[Account, Server, Member, str]:
    account_name = _normalize_account_name(name)
    await db.execute(
        text(
            "SELECT pg_advisory_xact_lock("
            ":bootstrap_owner_namespace, :bootstrap_owner_scope)"
        ),
        {
            "bootstrap_owner_namespace": BOOTSTRAP_OWNER_LOCK_NAMESPACE,
            "bootstrap_owner_scope": BOOTSTRAP_OWNER_LOCK_SCOPE,
        },
    )
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
    owner_result = await db.execute(
        select(ServerMembership.id)
        .where(
            ServerMembership.server_id == server.id,
            ServerMembership.role == "owner",
            ServerMembership.status == "active",
        )
        .limit(1)
    )
    default_role = "member" if owner_result.scalar_one_or_none() else "owner"
    await ensure_account_membership(
        db,
        account=account,
        server=server,
        member=member,
        default_role=default_role,
    )
    token = f"sk_session_{secrets.token_urlsafe(32)}"
    account.session_token_hash = _hash_token(token)
    account.last_login_at = _utcnow_aware()
    await db.flush()
    return account, server, member, token


async def _bootstrap_better_auth_account(
    db: AsyncSession,
    *,
    external_user_id: str,
    email: str | None = None,
    display_name: str | None = None,
) -> tuple[Account, Server, Member, str]:
    account_name = _better_auth_account_name(external_user_id)
    visible_name = _better_auth_display_name(email=email, display_name=display_name, account_name=account_name)

    result = await db.execute(select(Account).where(Account.name == account_name))
    account = result.scalar_one_or_none()
    server = None
    member = None

    if account:
        server_result = await db.execute(select(Server).where(Server.id == account.server_id))
        server = server_result.scalar_one_or_none()
        member_result = await db.execute(select(Member).where(Member.id == account.member_id))
        member = member_result.scalar_one_or_none()

    if not account or not server or not member:
        server = Server(id=uuid.uuid4(), name=_better_auth_personal_server_name(visible_name))
        db.add(server)
        await db.flush()

        member = Member(
            id=uuid.uuid4(),
            server_id=server.id,
            kind="human",
            display_name=visible_name,
            status="online",
        )
        db.add(member)
        await db.flush()

        if account:
            account.server_id = server.id
            account.member_id = member.id
        else:
            account = Account(
                name=account_name,
                display_name=visible_name,
                server_id=server.id,
                member_id=member.id,
            )
            db.add(account)
            await db.flush()

    member.status = "online"
    account.display_name = visible_name
    membership = await ensure_account_membership(
        db,
        account=account,
        server=server,
        member=member,
        default_role="owner",
    )
    if membership.role != "owner":
        membership.role = "owner"
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
    account = await _current_account(db, request)
    if not account:
        if required:
            raise HTTPException(401, f"Login required for {role}")
        return None

    membership_result = await db.execute(
        select(ServerMembership, Member)
        .join(Member, Member.id == ServerMembership.member_id)
        .where(
            ServerMembership.account_id == account.id,
            ServerMembership.server_id == server.id,
            ServerMembership.status == "active",
        )
    )
    membership_row = membership_result.one_or_none()
    if membership_row:
        _membership, viewer = membership_row
    else:
        member_result = await db.execute(
            select(Member).where(
                Member.id == account.member_id,
                Member.server_id == server.id,
                Member.kind == "human",
            )
        )
        viewer = member_result.scalar_one_or_none()
    if not viewer:
        if required:
            raise HTTPException(401, f"Login required for {role}")
        return None

    if not explicit_name:
        return viewer

    actor_ref = str(explicit_name).strip()
    if not actor_ref:
        return viewer
    try:
        actor_id = uuid.UUID(actor_ref)
    except ValueError:
        actor_id = None

    if actor_id:
        actor_result = await db.execute(
            select(Member).where(
                Member.id == actor_id,
                Member.server_id == server.id,
                Member.kind == "human",
            )
        )
        actor = actor_result.scalar_one_or_none()
    else:
        display_name = actor_ref.lstrip("@").strip()
        if not display_name:
            raise HTTPException(400, "Invalid actor reference")
        actor_result = await db.execute(
            select(Member).where(
                Member.server_id == server.id,
                Member.kind == "human",
                func.lower(Member.display_name) == display_name.lower(),
            )
        )
        candidates = list(actor_result.scalars().all())
        if len(candidates) > 1:
            raise HTTPException(400, "Ambiguous actor reference")
        actor = candidates[0] if candidates else None

    if not actor:
        raise HTTPException(404, "Actor not found")
    if actor.id != viewer.id:
        raise HTTPException(403, "Actor must match the current account")
    return viewer


async def _resolve_memory_viewer(db: AsyncSession, server: Server, request: Request) -> Member:
    return await _resolve_human_actor(db, server, request, None, role="memory viewer")


def _ensure_memory_actor_matches_viewer(body: dict, viewer: Member) -> None:
    explicit_actor = body.get("actor")
    if not explicit_actor:
        return
    actor_ref = str(explicit_actor).strip().lstrip("@")
    if actor_ref not in {str(viewer.id), viewer.display_name}:
        raise HTTPException(403, "Memory actor must match the current account")


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
        "memberships": await list_account_memberships(db, account=account),
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
    context = await _resolve_active_server_context(db, request)
    return await _serialize_account(db, context.account, context.server, context.member)


@router.post("/auth/better-auth/bridge")
async def bridge_better_auth_session(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    _verify_auth_bridge_secret(request)
    body = await request.json()
    account, server, member, token = await _bootstrap_better_auth_account(
        db,
        external_user_id=body.get("userId"),
        email=body.get("email"),
        display_name=body.get("name") or body.get("displayName"),
    )
    await db.commit()
    payload = await _serialize_account(db, account, server, member)
    payload["sessionToken"] = token
    return payload


@router.post("/servers")
async def create_server(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    account = await _current_account(db, request)
    if not account:
        raise HTTPException(401, "Login required for Server creation")
    body = await request.json()
    server, member, _membership = await create_server_for_account(
        db,
        account=account,
        name=body.get("name"),
    )
    await db.commit()
    payload = await _serialize_account(db, account, server, member)
    payload["created"] = True
    return payload


@router.post("/server-invites")
async def create_server_invite(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    body = await request.json()
    created = await create_server_invite_record(
        db,
        server=context.server,
        creator=context.member,
        role=body.get("role") or "member",
        invited_name=body.get("invitedName"),
        expires_in_days=body.get("expiresInDays"),
        public_base_url=_public_frontend_base_url(request),
    )
    await db.commit()
    return {
        "invite": _serialize_invite_payload(created.invite, context.server, join_url=created.join_url),
    }


@router.get("/server-invites/{token}")
async def get_server_invite(token: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    account = await _current_account(db, request)
    preview = await inspect_server_invite(db, token=token, account=account)
    return {
        "invite": _serialize_invite_payload(
            preview.invite,
            preview.server,
            already_member=preview.already_member,
        ),
    }


@router.post("/server-invites/{token}/accept")
async def accept_server_invite(token: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    account = await _current_account(db, request)
    if not account:
        raise HTTPException(401, "Login required for invite acceptance")
    accepted = await accept_server_invite_record(db, token=token, account=account)
    await db.commit()
    payload = await _serialize_account(db, account, accepted.server, accepted.member)
    payload["accepted"] = True
    payload["invite"] = _serialize_invite_payload(accepted.invite, accepted.server)
    return payload


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
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
    body = await request.json()
    resource_type = str(body.get("resourceType") or "human").strip().lower()
    if resource_type not in {"human", "admin"}:
        raise HTTPException(400, "Only human or admin API keys can be created from Settings")

    token = f"sk_{resource_type}_{secrets.token_urlsafe(32)}"
    api_key = ApiKey(
        key_prefix=token[:20],
        token_hash=_hash_token(token),
        resource_type=resource_type,
        resource_id=context.member.id,
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    now = datetime.now(timezone.utc)
    blocking = set()
    for workspace in workspaces:
        status = workspace.status
        if status not in DELETE_BLOCKING_WORKSPACE_STATUSES:
            continue
        if status in {"starting", "restarting"}:
            started_at = workspace.started_at
            if started_at is None:
                blocking.add(status)
                continue
            if started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=timezone.utc)
            if now - started_at > STALE_STARTING_WORKSPACE_GRACE:
                continue
        blocking.add(status)
    return sorted(blocking)


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
    file_ids: list[uuid.UUID] | None = None,
) -> None:
    conditions = []
    if channel_ids:
        conditions.append((SavedItem.item_type == "channel") & SavedItem.item_id.in_(channel_ids))
    if message_ids:
        conditions.append((SavedItem.item_type == "message") & SavedItem.item_id.in_(message_ids))
    if task_ids:
        conditions.append((SavedItem.item_type == "task") & SavedItem.item_id.in_(task_ids))
    if file_ids:
        conditions.append((SavedItem.item_type == "file") & SavedItem.item_id.in_(file_ids))
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
    def sort_key(item: ActivityLog) -> datetime:
        return item.occurred_at or datetime.min.replace(tzinfo=timezone.utc)

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
    thread_read_seq_by_root: dict[uuid.UUID, int] | None = None,
    thread_unread_count_by_root: dict[uuid.UUID, int] | None = None,
) -> dict:
    sender_result = await db.execute(select(Member).where(Member.id == msg.sender_id))
    sender = sender_result.scalar_one_or_none()
    sender_member = await serialize_member(db, sender) if sender else None
    root_id = msg.parent_id or msg.id
    metadata = (thread_metadata or {}).get(root_id, {})
    thread_latest_seq = int(metadata.get("latestReplySeq") or 0) if not msg.parent_id else 0
    thread_read_state = read_state_from_message_seq(
        latest_seq=thread_latest_seq,
        last_read_seq=(thread_read_seq_by_root or {}).get(root_id, 0),
    )
    if thread_unread_count_by_root is not None and not msg.parent_id:
        thread_unread_count = max(0, int(thread_unread_count_by_root.get(root_id, 0)))
        thread_read_state["unreadCount"] = thread_unread_count
        thread_read_state["hasUnread"] = thread_unread_count > 0
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
        "threadLatestSeq": int(thread_read_state["latestSeq"]) if not msg.parent_id else 0,
        "threadUnreadCount": int(thread_read_state["unreadCount"]) if not msg.parent_id else 0,
        "hasThreadUnread": bool(thread_read_state["hasUnread"]) if not msg.parent_id else False,
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


async def _channel_latest_seq_map(db: AsyncSession, channel_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not channel_ids:
        return {}
    result = await db.execute(
        select(Message.channel_id, func.max(Message.seq))
        .where(Message.channel_id.in_(channel_ids))
        .group_by(Message.channel_id)
    )
    return {channel_id: int(latest_seq or 0) for channel_id, latest_seq in result.all()}


async def _channel_read_seq_map(
    db: AsyncSession,
    *,
    channel_ids: list[uuid.UUID],
    member_id: uuid.UUID,
) -> dict[uuid.UUID, int]:
    if not channel_ids:
        return {}
    result = await db.execute(
        select(ChannelMember.channel_id, ChannelMember.last_read_seq).where(
            ChannelMember.channel_id.in_(channel_ids),
            ChannelMember.member_id == member_id,
        )
    )
    return {channel_id: int(last_read_seq or 0) for channel_id, last_read_seq in result.all()}


async def _channel_unread_count_map(
    db: AsyncSession,
    *,
    channel_ids: list[uuid.UUID],
    read_seq_by_channel: dict[uuid.UUID, int],
) -> dict[uuid.UUID, int]:
    if not channel_ids:
        return {}
    result = await db.execute(
        select(Message.channel_id, Message.seq).where(Message.channel_id.in_(channel_ids))
    )
    counts = {channel_id: 0 for channel_id in channel_ids}
    for channel_id, seq in result.all():
        if int(seq or 0) > read_seq_by_channel.get(channel_id, 0):
            counts[channel_id] = counts.get(channel_id, 0) + 1
    return counts


async def _thread_read_seq_map(
    db: AsyncSession,
    *,
    root_message_ids: list[uuid.UUID],
    server_id: uuid.UUID,
    member_id: uuid.UUID,
) -> dict[uuid.UUID, int]:
    if not root_message_ids:
        return {}
    result = await db.execute(
        select(ChatThreadReadCursor.root_message_id, ChatThreadReadCursor.last_read_seq).where(
            ChatThreadReadCursor.server_id == server_id,
            ChatThreadReadCursor.root_message_id.in_(root_message_ids),
            ChatThreadReadCursor.member_id == member_id,
        )
    )
    return {root_message_id: int(last_read_seq or 0) for root_message_id, last_read_seq in result.all()}


async def _thread_unread_count_map(
    db: AsyncSession,
    *,
    root_message_ids: list[uuid.UUID],
    thread_read_seq_by_root: dict[uuid.UUID, int],
) -> dict[uuid.UUID, int]:
    if not root_message_ids:
        return {}
    result = await db.execute(
        select(Message.parent_id, Message.seq).where(Message.parent_id.in_(root_message_ids))
    )
    counts = {root_id: 0 for root_id in root_message_ids}
    for root_id, seq in result.all():
        if root_id and int(seq or 0) > thread_read_seq_by_root.get(root_id, 0):
            counts[root_id] = counts.get(root_id, 0) + 1
    return counts


def _channel_read_state_payload(
    channel: Channel,
    *,
    latest_seq_by_channel: dict[uuid.UUID, int],
    read_seq_by_channel: dict[uuid.UUID, int],
    unread_count_by_channel: dict[uuid.UUID, int] | None = None,
) -> dict[str, int | bool]:
    state = read_state_from_message_seq(
        latest_seq=latest_seq_by_channel.get(channel.id, 0),
        last_read_seq=read_seq_by_channel.get(channel.id, 0),
    )
    if unread_count_by_channel is not None:
        unread_count = max(0, int(unread_count_by_channel.get(channel.id, 0)))
        state["unreadCount"] = unread_count
        state["hasUnread"] = unread_count > 0
    return state


async def _dm_channel_payload(
    db: AsyncSession,
    channel: Channel,
    viewer: Member,
    *,
    latest_seq_by_channel: dict[uuid.UUID, int] | None = None,
    read_seq_by_channel: dict[uuid.UUID, int] | None = None,
    unread_count_by_channel: dict[uuid.UUID, int] | None = None,
) -> dict:
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
        **_channel_read_state_payload(
            channel,
            latest_seq_by_channel=latest_seq_by_channel or {},
            read_seq_by_channel=read_seq_by_channel or {},
            unread_count_by_channel=unread_count_by_channel,
        ),
    }


async def _task_channel_target(db: AsyncSession, task: Task) -> str | None:
    channel_result = await db.execute(select(Channel).where(Channel.id == task.channel_id))
    channel = channel_result.scalar_one_or_none()
    if not channel:
        return None
    return f"#{channel.name}" if channel.kind == "public" else channel.name


def _task_run_event_details(task_run: TaskRun | None) -> dict:
    if task_run is None:
        return {}
    details = {
        "taskRunId": str(task_run.id),
        "promptProfile": task_run.prompt_profile,
        "contextSessionId": task_run.context_session_id,
        "roleKey": getattr(task_run, "role_key", None),
        "template": getattr(task_run, "template_snapshot", None) or None,
        "role": getattr(task_run, "role_snapshot", None) or None,
        "completionPolicy": getattr(task_run, "completion_policy", None) or None,
    }
    return {key: value for key, value in details.items() if value is not None}


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
    runs_result = await db.execute(
        select(TaskRun).where(TaskRun.task_id == task.id).order_by(TaskRun.created_at.desc())
    )
    runs = runs_result.scalars().all()
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
        "runs": [serialize_task_run(run) for run in runs],
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
async def list_channels(
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    result = await db.execute(
        select(Channel).where(Channel.server_id == server.id, Channel.kind != "dm")
    )
    channels = result.scalars().all()
    visible_channels = []
    for channel in channels:
        if channel.kind == "private" and not await is_channel_member(db, channel_id=channel.id, member_id=context.member.id):
            continue
        visible_channels.append(channel)
    visible_channel_ids = [channel.id for channel in visible_channels]
    latest_seq_by_channel = await _channel_latest_seq_map(db, visible_channel_ids)
    read_seq_by_channel = await _channel_read_seq_map(
        db,
        channel_ids=visible_channel_ids,
        member_id=context.member.id,
    )
    unread_count_by_channel = await _channel_unread_count_map(
        db,
        channel_ids=visible_channel_ids,
        read_seq_by_channel=read_seq_by_channel,
    )

    return {
        "channels": [
            {
                "id": str(ch.id),
                "name": f"#{ch.name}" if ch.kind == "public" else ch.name,
                "type": ch.kind,
                "description": ch.description or "",
                **_channel_read_state_payload(
                    ch,
                    latest_seq_by_channel=latest_seq_by_channel,
                    read_seq_by_channel=read_seq_by_channel,
                    unread_count_by_channel=unread_count_by_channel,
                ),
            }
            for ch in visible_channels
        ]
    }


@router.get("/chat/read-cursors")
async def get_chat_read_cursors(
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    channel_rows = await db.execute(
        select(ChannelMember, Channel)
        .join(Channel, Channel.id == ChannelMember.channel_id)
        .where(
            Channel.server_id == context.server.id,
            ChannelMember.member_id == context.member.id,
        )
    )
    thread_result = await db.execute(
        select(ChatThreadReadCursor).where(
            ChatThreadReadCursor.server_id == context.server.id,
            ChatThreadReadCursor.member_id == context.member.id,
        )
    )

    cursors = [
        serialize_channel_read_cursor(membership, scope_kind="dm" if channel.kind == "dm" else "channel")
        for membership, channel in channel_rows.all()
    ]
    cursors.extend(serialize_thread_read_cursor(cursor) for cursor in thread_result.scalars().all())
    return {
        "serverId": str(context.server.id),
        "memberId": str(context.member.id),
        "cursors": cursors,
    }


async def _resolve_read_cursor_channel(db: AsyncSession, server: Server, scope: dict) -> Channel:
    channel_ref = scope.get("channelId") or scope.get("id") or scope.get("channelName") or scope.get("name")
    if not channel_ref:
        raise HTTPException(400, "Missing channel cursor scope")
    try:
        channel_id = uuid.UUID(str(channel_ref))
    except ValueError:
        channel_id = None
    if channel_id:
        result = await db.execute(select(Channel).where(Channel.server_id == server.id, Channel.id == channel_id))
        channel = result.scalar_one_or_none()
    else:
        channel = await _resolve_channel(db, server, str(channel_ref).lstrip("#"))
    if not channel:
        raise HTTPException(404, "Channel not found")
    return channel


async def _resolve_thread_last_seen_message_id(
    db: AsyncSession,
    *,
    root: Message,
    last_seen_message_id: object | None,
) -> uuid.UUID | None:
    if last_seen_message_id is None:
        return None
    try:
        parsed_id = uuid.UUID(str(last_seen_message_id))
    except ValueError:
        raise HTTPException(400, "Invalid thread lastSeenMessageId") from None

    result = await db.execute(select(Message).where(Message.id == parsed_id))
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(400, "Thread lastSeenMessageId not found")
    if message.id != root.id and message.parent_id != root.id:
        raise HTTPException(400, "Thread lastSeenMessageId must belong to the thread")
    return message.id


def _parse_read_cursor_last_read_seq(body: dict) -> int:
    if "lastReadSeq" in body:
        raw = body["lastReadSeq"]
    elif "last_read_seq" in body:
        raw = body["last_read_seq"]
    else:
        return 0

    if raw is None or isinstance(raw, bool):
        raise HTTPException(400, "Invalid lastReadSeq")
    if isinstance(raw, int):
        value = raw
    elif isinstance(raw, str):
        text = raw.strip()
        if not text or not text.isdecimal():
            raise HTTPException(400, "Invalid lastReadSeq")
        value = int(text)
    else:
        raise HTTPException(400, "Invalid lastReadSeq")

    if value < 0:
        raise HTTPException(400, "Invalid lastReadSeq")
    return value


def _parse_read_cursor_request_body(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise HTTPException(400, "Invalid read cursor request body")
    return raw


def _parse_read_cursor_scope(body: dict) -> dict:
    if "scope" not in body:
        return {}
    scope = body["scope"]
    if not isinstance(scope, dict):
        raise HTTPException(400, "Invalid read cursor scope")
    return scope


@router.post("/chat/read-cursors")
async def update_chat_read_cursor(
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    body = _parse_read_cursor_request_body(await request.json())
    scope = _parse_read_cursor_scope(body)
    kind = scope.get("kind") or body.get("kind")
    last_read_seq = _parse_read_cursor_last_read_seq(body)
    context = await _resolve_active_server_context(db, request)

    if kind in {"channel", "dm"}:
        channel = await _resolve_read_cursor_channel(db, context.server, scope)
        if kind == "dm" and channel.kind != "dm":
            raise HTTPException(400, "DM cursor scope must reference a DM channel")
        if kind == "channel" and channel.kind == "dm":
            raise HTTPException(400, "Channel cursor scope must not reference a DM channel")
        member_in_channel = await is_channel_member(db, channel_id=channel.id, member_id=context.member.id)
        ensure_channel_access(channel, context.member.id, is_channel_member=member_in_channel)
        cursor = await mark_channel_read(
            db,
            channel_id=channel.id,
            member_id=context.member.id,
            last_read_seq=last_read_seq,
        )
        await db.commit()
        return {
            "cursor": serialize_channel_read_cursor(cursor, scope_kind="dm" if channel.kind == "dm" else "channel")
        }

    if kind == "thread":
        thread_ref = scope.get("rootMessageId") or scope.get("threadId") or body.get("threadId")
        if not thread_ref:
            raise HTTPException(400, "Missing thread cursor scope")
        root = await resolve_thread_root(db, context.server.id, str(thread_ref))
        if not root:
            raise HTTPException(404, "Thread root not found")
        channel_result = await db.execute(select(Channel).where(Channel.id == root.channel_id))
        channel = channel_result.scalar_one_or_none()
        if channel:
            member_in_channel = await is_channel_member(db, channel_id=channel.id, member_id=context.member.id)
            ensure_channel_access(channel, context.member.id, is_channel_member=member_in_channel)
        last_seen_message_id = (
            body["lastSeenMessageId"]
            if "lastSeenMessageId" in body
            else scope.get("lastSeenMessageId")
        )
        validated_last_seen_message_id = await _resolve_thread_last_seen_message_id(
            db,
            root=root,
            last_seen_message_id=last_seen_message_id,
        )
        cursor = await upsert_thread_read_cursor(
            db,
            server_id=context.server.id,
            member_id=context.member.id,
            root_message_id=root.id,
            last_read_seq=last_read_seq,
            last_seen_message_id=validated_last_seen_message_id,
        )
        await db.commit()
        return {"cursor": serialize_thread_read_cursor(cursor)}

    raise HTTPException(400, "Unsupported read cursor scope")


@router.get("/events/stream")
async def stream_public_events(
    request: Request,
    scopeKind: str | None = Query(None),
    scopeId: str | None = Query(None),
    heartbeatSeconds: float = Query(15.0),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server_id = str(context.server.id)
    heartbeat = min(max(heartbeatSeconds, 1.0), 120.0)

    async def event_stream():
        yield "event: ready\ndata: {\"ok\":true}\n\n"
        async with public_event_hub.subscribe_queue() as queue:
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=heartbeat)
                except asyncio.TimeoutError:
                    yield public_event_heartbeat_frame()
                    continue
                payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
                if str(event.get("serverId") or payload.get("serverId") or "") != server_id:
                    continue
                if not should_deliver_public_event(event, scope_kind=scopeKind, scope_id=scopeId):
                    continue
                yield public_event_sse_frame(event)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/channels/{channel_name}/messages")
async def get_channel_messages(
    channel_name: str,
    request: Request,
    limit: int = Query(50),
    threadMode: str | None = Query(None),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    name = channel_name.lstrip("#")
    context = await _resolve_active_server_context(db, request)
    ch = await _resolve_channel(db, context.server, name)
    if not ch:
        return {"messages": []}
    member_in_channel = await is_channel_member(db, channel_id=ch.id, member_id=context.member.id)
    ensure_channel_access(ch, context.member.id, is_channel_member=member_in_channel)

    q = select(Message).where(Message.channel_id == ch.id)
    if threadMode == "roots":
        q = q.where(Message.parent_id.is_(None))
    msgs_result = await db.execute(q.order_by(Message.seq.desc()).limit(limit))
    messages = list(reversed(msgs_result.scalars().all()))

    root_ids = [msg.id for msg in messages if msg.parent_id is None]
    metadata = await load_thread_metadata(db, root_ids)
    thread_read_seq_by_root = await _thread_read_seq_map(
        db,
        root_message_ids=root_ids,
        server_id=context.server.id,
        member_id=context.member.id,
    )
    thread_unread_count_by_root = await _thread_unread_count_map(
        db,
        root_message_ids=root_ids,
        thread_read_seq_by_root=thread_read_seq_by_root,
    )
    result = [
        await _serialize_public_message(
            db,
            msg,
            metadata,
            thread_read_seq_by_root=thread_read_seq_by_root,
            thread_unread_count_by_root=thread_unread_count_by_root,
        )
        for msg in messages
    ]

    return {"messages": result, "channelName": name}


@router.get("/threads/{thread_id}")
async def get_public_thread(
    thread_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    root = await resolve_thread_root(db, server.id, thread_id)
    if not root:
        raise HTTPException(404, "Thread root not found")
    channel_result = await db.execute(select(Channel).where(Channel.id == root.channel_id))
    channel = channel_result.scalar_one_or_none()
    if channel:
        member_in_channel = await is_channel_member(db, channel_id=channel.id, member_id=context.member.id)
        ensure_channel_access(channel, context.member.id, is_channel_member=member_in_channel)
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
            "latestReplySeq": max([int(reply.seq or 0) for reply in replies], default=0),
            "threadSummary": serialize_thread_summary(summary),
        }
    }
    thread_read_seq_by_root = await _thread_read_seq_map(
        db,
        root_message_ids=[root.id],
        server_id=server.id,
        member_id=context.member.id,
    )
    thread_unread_count_by_root = await _thread_unread_count_map(
        db,
        root_message_ids=[root.id],
        thread_read_seq_by_root=thread_read_seq_by_root,
    )
    return {
        "thread": await _serialize_public_message(
            db,
            root,
            metadata,
            thread_read_seq_by_root=thread_read_seq_by_root,
            thread_unread_count_by_root=thread_unread_count_by_root,
        ),
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
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    body = await request.json()
    trace = LatencyTrace(
        trace_id_from_request(request, body, prefix="message"),
        "public_message_create",
        channel=channel_name,
    )
    trace.mark("backend.public_message.request_received")
    context = await _resolve_active_server_context(db, request)
    server = context.server
    content = body.get("content")
    if not content:
        raise HTTPException(400, "Missing content")
    with trace.time("backend.public_message.resolve"):
        channel = await _resolve_channel(db, server, channel_name)
        member_in_channel = await is_channel_member(db, channel_id=channel.id, member_id=context.member.id)
        ensure_channel_access(channel, context.member.id, is_channel_member=member_in_channel)
        sender = context.member if not body.get("sender") else await _resolve_human_actor(db, server, request, body.get("sender"), role="message sender")
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
        msg = Message(
            short_id=uuid.uuid4().hex[:8],
            channel_id=channel.id,
            sender_id=sender.id,
            parent_id=parent_id,
            content=content,
            channel_type="thread" if parent_id else channel.kind,
            mentions=await _parse_mentions(db, server, content),
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
        delivered = await _push_committed_events(db, server_id=server.id)
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    await _push_committed_events(db, server_id=server.id)
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    await _push_committed_events(db, server_id=server.id)
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
    account = context.account
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
    account = context.account
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
            SavedItem.server_id == server.id,
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
        member_id=context.member.id,
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
    account = context.account
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
    account = context.account
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
async def list_tasks(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    context = await _resolve_active_server_context(db, request)
    result = await db.execute(
        select(Task)
        .join(Channel, Channel.id == Task.channel_id)
        .where(Channel.server_id == context.server.id)
        .order_by(Task.task_number)
    )
    tasks = result.scalars().all()

    task_list = [await _serialize_task(db, task) for task in tasks]

    return {"tasks": task_list}


@router.get("/task-run-templates")
async def list_task_run_templates(
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    templates = await list_templates(db, server_id=context.server.id)
    return {"templates": [serialize_task_run_template(template) for template in templates]}


@router.post("/task-run-templates")
async def create_task_run_template(
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    try:
        template = await create_template(
            db,
            body,
            server_id=context.server.id,
            created_by=context.member.id,
        )
        await db.commit()
        await db.refresh(template)
    except PermissionError as exc:
        await db.rollback()
        raise HTTPException(403, str(exc))
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(400, str(exc))
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "TaskRun template slug already exists")
    return {"created": True, "template": serialize_task_run_template(template)}


@router.patch("/task-run-templates/{template_ref}")
async def update_task_run_template(
    template_ref: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    template = await get_template_by_ref(
        db,
        template_ref,
        server_id=context.server.id,
    )
    if template is None:
        raise HTTPException(404, "TaskRun template not found")
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    try:
        template = await update_template(
            db,
            template,
            body,
            server_id=context.server.id,
        )
        await db.commit()
        await db.refresh(template)
    except LookupError:
        await db.rollback()
        raise HTTPException(404, "TaskRun template not found")
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(400, str(exc))
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "TaskRun template slug already exists")
    return {"updated": True, "template": serialize_task_run_template(template)}


@router.post("/task-run-templates/{template_ref}/disable")
async def disable_task_run_template(
    template_ref: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    template = await get_template_by_ref(
        db,
        template_ref,
        server_id=context.server.id,
    )
    if template is None:
        raise HTTPException(404, "TaskRun template not found")
    try:
        template = await disable_template(
            db,
            template,
            server_id=context.server.id,
        )
        await db.commit()
        await db.refresh(template)
    except LookupError:
        await db.rollback()
        raise HTTPException(404, "TaskRun template not found")
    return {"disabled": True, "template": serialize_task_run_template(template)}


def _role_preset_from_snapshot(snapshot: dict, role_key: str | None) -> dict:
    presets = snapshot.get("rolePresets") if isinstance(snapshot, dict) else None
    if not isinstance(presets, list):
        presets = []
    if role_key:
        for preset in presets:
            if isinstance(preset, dict) and preset.get("roleKey") == role_key:
                return dict(preset)
        raise HTTPException(400, f"Role preset not found: {role_key}")
    for preset in presets:
        if isinstance(preset, dict):
            return dict(preset)
    return {}


async def _resolve_task_run_template_request(
    db: AsyncSession,
    body: dict,
    *,
    server_id: uuid.UUID,
) -> tuple[uuid.UUID | None, dict | None, str | None, dict | None]:
    template_ref = body.get("template") or body.get("templateId") or body.get("templateSlug")
    if not template_ref:
        return None, None, body.get("roleKey"), None
    template = await get_template_by_ref(db, template_ref, server_id=server_id)
    if template is None:
        raise HTTPException(404, "TaskRun template not found")
    snapshot = task_run_template_snapshot(template)
    requested_role_key = body.get("roleKey")
    role_snapshot = _role_preset_from_snapshot(snapshot, requested_role_key)
    resolved_role_key = requested_role_key or role_snapshot.get("roleKey")
    return template.id, snapshot, resolved_role_key, role_snapshot


@router.post("/tasks/{task_id}/assignments")
async def create_task_assignment(
    task_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    if body.get("autoStart", True) is not True:
        raise HTTPException(400, "Manual TaskRun start is not implemented yet")
    execution_strategy = body.get("executionStrategy") or "parallel"
    if execution_strategy != "parallel":
        raise HTTPException(400, "Only parallel TaskRun assignment is implemented")
    task = await _resolve_task_by_id_or_number(db, server, task_id)
    assignee = await _resolve_member(db, server, body.get("assignee"))
    if assignee is None:
        raise HTTPException(400, "Missing assignee")
    if getattr(assignee, "kind", None) != "agent":
        raise HTTPException(400, "TaskRun auto-start currently requires an agent assignee")
    actor = await _resolve_human_actor(db, server, request, body.get("actor"), role="task assignment actor")
    template_id, snapshot, role_key, role_snapshot = await _resolve_task_run_template_request(
        db,
        body,
        server_id=server.id,
    )
    role = role_key or body.get("role") or "general"
    assignment, task_run = await create_task_assignment_and_run(
        db,
        task=task,
        assignee=assignee,
        assigned_by_id=actor.id,
        role=role,
        role_key=role_key,
        template_id=template_id,
        template_snapshot=snapshot,
        role_snapshot=role_snapshot,
        execution_strategy=execution_strategy,
        run_order=body.get("runOrder"),
        assignment_mode="direct_drag",
        trigger_type="direct_assignment",
    )
    if assignment is None or task_run is None:
        raise HTTPException(400, "TaskRun assignment could not be created")
    task.assignee_id = assignee.id
    target = await _task_channel_target(db, task)
    await _record_activity(
        db,
        server,
        actor,
        "supervisor_task_assigned",
        f"@{actor.display_name} assigned task #{task.task_number} to @{assignee.display_name}",
        {
            "taskNumber": task.task_number,
            "title": task.title,
            "status": task.status,
            "assignee": f"@{assignee.display_name}",
            "assigneeId": str(assignee.id),
            "targetAgentId": str(assignee.id),
            "target": target,
            "channel": target,
            **_task_run_event_details(task_run),
        },
        channel_id=task.channel_id,
        task_id=task.id,
    )
    await db.commit()
    await db.refresh(task)
    await _push_committed_events(db, server_id=server.id)
    return {
        "created": True,
        "assignmentId": str(assignment.id),
        "run": serialize_task_run(task_run),
        "task": await _serialize_task(db, task),
    }


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    context = await _resolve_active_server_context(db, request)
    server = context.server
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


@router.get("/memory/scopes/{scope_type}/{scope_id}")
async def list_scoped_memory(
    scope_type: str,
    scope_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    viewer = await _resolve_memory_viewer(db, server, request)
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=viewer)
    entries = await list_memory_entries(db, server, context)
    return {"scope": context.scope.as_dict(), "entries": [serialize_memory_entry(entry) for entry in entries]}


@router.get("/memory/scopes/{scope_type}/{scope_id}/path/{path:path}")
async def read_scoped_memory_path(
    scope_type: str,
    scope_id: str,
    path: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    viewer = await _resolve_memory_viewer(db, server, request)
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=viewer)
    entry = await get_memory_entry(db, server, context, path)
    return {"entry": serialize_memory_entry(entry)}


@router.post("/memory/scopes/{scope_type}/{scope_id}/search")
async def search_scoped_memory(
    scope_type: str,
    scope_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    body = await request.json()
    viewer = await _resolve_memory_viewer(db, server, request)
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=viewer)
    entries = await search_memory(db, server, context, str(body.get("query") or body.get("q") or ""), limit=int(body.get("limit") or 10))
    return {"scope": context.scope.as_dict(), "entries": [serialize_memory_entry(entry) for entry in entries]}


@router.put("/memory/scopes/{scope_type}/{scope_id}/path/{path:path}")
async def write_scoped_memory_path(
    scope_type: str,
    scope_id: str,
    path: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    body = await request.json()
    viewer = await _resolve_memory_viewer(db, server, request)
    _ensure_memory_actor_matches_viewer(body, viewer)
    actor = viewer
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=viewer)
    entry, created = await write_memory_entry(db, server, context, path, body, author=actor)
    await db.commit()
    await db.refresh(entry)
    await _push_committed_events(db, server_id=server.id)
    return {"created": created, "entry": serialize_memory_entry(entry)}


@router.post("/memory/scopes/{scope_type}/{scope_id}/proposals")
async def propose_scoped_memory(
    scope_type: str,
    scope_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    body = await request.json()
    viewer = await _resolve_memory_viewer(db, server, request)
    _ensure_memory_actor_matches_viewer(body, viewer)
    actor = viewer
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=viewer)
    proposal = await create_memory_proposal(db, server, context, body, author=actor)
    await db.commit()
    await db.refresh(proposal)
    await _push_committed_events(db, server_id=server.id)
    return {"proposal": serialize_memory_proposal(proposal)}


@router.get("/memory/scopes/{scope_type}/{scope_id}/proposals")
async def list_scoped_memory_proposals(
    scope_type: str,
    scope_id: str,
    request: Request,
    status: str = Query("open"),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    viewer = await _resolve_memory_viewer(db, server, request)
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=viewer)
    proposals = await list_memory_proposals(db, server, context, status=status)
    return {"scope": context.scope.as_dict(), "proposals": [serialize_memory_proposal(proposal) for proposal in proposals]}


@router.post("/memory/proposals/{proposal_id}/accept")
async def accept_memory_proposal(
    proposal_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    body = await request.json()
    viewer = await _resolve_memory_viewer(db, server, request)
    _ensure_memory_actor_matches_viewer(body, viewer)
    result = await resolve_memory_proposal(
        db,
        server,
        proposal_id,
        {**body, "status": "accepted"},
        reviewer=viewer,
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
async def reject_memory_proposal(
    proposal_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    body = await request.json()
    viewer = await _resolve_memory_viewer(db, server, request)
    _ensure_memory_actor_matches_viewer(body, viewer)
    result = await resolve_memory_proposal(
        db,
        server,
        proposal_id,
        {**body, "status": "rejected"},
        reviewer=viewer,
    )
    await db.commit()
    await db.refresh(result["proposal"])
    await _push_committed_events(db, server_id=server.id)
    return {"proposal": serialize_memory_proposal(result["proposal"]), "entry": None}


@router.delete("/memory/scopes/{scope_type}/{scope_id}/path/{path:path}")
async def delete_scoped_memory_path(
    scope_type: str,
    scope_id: str,
    path: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    viewer = await _resolve_memory_viewer(db, server, request)
    context = await resolve_memory_scope(db, server, scope_type, scope_id, viewer=viewer)
    entry = await delete_memory_entry(db, server, context, path, author=viewer)
    await db.commit()
    await db.refresh(entry)
    await _push_committed_events(db, server_id=server.id)
    return {"deleted": True, "entry": serialize_memory_entry(entry)}


@router.get("/channels/{channel_name}/memory")
async def list_channel_memory_alias(
    channel_name: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    viewer = await _resolve_memory_viewer(db, server, request)
    context = await resolve_memory_scope(db, server, "channel", channel_name, viewer=viewer)
    entries = await list_memory_entries(db, server, context)
    return {"scope": context.scope.as_dict(), "entries": [serialize_memory_entry(entry) for entry in entries]}


@router.get("/tasks/{task_id}/memory")
async def list_task_memory_alias(
    task_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    viewer = await _resolve_memory_viewer(db, server, request)
    context = await resolve_memory_scope(db, server, "task", task_id, viewer=viewer)
    entries = await list_memory_entries(db, server, context)
    return {"scope": context.scope.as_dict(), "entries": [serialize_memory_entry(entry) for entry in entries]}


async def _resolve_task_by_id_or_number(db: AsyncSession, server: Server, task_id: str) -> Task:
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
    return task


@router.post("/tasks/{task_id}/memory/request")
async def request_task_memory_result(
    task_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    body = await request.json()
    task = await _resolve_task_by_id_or_number(db, server, task_id)
    actor = await _resolve_human_actor(db, server, request, body.get("actor"), role="task memory requester")
    event = await add_task_memory_request_event(
        db,
        server,
        task,
        actor=actor,
        instruction=str(body.get("instruction") or "").strip() or None,
        output_directions=normalize_output_directions(body.get("outputDirections")),
        trigger="manual",
    )
    if event is None:
        await db.rollback()
        return {"requested": False, "reason": "task has no agent assignee"}
    await db.commit()
    await _push_committed_events(db, server_id=server.id)
    return {"requested": True, "eventType": "task.memory_requested"}


@router.post("/tasks")
async def create_task(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    selected_server_id = server.id
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    title = body.get("title")
    if not title:
        raise HTTPException(400, "Missing title")
    channel = await _resolve_channel(db, server, body.get("channel") or "#all")
    creator = await _resolve_human_actor(db, server, request, body.get("creator"), role="task creator") if body.get("creator") else context.member
    assignee = await _resolve_member(db, server, body.get("assignee"))
    channel_id = channel.id
    channel_target = f"#{channel.name}" if channel.kind == "public" else channel.name
    creator_id = creator.id
    creator_name = creator.display_name
    assignee_id = assignee.id if assignee else None
    assignee_name = assignee.display_name if assignee else None
    assignee_kind = assignee.kind if assignee else None
    has_runtime_assignment = bool(assignee_id and assignee_kind == "agent")
    if has_runtime_assignment and body.get("autoStart", True) is not True:
        raise HTTPException(400, "Manual TaskRun start is not implemented yet")
    execution_strategy = body.get("executionStrategy") or "parallel"
    if has_runtime_assignment and execution_strategy != "parallel":
        raise HTTPException(400, "Only parallel TaskRun assignment is implemented")
    template_id, template_snapshot, role_key, role_snapshot = await _resolve_task_run_template_request(
        db,
        body,
        server_id=server.id,
    )
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
        server_result = await db.execute(select(Server).where(Server.id == selected_server_id))
        server = server_result.scalar_one()
        channel_result = await db.execute(select(Channel).where(Channel.id == channel_id))
        channel = channel_result.scalar_one()
        creator_result = await db.execute(select(Member).where(Member.id == creator_id))
        creator = creator_result.scalar_one()
        if assignee_id:
            assignee_result = await db.execute(select(Member).where(Member.id == assignee_id))
            assignee = assignee_result.scalar_one_or_none()
        channel_target = f"#{channel.name}" if channel.kind == "public" else channel.name

    _assignment, task_run = await create_task_assignment_and_run(
        db,
        task=task,
        assignee=assignee,
        assigned_by_id=creator_id,
        role=role_key or body.get("role") or "general",
        role_key=role_key,
        template_id=template_id,
        template_snapshot=template_snapshot,
        role_snapshot=role_snapshot,
        execution_strategy=execution_strategy,
        assignment_mode="task_created",
        trigger_type="task_created",
    )

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
            **_task_run_event_details(task_run),
        },
        channel_id=channel_id,
        task_id=task.id,
    )

    await db.commit()
    await db.refresh(task)
    await _push_committed_events(db, server_id=server.id)
    return {"created": True, "task": await _serialize_task(db, task)}


@router.patch("/tasks/{task_id}")
async def update_task(task_id: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    body = await request.json()
    task = await _resolve_task_by_id_or_number(db, server, task_id)
    previous_status = task.status

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
    if previous_status != "in_review" and task.status == "in_review":
        await add_task_memory_request_event(
            db,
            server,
            task,
            actor=actor,
            instruction=str(body.get("memoryInstruction") or "").strip() or None,
            output_directions=normalize_output_directions(body.get("outputDirections")),
            trigger="status_in_review",
        )
    await db.commit()
    await db.refresh(task)
    await _push_committed_events(db, server_id=server.id)
    return {"updated": True, "task": await _serialize_task(db, task)}


@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    """Delete one server-scoped task and retain its identity as JSON tombstone data."""

    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
    task = await _resolve_task_by_id_or_number(db, server, task_id)
    actor = await _resolve_human_actor(db, server, request, None, role="task deletion actor")

    # Preserve only primitive values before DELETE/rollback can expire ORM state.
    deleted_task_id = task.id
    deleted_task_number = task.task_number
    deleted_title = task.title
    deleted_channel_id = task.channel_id
    tombstone = {
        "taskId": str(deleted_task_id),
        "taskNumber": deleted_task_number,
        "title": deleted_title,
    }

    try:
        await _delete_saved_item_references(db, task_ids=[deleted_task_id])
        # Core DELETE lets PostgreSQL enforce the declared CASCADE/SET NULL graph:
        # task assignments/runs cascade; durable references become NULL.
        await db.execute(delete(Task).where(Task.id == deleted_task_id))
        await _record_activity(
            db,
            server,
            actor,
            "supervisor_task_deleted",
            f"@{actor.display_name} deleted task #{deleted_task_number}",
            {"taskId": str(deleted_task_id), "tombstone": tombstone},
            channel_id=deleted_channel_id,
            task_id=None,
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    await _push_committed_events(db, server_id=server.id)
    return {
        "deleted": True,
        "taskId": str(deleted_task_id),
        "taskNumber": deleted_task_number,
    }


@router.get("/computers")
async def list_computers(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
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
    await _push_committed_events(db, server_id=server.id)
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
    request: Request,
    agent_id: str | None = Query(None, alias="agentId"),
    task_id: str | None = Query(None, alias="taskId"),
    limit: int = Query(50),
    compact: bool = Query(False),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server

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
    request: Request,
    q: str = Query(..., min_length=1),
    limit: int = Query(20),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server

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
    request: Request,
    channel_id: str | None = Query(None, alias="channelId"),
    limit: int = Query(50),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server

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
    context = await _resolve_active_server_context(db, request)
    server = context.server

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


def _quarantine_file_for_deletion(path: Path, file_id: uuid.UUID) -> Path:
    """Atomically remove a local blob from its served path before DB deletion."""

    quarantine_root = UPLOAD_ROOT.resolve() / ".deleted"
    quarantine_root.mkdir(parents=True, exist_ok=True)
    quarantine_path = quarantine_root / f"{file_id}-{path.name}"
    if quarantine_path.exists():
        raise HTTPException(409, "File deletion is already quarantined")
    try:
        path.replace(quarantine_path)
    except OSError as exc:
        logger.exception("Failed to quarantine file blob %s", path)
        raise HTTPException(500, "Could not quarantine file storage") from exc
    return quarantine_path


def _restore_quarantined_file(quarantine_path: Path, original_path: Path) -> None:
    """Compensate a failed DB transaction by restoring the served blob."""

    original_path.parent.mkdir(parents=True, exist_ok=True)
    quarantine_path.replace(original_path)


def _purge_quarantined_file(quarantine_path: Path) -> bool:
    """Best-effort post-commit purge; False means a non-served orphan remains."""

    try:
        quarantine_path.unlink(missing_ok=True)
        return True
    except OSError:
        logger.exception("Failed to purge quarantined file blob %s", quarantine_path)
        return False


@router.delete("/files/{file_id}")
async def delete_file(
    file_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    """Delete file metadata transactionally and quarantine local storage safely."""

    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
    file_entry = await _get_public_attachment(db, server, file_id)
    actor = await _resolve_human_actor(db, server, request, None, role="file deletion actor")

    deleted_file_id = file_entry.id
    deleted_channel_id = file_entry.channel_id
    deleted_file_name = file_entry.file_name
    deleted_original_name = file_entry.original_name
    original_path = _safe_attachment_path(file_entry)
    tombstone = {
        "fileId": str(deleted_file_id),
        "fileName": deleted_file_name,
        "originalName": deleted_original_name,
    }

    # Filesystem and PostgreSQL are not one transaction.  Quarantine first so a
    # successful DB delete never leaves the blob publicly resolvable; compensate
    # by restoring the path if the DB transaction fails.
    quarantine_path = _quarantine_file_for_deletion(original_path, deleted_file_id)
    try:
        await _delete_saved_item_references(db, file_ids=[deleted_file_id])
        await db.execute(delete(FileEntry).where(FileEntry.id == deleted_file_id))
        await _record_activity(
            db,
            server,
            actor,
            "supervisor_file_deleted",
            f"@{actor.display_name} deleted file {deleted_original_name or deleted_file_name}",
            {
                "fileId": str(deleted_file_id),
                "tombstone": tombstone,
                "storagePolicy": "quarantine-then-delete",
            },
            channel_id=deleted_channel_id,
        )
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            _restore_quarantined_file(quarantine_path, original_path)
        except OSError:
            logger.critical(
                "DB file deletion rolled back but blob restore failed quarantine=%s original=%s",
                quarantine_path,
                original_path,
                exc_info=True,
            )
        raise

    storage_cleanup = "deleted" if _purge_quarantined_file(quarantine_path) else "quarantined"
    await _push_committed_events(db, server_id=server.id)
    return {
        "deleted": True,
        "fileId": str(deleted_file_id),
        "storageCleanup": storage_cleanup,
    }


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
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
    await _resolve_human_actor(db, server, request, None, role="attachment viewer")
    entry = await _get_public_attachment(db, server, attachment_id)
    path = _safe_attachment_path(entry)
    return FileResponse(path, media_type=entry.mime_type, filename=entry.original_name)


@router.get("/reminders")
async def list_reminders(
    request: Request,
    status: str | None = Query(None),
    limit: int = Query(50),
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server

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
async def list_members(request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    context = await _resolve_active_server_context(db, request)
    server = context.server

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


def _apply_member_patch(member: Member, body: dict) -> None:
    if "status" in body:
        member.status = body["status"]
    if "description" in body:
        member.description = body["description"]
    if "avatarUrl" in body and member.kind == "human":
        avatar_url = body["avatarUrl"]
        member.avatar_url = str(avatar_url).strip() if avatar_url else None

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


def _channel_member_ids_from_body(body: dict) -> list[uuid.UUID]:
    raw_ids: list[str] = []
    if body.get("memberId"):
        raw_ids.append(str(body["memberId"]))
    if body.get("memberIds"):
        raw_member_ids = body["memberIds"]
        if not isinstance(raw_member_ids, list):
            raise HTTPException(400, "Invalid memberIds")
        raw_ids.extend(str(member_id) for member_id in raw_member_ids if member_id)

    if not raw_ids:
        raise HTTPException(400, "Missing memberId")

    parsed_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for raw_id in raw_ids:
        try:
            parsed_id = uuid.UUID(raw_id)
        except ValueError:
            raise HTTPException(400, "Invalid memberId")
        if parsed_id in seen:
            continue
        seen.add(parsed_id)
        parsed_ids.append(parsed_id)
    return parsed_ids


@router.patch("/members/{member_id}")
async def update_member(member_id: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
    member = await _resolve_member(db, server, member_id)
    if not member:
        raise HTTPException(404, "Member not found")
    body = await request.json()

    _apply_member_patch(member, body)

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
    await _push_committed_events(db, server_id=server.id)
    return {"updated": True, "member": await serialize_member(db, member)}


@router.delete("/members/{member_id}")
async def delete_member(
    member_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
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
    await _push_committed_events(db, server_id=server.id)
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
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
        "command": _computer_connect_command(token, server_url, server.name),
        "daemonInstall": _daemon_install_metadata(server_url),
        "serverId": str(server.id),
        "serverName": server.name,
        "expiresAt": expires_at.isoformat(),
    }


@router.post("/computers/{computer_id}/reconnect-command")
async def generate_computer_reconnect_command(
    computer_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
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
        "command": _computer_connect_command(token, server_url, server.name),
        "daemonInstall": _daemon_install_metadata(server_url),
        "serverId": str(server.id),
        "serverName": server.name,
        "expiresAt": expires_at.isoformat(),
    }


@router.post("/workspaces/{workspace_id}/lifecycle")
async def control_workspace_lifecycle(
    workspace_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
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
        await _push_committed_events(db, server_id=server.id)
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
    await _push_committed_events(db, server_id=server.id)
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
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
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
    await _push_committed_events(db, server_id=server.id)
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
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
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

    Product surfaces expose Codex as `codex`; the daemon launches the ACP
    implementation. Historical `codex_acp` values are accepted only as aliases.
    The native `codex_cli` runtime is intentionally not a product runtime.
    """
    aliases = {
        "claude": "claude_code",
        "claude_code": "claude_code",
        "codex": "codex",
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


def _agent_auto_start_enabled(body: dict) -> bool:
    value = body.get("autoStart", body.get("startRuntime", True))
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "off"}
    return bool(value)


@router.post("/members/agents")
async def create_agent(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
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
    ensure_server_scoped_computer(computer, server_id=server.id)

    runtime = _normalize_runtime(body.get("runtime", "claude_code"))
    runtime_command = body.get("runtimeCommand")
    if runtime == "codex":
        runtime_command = None
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
    auto_start = _agent_auto_start_enabled(body)
    desired_status = "running" if auto_start else "stopped"
    workspace_status = PENDING_RUNTIME_START_STATUS if auto_start else "stopped"
    requested_permissions = body.get("permissions") if "permissions" in body else None
    if requested_permissions is not None and not isinstance(requested_permissions, dict):
        raise HTTPException(400, "Agent permissions must be an object")
    try:
        permissions = agent_permissions_for_creation(requested_permissions)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

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
            "runtimeDesiredStatus": desired_status,
            "permissions": permissions,
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
        status=workspace_status,
        cwd=body.get("cwd"),
    )
    db.add(workspace)
    await db.flush()

    agent.config = {**(agent.config or {}), "workspaceId": str(workspace.id)}

    await db.commit()
    await db.refresh(agent)
    await db.refresh(workspace)

    # Emit a member.created event so the Members page refreshes without a manual
    # reload. The actor is the human who created the agent when authenticated;
    # otherwise we fall back to the new agent itself (public API key path).
    # This event is UI-only: the daemon proxy gates non-message events through
    # isRuntimeActionableEventType(), so member.created never reaches a runtime.
    try:
        actor = await _resolve_human_actor(db, server, request, None, role="agent creation actor", required=False)
        emit_actor = actor or agent
        await _record_activity(
            db,
            server,
            emit_actor,
            "supervisor_member_created",
            f"@{emit_actor.display_name} created agent @{agent.display_name}",
            {
                "memberId": str(agent.id),
                "agentId": str(agent.id),
                "memberName": agent.display_name,
                "computerId": str(computer_id),
            },
        )
        await db.commit()
        await _push_committed_events(db, server_id=server.id)
    except Exception:
        logger.exception("member.created event emit failed for agent=%s", agent.id)

    if auto_start:
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
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

    creator = context.member if not body.get("creator") else await _resolve_human_actor(db, server, request, body.get("creator"), role="channel creator")

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
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    await _push_committed_events(db, server_id=server.id)
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    parsed_member_ids = _channel_member_ids_from_body(body)

    members = await db.execute(
        select(Member).where(Member.id.in_(parsed_member_ids), Member.server_id == server.id)
    )
    existing_members = {member.id for member in members.scalars().all()}
    missing_member_ids = [member_id for member_id in parsed_member_ids if member_id not in existing_members]
    if missing_member_ids:
        raise HTTPException(404, "Member not found")

    existing = await db.execute(
        select(ChannelMember.member_id).where(
            ChannelMember.channel_id == parsed_channel_id,
            ChannelMember.member_id.in_(parsed_member_ids),
        )
    )
    existing_member_ids = {member_id for (member_id,) in existing.all()}
    added_member_ids: list[uuid.UUID] = []
    for parsed_member_id in parsed_member_ids:
        if parsed_member_id in existing_member_ids:
            continue
        db.add(ChannelMember(channel_id=parsed_channel_id, member_id=parsed_member_id))
        added_member_ids.append(parsed_member_id)

    await db.commit()
    if len(parsed_member_ids) == 1:
        parsed_member_id = parsed_member_ids[0]
        response = {
            "added": bool(added_member_ids),
            "channelId": str(parsed_channel_id),
            "memberId": str(parsed_member_id),
        }
        if not added_member_ids:
            response["reason"] = "already_member"
        return response
    return {
        "added": len(added_member_ids),
        "channelId": str(parsed_channel_id),
        "memberIds": [str(member_id) for member_id in parsed_member_ids],
        "addedMemberIds": [str(member_id) for member_id in added_member_ids],
    }


@router.delete("/channels/{channel_id}/members/{member_id}")
async def remove_channel_member(
    channel_id: str,
    member_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
    channel_ids = [channel.id for channel in channels]
    latest_seq_by_channel = await _channel_latest_seq_map(db, channel_ids)
    read_seq_by_channel = await _channel_read_seq_map(
        db,
        channel_ids=channel_ids,
        member_id=viewer.id,
    )
    unread_count_by_channel = await _channel_unread_count_map(
        db,
        channel_ids=channel_ids,
        read_seq_by_channel=read_seq_by_channel,
    )
    return {
        "dms": [
            await _dm_channel_payload(
                db,
                channel,
                viewer,
                latest_seq_by_channel=latest_seq_by_channel,
                read_seq_by_channel=read_seq_by_channel,
                unread_count_by_channel=unread_count_by_channel,
            )
            for channel in channels
        ],
        "count": len(channels),
    }


@router.post("/dm")
async def create_or_get_dm(
    request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    server = context.server
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
