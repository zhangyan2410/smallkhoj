from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest
from postgres_test_support import disposable_postgres, run_alembic


def _url(value: str) -> str:
    return value.replace("postgresql+asyncpg://", "postgresql://", 1)


async def _insert_server(connection: asyncpg.Connection, handle: str) -> uuid.UUID:
    server_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    await connection.execute(
        """
        INSERT INTO servers (id, name, server_handle, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $4)
        """,
        server_id,
        f"Server {handle}",
        handle,
        now,
    )
    return server_id


async def _insert_account_and_human(
    connection: asyncpg.Connection,
    *,
    server_id: uuid.UUID,
    handle: str,
    handle_key: str,
) -> tuple[uuid.UUID, uuid.UUID]:
    account_id = uuid.uuid4()
    member_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    await connection.execute(
        """
        INSERT INTO accounts (
            id, auth_subject, home_server_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $4)
        """,
        account_id,
        f"auth:{account_id}",
        server_id,
        now,
    )
    await connection.execute(
        """
        INSERT INTO members (
            id, origin_server_id, account_id, type, handle, handle_key,
            status, skills, config, created_at, updated_at
        ) VALUES ($1, $2, $3, 'human', $4, $5, 'online', '[]', '{}', $6, $6)
        """,
        member_id,
        server_id,
        account_id,
        handle,
        handle_key,
        now,
    )
    return account_id, member_id


async def _insert_agent(
    connection: asyncpg.Connection,
    *,
    server_id: uuid.UUID,
    handle: str,
    handle_key: str,
    deleted: bool = False,
) -> uuid.UUID:
    member_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    await connection.execute(
        """
        INSERT INTO members (
            id, origin_server_id, account_id, type, handle, handle_key,
            status, skills, config, deleted_at, created_at, updated_at
        ) VALUES ($1, $2, NULL, 'agent', $3, $4, $5, '[]', '{}', $6, $7, $7)
        """,
        member_id,
        server_id,
        handle,
        handle_key,
        "deleted" if deleted else "offline",
        now if deleted else None,
        now,
    )
    return member_id


@pytest.mark.asyncio
async def test_origin_name_namespace_and_agent_tombstone_rules():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        connection = await asyncpg.connect(_url(postgres.database_url))
        try:
            first = await _insert_server(connection, "s7k2m")
            second = await _insert_server(connection, "s9abc")
            await _insert_account_and_human(
                connection,
                server_id=first,
                handle="Ean",
                handle_key="ean",
            )

            with pytest.raises(asyncpg.UniqueViolationError) as human_agent_collision:
                await _insert_agent(connection, server_id=first, handle="ean", handle_key="ean")
            assert human_agent_collision.value.constraint_name == "uq_members_origin_active_name"

            await _insert_agent(connection, server_id=second, handle="ean", handle_key="ean")

            old_agent = await _insert_agent(connection, server_id=first, handle="张翰", handle_key="张翰")
            with pytest.raises(asyncpg.UniqueViolationError):
                await _insert_agent(connection, server_id=first, handle="张翰", handle_key="张翰")
            await connection.execute(
                "UPDATE members SET deleted_at = now(), status = 'deleted' WHERE id = $1",
                old_agent,
            )
            new_agent = await _insert_agent(connection, server_id=first, handle="张翰", handle_key="张翰")
            assert new_agent != old_agent

            human_id = await connection.fetchval(
                "SELECT id FROM members WHERE origin_server_id = $1 AND type = 'human'",
                first,
            )
            await connection.execute(
                "UPDATE members SET deleted_at = now(), status = 'deleted' WHERE id = $1",
                human_id,
            )
            with pytest.raises(asyncpg.UniqueViolationError):
                await _insert_agent(connection, server_id=first, handle="EAN", handle_key="ean")
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_database_enforces_human_origin_and_server_membership_identity():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        connection = await asyncpg.connect(_url(postgres.database_url))
        try:
            home = await _insert_server(connection, "s1111")
            foreign = await _insert_server(connection, "s2222")
            wrong_home = await _insert_server(connection, "s4444")
            account_id, human_id = await _insert_account_and_human(
                connection,
                server_id=home,
                handle="研发-1",
                handle_key="研发-1",
            )
            agent_id = await _insert_agent(
                connection,
                server_id=home,
                handle="helper",
                handle_key="helper",
            )
            now = datetime.now(timezone.utc)
            wrong_origin_account = uuid.uuid4()
            await connection.execute(
                """
                INSERT INTO accounts (
                    id, auth_subject, home_server_id, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $4)
                """,
                wrong_origin_account,
                f"auth:{wrong_origin_account}",
                wrong_home,
                now,
            )

            with pytest.raises(asyncpg.ForeignKeyViolationError):
                await connection.execute(
                    """
                    INSERT INTO members (
                        id, origin_server_id, account_id, type, handle, handle_key,
                        status, skills, config, created_at, updated_at
                    ) VALUES ($1, $2, $3, 'human', 'wrong', 'wrong', 'online', '[]', '{}', $4, $4)
                    """,
                    uuid.uuid4(),
                    foreign,
                    wrong_origin_account,
                    now,
                )

            await connection.execute(
                """
                INSERT INTO server_memberships (
                    id, server_id, account_id, member_id, role, status, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, 'member', 'active', $5, $5)
                """,
                uuid.uuid4(),
                foreign,
                account_id,
                human_id,
                now,
            )
            with pytest.raises(asyncpg.ForeignKeyViolationError) as agent_membership:
                await connection.execute(
                    """
                    INSERT INTO server_memberships (
                        id, server_id, account_id, member_id, role, status, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, 'member', 'active', $5, $5)
                    """,
                    uuid.uuid4(),
                    home,
                    account_id,
                    agent_id,
                    now,
                )
            assert agent_membership.value.constraint_name == "fk_server_memberships_account_member"
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_concurrent_same_name_insert_is_decided_by_named_unique_index():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        setup = await asyncpg.connect(_url(postgres.database_url))
        try:
            server_id = await _insert_server(setup, "s3333")
        finally:
            await setup.close()

        ready = asyncio.Event()

        async def insert_agent(wait_for_peer: bool) -> str:
            connection = await asyncpg.connect(_url(postgres.database_url))
            transaction = connection.transaction()
            await transaction.start()
            try:
                if wait_for_peer:
                    await ready.wait()
                else:
                    ready.set()
                await _insert_agent(
                    connection,
                    server_id=server_id,
                    handle="concurrent",
                    handle_key="concurrent",
                )
                await transaction.commit()
                return "inserted"
            except asyncpg.UniqueViolationError as error:
                await transaction.rollback()
                assert error.constraint_name == "uq_members_origin_active_name"
                return "conflict"
            finally:
                await connection.close()

        results = await asyncio.gather(insert_agent(False), insert_agent(True))
        assert sorted(results) == ["conflict", "inserted"]
