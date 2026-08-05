import os
import uuid
from datetime import datetime, timezone

import asyncpg
import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from main import app
from models import (
    Account,
    Base,
    Channel,
    ChannelMember,
    ChatThreadReadCursor,
    Member,
    Message,
    Server,
    ServerMembership,
)
from routers import public_api

TEST_DATABASE_URL = os.environ.get(
    "SMALLKHOJ_TEST_DATABASE_URL",
    "postgresql+asyncpg://smallkhoj:smallkhoj@localhost:5432/smallkhoj",
)
TEST_SCHEMA_DATABASE_URL = TEST_DATABASE_URL.replace(
    "postgresql+asyncpg://",
    "postgresql://",
    1,
)


async def _create_temp_schema() -> str:
    schema_name = f"smallkhoj_test_{uuid.uuid4().hex[:12]}"
    try:
        conn = await asyncpg.connect(TEST_SCHEMA_DATABASE_URL)
    except Exception as exc:
        pytest.skip(f"Postgres test database is unavailable: {exc}")
    try:
        await conn.execute(f'CREATE SCHEMA "{schema_name}"')
    finally:
        await conn.close()
    return schema_name


async def _drop_temp_schema(schema_name: str) -> None:
    conn = await asyncpg.connect(TEST_SCHEMA_DATABASE_URL)
    try:
        await conn.execute(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE')
    finally:
        await conn.close()


def _auth_headers(*, server_id: uuid.UUID, token: str) -> dict[str, str]:
    return {
        "X-Public-Key": public_api.PUBLIC_API_KEY,
        "X-Account-Token": token,
        "X-Server-Id": str(server_id),
    }


def _home_identity(server: Server, *, token: str) -> tuple[Member, Account, ServerMembership]:
    account_id = uuid.uuid4()
    member = Member(
        id=uuid.uuid4(),
        origin_server_id=server.id,
        account_id=account_id,
        kind="human",
        handle="Lee",
        handle_key="lee",
    )
    account = Account(
        id=account_id,
        auth_subject=f"test:{token}",
        display_name="Lee",
        home_server_id=server.id,
        session_token_hash=public_api._hash_token(token),
    )
    membership = ServerMembership(
        id=uuid.uuid4(),
        server_id=server.id,
        account_id=account.id,
        member_id=member.id,
        role="owner",
        status="active",
    )
    return member, account, membership


async def _insert_message_fixture_with_seq(db, message: Message) -> None:
    """Insert a fixed cursor boundary into a GENERATED ALWAYS test table."""

    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            """
            INSERT INTO messages (
                id, short_id, channel_id, sender_id, parent_id, content,
                channel_type, mentions, seq, created_at, updated_at
            ) OVERRIDING SYSTEM VALUE VALUES (
                :id, :short_id, :channel_id, :sender_id, :parent_id, :content,
                :channel_type, '{}'::uuid[], :seq, :created_at, :updated_at
            )
            """
        ),
        {
            "id": message.id,
            "short_id": message.short_id,
            "channel_id": message.channel_id,
            "sender_id": message.sender_id,
            "parent_id": message.parent_id,
            "content": message.content,
            "channel_type": message.channel_type,
            "seq": message.seq,
            "created_at": now,
            "updated_at": now,
        },
    )


