import uuid
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy.exc import MultipleResultsFound

from main import app
from models import Account, Channel, ChannelMember, ChatThreadReadCursor, Member, Message, Server, ServerMembership
from routers import public_api


class _ExecuteResult:
    def __init__(self, value=None, rows=None, scalar_rows=None, row=None):
        self._value = value
        self._rows = rows or []
        self._scalar_rows = scalar_rows or []
        self._row = row

    def scalar_one_or_none(self):
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


class _ReadCursorHttpSession:
    def __init__(
        self,
        *,
        account,
        server,
        member,
        membership,
        channel,
        channel_member,
        root_message=None,
        active_membership=True,
        latest_seq=0,
        unread_message_seqs=None,
        last_seen_message=None,
    ):
        self.account = account
        self.server = server
        self.member = member
        self.membership = membership
        self.channel = channel
        self.channel_member = channel_member
        self.root_message = root_message
        self.last_seen_message = last_seen_message
        self.messages_by_id = {
            message.id: message
            for message in (root_message, last_seen_message)
            if message is not None
        }
        self.thread_cursor = None
        self.commits = 0
        self.active_membership = active_membership
        self.latest_seq = latest_seq
        self.unread_message_seqs = unread_message_seqs or []
        self.statements = []

    @staticmethod
    def _first_uuid_param(statement):
        try:
            params = statement.compile().params
        except Exception:
            return None
        for value in params.values():
            try:
                return uuid.UUID(str(value))
            except (TypeError, ValueError):
                continue
        return None

    async def execute(self, statement):
        text = str(statement)
        self.statements.append(text)
        if "FROM accounts" in text:
            return _ExecuteResult(self.account)
        if "FROM server_memberships" in text:
            if not self.active_membership:
                return _ExecuteResult(rows=[])
            return _ExecuteResult(row=(self.membership, self.server, self.member))
        if "max(messages.seq)" in text:
            return _ExecuteResult(rows=[(self.channel.id, self.latest_seq)])
        if "messages.channel_id, messages.seq" in text:
            return _ExecuteResult(rows=[(self.channel.id, seq) for seq in self.unread_message_seqs])
        if "FROM channel_members" in text and "JOIN channels" in text:
            return _ExecuteResult(rows=[(self.channel_member, self.channel)])
        if "FROM channel_members" in text and "channel_members.channel_id IN" in text:
            return _ExecuteResult(rows=[(self.channel_member.channel_id, self.channel_member.last_read_seq)])
        if "FROM channel_members" in text:
            return _ExecuteResult(self.channel_member)
        if "FROM channels" in text and ("channels.kind" in text or "channels.type" in text) and "!=" in text:
            return _ExecuteResult(scalar_rows=[self.channel])
        if "FROM channels" in text and "channel_members" not in text:
            return _ExecuteResult(self.channel)
        if "FROM messages" in text and "JOIN channels" in text:
            return _ExecuteResult(self.root_message)
        if "FROM messages" in text:
            message_id = self._first_uuid_param(statement)
            return _ExecuteResult(self.messages_by_id.get(message_id) if message_id else None)
        if "FROM chat_thread_read_cursors" in text:
            if "root_message_id =" in text:
                return _ExecuteResult(self.thread_cursor)
            return _ExecuteResult(scalar_rows=[self.thread_cursor] if self.thread_cursor else [])
        return _ExecuteResult()

    def add(self, item):
        if isinstance(item, ChatThreadReadCursor):
            self.thread_cursor = item
            return
        raise AssertionError(f"unexpected add in read-cursor HTTP route: {item!r}")

    async def flush(self):
        return None

    async def commit(self):
        self.commits += 1

    async def close(self):
        return None


