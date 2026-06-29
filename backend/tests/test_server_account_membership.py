import inspect
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import models.seed as seed
import routers.public_api as public_api
from models import Account, Base, Channel, ChannelMember, Computer, Member, Server
from services import server_membership


class _ExecuteResult:
    def __init__(self, value=None, scalar_rows=None):
        self._value = value
        self._scalar_rows = scalar_rows or []

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return self._scalar_rows


class _FakeSession:
    def __init__(self, *results):
        self._results = list(results)
        self.added = []
        self.flushed = 0

    async def execute(self, _statement):
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


def test_server_membership_tables_are_declared():
    membership_table = Base.metadata.tables["server_memberships"]
    invite_table = Base.metadata.tables["server_invites"]

    assert {"server_id", "account_id", "member_id", "role", "status"} <= set(membership_table.c.keys())
    assert {"server_id", "token_hash", "role", "channel_id", "expires_at", "accepted_at"} <= set(invite_table.c.keys())


@pytest.mark.asyncio
async def test_startup_seed_emits_membership_invite_tables_and_backfill(monkeypatch):
    fake_engine = _SeedEngine()
    monkeypatch.setattr(seed, "engine", fake_engine)

    await seed.create_tables()

    statements = "\n".join(fake_engine.conn.statements)
    assert "CREATE TABLE IF NOT EXISTS server_memberships" in statements
    assert "CREATE TABLE IF NOT EXISTS server_invites" in statements
    assert "INSERT INTO server_memberships" in statements
    assert "accounts.server_id" in statements
    assert "accounts.member_id" in statements


@pytest.mark.asyncio
async def test_bootstrap_account_creates_owner_membership_for_first_server_account():
    server = Server(id=uuid.uuid4(), name="Release")
    member = Member(id=uuid.uuid4(), server_id=server.id, kind="human", display_name="lee")
    account = Account(id=uuid.uuid4(), name="lee", display_name="Lee", server_id=server.id, member_id=member.id)
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
    account = SimpleNamespace(id=uuid.uuid4(), server_id=uuid.uuid4(), member_id=uuid.uuid4())
    requested_server_id = uuid.uuid4()
    db = _FakeSession(_ExecuteResult(None))

    with pytest.raises(HTTPException) as error:
        await server_membership.resolve_active_server_context(
            db,
            account=account,
            requested_server_id=requested_server_id,
        )

    assert error.value.status_code == 403


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
        public_api.list_channels,
        public_api.get_channel_messages,
        public_api.create_channel_message,
        public_api.create_channel,
        public_api.create_agent,
    ]

    for handler in migrated:
        source = inspect.getsource(handler)
        assert "_resolve_active_server_context" in source, handler.__name__
        assert "await _get_server(db)" not in source, handler.__name__