@pytest.mark.asyncio
async def test_postgres_http_channel_cursor_persists_and_projects_unread_state():
    schema_name = await _create_temp_schema()
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        connect_args={"server_settings": {"search_path": schema_name}},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        server = Server(id=uuid.uuid4(), name="Inkframe Test", server_handle="spg01")
        member, account, membership = _home_identity(server, token="sk_session_pg")
        channel = Channel(id=uuid.uuid4(), server_id=server.id, name="general", kind="public")
        channel_member = ChannelMember(channel_id=channel.id, member_id=member.id, last_read_seq=0)
        message = Message(
            id=uuid.uuid4(),
            short_id="pgcursor",
            channel_id=channel.id,
            sender_id=member.id,
            content="Unread row",
            channel_type="channel",
            mentions=[],
            seq=5,
        )

        async with session_factory() as db:
            db.add_all([server, member, account, membership, channel, channel_member])
            await db.flush()
            await _insert_message_fixture_with_seq(db, message)
            await db.commit()

        async def override_db():
            async with session_factory() as db:
                yield db

        previous_dependency_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                headers = {
                    "X-Public-Key": public_api.PUBLIC_API_KEY,
                    "X-Account-Token": "sk_session_pg",
                    "X-Server-Id": str(server.id),
                }
                post_response = await client.post(
                    "/api/v1/chat/read-cursors",
                    headers=headers,
                    json={"scope": {"kind": "channel", "channelId": str(channel.id)}, "lastReadSeq": 3},
                )
                assert post_response.status_code == 200
                assert post_response.json()["cursor"]["lastReadSeq"] == 3

                get_response = await client.get("/api/v1/chat/read-cursors", headers=headers)
                assert get_response.status_code == 200
                assert get_response.json()["cursors"] == [
                    {
                        "scope": {"kind": "channel", "channelId": str(channel.id)},
                        "memberId": str(member.id),
                        "lastReadSeq": 3,
                    }
                ]

                channels_response = await client.get("/api/v1/channels", headers=headers)
                assert channels_response.status_code == 200
                assert channels_response.json()["channels"][0]["latestSeq"] == 5
                assert channels_response.json()["channels"][0]["unreadCount"] == 1
                assert channels_response.json()["channels"][0]["hasUnread"] is True
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_dependency_overrides)

        async with session_factory() as db:
            row = await db.scalar(
                select(ChannelMember).where(
                    ChannelMember.channel_id == channel.id,
                    ChannelMember.member_id == member.id,
                )
            )
            assert row is not None
            assert row.last_read_seq == 3
    finally:
        await engine.dispose()
        await _drop_temp_schema(schema_name)


@pytest.mark.asyncio
async def test_postgres_http_dm_cursor_persists_with_dm_scope():
    schema_name = await _create_temp_schema()
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        connect_args={"server_settings": {"search_path": schema_name}},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        server = Server(id=uuid.uuid4(), name="Inkframe Test", server_handle="spg01")
        member, account, membership = _home_identity(server, token="sk_session_pg_dm")
        dm_channel = Channel(id=uuid.uuid4(), server_id=server.id, name="dm-lee-codex", kind="dm")
        dm_member = ChannelMember(channel_id=dm_channel.id, member_id=member.id, last_read_seq=1)

        async with session_factory() as db:
            db.add_all([server, member, account, membership, dm_channel, dm_member])
            await db.commit()

        async def override_db():
            async with session_factory() as db:
                yield db

        previous_dependency_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                headers = _auth_headers(server_id=server.id, token="sk_session_pg_dm")
                post_response = await client.post(
                    "/api/v1/chat/read-cursors",
                    headers=headers,
                    json={"scope": {"kind": "dm", "channelId": str(dm_channel.id)}, "lastReadSeq": 11},
                )
                assert post_response.status_code == 200
                assert post_response.json()["cursor"] == {
                    "scope": {"kind": "dm", "channelId": str(dm_channel.id)},
                    "memberId": str(member.id),
                    "lastReadSeq": 11,
                }

                get_response = await client.get("/api/v1/chat/read-cursors", headers=headers)
                assert get_response.status_code == 200
                assert get_response.json()["cursors"] == [
                    {
                        "scope": {"kind": "dm", "channelId": str(dm_channel.id)},
                        "memberId": str(member.id),
                        "lastReadSeq": 11,
                    }
                ]
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_dependency_overrides)

        async with session_factory() as db:
            row = await db.scalar(
                select(ChannelMember).where(
                    ChannelMember.channel_id == dm_channel.id,
                    ChannelMember.member_id == member.id,
                )
            )
            assert row is not None
            assert row.last_read_seq == 11
    finally:
        await engine.dispose()
        await _drop_temp_schema(schema_name)


