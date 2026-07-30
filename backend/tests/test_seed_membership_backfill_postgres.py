from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest
from postgres_test_support import disposable_postgres, run_alembic
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import models.seed as seed
from models import Account, Member, Server, ServerMembership
from routers import public_api


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


class _InstrumentedSeedConnection:
    def __init__(
        self,
        connection,
        *,
        lock_attempted: asyncio.Event,
        lock_acquired: asyncio.Event,
        continue_after_lock: asyncio.Event,
        backfill_done: asyncio.Event,
    ) -> None:
        self._connection = connection
        self._lock_attempted = lock_attempted
        self._lock_acquired = lock_acquired
        self._continue_after_lock = continue_after_lock
        self._backfill_done = backfill_done

    async def execute(self, statement, parameters=None):
        sql = " ".join(str(statement).split())
        if "pg_advisory_xact_lock" in sql:
            self._lock_attempted.set()
            result = await self._connection.execute(statement, parameters)
            self._lock_acquired.set()
            await self._continue_after_lock.wait()
            return result

        result = await self._connection.execute(statement, parameters)
        if "INSERT INTO server_memberships" in sql:
            self._backfill_done.set()
        return result


class _InstrumentedSeedBegin:
    def __init__(self, engine, **events) -> None:
        self._engine = engine
        self._events = events
        self._context = None

    async def __aenter__(self):
        self._context = self._engine.begin()
        connection = await self._context.__aenter__()
        return _InstrumentedSeedConnection(connection, **self._events)

    async def __aexit__(self, exc_type, exc, traceback):
        return await self._context.__aexit__(exc_type, exc, traceback)


class _InstrumentedSeedEngine:
    def __init__(self, engine, **events) -> None:
        self._engine = engine
        self._events = events

    def begin(self):
        return _InstrumentedSeedBegin(self._engine, **self._events)


@pytest.mark.asyncio
async def test_membership_backfill_sql_serializes_ranks_and_fails_closed(monkeypatch):
    recording_engine = _RecordingEngine()
    monkeypatch.setattr(seed, "engine", recording_engine)

    await seed.create_tables()

    statements = recording_engine.connection.statements
    lock_index = next(
        (index for index, statement in enumerate(statements) if "pg_advisory_xact_lock" in statement),
        None,
    )
    guard_index = next(
        (
            index
            for index, statement in enumerate(statements)
            if "LEGACY_MEMBERSHIP_MULTIPLE_ACTIVE_OWNERS" in statement
        ),
        None,
    )
    backfill_index = next(
        (index for index, statement in enumerate(statements) if "INSERT INTO server_memberships" in statement),
        None,
    )

    assert lock_index is not None
    assert guard_index is not None
    assert backfill_index is not None
    assert lock_index < guard_index < backfill_index

    guard_sql = statements[guard_index]
    assert "HAVING COUNT(*) > 1" in guard_sql.upper()
    assert "role = 'owner'" in guard_sql
    assert "status = 'active'" in guard_sql

    backfill_sql = statements[backfill_index]
    assert "ROW_NUMBER() OVER" in backfill_sql.upper()
    assert "PARTITION BY accounts.server_id" in backfill_sql
    assert "ORDER BY accounts.created_at, accounts.id" in backfill_sql
    assert "candidate_rank = 1" in backfill_sql
    assert "ON CONFLICT (server_id, account_id) DO NOTHING" in backfill_sql


@pytest.mark.asyncio
async def test_bootstrap_and_startup_backfill_share_one_owner_election_lock(
    monkeypatch,
):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            legacy_member_id = uuid.uuid4()
            legacy_account_id = uuid.uuid4()
            async with sessions.begin() as db:
                db.add(
                    Server(
                        id=public_api.DEFAULT_SERVER_ID,
                        name=public_api.DEFAULT_SERVER_NAME,
                    )
                )
                db.add(
                    Member(
                        id=legacy_member_id,
                        server_id=public_api.DEFAULT_SERVER_ID,
                        kind="human",
                        display_name="legacy-seed-candidate",
                        status="online",
                    )
                )
                db.add(
                    Account(
                        id=legacy_account_id,
                        name="legacy-seed-candidate",
                        display_name="Legacy Seed Candidate",
                        server_id=public_api.DEFAULT_SERVER_ID,
                        member_id=legacy_member_id,
                    )
                )

            bootstrap_uncommitted = asyncio.Event()
            release_bootstrap = asyncio.Event()
            lock_attempted = asyncio.Event()
            lock_acquired = asyncio.Event()
            continue_after_lock = asyncio.Event()
            backfill_done = asyncio.Event()

            monkeypatch.setattr(
                seed,
                "engine",
                _InstrumentedSeedEngine(
                    engine,
                    lock_attempted=lock_attempted,
                    lock_acquired=lock_acquired,
                    continue_after_lock=continue_after_lock,
                    backfill_done=backfill_done,
                ),
            )

            async def bootstrap_account_without_committing():
                async with sessions.begin() as db:
                    await public_api._bootstrap_account(
                        db,
                        name="concurrent-bootstrap",
                        display_name="Concurrent Bootstrap",
                    )
                    bootstrap_uncommitted.set()
                    await release_bootstrap.wait()

            bootstrap_task = asyncio.create_task(
                bootstrap_account_without_committing()
            )
            await asyncio.wait_for(bootstrap_uncommitted.wait(), timeout=5)

            seed_task = asyncio.create_task(seed.create_tables())
            await asyncio.wait_for(lock_attempted.wait(), timeout=5)
            try:
                await asyncio.wait_for(lock_acquired.wait(), timeout=1)
            except TimeoutError:
                # A shared transaction lock blocks seed until bootstrap commits.
                release_bootstrap.set()
                await asyncio.wait_for(lock_acquired.wait(), timeout=5)
                continue_after_lock.set()
            else:
                # Different lock identities let seed elect an owner while the
                # bootstrap owner is still invisible and uncommitted.
                continue_after_lock.set()
                await asyncio.wait_for(backfill_done.wait(), timeout=5)
                release_bootstrap.set()

            await asyncio.gather(bootstrap_task, seed_task)

            async with sessions() as db:
                active_owner_count = await db.scalar(
                    select(func.count())
                    .select_from(ServerMembership)
                    .where(
                        ServerMembership.server_id == public_api.DEFAULT_SERVER_ID,
                        ServerMembership.role == "owner",
                        ServerMembership.status == "active",
                    )
                )

            assert active_owner_count == 1
        finally:
            await engine.dispose()