def _http_cursor_world(
    *,
    channel_kind="public",
    with_thread=False,
    account_present=True,
    active_membership=True,
    latest_seq=0,
    unread_message_seqs=None,
    last_seen_message_kind="reply",
):
    server = Server(id=uuid.uuid4(), name="Inkframe")
    member = Member(id=uuid.uuid4(), server_id=server.id, kind="human", display_name="Lee")
    account = Account(
        id=uuid.uuid4(),
        name="lee",
        display_name="Lee",
        server_id=server.id,
        member_id=member.id,
        session_token_hash=public_api._hash_token("sk_session_http"),
    ) if account_present else None
    membership = ServerMembership(
        id=uuid.uuid4(),
        server_id=server.id,
        account_id=account.id if account else uuid.uuid4(),
        member_id=member.id,
        role="owner",
        status="active",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    channel = Channel(
        id=uuid.uuid4(),
        server_id=server.id,
        name="dm-lee-codex" if channel_kind == "dm" else "general",
        kind=channel_kind,
    )
    channel_member = ChannelMember(channel_id=channel.id, member_id=member.id, last_read_seq=2)
    root_message = None
    if with_thread:
        root_message = Message(
            id=uuid.uuid4(),
            short_id="threadroot",
            channel_id=channel.id,
            sender_id=member.id,
            parent_id=None,
            content="Root message",
            channel_type="channel",
            mentions=[],
            seq=30,
        )
    last_seen_message = None
    if root_message and last_seen_message_kind:
        if last_seen_message_kind == "root":
            last_seen_message = root_message
        elif last_seen_message_kind == "reply":
            last_seen_message = Message(
                id=uuid.uuid4(),
                short_id="threadreply",
                channel_id=channel.id,
                sender_id=member.id,
                parent_id=root_message.id,
                content="Thread reply",
                channel_type="thread",
                mentions=[],
                seq=31,
            )
        elif last_seen_message_kind == "other-thread":
            last_seen_message = Message(
                id=uuid.uuid4(),
                short_id="otherreply",
                channel_id=channel.id,
                sender_id=member.id,
                parent_id=uuid.uuid4(),
                content="Other thread reply",
                channel_type="thread",
                mentions=[],
                seq=41,
            )
        elif last_seen_message_kind == "other-root":
            last_seen_message = Message(
                id=uuid.uuid4(),
                short_id="otherroot",
                channel_id=channel.id,
                sender_id=member.id,
                parent_id=None,
                content="Other root message",
                channel_type="channel",
                mentions=[],
                seq=40,
            )
    return _ReadCursorHttpSession(
        account=account,
        server=server,
        member=member,
        membership=membership,
        channel=channel,
        channel_member=channel_member,
        root_message=root_message,
        active_membership=active_membership,
        latest_seq=latest_seq,
        unread_message_seqs=unread_message_seqs,
        last_seen_message=last_seen_message,
    )


@pytest.mark.asyncio
async def test_http_channel_cursor_post_and_get_projection_uses_public_auth_and_active_server():
    db = _http_cursor_world()

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            headers = {
                "X-Public-Key": public_api.PUBLIC_API_KEY,
                "X-Account-Token": "sk_session_http",
                "X-Server-Id": str(db.server.id),
            }
            post_response = await client.post(
                "/api/v1/chat/read-cursors",
                headers=headers,
                json={
                    "scope": {"kind": "channel", "channelId": str(db.channel.id)},
                    "lastReadSeq": 14,
                },
            )
            assert post_response.status_code == 200
            assert db.commits == 1
            assert db.channel_member.last_read_seq == 14
            assert post_response.json()["cursor"] == {
                "scope": {"kind": "channel", "channelId": str(db.channel.id)},
                "memberId": str(db.member.id),
                "lastReadSeq": 14,
            }

            get_response = await client.get("/api/v1/chat/read-cursors", headers=headers)
            assert get_response.status_code == 200
            assert get_response.json() == {
                "serverId": str(db.server.id),
                "memberId": str(db.member.id),
                "cursors": [
                    {
                        "scope": {"kind": "channel", "channelId": str(db.channel.id)},
                        "memberId": str(db.member.id),
                        "lastReadSeq": 14,
                    }
                ],
            }
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_channels_unread_projection_counts_newer_messages_not_global_seq_gap():
    db = _http_cursor_world(latest_seq=120, unread_message_seqs=[120])
    db.channel_member.last_read_seq = 90

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get(
                "/api/v1/channels",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
            )
            assert response.status_code == 200
            assert response.json()["channels"] == [
                {
                    "id": str(db.channel.id),
                    "name": "#general",
                    "type": "public",
                    "description": "",
                    "latestSeq": 120,
                    "unreadCount": 1,
                    "hasUnread": True,
                }
            ]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_read_cursor_requires_account_session():
    db = _http_cursor_world(account_present=False)

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get(
                "/api/v1/chat/read-cursors",
                headers={"X-Public-Key": public_api.PUBLIC_API_KEY, "X-Account-Token": "sk_session_http"},
            )
            assert response.status_code == 401
            assert response.json()["detail"] == "Login required for Server access"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_read_cursor_rejects_unjoined_active_server():
    db = _http_cursor_world(active_membership=False)

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(uuid.uuid4()),
                },
            )
            assert response.status_code == 403
            assert response.json()["detail"] == "Account is not a member of the selected Server"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_cursor_get_queries_are_scoped_to_active_server_and_member():
    db = _http_cursor_world(with_thread=True)

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
            )
            assert response.status_code == 200

            executed = "\n".join(db.statements)
            assert "server_memberships.account_id =" in executed
            assert "server_memberships.server_id =" in executed
            assert "channels.server_id =" in executed
            assert "channel_members.member_id =" in executed
            assert "chat_thread_read_cursors.server_id =" in executed
            assert "chat_thread_read_cursors.member_id =" in executed
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_dm_cursor_post_and_get_projection_uses_dm_scope():
    db = _http_cursor_world(channel_kind="dm")

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            headers = {
                "X-Public-Key": public_api.PUBLIC_API_KEY,
                "X-Account-Token": "sk_session_http",
                "X-Server-Id": str(db.server.id),
            }
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers=headers,
                json={"scope": {"kind": "dm", "channelId": str(db.channel.id)}, "lastReadSeq": 9},
            )
            assert response.status_code == 200
            assert response.json()["cursor"]["scope"] == {"kind": "dm", "channelId": str(db.channel.id)}

            get_response = await client.get("/api/v1/chat/read-cursors", headers=headers)
            assert get_response.status_code == 200
            assert get_response.json()["cursors"] == [
                {
                    "scope": {"kind": "dm", "channelId": str(db.channel.id)},
                    "memberId": str(db.member.id),
                    "lastReadSeq": 9,
                }
            ]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_channel_cursor_write_is_monotonic():
    db = _http_cursor_world()
    db.channel_member.last_read_seq = 20

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            headers = {
                "X-Public-Key": public_api.PUBLIC_API_KEY,
                "X-Account-Token": "sk_session_http",
                "X-Server-Id": str(db.server.id),
            }
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers=headers,
                json={"scope": {"kind": "channel", "channelId": str(db.channel.id)}, "lastReadSeq": 7},
            )
            assert response.status_code == 200
            assert db.channel_member.last_read_seq == 20
            assert response.json()["cursor"]["lastReadSeq"] == 20
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_channel_cursor_rejects_malformed_last_read_seq_without_commit():
    db = _http_cursor_world()
    original_seq = db.channel_member.last_read_seq

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "scope": {"kind": "channel", "channelId": str(db.channel.id)},
                    "lastReadSeq": "not-a-number",
                },
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Invalid lastReadSeq"
            assert db.commits == 0
            assert db.channel_member.last_read_seq == original_seq
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_channel_cursor_rejects_negative_last_read_seq_without_commit():
    db = _http_cursor_world()
    original_seq = db.channel_member.last_read_seq

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "scope": {"kind": "channel", "channelId": str(db.channel.id)},
                    "lastReadSeq": -1,
                },
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Invalid lastReadSeq"
            assert db.commits == 0
            assert db.channel_member.last_read_seq == original_seq
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_channel_cursor_accepts_string_integer_last_read_seq():
    db = _http_cursor_world()

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "scope": {"kind": "channel", "channelId": str(db.channel.id)},
                    "lastReadSeq": "12",
                },
            )
            assert response.status_code == 200
            assert db.commits == 1
            assert db.channel_member.last_read_seq == 12
            assert response.json()["cursor"]["lastReadSeq"] == 12
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize("raw_body", [b"[]", b'"not-object"', b"null", b"12", b"true"])
async def test_http_read_cursor_rejects_non_object_json_body_without_commit(raw_body):
    db = _http_cursor_world()
    original_seq = db.channel_member.last_read_seq

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                    "Content-Type": "application/json",
                },
                content=raw_body,
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Invalid read cursor request body"
            assert db.commits == 0
            assert db.channel_member.last_read_seq == original_seq
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize("scope", [None, [], "thread", 12, True])
async def test_http_read_cursor_rejects_present_non_object_scope_without_commit(scope):
    db = _http_cursor_world()
    original_seq = db.channel_member.last_read_seq

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={"scope": scope, "kind": "channel", "lastReadSeq": 9},
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Invalid read cursor scope"
            assert db.commits == 0
            assert db.channel_member.last_read_seq == original_seq
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_thread_cursor_accepts_top_level_fallback_without_scope():
    db = _http_cursor_world(with_thread=True)

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "kind": "thread",
                    "threadId": str(db.root_message.id),
                    "lastReadSeq": 31,
                    "lastSeenMessageId": str(db.last_seen_message.id),
                },
            )
            assert response.status_code == 200
            assert db.commits == 1
            assert response.json()["cursor"] == {
                "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                "memberId": str(db.member.id),
                "lastReadSeq": 31,
                "lastSeenMessageId": str(db.last_seen_message.id),
            }
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_dm_cursor_rejects_public_channel_scope_mismatch():
    db = _http_cursor_world(channel_kind="public")

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={"scope": {"kind": "dm", "channelId": str(db.channel.id)}, "lastReadSeq": 7},
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "DM cursor scope must reference a DM channel"
            assert db.commits == 0
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_channel_cursor_rejects_dm_scope_mismatch():
    db = _http_cursor_world(channel_kind="dm")

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={"scope": {"kind": "channel", "channelId": str(db.channel.id)}, "lastReadSeq": 7},
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Channel cursor scope must not reference a DM channel"
            assert db.commits == 0
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_thread_cursor_post_and_get_projection():
    db = _http_cursor_world(with_thread=True)
    seen_message_id = db.last_seen_message.id

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            headers = {
                "X-Public-Key": public_api.PUBLIC_API_KEY,
                "X-Account-Token": "sk_session_http",
                "X-Server-Id": str(db.server.id),
            }
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers=headers,
                json={
                    "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                    "lastReadSeq": 34,
                    "lastSeenMessageId": str(seen_message_id),
                },
            )
            assert response.status_code == 200
            assert db.commits == 1
            assert response.json()["cursor"] == {
                "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                "memberId": str(db.member.id),
                "lastReadSeq": 34,
                "lastSeenMessageId": str(seen_message_id),
            }

            get_response = await client.get("/api/v1/chat/read-cursors", headers=headers)
            assert get_response.status_code == 200
            assert get_response.json()["cursors"] == [
                {
                    "scope": {"kind": "channel", "channelId": str(db.channel.id)},
                    "memberId": str(db.member.id),
                    "lastReadSeq": 2,
                },
                {
                    "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                    "memberId": str(db.member.id),
                    "lastReadSeq": 34,
                    "lastSeenMessageId": str(seen_message_id),
                },
            ]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_thread_cursor_rejects_malformed_last_read_seq_without_commit():
    db = _http_cursor_world(with_thread=True)

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                    "lastReadSeq": "1.5",
                    "lastSeenMessageId": str(db.last_seen_message.id),
                },
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Invalid lastReadSeq"
            assert db.commits == 0
            assert db.thread_cursor is None
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_thread_cursor_rejects_negative_last_read_seq_without_commit():
    db = _http_cursor_world(with_thread=True)

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                    "lastReadSeq": -1,
                    "lastSeenMessageId": str(db.last_seen_message.id),
                },
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Invalid lastReadSeq"
            assert db.commits == 0
            assert db.thread_cursor is None
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_thread_cursor_accepts_root_message_as_last_seen():
    db = _http_cursor_world(with_thread=True, last_seen_message_kind="root")

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                    "lastReadSeq": 30,
                    "lastSeenMessageId": str(db.root_message.id),
                },
            )
            assert response.status_code == 200
            assert response.json()["cursor"]["lastSeenMessageId"] == str(db.root_message.id)
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_thread_cursor_rejects_last_seen_message_outside_thread():
    db = _http_cursor_world(with_thread=True, last_seen_message_kind="other-thread")

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                    "lastReadSeq": 34,
                    "lastSeenMessageId": str(db.last_seen_message.id),
                },
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Thread lastSeenMessageId must belong to the thread"
            assert db.commits == 0
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_thread_cursor_rejects_other_root_as_last_seen_message():
    db = _http_cursor_world(with_thread=True, last_seen_message_kind="other-root")

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                    "lastReadSeq": 34,
                    "lastSeenMessageId": str(db.last_seen_message.id),
                },
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Thread lastSeenMessageId must belong to the thread"
            assert db.commits == 0
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_thread_cursor_rejects_unknown_last_seen_message_id():
    db = _http_cursor_world(with_thread=True, last_seen_message_kind=None)

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                    "lastReadSeq": 34,
                    "lastSeenMessageId": str(uuid.uuid4()),
                },
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Thread lastSeenMessageId not found"
            assert db.commits == 0
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_thread_cursor_rejects_empty_last_seen_message_id_when_supplied():
    db = _http_cursor_world(with_thread=True)

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                    "lastReadSeq": 34,
                    "lastSeenMessageId": "",
                },
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Invalid thread lastSeenMessageId"
            assert db.commits == 0
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_http_thread_cursor_rejects_malformed_last_seen_message_id():
    db = _http_cursor_world(with_thread=True)

    async def override_db():
        yield db

    app.dependency_overrides[public_api.get_db] = override_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/v1/chat/read-cursors",
                headers={
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_http",
                    "X-Server-Id": str(db.server.id),
                },
                json={
                    "scope": {"kind": "thread", "rootMessageId": str(db.root_message.id)},
                    "lastReadSeq": 34,
                    "lastSeenMessageId": "not-a-uuid",
                },
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Invalid thread lastSeenMessageId"
            assert db.commits == 0
    finally:
        app.dependency_overrides.clear()