@pytest.mark.asyncio
async def test_postgres_http_thread_cursor_persists_and_projects():
    schema_name = await _create_temp_schema()
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        connect_args={"server_settings": {"search_path": schema_name}},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        server = Server(id=uuid.uuid4(), name="Inkframe Test", server_handle="spg01")
        member, account, membership = _home_identity(server, token="sk_session_pg_thread")
        channel = Channel(id=uuid.uuid4(), server_id=server.id, name="general", kind="public")
        channel_member = ChannelMember(channel_id=channel.id, member_id=member.id, last_read_seq=2)
        root_message = Message(
            id=uuid.uuid4(),
            short_id="pgroot",
            channel_id=channel.id,
            sender_id=member.id,
            content="Root message",
            channel_type="channel",
            mentions=[],
            seq=30,
        )
        reply_message = Message(
            id=uuid.uuid4(),
            short_id="pgreply",
            channel_id=channel.id,
            sender_id=member.id,
            parent_id=root_message.id,
            content="Thread reply",
            channel_type="channel",
            mentions=[],
            seq=31,
        )

        async with session_factory() as db:
            db.add_all([server, member, account, membership, channel, channel_member])
            await db.flush()
            await _insert_message_fixture_with_seq(db, root_message)
            await _insert_message_fixture_with_seq(db, reply_message)
            await db.commit()

        async def override_db():
            async with session_factory() as db:
                yield db

        previous_dependency_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                headers = _auth_headers(server_id=server.id, token="sk_session_pg_thread")
                post_response = await client.post(
                    "/api/v1/chat/read-cursors",
                    headers=headers,
                    json={
                        "scope": {"kind": "thread", "rootMessageId": str(root_message.id)},
                        "lastReadSeq": 31,
                        "lastSeenMessageId": str(reply_message.id),
                    },
                )
                assert post_response.status_code == 200
                assert post_response.json()["cursor"] == {
                    "scope": {"kind": "thread", "rootMessageId": str(root_message.id)},
                    "memberId": str(member.id),
                    "lastReadSeq": 31,
                    "lastSeenMessageId": str(reply_message.id),
                }

                get_response = await client.get("/api/v1/chat/read-cursors", headers=headers)
                assert get_response.status_code == 200
                assert get_response.json()["cursors"] == [
                    {
                        "scope": {"kind": "channel", "channelId": str(channel.id)},
                        "memberId": str(member.id),
                        "lastReadSeq": 2,
                    },
                    {
                        "scope": {"kind": "thread", "rootMessageId": str(root_message.id)},
                        "memberId": str(member.id),
                        "lastReadSeq": 31,
                        "lastSeenMessageId": str(reply_message.id),
                    },
                ]
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_dependency_overrides)

        async with session_factory() as db:
            row = await db.scalar(
                select(ChatThreadReadCursor).where(
                    ChatThreadReadCursor.root_message_id == root_message.id,
                    ChatThreadReadCursor.member_id == member.id,
                )
            )
            assert row is not None
            assert row.server_id == server.id
            assert row.last_read_seq == 31
            assert row.last_seen_message_id == reply_message.id
    finally:
        await engine.dispose()
        await _drop_temp_schema(schema_name)


@pytest.mark.asyncio
async def test_postgres_http_channel_and_dm_scope_mismatches_reject_without_writes():
    schema_name = await _create_temp_schema()
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        connect_args={"server_settings": {"search_path": schema_name}},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        server = Server(id=uuid.uuid4(), name="Inkframe Test", server_handle="spg01")
        member, account, membership = _home_identity(server, token="sk_session_pg_mismatch")
        public_channel = Channel(id=uuid.uuid4(), server_id=server.id, name="general", kind="public")
        dm_channel = Channel(id=uuid.uuid4(), server_id=server.id, name="dm-lee-codex", kind="dm")
        public_member = ChannelMember(channel_id=public_channel.id, member_id=member.id, last_read_seq=4)
        dm_member = ChannelMember(channel_id=dm_channel.id, member_id=member.id, last_read_seq=6)

        async with session_factory() as db:
            db.add_all([server, member, account, membership, public_channel, dm_channel, public_member, dm_member])
            await db.commit()

        async def override_db():
            async with session_factory() as db:
                yield db

        previous_dependency_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                headers = _auth_headers(server_id=server.id, token="sk_session_pg_mismatch")
                dm_on_public = await client.post(
                    "/api/v1/chat/read-cursors",
                    headers=headers,
                    json={"scope": {"kind": "dm", "channelId": str(public_channel.id)}, "lastReadSeq": 20},
                )
                assert dm_on_public.status_code == 400
                assert dm_on_public.json()["detail"] == "DM cursor scope must reference a DM channel"

                channel_on_dm = await client.post(
                    "/api/v1/chat/read-cursors",
                    headers=headers,
                    json={"scope": {"kind": "channel", "channelId": str(dm_channel.id)}, "lastReadSeq": 22},
                )
                assert channel_on_dm.status_code == 400
                assert channel_on_dm.json()["detail"] == "Channel cursor scope must not reference a DM channel"
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_dependency_overrides)

        async with session_factory() as db:
            public_row = await db.scalar(
                select(ChannelMember).where(
                    ChannelMember.channel_id == public_channel.id,
                    ChannelMember.member_id == member.id,
                )
            )
            dm_row = await db.scalar(
                select(ChannelMember).where(
                    ChannelMember.channel_id == dm_channel.id,
                    ChannelMember.member_id == member.id,
                )
            )
            assert public_row is not None
            assert public_row.last_read_seq == 4
            assert dm_row is not None
            assert dm_row.last_read_seq == 6
    finally:
        await engine.dispose()
        await _drop_temp_schema(schema_name)


