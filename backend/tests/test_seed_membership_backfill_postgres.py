from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import models.seed as seed
from models import Account, Member, Server, ServerMembership
from services.account_bootstrap import bootstrap_account
from tests.postgres_test_support import disposable_postgres, run_alembic


class _RecordingConnection:
    def __init__(self) -> None:
        self.statements: list[str] = []

    async def execute(self, statement, _parameters=None):
        self.statements.append(" ".join(str(statement).split()))


class _RecordingBegin:
    def __init__(self, connection: _RecordingConnection) -> None:
        self.connection = connection

    async def __aenter__(self) -> _RecordingConnection:
        return self.connection

    async def __aexit__(self, _exc_type, _exc, _traceback) -> None:
        return None


class _RecordingEngine:
    def __init__(self) -> None:
        self.connection = _RecordingConnection()

    def begin(self) -> _RecordingBegin:
        return _RecordingBegin(self.connection)


@pytest.mark.asyncio
async def test_runtime_seed_never_writes_or_backfills_identity(monkeypatch):
    recording_engine = _RecordingEngine()
    monkeypatch.setattr(seed, "engine", recording_engine)

    await seed.create_tables()

    statements = "\n".join(recording_engine.connection.statements)
    assert "INSERT INTO server_memberships" not in statements
    assert "INSERT INTO accounts" not in statements
    assert "INSERT INTO servers" not in statements
    assert "INSERT INTO members" not in statements
    assert "accounts.server_id" not in statements
    assert "accounts.member_id" not in statements
    assert "CREATE TABLE" not in statements.upper()


@pytest.mark.asyncio
async def test_runtime_seed_is_idempotent_and_preserves_bootstrapped_identity(monkeypatch):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with sessions.begin() as db:
                created = await bootstrap_account(
                    db,
                    auth_subject="seed-contract-account",
                    name="种子契约",
                )
                expected_ids = {
                    "account": created.account.id,
                    "server": created.server.id,
                    "member": created.member.id,
                    "membership": created.membership.id,
                }

            monkeypatch.setattr(seed, "engine", engine)
            await asyncio.gather(seed.create_tables(), seed.create_tables())

            async with sessions() as db:
                counts = {
                    "account": await db.scalar(select(func.count()).select_from(Account)),
                    "server": await db.scalar(select(func.count()).select_from(Server)),
                    "member": await db.scalar(select(func.count()).select_from(Member)),
                    "membership": await db.scalar(select(func.count()).select_from(ServerMembership)),
                }
                account = (await db.execute(select(Account))).scalar_one()
                server = (await db.execute(select(Server))).scalar_one()
                member = (await db.execute(select(Member))).scalar_one()
                membership = (await db.execute(select(ServerMembership))).scalar_one()

            assert counts == {"account": 1, "server": 1, "member": 1, "membership": 1}
            assert {
                "account": account.id,
                "server": server.id,
                "member": member.id,
                "membership": membership.id,
            } == expected_ids
        finally:
            await engine.dispose()
