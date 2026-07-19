from types import SimpleNamespace
from pathlib import Path
import uuid

import pytest

from routers import public_api
import models.seed as seed
from models import Base, Channel, ChannelMember
from models.slock import ChatThreadReadCursor
from services.chat_read_cursors import (
    read_state_from_message_seq,
    mark_channel_read,
    serialize_channel_read_cursor,
    serialize_thread_read_cursor,
    upsert_thread_read_cursor,
)


class _ExecuteResult:
    def __init__(self, value=None):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def all(self):
        if self._value is None:
            return []
        return self._value if isinstance(self._value, list) else [self._value]

    def scalars(self):
        return self


class _FakeSession:
    def __init__(self, *results):
        self._results = list(results)
        self.added = []
        self.flushed = False
        self.committed = False

    async def execute(self, _statement):
        if self._results:
            return self._results.pop(0)
        return _ExecuteResult()

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        self.flushed = True

    async def commit(self):
        self.committed = True


class _JsonRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


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


def test_chat_thread_read_cursor_table_contract():
    table = Base.metadata.tables["chat_thread_read_cursors"]

    assert {
        "server_id",
        "member_id",
        "root_message_id",
        "last_read_seq",
        "last_seen_message_id",
        "created_at",
        "updated_at",
    } <= set(table.c.keys())
    assert any(index.name == "uq_chat_thread_read_cursor_scope" and index.unique for index in table.indexes)
    assert any(index.name == "idx_chat_thread_read_cursors_member" for index in table.indexes)
    assert "last_read_seq" in Base.metadata.tables["channel_members"].c


@pytest.mark.asyncio
async def test_startup_seed_does_not_emit_chat_thread_read_cursor_ddl(monkeypatch):
    """Schema for chat_thread_read_cursors (table + uq_chat_thread_read_cursor_scope
    + idx_chat_thread_read_cursors_member) is owned by Alembic — see the
    ``0001_baseline`` migration. seed.create_tables() must not emit table/index
    DDL anymore.
    """
    fake_engine = _SeedEngine()
    monkeypatch.setattr(seed, "engine", fake_engine)

    await seed.create_tables()

    statements = "\n".join(fake_engine.conn.statements)
    assert "CREATE TABLE IF NOT EXISTS chat_thread_read_cursors" not in statements
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_thread_read_cursor_scope" not in statements
    assert "CREATE INDEX IF NOT EXISTS idx_chat_thread_read_cursors_member" not in statements


@pytest.mark.asyncio
async def test_mark_channel_read_updates_channel_member_monotonically():
    channel_id = uuid.uuid4()
    member_id = uuid.uuid4()
    membership = ChannelMember(channel_id=channel_id, member_id=member_id, last_read_seq=12)
    db = _FakeSession(_ExecuteResult(membership))

    updated = await mark_channel_read(db, channel_id=channel_id, member_id=member_id, last_read_seq=9)
    assert updated.last_read_seq == 12

    updated = await mark_channel_read(db, channel_id=channel_id, member_id=member_id, last_read_seq=18)
    assert updated.last_read_seq == 18
    assert db.flushed is True


@pytest.mark.asyncio
async def test_upsert_thread_read_cursor_creates_and_updates_monotonically():
    server_id = uuid.uuid4()
    member_id = uuid.uuid4()
    root_message_id = uuid.uuid4()
    first_seen_id = uuid.uuid4()
    second_seen_id = uuid.uuid4()
    db = _FakeSession(_ExecuteResult())

    created = await upsert_thread_read_cursor(
        db,
        server_id=server_id,
        member_id=member_id,
        root_message_id=root_message_id,
        last_read_seq=5,
        last_seen_message_id=first_seen_id,
    )

    assert isinstance(created, ChatThreadReadCursor)
    assert db.added == [created]
    assert created.server_id == server_id
    assert created.member_id == member_id
    assert created.root_message_id == root_message_id
    assert created.last_read_seq == 5
    assert created.last_seen_message_id == first_seen_id

    db_existing = _FakeSession(_ExecuteResult(created), _ExecuteResult(created))
    older = await upsert_thread_read_cursor(
        db_existing,
        server_id=server_id,
        member_id=member_id,
        root_message_id=root_message_id,
        last_read_seq=3,
        last_seen_message_id=second_seen_id,
    )
    assert older.last_read_seq == 5
    assert older.last_seen_message_id == first_seen_id

    newer = await upsert_thread_read_cursor(
        db_existing,
        server_id=server_id,
        member_id=member_id,
        root_message_id=root_message_id,
        last_read_seq=9,
        last_seen_message_id=second_seen_id,
    )
    assert newer.last_read_seq == 9
    assert newer.last_seen_message_id == second_seen_id