@pytest.mark.asyncio
async def test_postgres_http_read_cursor_requires_account_session():
    schema_name = await _create_temp_schema()
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        connect_args={"server_settings": {"search_path": schema_name}},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async def override_db():
            async with session_factory() as db:
                yield db

        previous_dependency_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                response = await client.get(
                    "/api/v1/chat/read-cursors",
                    headers={"X-Public-Key": public_api.PUBLIC_API_KEY},
                )
                assert response.status_code == 401
                assert response.json()["detail"] == "Login required for Server access"
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_dependency_overrides)
    finally:
        await engine.dispose()
        await _drop_temp_schema(schema_name)


@pytest.mark.asyncio
async def test_postgres_http_read_cursor_rejects_unjoined_active_server():
    schema_name = await _create_temp_schema()
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        connect_args={"server_settings": {"search_path": schema_name}},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        joined_server = Server(id=uuid.uuid4(), name="Joined Server", server_handle="spg01")
        other_server = Server(id=uuid.uuid4(), name="Other Server", server_handle="spg02")
        member, account, membership = _home_identity(
            joined_server,
            token="sk_session_pg_unjoined",
        )

        async with session_factory() as db:
            db.add_all([joined_server, other_server, member, account, membership])
            await db.commit()

        async def override_db():
            async with session_factory() as db:
                yield db

        previous_dependency_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                response = await client.get(
                    "/api/v1/chat/read-cursors",
                    headers=_auth_headers(server_id=other_server.id, token="sk_session_pg_unjoined"),
                )
                assert response.status_code == 403
                assert response.json()["detail"] == "Account is not a member of the selected Server"
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_dependency_overrides)
    finally:
        await engine.dispose()
        await _drop_temp_schema(schema_name)


@pytest.mark.asyncio
async def test_postgres_http_channel_cursor_write_is_monotonic():
    schema_name = await _create_temp_schema()
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        connect_args={"server_settings": {"search_path": schema_name}},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        server = Server(id=uuid.uuid4(), name="Inkframe Test", server_handle="spg01")
        member, account, membership = _home_identity(server, token="sk_session_pg_monotonic")
        channel = Channel(id=uuid.uuid4(), server_id=server.id, name="general", kind="public")
        channel_member = ChannelMember(channel_id=channel.id, member_id=member.id, last_read_seq=20)

        async with session_factory() as db:
            db.add_all([server, member, account, membership, channel, channel_member])
            await db.commit()

        async def override_db():
            async with session_factory() as db:
                yield db

        previous_dependency_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                response = await client.post(
                    "/api/v1/chat/read-cursors",
                    headers=_auth_headers(server_id=server.id, token="sk_session_pg_monotonic"),
                    json={"scope": {"kind": "channel", "channelId": str(channel.id)}, "lastReadSeq": 7},
                )
                assert response.status_code == 200
                assert response.json()["cursor"]["lastReadSeq"] == 20
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_dependency_overrides)

        async with session_factory() as db:
            row = await db.scalar(
                select(ChannelMember).where(
                    ChannelMember.channel_id == channel.id,
                    ChannelMember.member_id == member.id,
                )
            )
            assert row is not None
            assert row.last_read_seq == 20
    finally:
        await engine.dispose()
        await _drop_temp_schema(schema_name)


