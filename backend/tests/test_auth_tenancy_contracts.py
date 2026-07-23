import base64
import inspect
import os
import subprocess
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, WebSocketDisconnect
from pydantic import ValidationError

import models.seed as seed
from config import Settings
from models import Account, Member, ServerMembership
from routers import agent_api, chat, public_api

CHAT_WEBSOCKET_PROTOCOL = "smallkhoj.chat.v1"
CHAT_WEBSOCKET_KEY_PROTOCOL_PREFIX = "smallkhoj.public-key."


class _NoQuerySession:
    async def execute(self, _statement):
        raise AssertionError("credential rejection must happen before database lookup")


class _ActorResult:
    def __init__(self, values=None, row=None):
        self.values = list(values or [])
        self.row = row

    def scalar_one_or_none(self):
        return self.values[0] if len(self.values) == 1 else None

    def one_or_none(self):
        return self.row

    def scalars(self):
        return self

    def all(self):
        return self.values


class _ActorSession:
    def __init__(self, *, account, membership, viewer, members):
        self.account = account
        self.membership = membership
        self.viewer = viewer
        self.members = members
        self.added = []

    async def execute(self, statement):
        sql = str(statement)
        params = statement.compile().params
        if "FROM accounts" in sql:
            return _ActorResult([self.account])
        if "FROM server_memberships" in sql:
            return _ActorResult(row=(self.membership, self.viewer))
        if "FROM members" in sql:
            uuid_values = {value for value in params.values() if isinstance(value, uuid.UUID)}
            string_values = {value for value in params.values() if isinstance(value, str)}
            matches = [
                member
                for member in self.members
                if member.server_id == self.viewer.server_id
                and (
                    member.id in uuid_values
                    or member.display_name in string_values
                    or member.display_name.lower() in {value.lower() for value in string_values}
                )
            ]
            return _ActorResult(matches)
        raise AssertionError(f"unexpected actor query: {sql}")

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        return None


@pytest.mark.asyncio
async def test_public_api_rejects_query_string_credential():
    request = SimpleNamespace(
        headers={},
        query_params={"api_key": public_api.PUBLIC_API_KEY},
    )

    with pytest.raises(HTTPException) as error:
        await public_api.verify_public_api_key(request, _NoQuerySession())

    assert error.value.status_code == 401
    assert "header" in error.value.detail.lower()
    assert "query" not in error.value.detail.lower()
    assert "api_key" not in error.value.detail.lower()


def test_production_settings_reject_missing_public_api_key():
    with pytest.raises(ValidationError, match="PUBLIC_API_KEY"):
        Settings(debug=False, public_api_key="")


def test_production_settings_reject_repository_known_public_api_key():
    with pytest.raises(ValidationError, match="PUBLIC_API_KEY"):
        Settings(debug=False, public_api_key="sk_public_local")


def test_local_debug_settings_resolve_explicit_development_key():
    configured = Settings(debug=True, public_api_key="")
    assert configured.public_api_key == "sk_public_local"


def test_public_api_module_uses_configured_key_instead_of_literal():
    backend_root = Path(__file__).resolve().parents[1]
    env = {
        **os.environ,
        "DEBUG": "true",
        "PUBLIC_API_KEY": "sk_test_rotated_public_key",
    }
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from routers import public_api; "
                "print(public_api.PUBLIC_API_KEY); "
                "print(public_api.settings.public_api_key)"
            ),
        ],
        cwd=backend_root,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )

    assert result.stdout.splitlines() == [
        "sk_test_rotated_public_key",
        "sk_test_rotated_public_key",
    ]


def test_auth_bridge_fails_closed_when_unconfigured_in_debug(monkeypatch):
    monkeypatch.setattr(
        public_api,
        "settings",
        SimpleNamespace(auth_bridge_secret="", debug=True),
    )

    with pytest.raises(HTTPException) as error:
        public_api._verify_auth_bridge_secret(
            SimpleNamespace(headers={public_api.AUTH_BRIDGE_SECRET_HEADER: "attacker-value"})
        )

    assert error.value.status_code == 503
    assert "not configured" in error.value.detail


