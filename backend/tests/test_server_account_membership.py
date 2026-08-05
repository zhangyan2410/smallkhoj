import inspect
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import MultipleResultsFound

import models.seed as seed
import routers.public_api as public_api
from models import Account, Base, Channel, Computer, Member, Server, ServerInvite, ServerMembership
from services import server_invites, server_membership


class _ExecuteResult:
    def __init__(self, value=None, scalar_rows=None, rows=None, row=None):
        self._value = value
        self._scalar_rows = scalar_rows or []
        self._rows = rows or []
        self._row = row

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value

    def one_or_none(self):
        if self._row is not None:
            return self._row
        if len(self._rows) > 1:
            raise MultipleResultsFound("Multiple rows were found when one or none was required")
        return self._rows[0] if self._rows else None

    def scalars(self):
        return self

    def all(self):
        return self._scalar_rows or self._rows


class _FakeSession:
    def __init__(self, *results):
        self._results = list(results)
        self.added = []
        self.flushed = 0

    async def execute(self, _statement, _parameters=None):
        if self._results:
            return self._results.pop(0)
        return _ExecuteResult()

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        self.flushed += 1
        for item in self.added:
            if getattr(item, "id", None) is None:
                item.id = uuid.uuid4()

    async def commit(self):
        self.committed = True


class _ServerFilterAwareSession:
    def __init__(self, filtered_row, unfiltered_rows):
        self.filtered_row = filtered_row
        self.unfiltered_rows = unfiltered_rows

    async def execute(self, statement):
        statement_text = str(statement)
        if "server_memberships.server_id =" in statement_text:
            return _ExecuteResult(row=self.filtered_row)
        return _ExecuteResult(rows=self.unfiltered_rows)


class _SeedConn:
    def __init__(self):
        self.statements = []

    async def run_sync(self, callback):
        self.run_sync_callback = callback

    async def execute(self, statement, _parameters=None):
        self.statements.append(str(statement))


class _SeedBegin:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _SeedEngine:
    def __init__(self):
        self.conn = _SeedConn()

    def begin(self):
        return _SeedBegin(self.conn)


def _request(*, server_id=None, token="sk_session_test"):
    return SimpleNamespace(
        headers={"X-Server-Id": str(server_id)} if server_id else {},
        cookies={public_api.SESSION_COOKIE_NAME: token},
        query_params={},
    )


class _JsonRequest:
    def __init__(self, body, *, headers=None, cookies=None):
        self._body = body
        self.headers = headers or {}
        self.cookies = cookies or {public_api.SESSION_COOKIE_NAME: "sk_session_test"}
        self.query_params = {}

    async def json(self):
        return self._body


