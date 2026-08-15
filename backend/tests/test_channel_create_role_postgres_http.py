"""POST /channels requires an owner/admin membership on the active Server."""

from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from main import app
from models import Account, Member, Server, ServerMembership
from routers import public_api
from tests.postgres_test_support import disposable_postgres, run_alembic


def _headers(server_id: uuid.UUID, token: str) -> dict[str, str]:
    return {
        "X-Public-Key": public_api.PUBLIC_API_KEY,
        "X-Account-Token": token,
        "X-Server-Id": str(server_id),
    }


async def _seed_identity(session_factory, *, role: str, handle_suffix: str):
    server = Server(
        id=uuid.uuid4(),
        name=f"channel-role-server-{handle_suffix}",
        server_handle=f"s{handle_suffix}",
    )
    account_id = uuid.uuid4()
    handle = f"channel-role-{handle_suffix}"
    member = Member(
        id=uuid.uuid4(),
        origin_server_id=server.id,
        account_id=account_id,
        kind="human",
        handle=handle,
        handle_key=handle,
    )
    token = f"channel_role_session_{uuid.uuid4().hex}"
    account = Account(
        id=account_id,
        auth_subject=f"test:{token}",
        display_name=member.handle,
        home_server_id=server.id,
        session_token_hash=public_api._hash_token(token),
    )
    membership = ServerMembership(
        id=uuid.uuid4(),
        server_id=server.id,
        account_id=account.id,
        member_id=member.id,
        role=role,
        status="active",
    )
    async with session_factory.begin() as db:
        db.add_all([server, member, account, membership])
    return server, token


@pytest.mark.asyncio
async def test_create_channel_requires_owner_or_admin_role():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            member_server, member_token = await _seed_identity(sessions, role="member", handle_suffix="aaaa")
            owner_server, owner_token = await _seed_identity(sessions, role="owner", handle_suffix="bbbb")
            admin_server, admin_token = await _seed_identity(sessions, role="admin", handle_suffix="cccc")

            async def override_db():
                async with sessions() as db:
                    yield db

            previous = app.dependency_overrides.copy()
            app.dependency_overrides[public_api.get_db] = override_db
            try:
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://testserver",
                ) as client:
                    member_create = await client.post(
                        "/api/v1/channels",
                        headers=_headers(member_server.id, member_token),
                        json={"name": "member-ch"},
                    )
                    assert member_create.status_code == 403, member_create.text

                    owner_create = await client.post(
                        "/api/v1/channels",
                        headers=_headers(owner_server.id, owner_token),
                        json={"name": "owner-ch"},
                    )
                    assert owner_create.status_code == 200, owner_create.text
                    assert owner_create.json()["channel"]["name"] == "#owner-ch"

                    admin_create = await client.post(
                        "/api/v1/channels",
                        headers=_headers(admin_server.id, admin_token),
                        json={"name": "admin-ch"},
                    )
                    assert admin_create.status_code == 200, admin_create.text
            finally:
                app.dependency_overrides.clear()
                app.dependency_overrides.update(previous)
        finally:
            await engine.dispose()