@pytest.mark.parametrize("config", [None, {}, {"permissions": None}, {"permissions": {}}])
def test_missing_or_empty_agent_permissions_deny_known_capability(config):
    member = SimpleNamespace(config=config)

    with pytest.raises(HTTPException) as error:
        agent_api._require_permission(member, "sendMessage")

    assert error.value.status_code == 403


def test_unknown_agent_permission_is_denied_even_when_present():
    member = SimpleNamespace(config={"permissions": {"futureCapability": True}})

    with pytest.raises(HTTPException) as error:
        agent_api._require_permission(member, "futureCapability")

    assert error.value.status_code == 403


def test_known_agent_permission_requires_explicit_true():
    member = SimpleNamespace(config={"permissions": {"sendMessage": True}})
    assert agent_api._require_permission(member, "sendMessage") is None


def test_new_agent_gets_explicit_compatibility_permissions():
    permissions = agent_api._agent_permissions_for_creation(None)

    assert set(permissions) == set(agent_api.AGENT_PERMISSION_CAPABILITIES)
    assert all(value is True for value in permissions.values())


def test_new_agent_partial_permissions_are_expanded_default_deny():
    permissions = agent_api._agent_permissions_for_creation({"sendMessage": True})

    assert permissions["sendMessage"] is True
    assert permissions["createTask"] is False
    assert set(permissions) == set(agent_api.AGENT_PERMISSION_CAPABILITIES)


def test_new_agent_rejects_unknown_permissions():
    with pytest.raises(HTTPException) as error:
        agent_api._agent_permissions_for_creation({"futureCapability": True})

    assert error.value.status_code == 400


def test_runtime_seed_backfills_only_missing_legacy_agent_permission_maps():
    source = inspect.getsource(seed.create_tables)

    assert "UPDATE members" in source
    assert "type = 'agent'" in source
    assert "config ? 'permissions'" in source
    assert "agent_permissions" in source
    assert "config->'permissions' = '{}'" not in source


@pytest.mark.asyncio
async def test_member_patch_rejects_non_admin_before_resolving_target(monkeypatch):
    context = SimpleNamespace(
        server=SimpleNamespace(id="server-a"),
        membership=SimpleNamespace(role="member"),
    )

    async def fake_context(_db, _request):
        return context

    async def forbidden_target_lookup(*_args, **_kwargs):
        raise AssertionError("target lookup must not run before the role gate")

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_context)
    monkeypatch.setattr(public_api, "_resolve_member", forbidden_target_lookup)

    with pytest.raises(HTTPException) as error:
        await public_api.update_member(
            "00000000-0000-0000-0000-000000000001",
            SimpleNamespace(),
            db=SimpleNamespace(),
        )

    assert error.value.status_code == 403