@pytest.mark.asyncio
async def test_postgres_http_dm_cursor_write_is_monotonic():
    schema_name = await _create_temp_schema()
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        connect_args={"server_settings": {"search_path": schema_name}},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        server = Server(id=uuid.uuid4(), name="Inkframe Test", server_handle="spg01")
        member, account, membership = _home_identity(server, token="sk_session_pg_dm_monotonic")
        dm_channel = Channel(id=uuid.uuid4(), server_id=server.id, name="dm-lee-codex", kind="dm")
        dm_member = ChannelMember(channel_id=dm_channel.id, member_id=member.id, last_read_seq=20)

        async with session_factory() as db:
            db.add_all([server, member, account, membership, dm_channel, dm_member])
            await db.commit()

        async def override_db():
            async with session_factory() as db:
                yield db

        previous_dependency_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                response = await client.post(
                    "/api/v1/chat/read-cursors",
                    headers=_auth_headers(server_id=server.id, token="sk_session_pg_dm_monotonic"),
                    json={"scope": {"kind": "dm", "channelId": str(dm_channel.id)}, "lastReadSeq": 7},
                )
                assert response.status_code == 200
                assert response.json()["cursor"] == {
                    "scope": {"kind": "dm", "channelId": str(dm_channel.id)},
                    "memberId": str(member.id),
                    "lastReadSeq": 20,
                }
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_dependency_overrides)

        async with session_factory() as db:
            row = await db.scalar(
                select(ChannelMember).where(
                    ChannelMember.channel_id == dm_channel.id,
                    ChannelMember.member_id == member.id,
                )
            )
            assert row is not None
            assert row.last_read_seq == 20
    finally:
        await engine.dispose()
        await _drop_temp_schema(schema_name)


@pytest.mark.asyncio
async def test_postgres_http_thread_cursor_write_is_monotonic_and_preserves_last_seen():
    schema_name = await _create_temp_schema()
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        connect_args={"server_settings": {"search_path": schema_name}},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        server = Server(id=uuid.uuid4(), name="Inkframe Test", server_handle="spg01")
        member, account, membership = _home_identity(
            server,
            token="sk_session_pg_thread_monotonic",
        )
        channel = Channel(id=uuid.uuid4(), server_id=server.id, name="general", kind="public")
        channel_member = ChannelMember(channel_id=channel.id, member_id=member.id, last_read_seq=2)
        root_message = Message(
            id=uuid.uuid4(),
            short_id="pgrootmono",
            channel_id=channel.id,
            sender_id=member.id,
            content="Root message",
            channel_type="channel",
            mentions=[],
            seq=30,
        )
        older_reply = Message(
            id=uuid.uuid4(),
            short_id="pgoldmono",
            channel_id=channel.id,
            sender_id=member.id,
            parent_id=root_message.id,
            content="Older thread reply",
            channel_type="channel",
            mentions=[],
            seq=10,
        )
        current_reply = Message(
            id=uuid.uuid4(),
            short_id="pgcurmono",
            channel_id=channel.id,
            sender_id=member.id,
            parent_id=root_message.id,
            content="Current thread reply",
            channel_type="channel",
            mentions=[],
            seq=31,
        )
        thread_cursor = ChatThreadReadCursor(
            server_id=server.id,
            member_id=member.id,
            root_message_id=root_message.id,
            last_read_seq=31,
            last_seen_message_id=current_reply.id,
        )

        async with session_factory() as db:
            db.add_all(
                [
                    server,
                    member,
                    account,
                    membership,
                    channel,
                    channel_member,
                ]
            )
            await db.flush()
            await _insert_message_fixture_with_seq(db, root_message)
            await _insert_message_fixture_with_seq(db, older_reply)
            await _insert_message_fixture_with_seq(db, current_reply)
            db.add(thread_cursor)
            await db.commit()

        async def override_db():
            async with session_factory() as db:
                yield db

        previous_dependency_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                response = await client.post(
                    "/api/v1/chat/read-cursors",
                    headers=_auth_headers(server_id=server.id, token="sk_session_pg_thread_monotonic"),
                    json={
                        "scope": {"kind": "thread", "rootMessageId": str(root_message.id)},
                        "lastReadSeq": 10,
                        "lastSeenMessageId": str(older_reply.id),
                    },
                )
                assert response.status_code == 200
                assert response.json()["cursor"] == {
                    "scope": {"kind": "thread", "rootMessageId": str(root_message.id)},
                    "memberId": str(member.id),
                    "lastReadSeq": 31,
                    "lastSeenMessageId": str(current_reply.id),
                }
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_dependency_overrides)

        async with session_factory() as db:
            row = await db.scalar(
                select(ChatThreadReadCursor).where(
                    ChatThreadReadCursor.root_message_id == root_message.id,
                    ChatThreadReadCursor.member_id == member.id,
                )
            )
            assert row is not None
            assert row.server_id == server.id
            assert row.last_read_seq == 31
            assert row.last_seen_message_id == current_reply.id
    finally:
        await engine.dispose()
        await _drop_temp_schema(schema_name)