def _membership(server: Server, account: Account, member: Member, *, role="member") -> ServerMembership:
    return ServerMembership(
        id=uuid.uuid4(),
        server_id=server.id,
        account_id=account.id,
        member_id=member.id,
        role=role,
        status="active",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def _invite(
    server: Server,
    *,
    token_hash: str = "invite-token-hash",
    role: str = "member",
    accepted_account_id: uuid.UUID | None = None,
    accepted_at: datetime | None = None,
    expires_at: datetime | None = None,
    revoked_at: datetime | None = None,
) -> ServerInvite:
    return ServerInvite(
        id=uuid.uuid4(),
        server_id=server.id,
        token_hash=token_hash,
        role=role,
        expires_at=expires_at or (datetime.now(timezone.utc) + timedelta(days=7)),
        revoked_at=revoked_at,
        accepted_at=accepted_at,
        accepted_account_id=accepted_account_id,
    )


def _server(name: str) -> Server:
    return Server(id=uuid.uuid4(), name=name, server_handle=f"s{uuid.uuid4().hex[:4]}")


def _home_identity(
    server: Server,
    *,
    handle: str = "lee",
    display_name: str | None = "Lee",
    token: str | None = None,
) -> tuple[Account, Member]:
    account_id = uuid.uuid4()
    member = Member(
        id=uuid.uuid4(),
        origin_server_id=server.id,
        account_id=account_id,
        kind="human",
        handle=handle,
        handle_key=handle.casefold(),
    )
    account = Account(
        id=account_id,
        auth_subject=f"test:{account_id}",
        display_name=display_name,
        home_server_id=server.id,
        session_token_hash=public_api._hash_token(token) if token else None,
    )
    return account, member


def test_server_membership_tables_are_declared():
    membership_table = Base.metadata.tables["server_memberships"]
    invite_table = Base.metadata.tables["server_invites"]

    assert {"server_id", "account_id", "member_id", "role", "status"} <= set(membership_table.c.keys())
    assert {"server_id", "token_hash", "role", "channel_id", "expires_at", "accepted_at"} <= set(invite_table.c.keys())


@pytest.mark.asyncio
async def test_startup_seed_does_not_backfill_clean_reset_identity(monkeypatch):
    """Schema (server_memberships/server_invites tables) is owned by Alembic —
    see the ``0001_baseline`` migration for the CREATE TABLE statements.
    seed.create_tables() now emits runtime-only data seeding. Identity rows are
    created transactionally by signup after the clean-reset migration.
    """
    fake_engine = _SeedEngine()
    monkeypatch.setattr(seed, "engine", fake_engine)

    await seed.create_tables()

    statements = "\n".join(fake_engine.conn.statements)
    assert "INSERT INTO server_memberships" not in statements
    assert "accounts.server_id" not in statements
    assert "accounts.member_id" not in statements
    # Schema DDL must NOT be emitted by create_tables() anymore — it lives in
    # the Alembic baseline migration.
    assert "CREATE TABLE IF NOT EXISTS server_memberships" not in statements
    assert "CREATE TABLE IF NOT EXISTS server_invites" not in statements


@pytest.mark.asyncio
async def test_bootstrap_account_creates_owner_membership_for_first_server_account():
    server = _server("Release")
    account, member = _home_identity(server)
    db = _FakeSession(_ExecuteResult(None))

    membership = await server_membership.ensure_account_membership(
        db,
        account=account,
        server=server,
        member=member,
        default_role="owner",
    )

    assert membership.server_id == server.id
    assert membership.account_id == account.id
    assert membership.member_id == member.id
    assert membership.role == "owner"
    assert membership.status == "active"
    assert membership in db.added


@pytest.mark.asyncio
async def test_active_server_requires_account_membership():
    account = SimpleNamespace(id=uuid.uuid4(), home_server_id=uuid.uuid4())
    requested_server_id = uuid.uuid4()
    db = _FakeSession(_ExecuteResult(None))

    with pytest.raises(HTTPException) as error:
        await server_membership.resolve_active_server_context(
            db,
            account=account,
            requested_server_id=requested_server_id,
        )

    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_active_server_context_can_select_joined_server():
    home_server = _server("Personal")
    account, member = _home_identity(home_server)
    server = _server("Shared")
    membership = _membership(server, account, member, role="member")
    db = _FakeSession(_ExecuteResult(row=(membership, server, member)))

    context = await server_membership.resolve_active_server_context(
        db,
        account=account,
        requested_server_id=server.id,
    )

    assert context.server.id == server.id
    assert context.member.id == member.id
    assert context.membership.role == "member"


@pytest.mark.asyncio
async def test_active_server_context_uses_default_server_when_account_has_multiple_memberships():
    default_server = _server("Personal")
    shared_server = _server("Shared")
    account, default_member = _home_identity(default_server)
    shared_member = default_member
    default_membership = _membership(default_server, account, default_member, role="owner")
    shared_membership = _membership(shared_server, account, shared_member, role="member")
    default_row = (default_membership, default_server, default_member)
    shared_row = (shared_membership, shared_server, shared_member)
    db = _ServerFilterAwareSession(
        default_row,
        [
            default_row,
            shared_row,
        ],
    )

    context = await server_membership.resolve_active_server_context(db, account=account)

    assert context.server.id == default_server.id
    assert context.member.id == default_member.id
    assert context.membership.role == "owner"


@pytest.mark.asyncio
async def test_list_account_memberships_returns_switcher_contract():
    default_server = _server("lee")
    shared_server = _server("Raft 中文社区")
    account, default_member = _home_identity(default_server, handle="lee")
    shared_member = default_member
    rows = [
        (_membership(default_server, account, default_member, role="owner"), default_server, default_member),
        (_membership(shared_server, account, shared_member, role="member"), shared_server, shared_member),
    ]
    db = _FakeSession(_ExecuteResult(rows=rows))

    memberships = await server_membership.list_account_memberships(db, account=account)

    assert memberships == [
        {
            "server": {"id": str(default_server.id), "name": "lee"},
            "member": {"id": str(default_member.id), "name": "lee", "handle": "lee", "kind": "human"},
            "role": "owner",
            "status": "active",
            "isDefault": True,
        },
        {
            "server": {"id": str(shared_server.id), "name": "Raft 中文社区"},
            "member": {"id": str(shared_member.id), "name": "lee", "handle": "lee", "kind": "human"},
            "role": "member",
            "status": "active",
            "isDefault": False,
        },
    ]


@pytest.mark.asyncio
async def test_serialize_account_includes_all_active_server_memberships(monkeypatch):
    server = _server("lee")
    account, member = _home_identity(server, handle="lee")
    membership_payload = [
        {
            "server": {"id": str(server.id), "name": "lee"},
            "member": {"id": str(member.id), "name": "lee", "handle": "lee", "kind": "human"},
            "role": "owner",
            "status": "active",
            "isDefault": True,
        }
    ]

    async def fake_serialize_member(_db, item):
        return {"id": str(item.id), "name": item.handle, "handle": item.handle, "kind": item.kind, "status": item.status or "online"}

    async def fake_list_memberships(_db, *, account):
        return membership_payload

    monkeypatch.setattr(public_api, "serialize_member", fake_serialize_member)
    monkeypatch.setattr(public_api, "list_account_memberships", fake_list_memberships)

    payload = await public_api._serialize_account(_FakeSession(), account, server, member)

    assert payload["server"]["id"] == str(server.id)
    assert payload["member"]["id"] == str(member.id)
    assert payload["memberships"] == membership_payload


@pytest.mark.asyncio
async def test_additional_owned_server_service_is_removed():
    assert not hasattr(server_membership, "create_server_for_account")


@pytest.mark.asyncio
async def test_create_server_endpoint_rejects_additional_owned_server():
    db = _FakeSession()
    with pytest.raises(HTTPException) as error:
        await public_api.create_server(
            _JsonRequest({"name": "Release Lab"}),
            _auth=None,
            db=db,
        )

    assert error.value.status_code == 410
    assert db.added == []


@pytest.mark.asyncio
async def test_create_server_invite_returns_join_url_and_stores_only_token_hash():
    server = _server("青禾的服务器")
    _account, creator = _home_identity(server, handle="青禾", display_name="青禾")
    db = _FakeSession()

    created = await server_invites.create_server_invite(
        db,
        server=server,
        creator=creator,
        role="member",
        invited_name="竹影",
        expires_in_days=14,
        public_base_url="http://localhost:3000",
    )

    assert created.token.startswith("sk_invite_")
    assert created.join_url == f"http://localhost:3000/join/{created.token}"
    assert created.invite in db.added
    assert created.invite.server_id == server.id
    assert created.invite.role == "member"
    assert created.invite.invited_name == "竹影"
    assert created.invite.token_hash == server_invites.hash_invite_token(created.token)
    assert created.token not in created.invite.token_hash


@pytest.mark.asyncio
async def test_create_server_invite_endpoint_requires_owner_or_admin(monkeypatch):
    server = _server("青禾的服务器")
    account, member = _home_identity(server, handle="member", display_name=None)
    membership = _membership(server, account, member, role="member")
    db = _FakeSession()

    async def fake_context(_db, _request):
        return SimpleNamespace(account=account, server=server, member=member, membership=membership)

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_context)

    with pytest.raises(HTTPException) as error:
        await public_api.create_server_invite(
            _JsonRequest({"role": "member"}),
            _auth=None,
            db=db,
        )

    assert error.value.status_code == 403
    assert db.added == []


