import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from config import settings
from models import Member, ServerMembership
from services.account_bootstrap import bootstrap_account
from services.server_membership import list_account_memberships
from tests.postgres_test_support import disposable_postgres, run_alembic


@pytest.mark.asyncio
async def test_new_account_auto_joins_configured_official_server(monkeypatch):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with sessions.begin() as db:
                official = await bootstrap_account(
                    db,
                    auth_subject="better-auth:official",
                    name="sqteam",
                )

            monkeypatch.setattr(
                settings, "official_server_handle", official.server.server_handle
            )

            async with sessions.begin() as db:
                user = await bootstrap_account(
                    db,
                    auth_subject="better-auth:user",
                    name="ean",
                )

            async with sessions() as db:
                memberships = list(
                    (
                        await db.execute(
                            select(ServerMembership).where(
                                ServerMembership.account_id == user.account.id
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                assert len(memberships) == 2
                by_server = {membership.server_id: membership for membership in memberships}
                home = by_server[user.server.id]
                official_membership = by_server[official.server.id]
                assert home.role == "owner"
                assert official_membership.role == "member"
                assert official_membership.status == "active"
                # Joining the official Server reuses the same Human Member UUID.
                assert official_membership.member_id == user.member.id

                member_count = await db.scalar(
                    select(func.count())
                    .select_from(Member)
                    .where(Member.account_id == user.account.id)
                )
                assert member_count == 1

                # Same query backing GET /auth/me: official Server is listed.
                serialized = await list_account_memberships(db, account=user.account)
                official_entries = [
                    entry
                    for entry in serialized
                    if entry["server"]["id"] == str(official.server.id)
                ]
                assert len(official_entries) == 1
                assert official_entries[0]["role"] == "member"
                assert official_entries[0]["isDefault"] is False

                # The official Account itself keeps exactly one owner membership.
                official_count = await db.scalar(
                    select(func.count())
                    .select_from(ServerMembership)
                    .where(ServerMembership.account_id == official.account.id)
                )
                assert official_count == 1
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_resume_does_not_duplicate_official_membership(monkeypatch):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with sessions.begin() as db:
                official = await bootstrap_account(
                    db,
                    auth_subject="better-auth:official",
                    name="sqteam",
                )

            monkeypatch.setattr(
                settings, "official_server_handle", official.server.server_handle
            )

            async with sessions.begin() as db:
                await bootstrap_account(db, auth_subject="better-auth:user", name="ean")
            async with sessions.begin() as db:
                resumed = await bootstrap_account(
                    db, auth_subject="better-auth:user", name="ean"
                )
                assert resumed.created is False

            async with sessions() as db:
                count = await db.scalar(
                    select(func.count())
                    .select_from(ServerMembership)
                    .where(ServerMembership.account_id == resumed.account.id)
                )
                assert count == 2
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_unset_or_unknown_official_handle_skips_auto_join(monkeypatch):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            monkeypatch.setattr(settings, "official_server_handle", "szzzz")
            async with sessions.begin() as db:
                unknown_handle = await bootstrap_account(
                    db,
                    auth_subject="better-auth:unknown-handle",
                    name="alpha",
                )

            monkeypatch.setattr(settings, "official_server_handle", "")
            async with sessions.begin() as db:
                unset = await bootstrap_account(
                    db,
                    auth_subject="better-auth:unset",
                    name="beta",
                )

            async with sessions() as db:
                for account in (unknown_handle.account, unset.account):
                    count = await db.scalar(
                        select(func.count())
                        .select_from(ServerMembership)
                        .where(ServerMembership.account_id == account.id)
                    )
                    assert count == 1
        finally:
            await engine.dispose()
