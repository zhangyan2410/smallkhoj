import asyncio

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import Account, Member, Server, ServerMembership
from routers import public_api
from tests.postgres_test_support import disposable_postgres, run_alembic


@pytest.mark.asyncio
@pytest.mark.parametrize("_attempt", range(3))
async def test_concurrent_first_registrations_commit_exactly_one_bootstrap_owner(_attempt):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async def register(name: str):
                async with sessions.begin() as db:
                    account, server, member, _token = await public_api._bootstrap_account(
                        db,
                        name=name,
                        display_name=name.title(),
                    )
                    return account.id, server.id, member.id

            registrations = await asyncio.gather(
                register("bootstrap-alpha"),
                register("bootstrap-beta"),
            )

            assert len(registrations) == 2
            assert len({server_id for _account_id, server_id, _member_id in registrations}) == 2

            async with sessions() as db:
                account_count = await db.scalar(select(func.count()).select_from(Account))
                server_count = await db.scalar(select(func.count()).select_from(Server))
                member_count = await db.scalar(select(func.count()).select_from(Member))
                memberships = list(
                    (await db.execute(select(ServerMembership).where(ServerMembership.status == "active")))
                    .scalars()
                    .all()
                )

            assert account_count == 2
            assert server_count == 2
            assert member_count == 2
            assert len(memberships) == 2
            assert [membership.role for membership in memberships] == ["owner", "owner"]
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_rolled_back_first_registration_releases_lock_and_leaves_no_orphans():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            with pytest.raises(RuntimeError, match="forced registration rollback"):
                async with sessions.begin() as db:
                    await public_api._bootstrap_account(
                        db,
                        name="rolled-back-bootstrap",
                        display_name="Rolled Back Bootstrap",
                    )
                    raise RuntimeError("forced registration rollback")

            async with sessions() as db:
                assert await db.scalar(select(func.count()).select_from(Account)) == 0
                assert await db.scalar(select(func.count()).select_from(Server)) == 0
                assert await db.scalar(select(func.count()).select_from(Member)) == 0
                assert await db.scalar(select(func.count()).select_from(ServerMembership)) == 0

            async with sessions.begin() as db:
                await public_api._bootstrap_account(
                    db,
                    name="bootstrap-retry",
                    display_name="Bootstrap Retry",
                )

            async with sessions() as db:
                memberships = list(
                    (await db.execute(select(ServerMembership))).scalars().all()
                )
                assert len(memberships) == 1
                assert memberships[0].role == "owner"
        finally:
            await engine.dispose()