@pytest.mark.asyncio
async def test_create_server_invite_endpoint_returns_admin_invite_for_owner(monkeypatch):
    server = _server("青禾的服务器")
    account, member = _home_identity(server, handle="owner", display_name="青禾")
    membership = _membership(server, account, member, role="owner")
    db = _FakeSession()

    async def fake_context(_db, _request):
        return SimpleNamespace(account=account, server=server, member=member, membership=membership)

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_context)

    payload = await public_api.create_server_invite(
        _JsonRequest(
            {"role": "admin", "invitedName": "竹影", "expiresInDays": 3},
            headers={"origin": "https://app.smallkhoj.test"},
        ),
        _auth=None,
        db=db,
    )

    invite = payload["invite"]
    assert db.committed is True
    assert invite["serverId"] == str(server.id)
    assert invite["serverName"] == server.name
    assert invite["role"] == "admin"
    assert invite["invitedName"] == "竹影"
    assert invite["joinUrl"].startswith("https://app.smallkhoj.test/join/sk_invite_")
    assert "token" not in invite


@pytest.mark.asyncio
async def test_accept_server_invite_reuses_home_human_identity_and_marks_invite():
    home_server = _server("竹影")
    account, member = _home_identity(home_server, handle="zhuying", display_name="竹影")
    server = _server("青禾的服务器")
    token = "sk_invite_test_token"
    invite = _invite(server, token_hash=server_invites.hash_invite_token(token))
    db = _FakeSession(
        _ExecuteResult(invite),
        _ExecuteResult(server),
        _ExecuteResult(row=None),
        _ExecuteResult(member),
        _ExecuteResult(None),
    )

    accepted = await server_invites.accept_server_invite(db, token=token, account=account)

    assert accepted.server is server
    assert accepted.member is member
    assert accepted.member.origin_server_id == home_server.id
    assert accepted.member.kind == "human"
    assert accepted.member.handle == "zhuying"
    assert accepted.membership.server_id == server.id
    assert accepted.membership.account_id == account.id
    assert accepted.membership.member_id == accepted.member.id
    assert accepted.membership.role == "member"
    assert invite.accepted_account_id == account.id
    assert invite.accepted_at is not None
    assert accepted.member not in db.added
    assert accepted.membership in db.added