def test_chat_read_cursor_serializers_use_stable_frontend_contract():
    channel_id = uuid.uuid4()
    member_id = uuid.uuid4()
    root_id = uuid.uuid4()
    message_id = uuid.uuid4()

    channel_cursor = serialize_channel_read_cursor(
        ChannelMember(channel_id=channel_id, member_id=member_id, last_read_seq=14),
        scope_kind="dm",
    )
    thread_cursor = serialize_thread_read_cursor(
        SimpleNamespace(
            member_id=member_id,
            root_message_id=root_id,
            last_read_seq=21,
            last_seen_message_id=message_id,
        )
    )

    assert channel_cursor == {
        "scope": {"kind": "dm", "channelId": str(channel_id)},
        "memberId": str(member_id),
        "lastReadSeq": 14,
    }
    assert thread_cursor == {
        "scope": {"kind": "thread", "rootMessageId": str(root_id)},
        "memberId": str(member_id),
        "lastReadSeq": 21,
        "lastSeenMessageId": str(message_id),
    }


def test_read_state_from_message_seq_derives_sidebar_unread_fields():
    assert read_state_from_message_seq(latest_seq=12, last_read_seq=9) == {
        "latestSeq": 12,
        "unreadCount": 3,
        "hasUnread": True,
    }
    assert read_state_from_message_seq(latest_seq=7, last_read_seq=9) == {
        "latestSeq": 7,
        "unreadCount": 0,
        "hasUnread": False,
    }


def test_public_api_exposes_backend_owned_chat_read_cursor_routes():
    source = Path("routers/public_api.py").read_text()

    assert '@router.get("/chat/read-cursors")' in source
    assert '@router.post("/chat/read-cursors")' in source
    assert "mark_channel_read" in source
    assert "upsert_thread_read_cursor" in source
    assert "await db.commit()" in source


def test_public_api_uses_named_last_read_seq_parser_for_read_cursor_route():
    source = Path("routers/public_api.py").read_text()

    assert "def _parse_read_cursor_last_read_seq" in source
    assert "last_read_seq = _parse_read_cursor_last_read_seq(body)" in source
    assert 'int(body.get("lastReadSeq") or body.get("last_read_seq") or 0)' not in source


def test_read_cursor_last_read_seq_parser_accepts_compatible_values():
    assert public_api._parse_read_cursor_last_read_seq({}) == 0
    assert public_api._parse_read_cursor_last_read_seq({"lastReadSeq": 0}) == 0
    assert public_api._parse_read_cursor_last_read_seq({"lastReadSeq": 12}) == 12
    assert public_api._parse_read_cursor_last_read_seq({"lastReadSeq": " 12 "}) == 12
    assert public_api._parse_read_cursor_last_read_seq({"last_read_seq": "8"}) == 8
    assert public_api._parse_read_cursor_last_read_seq({"lastReadSeq": "3", "last_read_seq": "8"}) == 3


@pytest.mark.parametrize(
    "value",
    [None, "", "   ", -1, "-1", 1.5, "1.5", True, False, {}, []],
)
def test_read_cursor_last_read_seq_parser_rejects_invalid_values(value):
    with pytest.raises(public_api.HTTPException) as exc_info:
        public_api._parse_read_cursor_last_read_seq({"lastReadSeq": value})

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid lastReadSeq"


def test_public_api_rejects_mismatched_channel_and_dm_cursor_scopes():
    source = Path("routers/public_api.py").read_text()

    assert 'if kind == "dm" and channel.kind != "dm":' in source
    assert 'HTTPException(400, "DM cursor scope must reference a DM channel")' in source
    assert 'if kind == "channel" and channel.kind == "dm":' in source
    assert 'HTTPException(400, "Channel cursor scope must not reference a DM channel")' in source