async def _insert_legacy_accounts(
    connection: asyncpg.Connection,
    *,
    roles: tuple[str, ...] = (),
) -> tuple[uuid.UUID, tuple[uuid.UUID, ...]]:
    server_id = uuid.uuid4()
    account_ids = (
        uuid.UUID("00000000-0000-4000-8000-000000000002"),
        uuid.UUID("00000000-0000-4000-8000-000000000001"),
        uuid.UUID("00000000-0000-4000-8000-000000000003"),
    )
    created_at = datetime(2026, 7, 1, tzinfo=timezone.utc)
    await connection.execute(
        "INSERT INTO servers (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)",
        server_id,
        f"legacy-membership-{server_id.hex[:8]}",
        created_at,
    )

    for index, account_id in enumerate(account_ids):
        member_id = uuid.uuid4()
        account_created_at = created_at + timedelta(seconds=max(0, index - 1))
        await connection.execute(
            """
            INSERT INTO members (
                id, server_id, type, display_name, status, skills, config,
                created_at, updated_at
            ) VALUES ($1, $2, 'human', $3, 'active', '[]'::jsonb, '{}'::jsonb, $4, $4)
            """,
            member_id,
            server_id,
            f"legacy-member-{index}",
            account_created_at,
        )
        await connection.execute(
            """
            INSERT INTO accounts (
                id, name, display_name, server_id, member_id, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $6)
            """,
            account_id,
            f"legacy-account-{server_id.hex[:8]}-{index}",
            f"Legacy Account {index}",
            server_id,
            member_id,
            account_created_at,
        )
        if index < len(roles):
            await connection.execute(
                """
                INSERT INTO server_memberships (
                    id, server_id, account_id, member_id, role, status,
                    created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)
                """,
                uuid.uuid4(),
                server_id,
                account_id,
                member_id,
                roles[index],
                account_created_at,
            )

    return server_id, account_ids


@pytest.mark.asyncio
async def test_concurrent_legacy_backfill_selects_one_deterministic_owner_and_is_idempotent(
    monkeypatch,
):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        database_url = postgres.database_url.replace("+asyncpg", "")
        connection = await asyncpg.connect(database_url)
        try:
            server_id, account_ids = await _insert_legacy_accounts(connection)
        finally:
            await connection.close()

        engine = create_async_engine(postgres.database_url)
        monkeypatch.setattr(seed, "engine", engine)
        try:
            await asyncio.gather(seed.create_tables(), seed.create_tables())

            connection = await asyncpg.connect(database_url)
            try:
                first_rows = await connection.fetch(
                    """
                    SELECT sm.id, sm.account_id, sm.role
                    FROM server_memberships AS sm
                    WHERE sm.server_id = $1 AND sm.status = 'active'
                    ORDER BY sm.account_id
                    """,
                    server_id,
                )
            finally:
                await connection.close()

            assert len(first_rows) == 3
            assert [row["role"] for row in first_rows] == ["owner", "member", "member"]
            assert first_rows[0]["account_id"] == account_ids[1]

            first_memberships = [(row["id"], row["account_id"], row["role"]) for row in first_rows]
            await seed.create_tables()

            connection = await asyncpg.connect(database_url)
            try:
                repeated_rows = await connection.fetch(
                    """
                    SELECT sm.id, sm.account_id, sm.role
                    FROM server_memberships AS sm
                    WHERE sm.server_id = $1 AND sm.status = 'active'
                    ORDER BY sm.account_id
                    """,
                    server_id,
                )
            finally:
                await connection.close()

            assert [(row["id"], row["account_id"], row["role"]) for row in repeated_rows] == first_memberships
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_legacy_backfill_blocks_ambiguous_existing_multiple_owners_without_demotion(
    monkeypatch,
):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        database_url = postgres.database_url.replace("+asyncpg", "")
        connection = await asyncpg.connect(database_url)
        try:
            server_id, _account_ids = await _insert_legacy_accounts(
                connection,
                roles=("owner", "owner"),
            )
        finally:
            await connection.close()

        engine = create_async_engine(postgres.database_url)
        monkeypatch.setattr(seed, "engine", engine)
        try:
            with pytest.raises(
                DBAPIError,
                match="LEGACY_MEMBERSHIP_MULTIPLE_ACTIVE_OWNERS",
            ):
                await seed.create_tables()

            connection = await asyncpg.connect(database_url)
            try:
                roles = await connection.fetch(
                    """
                    SELECT account_id, role
                    FROM server_memberships
                    WHERE server_id = $1
                    ORDER BY account_id
                    """,
                    server_id,
                )
            finally:
                await connection.close()

            assert [row["role"] for row in roles] == ["owner", "owner"]
        finally:
            await engine.dispose()
