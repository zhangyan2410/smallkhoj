from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from postgres_test_support import disposable_postgres, run_alembic
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import Account, Member, Server, ServerMembership
from services.account_bootstrap import bootstrap_account
from services.server_invites import accept_server_invite, create_server_invite
from services.server_membership import resolve_active_server_context


@pytest.mark.asyncio
async def test_bootstrap_is_idempotent_and_name_is_immutable():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with sessions() as db:
                first = await bootstrap_account(
                    db,
                    auth_subject="better-auth:user-1",
                    name="张翰",
                )
                await db.commit()

            async with sessions() as db:
                resumed = await bootstrap_account(
                    db,
                    auth_subject="better-auth:user-1",
                    name="张翰",
                )
                await db.commit()

                assert resumed.created is False
                assert resumed.account.id == first.account.id
                assert resumed.server.id == first.server.id
                assert resumed.member.id == first.member.id
                assert resumed.session_token != first.session_token

            async with sessions() as db:
                with pytest.raises(HTTPException) as immutable:
                    await bootstrap_account(
                        db,
                        auth_subject="better-auth:user-1",
                        name="另一个名字",
                    )
                assert immutable.value.status_code == 409
                assert immutable.value.detail["reasonCode"] == "NAME_IMMUTABLE"
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_retry_commits_one_complete_home_identity():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async def register():
                async with sessions() as db:
                    result = await bootstrap_account(
                        db,
                        auth_subject="better-auth:concurrent",
                        name="ean",
                    )
                    await db.commit()
                    return result

            first, second = await asyncio.gather(register(), register())
            assert first.account.id == second.account.id
            assert first.server.id == second.server.id
            assert first.member.id == second.member.id

            async with sessions() as db:
                counts = {
                    "accounts": await db.scalar(select(func.count()).select_from(Account)),
                    "servers": await db.scalar(select(func.count()).select_from(Server)),
                    "members": await db.scalar(select(func.count()).select_from(Member)),
                    "memberships": await db.scalar(select(func.count()).select_from(ServerMembership)),
                }
                assert counts == {
                    "accounts": 1,
                    "servers": 1,
                    "members": 1,
                    "memberships": 1,
                }
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_invite_reuses_one_human_identity_across_servers():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with sessions() as db:
                owner = await bootstrap_account(
                    db,
                    auth_subject="better-auth:owner",
                    name="owner",
                )
                visitor = await bootstrap_account(
                    db,
                    auth_subject="better-auth:visitor",
                    name="ean",
                )
                created = await create_server_invite(
                    db,
                    server=owner.server,
                    creator=owner.member,
                    public_base_url="http://localhost:3000",
                )
                accepted = await accept_server_invite(
                    db,
                    token=created.token,
                    account=visitor.account,
                )
                await db.commit()

                assert accepted.member.id == visitor.member.id
                assert accepted.member.origin_server_id == visitor.server.id
                assert accepted.membership.server_id == owner.server.id
                assert accepted.membership.member_id == visitor.member.id

                home = await resolve_active_server_context(db, account=visitor.account)
                foreign = await resolve_active_server_context(
                    db,
                    account=visitor.account,
                    requested_server_id=owner.server.id,
                )
                assert home.server.id == visitor.server.id
                assert foreign.server.id == owner.server.id
                assert home.member.id == foreign.member.id == visitor.member.id

                member_count = await db.scalar(
                    select(func.count()).select_from(Member).where(Member.account_id == visitor.account.id)
                )
                assert member_count == 1
        finally:
            await engine.dispose()