@pytest.mark.asyncio
async def test_update_chat_read_cursor_route_writes_channel_cursor_with_active_context(monkeypatch):
    server_id = uuid.uuid4()
    viewer_member_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    channel = Channel(id=channel_id, server_id=server_id, name="general", kind="public")
    membership = ChannelMember(channel_id=channel_id, member_id=viewer_member_id, last_read_seq=3)
    db = _FakeSession(_ExecuteResult(membership))

    async def fake_context(_db, _request):
        return SimpleNamespace(server=SimpleNamespace(id=server_id), member=SimpleNamespace(id=viewer_member_id))

    async def fake_resolve_channel(_db, server, scope):
        assert server.id == server_id
        assert scope["channelId"] == str(channel_id)
        return channel

    async def fake_is_channel_member(_db, *, channel_id: uuid.UUID, member_id: uuid.UUID):
        assert channel_id == channel.id
        assert member_id == viewer_member_id
        return True

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_context)
    monkeypatch.setattr(public_api, "_resolve_read_cursor_channel", fake_resolve_channel)
    monkeypatch.setattr(public_api, "is_channel_member", fake_is_channel_member)

    payload = await public_api.update_chat_read_cursor(
        _JsonRequest({"scope": {"kind": "channel", "channelId": str(channel_id)}, "lastReadSeq": 12}),
        _auth=None,
        db=db,
    )

    assert db.committed is True
    assert membership.last_read_seq == 12
    assert payload["cursor"] == {
        "scope": {"kind": "channel", "channelId": str(channel_id)},
        "memberId": str(viewer_member_id),
        "lastReadSeq": 12,
    }


@pytest.mark.asyncio
async def test_update_chat_read_cursor_route_writes_dm_cursor_with_dm_scope(monkeypatch):
    server_id = uuid.uuid4()
    viewer_member_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    channel = Channel(id=channel_id, server_id=server_id, name="dm-a-b", kind="dm")
    membership = ChannelMember(channel_id=channel_id, member_id=viewer_member_id, last_read_seq=0)
    db = _FakeSession(_ExecuteResult(membership))

    async def fake_context(_db, _request):
        return SimpleNamespace(server=SimpleNamespace(id=server_id), member=SimpleNamespace(id=viewer_member_id))

    async def fake_resolve_channel(_db, _server, _scope):
        return channel

    async def fake_is_channel_member(_db, *, channel_id: uuid.UUID, member_id: uuid.UUID):
        return channel_id == channel.id and member_id == viewer_member_id

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_context)
    monkeypatch.setattr(public_api, "_resolve_read_cursor_channel", fake_resolve_channel)
    monkeypatch.setattr(public_api, "is_channel_member", fake_is_channel_member)

    payload = await public_api.update_chat_read_cursor(
        _JsonRequest({"scope": {"kind": "dm", "channelId": str(channel_id)}, "lastReadSeq": 7}),
        _auth=None,
        db=db,
    )

    assert db.committed is True
    assert payload["cursor"]["scope"] == {"kind": "dm", "channelId": str(channel_id)}
    assert payload["cursor"]["lastReadSeq"] == 7


@pytest.mark.asyncio
async def test_update_chat_read_cursor_route_writes_thread_cursor_with_active_context(monkeypatch):
    server_id = uuid.uuid4()
    viewer_member_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    root_message_id = uuid.uuid4()
    seen_message_id = uuid.uuid4()
    channel = Channel(id=channel_id, server_id=server_id, name="general", kind="public")
    root = SimpleNamespace(id=root_message_id, channel_id=channel_id)
    seen_message = SimpleNamespace(id=seen_message_id, parent_id=root_message_id)
    db = _FakeSession(_ExecuteResult(channel), _ExecuteResult(seen_message), _ExecuteResult())

    async def fake_context(_db, _request):
        return SimpleNamespace(server=SimpleNamespace(id=server_id), member=SimpleNamespace(id=viewer_member_id))

    async def fake_resolve_thread_root(_db, resolved_server_id, thread_ref):
        assert resolved_server_id == server_id
        assert thread_ref == str(root_message_id)
        return root

    async def fake_is_channel_member(_db, *, channel_id: uuid.UUID, member_id: uuid.UUID):
        assert channel_id == channel.id
        assert member_id == viewer_member_id
        return True

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_context)
    monkeypatch.setattr(public_api, "resolve_thread_root", fake_resolve_thread_root)
    monkeypatch.setattr(public_api, "is_channel_member", fake_is_channel_member)

    payload = await public_api.update_chat_read_cursor(
        _JsonRequest(
            {
                "scope": {"kind": "thread", "rootMessageId": str(root_message_id)},
                "lastReadSeq": 22,
                "lastSeenMessageId": str(seen_message_id),
            }
        ),
        _auth=None,
        db=db,
    )

    assert db.committed is True
    assert len(db.added) == 1
    assert payload["cursor"] == {
        "scope": {"kind": "thread", "rootMessageId": str(root_message_id)},
        "memberId": str(viewer_member_id),
        "lastReadSeq": 22,
        "lastSeenMessageId": str(seen_message_id),
    }