@pytest.mark.asyncio
async def test_accept_server_invite_rejects_consumed_by_another_account():
    server = _server("青禾的服务器")
    account, _member = _home_identity(_server("竹影"), handle="zhuying", display_name="竹影")
    token = "sk_invite_consumed"
    invite = _invite(
        server,
        token_hash=server_invites.hash_invite_token(token),
        accepted_at=datetime.now(timezone.utc),
        accepted_account_id=uuid.uuid4(),
    )
    db = _FakeSession(_ExecuteResult(invite))

    with pytest.raises(HTTPException) as error:
        await server_invites.accept_server_invite(db, token=token, account=account)

    assert error.value.status_code == 410


@pytest.mark.asyncio
async def test_accept_server_invite_rejects_malformed_token_without_database_lookup():
    account, _member = _home_identity(_server("竹影"), handle="zhuying", display_name="竹影")
    db = _FakeSession()

    with pytest.raises(HTTPException) as error:
        await server_invites.accept_server_invite(db, token="not-an-invite-token", account=account)

    assert error.value.status_code == 404
    assert db._results == []


@pytest.mark.asyncio
async def test_accept_server_invite_rejects_expired_invite():
    server = _server("青禾的服务器")
    account, _member = _home_identity(_server("竹影"), handle="zhuying", display_name="竹影")
    token = "sk_invite_expired"
    invite = _invite(
        server,
        token_hash=server_invites.hash_invite_token(token),
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db = _FakeSession(_ExecuteResult(invite))

    with pytest.raises(HTTPException) as error:
        await server_invites.accept_server_invite(db, token=token, account=account)

    assert error.value.status_code == 410
    assert "expired" in error.value.detail


@pytest.mark.asyncio
async def test_accept_server_invite_rejects_revoked_invite():
    server = _server("青禾的服务器")
    account, _member = _home_identity(_server("竹影"), handle="zhuying", display_name="竹影")
    token = "sk_invite_revoked"
    invite = _invite(
        server,
        token_hash=server_invites.hash_invite_token(token),
        revoked_at=datetime.now(timezone.utc),
    )
    db = _FakeSession(_ExecuteResult(invite))

    with pytest.raises(HTTPException) as error:
        await server_invites.accept_server_invite(db, token=token, account=account)

    assert error.value.status_code == 410
    assert "revoked" in error.value.detail


@pytest.mark.asyncio
async def test_accept_server_invite_is_idempotent_for_same_account_membership():
    home_server = _server("竹影")
    account, member = _home_identity(home_server, handle="zhuying", display_name="竹影")
    server = _server("青禾的服务器")
    membership = _membership(server, account, member, role="member")
    token = "sk_invite_same_account"
    invite = _invite(
        server,
        token_hash=server_invites.hash_invite_token(token),
        accepted_at=datetime.now(timezone.utc),
        accepted_account_id=account.id,
    )
    db = _FakeSession(
        _ExecuteResult(invite),
        _ExecuteResult(server),
        _ExecuteResult(row=(membership, member)),
    )

    accepted = await server_invites.accept_server_invite(db, token=token, account=account)

    assert accepted.member is member
    assert accepted.membership is membership
    assert db.added == []


@pytest.mark.asyncio
async def test_better_auth_bootstrap_creates_personal_server_and_session_token():
    db = _FakeSession(_ExecuteResult(None), _ExecuteResult(None))

    account, server, member, token = await public_api._bootstrap_better_auth_account(
        db,
        external_user_id="better-auth-user-123",
        name="Lee",
    )

    assert account.auth_subject == "better-auth:better-auth-user-123"
    assert account.display_name is None
    assert server.name == "Lee"
    assert server.server_handle.startswith("s")
    assert member.origin_server_id == server.id
    assert member.handle == "Lee"
    assert account.home_server_id == server.id
    assert member.account_id == account.id
    assert token.startswith("sk_session_")
    assert account.session_token_hash == public_api._hash_token(token)
    assert any(isinstance(item, Server) and item.name == "Lee" for item in db.added)
    assert any(isinstance(item, ServerMembership) and item.role == "owner" for item in db.added)


@pytest.mark.asyncio
async def test_better_auth_bootstrap_reuses_existing_personal_server_without_duplicates():
    server = _server("Lee")
    account, member = _home_identity(server, handle="Lee")
    account.auth_subject = "better-auth:better-auth-user-123"
    membership = _membership(server, account, member, role="owner")
    db = _FakeSession(
        _ExecuteResult(None),
        _ExecuteResult(account),
        _ExecuteResult(server),
        _ExecuteResult(member),
        _ExecuteResult(membership),
    )

    resolved_account, resolved_server, resolved_member, token = await public_api._bootstrap_better_auth_account(
        db,
        external_user_id="better-auth-user-123",
        name="Lee",
    )

    assert resolved_account is account
    assert resolved_server is server
    assert resolved_member is member
    assert token.startswith("sk_session_")
    assert db.added == []
    assert account.session_token_hash == public_api._hash_token(token)


@pytest.mark.asyncio
async def test_better_auth_bridge_requires_configured_secret(monkeypatch):
    monkeypatch.setattr(public_api, "settings", SimpleNamespace(auth_bridge_secret="sk_bridge_test", debug=False), raising=False)

    with pytest.raises(HTTPException) as error:
        await public_api.bridge_better_auth_session(
            _JsonRequest(
                {
                    "userId": "better-auth-user-123",
                    "email": "lee@example.com",
                    "name": "Lee",
                },
                headers={"X-Auth-Bridge-Secret": "wrong-secret"},
            ),
            _auth=None,
            db=_FakeSession(),
        )

    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_better_auth_bridge_returns_smallkhoj_session_payload(monkeypatch):
    monkeypatch.setattr(public_api, "settings", SimpleNamespace(auth_bridge_secret="sk_bridge_test", debug=False), raising=False)
    server = _server("Lee")
    account, member = _home_identity(server, handle="Lee")
    account.auth_subject = "better-auth:better-auth-user-123"
    calls = {}

    async def fake_bootstrap(_db, *, external_user_id, name):
        calls["identity"] = (external_user_id, name)
        return account, server, member, "sk_session_bridge"

    async def fake_serialize(_db, account, server, member):
        return {
            "account": {"id": str(account.id), "name": member.handle, "displayName": account.display_name},
            "server": {"id": str(server.id), "name": server.name, "serverHandle": server.server_handle},
            "member": {"id": str(member.id), "name": member.handle, "handle": member.handle, "kind": "human", "status": "online"},
            "memberships": [],
        }

    monkeypatch.setattr(public_api, "_bootstrap_better_auth_account", fake_bootstrap)
    monkeypatch.setattr(public_api, "_serialize_account", fake_serialize)
    db = _FakeSession()

    payload = await public_api.bridge_better_auth_session(
        _JsonRequest(
            {
                "userId": "better-auth-user-123",
                "email": "lee@example.com",
                "name": "Lee",
            },
            headers={"X-Auth-Bridge-Secret": "sk_bridge_test"},
        ),
        _auth=None,
        db=db,
    )

    assert calls["identity"] == ("better-auth-user-123", "Lee")
    assert db.committed is True
    assert payload["sessionToken"] == "sk_session_bridge"
    assert payload["account"]["name"] == "Lee"


def test_private_channel_requires_channel_membership():
    private_channel = Channel(id=uuid.uuid4(), server_id=uuid.uuid4(), name="secret", kind="private")
    member_id = uuid.uuid4()

    with pytest.raises(HTTPException) as error:
        server_membership.ensure_channel_access(private_channel, member_id, is_channel_member=False)

    assert error.value.status_code == 403


def test_computer_and_agent_creation_require_same_selected_server():
    server_id = uuid.uuid4()
    other_server_id = uuid.uuid4()
    computer = Computer(id=uuid.uuid4(), server_id=other_server_id, name="other", os="darwin", daemon_version="0.2.0")

    with pytest.raises(HTTPException) as error:
        server_membership.ensure_server_scoped_computer(computer, server_id=server_id)

    assert error.value.status_code == 404


def test_public_human_routes_resolve_active_server_instead_of_default_server():
    migrated = [
        public_api.list_api_keys,
        public_api.create_api_key,
        public_api.revoke_api_key,
        public_api.list_channels,
        public_api.get_chat_read_cursors,
        public_api.update_chat_read_cursor,
        public_api.stream_public_events,
        public_api.get_channel_messages,
        public_api.get_public_thread,
        public_api.create_channel_message,
        public_api.add_public_message_reaction,
        public_api.remove_public_message_reaction,
        public_api.list_saved_items,
        public_api.create_saved_item,
        public_api.delete_saved_item,
        public_api.delete_saved_item_by_target,
        public_api.list_task_run_templates,
        public_api.create_task_run_template,
        public_api.update_task_run_template,
        public_api.disable_task_run_template,
        public_api.create_channel,
        public_api.create_agent,
        public_api.list_tasks,
        public_api.create_task_assignment,
        public_api.get_task,
        public_api.list_scoped_memory,
        public_api.read_scoped_memory_path,
        public_api.search_scoped_memory,
        public_api.write_scoped_memory_path,
        public_api.propose_scoped_memory,
        public_api.list_scoped_memory_proposals,
        public_api.accept_memory_proposal,
        public_api.reject_memory_proposal,
        public_api.delete_scoped_memory_path,
        public_api.list_channel_memory_alias,
        public_api.list_task_memory_alias,
        public_api.request_task_memory_result,
        public_api.create_task,
        public_api.update_task,
        public_api.list_computers,
        public_api.delete_computer,
        public_api.list_activity,
        public_api.global_search,
        public_api.list_files,
        public_api.upload_file,
        public_api.preview_attachment,
        public_api.download_public_attachment,
        public_api.list_reminders,
        public_api.list_members,
        public_api.update_member,
        public_api.delete_member,
        public_api.create_public_reminder,
        public_api.update_public_reminder,
        public_api.generate_computer_connect_command,
        public_api.generate_computer_reconnect_command,
        public_api.control_workspace_lifecycle,
        public_api.delete_workspace,
        public_api.generate_computer_credential,
        public_api.delete_channel,
        public_api.add_channel_member,
        public_api.remove_channel_member,
        public_api.list_channel_members,
        public_api.list_dms,
        public_api.create_or_get_dm,
    ]

    for handler in migrated:
        source = inspect.getsource(handler)
        assert "_resolve_active_server_context" in source, handler.__name__
        assert "await _get_server(db)" not in source, handler.__name__
        assert "await _ensure_server(db)" not in source, handler.__name__