def _actor_context(*, duplicate_viewer_name=False):
    server_id = uuid.uuid4()
    viewer = Member(
        id=uuid.uuid4(),
        server_id=server_id,
        kind="human",
        display_name="Viewer",
    )
    foreign = Member(
        id=uuid.uuid4(),
        server_id=server_id,
        kind="human",
        display_name="Other",
    )
    account = Account(
        id=uuid.uuid4(),
        name="viewer-account",
        display_name="Viewer",
        server_id=server_id,
        member_id=viewer.id,
        session_token_hash=public_api._hash_token("sk_actor_session"),
    )
    membership = ServerMembership(
        id=uuid.uuid4(),
        server_id=server_id,
        account_id=account.id,
        member_id=viewer.id,
        role="member",
        status="active",
    )
    members = [viewer, foreign]
    if duplicate_viewer_name:
        members.append(
            Member(
                id=uuid.uuid4(),
                server_id=server_id,
                kind="human",
                display_name="viewer",
            )
        )
    return (
        SimpleNamespace(id=server_id),
        viewer,
        foreign,
        _ActorSession(
            account=account,
            membership=membership,
            viewer=viewer,
            members=members,
        ),
        SimpleNamespace(
            headers={"X-Account-Token": "sk_actor_session"},
            cookies={},
        ),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("actor_form", [None, "Viewer", "@Viewer", "uuid"])
async def test_human_actor_self_aliases_resolve_to_canonical_viewer(actor_form):
    server, viewer, _foreign, db, request = _actor_context()
    explicit = str(viewer.id) if actor_form == "uuid" else actor_form

    actor = await public_api._resolve_human_actor(
        db,
        server,
        request,
        explicit,
        role="contract actor",
    )

    assert actor is viewer
    assert db.added == []


@pytest.mark.asyncio
@pytest.mark.parametrize("actor_form", ["Other", "@other", "uuid"])
async def test_human_actor_foreign_aliases_are_rejected(actor_form):
    server, _viewer, foreign, db, request = _actor_context()
    explicit = str(foreign.id) if actor_form == "uuid" else actor_form

    with pytest.raises(HTTPException) as error:
        await public_api._resolve_human_actor(
            db,
            server,
            request,
            explicit,
            role="contract actor",
        )

    assert error.value.status_code == 403
    assert db.added == []


@pytest.mark.asyncio
async def test_human_actor_ambiguous_alias_is_rejected_without_creating_member():
    server, _viewer, _foreign, db, request = _actor_context(duplicate_viewer_name=True)

    with pytest.raises(HTTPException) as error:
        await public_api._resolve_human_actor(
            db,
            server,
            request,
            "VIEWER",
            role="contract actor",
        )

    assert error.value.status_code == 400
    assert db.added == []


@pytest.mark.asyncio
async def test_human_actor_unknown_alias_is_not_auto_created():
    server, _viewer, _foreign, db, request = _actor_context()

    with pytest.raises(HTTPException) as error:
        await public_api._resolve_human_actor(
            db,
            server,
            request,
            "new-human-from-untrusted-input",
            role="contract actor",
        )

    assert error.value.status_code == 404
    assert db.added == []


class _DisconnectedWebSocket:
    def __init__(self, *, headers=None):
        self.headers = headers or {}
        self.accepted = False
        self.accepted_subprotocol = None
        self.close_code = None
        self.close_reason = None

    async def accept(self, subprotocol=None):
        self.accepted = True
        self.accepted_subprotocol = subprotocol

    async def close(self, code=1000, reason=None):
        self.close_code = code
        self.close_reason = reason

    async def receive_json(self):
        raise WebSocketDisconnect()


@pytest.mark.asyncio
async def test_chat_websocket_rejects_missing_credential_before_accept():
    ws = _DisconnectedWebSocket()

    await chat.chat_websocket(ws)

    assert ws.accepted is False
    assert ws.close_code == 1008
    assert "key" not in (ws.close_reason or "").lower()


@pytest.mark.asyncio
async def test_chat_websocket_accepts_key_via_subprotocol_without_url_transport():
    key = public_api.PUBLIC_API_KEY
    encoded_key = base64.urlsafe_b64encode(key.encode("utf-8")).decode("ascii").rstrip("=")
    ws = _DisconnectedWebSocket(
        headers={
            "sec-websocket-protocol": (
                f"{CHAT_WEBSOCKET_PROTOCOL}, "
                f"{CHAT_WEBSOCKET_KEY_PROTOCOL_PREFIX}{encoded_key}"
            )
        }
    )

    await chat.chat_websocket(ws)

    assert ws.accepted is True
    assert ws.accepted_subprotocol == CHAT_WEBSOCKET_PROTOCOL
    assert key not in ws.accepted_subprotocol
    assert ws.close_code is None