@pytest.mark.asyncio
async def test_get_chat_read_cursors_route_lists_channel_dm_and_thread_cursors(monkeypatch):
    server_id = uuid.uuid4()
    viewer_member_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    dm_id = uuid.uuid4()
    root_id = uuid.uuid4()
    seen_id = uuid.uuid4()
    channel = Channel(id=channel_id, server_id=server_id, name="general", kind="public")
    dm = Channel(id=dm_id, server_id=server_id, name="dm-a-b", kind="dm")
    channel_membership = ChannelMember(channel_id=channel_id, member_id=viewer_member_id, last_read_seq=5)
    dm_membership = ChannelMember(channel_id=dm_id, member_id=viewer_member_id, last_read_seq=9)
    thread_cursor = ChatThreadReadCursor(
        server_id=server_id,
        member_id=viewer_member_id,
        root_message_id=root_id,
        last_read_seq=11,
        last_seen_message_id=seen_id,
    )
    db = _FakeSession(
        _ExecuteResult([(channel_membership, channel), (dm_membership, dm)]),
        _ExecuteResult([thread_cursor]),
    )

    async def fake_context(_db, _request):
        return SimpleNamespace(server=SimpleNamespace(id=server_id), member=SimpleNamespace(id=viewer_member_id))

    monkeypatch.setattr(public_api, "_resolve_active_server_context", fake_context)

    payload = await public_api.get_chat_read_cursors(_JsonRequest({}), _auth=None, db=db)

    assert payload["serverId"] == str(server_id)
    assert payload["memberId"] == str(viewer_member_id)
    assert payload["cursors"] == [
        {
            "scope": {"kind": "channel", "channelId": str(channel_id)},
            "memberId": str(viewer_member_id),
            "lastReadSeq": 5,
        },
        {
            "scope": {"kind": "dm", "channelId": str(dm_id)},
            "memberId": str(viewer_member_id),
            "lastReadSeq": 9,
        },
        {
            "scope": {"kind": "thread", "rootMessageId": str(root_id)},
            "memberId": str(viewer_member_id),
            "lastReadSeq": 11,
            "lastSeenMessageId": str(seen_id),
        },
    ]


def test_public_api_projects_latest_seq_and_unread_state_into_channel_payloads():
    source = Path("routers/public_api.py").read_text()
    service_source = Path("services/chat_read_cursors.py").read_text()

    assert "read_state_from_message_seq" in source
    assert "def _channel_latest_seq_map" in source
    assert "def _channel_unread_count_map" in source
    assert "_channel_read_state_payload" in source
    assert "visible_channel_ids" in source
    assert '"latestSeq"' in service_source
    assert '"unreadCount"' in service_source
    assert '"hasUnread"' in service_source


def test_public_message_payload_projects_thread_unread_state_from_backend_cursors():
    source = Path("routers/public_api.py").read_text()
    thread_source = Path("services/thread_summary.py").read_text()

    assert "latestReplySeq" in thread_source
    assert "thread_read_seq_by_root" in source
    assert "threadLatestSeq" in source
    assert "threadUnreadCount" in source
    assert "hasThreadUnread" in source
    assert "_thread_read_seq_map" in source
    assert "_thread_unread_count_map" in source
