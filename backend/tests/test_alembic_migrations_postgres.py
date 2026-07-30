"""Real PostgreSQL acceptance tests for Alembic schema transitions."""

from __future__ import annotations

import asyncio
import re
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest
from postgres_test_support import disposable_postgres, run_alembic
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from scripts.legacy_schema_preflight import inspect_legacy_schema
from services.schema_readiness import SchemaReadinessError, assert_schema_at_head

BASELINE_REVISION = "77b8b147f689"
IDENTITY_REVISION = "0002_messages_seq"


async def _seed_message_context(connection: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID]:
    server_id = uuid.uuid4()
    member_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    await connection.execute(
        "INSERT INTO servers (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)",
        server_id,
        "migration-test-server",
        now,
    )
    await connection.execute(
        """
        INSERT INTO members (
            id, server_id, type, display_name, status, skills, config, created_at, updated_at
        ) VALUES ($1, $2, 'human', $3, 'active', '[]'::jsonb, '{}'::jsonb, $4, $4)
        """,
        member_id,
        server_id,
        f"migration-member-{member_id.hex[:8]}",
        now,
    )
    await connection.execute(
        """
        INSERT INTO channels (id, server_id, name, type, creator_id, created_at, updated_at)
        VALUES ($1, $2, $3, 'public', $4, $5, $5)
        """,
        channel_id,
        server_id,
        f"migration-channel-{channel_id.hex[:8]}",
        member_id,
        now,
    )
    return channel_id, member_id


async def _insert_message(
    connection: asyncpg.Connection,
    channel_id: uuid.UUID,
    member_id: uuid.UUID,
    *,
    seq: int | None,
) -> int:
    message_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    if seq is None:
        return await connection.fetchval(
            """
            INSERT INTO messages (
                id, short_id, channel_id, sender_id, content, channel_type,
                mentions, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, 'migration test', 'channel', '{}', $5, $5)
            RETURNING seq
            """,
            message_id,
            message_id.hex[:12],
            channel_id,
            member_id,
            now,
        )
    return await connection.fetchval(
        """
        INSERT INTO messages (
            id, short_id, channel_id, sender_id, content, channel_type,
            mentions, seq, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'migration test', 'channel', '{}', $5, $6, $6)
        RETURNING seq
        """,
        message_id,
        message_id.hex[:12],
        channel_id,
        member_id,
        seq,
        now,
    )


@pytest.mark.asyncio
async def test_fresh_database_upgrades_to_head():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            revision = await connection.fetchval("SELECT version_num FROM alembic_version")
            assert revision
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_schema_readiness_rejects_missing_and_behind_revisions_then_accepts_head():
    async with disposable_postgres() as postgres:
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with sessions() as db:
                with pytest.raises(SchemaReadinessError, match="alembic upgrade head"):
                    await assert_schema_at_head(db)

            run_alembic(postgres.database_url, "upgrade", BASELINE_REVISION)
            async with sessions() as db:
                with pytest.raises(SchemaReadinessError, match="alembic upgrade head"):
                    await assert_schema_at_head(db)

            run_alembic(postgres.database_url, "upgrade", "head")
            async with sessions() as db:
                await assert_schema_at_head(db)
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_compatible_legacy_database_preflights_then_stamps_baseline_only():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", BASELINE_REVISION)
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            await connection.execute("DROP TABLE alembic_version")
        finally:
            await connection.close()

        report = await inspect_legacy_schema(postgres.database_url)
        assert report.compatible, "\n".join(report.issues)
        assert report.issues == ()

        run_alembic(postgres.database_url, "stamp", BASELINE_REVISION)
        run_alembic(postgres.database_url, "upgrade", "head")
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            revision = await connection.fetchval("SELECT version_num FROM alembic_version")
            assert revision == "0005_llm_run_lease"
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_legacy_preflight_rejects_case_changed_quoted_default_literal():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", BASELINE_REVISION)
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            await connection.execute("DROP TABLE alembic_version")
            await connection.execute(
                "ALTER TABLE memory_proposals ALTER COLUMN status SET DEFAULT 'OPEN'"
            )
        finally:
            await connection.close()

        report = await inspect_legacy_schema(postgres.database_url)
        assert not report.compatible
        assert any(
            "column definition mismatch: memory_proposals.status" in issue
            for issue in report.issues
        )

        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            assert await connection.fetchval("SELECT to_regclass('public.alembic_version')") is None
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_legacy_preflight_rejects_boolean_inversion_around_check():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", BASELINE_REVISION)
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            await connection.execute("DROP TABLE alembic_version")
            await connection.execute(
                """
                ALTER TABLE server_memberships
                DROP CONSTRAINT ck_server_memberships_role
                """
            )
            await connection.execute(
                """
                ALTER TABLE server_memberships
                ADD CONSTRAINT ck_server_memberships_role
                CHECK ((role IN ('owner', 'admin', 'member')) = FALSE)
                """
            )
        finally:
            await connection.close()

        report = await inspect_legacy_schema(postgres.database_url)
        assert not report.compatible
        assert "check constraint definition mismatch: ck_server_memberships_role" in report.issues

        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            assert await connection.fetchval("SELECT to_regclass('public.alembic_version')") is None
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_legacy_preflight_rejects_schema_drift_without_writing_revision_state():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", BASELINE_REVISION)
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            await connection.execute("DROP TABLE alembic_version")
            await connection.execute("DROP TABLE saved_items")
        finally:
            await connection.close()

        report = await inspect_legacy_schema(postgres.database_url)
        assert not report.compatible
        assert any("saved_items" in issue for issue in report.issues)

        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            assert await connection.fetchval("SELECT to_regclass('public.alembic_version')") is None
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_legacy_preflight_rejects_same_name_definition_drift():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", BASELINE_REVISION)
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            await connection.execute("DROP TABLE alembic_version")
            await connection.execute(
                "ALTER TABLE saved_items ALTER COLUMN item_type DROP NOT NULL"
            )
            await connection.execute(
                "ALTER TABLE saved_items ALTER COLUMN item_type TYPE varchar(40)"
            )
            await connection.execute(
                "ALTER TABLE channel_members ALTER COLUMN last_read_seq SET DEFAULT 7"
            )
            await connection.execute(
                "ALTER TABLE task_run_templates ADD COLUMN server_id uuid"
            )
            await connection.execute("DROP INDEX idx_saved_items_item")
            await connection.execute(
                "CREATE INDEX idx_saved_items_item ON saved_items (item_id, item_type)"
            )
            await connection.execute(
                "ALTER TABLE saved_items DROP CONSTRAINT uq_saved_items_account_item"
            )
            await connection.execute(
                """
                ALTER TABLE saved_items
                ADD CONSTRAINT uq_saved_items_account_item
                UNIQUE (server_id, item_type, item_id)
                """
            )
            account_fk_name = await connection.fetchval(
                """
                SELECT constraint_name
                FROM information_schema.key_column_usage
                WHERE table_schema = current_schema()
                  AND table_name = 'saved_items'
                  AND column_name = 'account_id'
                  AND position_in_unique_constraint IS NOT NULL
                """
            )
            assert account_fk_name and re.fullmatch(r"[a-z0-9_]+", account_fk_name)
            await connection.execute(
                f'ALTER TABLE saved_items DROP CONSTRAINT "{account_fk_name}"'
            )
            await connection.execute(
                f"""
                ALTER TABLE saved_items
                ADD CONSTRAINT "{account_fk_name}"
                FOREIGN KEY (account_id) REFERENCES servers(id) ON DELETE CASCADE
                """
            )
            await connection.execute(
                "ALTER TABLE saved_items DROP CONSTRAINT saved_items_pkey"
            )
            await connection.execute(
                """
                ALTER TABLE saved_items
                ADD CONSTRAINT saved_items_pkey PRIMARY KEY (id, server_id)
                """
            )
            await connection.execute(
                """
                ALTER TABLE server_memberships
                DROP CONSTRAINT ck_server_memberships_role
                """
            )
            await connection.execute(
                """
                ALTER TABLE server_memberships
                ADD CONSTRAINT ck_server_memberships_role
                CHECK (role IN ('admin', 'member'))
                """
            )
        finally:
            await connection.close()

        report = await inspect_legacy_schema(postgres.database_url)
        assert not report.compatible
        assert any("column definition mismatch" in issue for issue in report.issues)
        assert any("unexpected non-baseline columns" in issue for issue in report.issues)
        assert any("index definition mismatch" in issue for issue in report.issues)
        assert any("primary key definition mismatch" in issue for issue in report.issues)
        assert any("unique constraint definition mismatch" in issue for issue in report.issues)
        assert any("check constraint definition mismatch" in issue for issue in report.issues)
        assert any("foreign key definition mismatch" in issue for issue in report.issues)

        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            assert await connection.fetchval("SELECT to_regclass('public.alembic_version')") is None
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_identity_migration_starts_above_historical_message_seq():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", BASELINE_REVISION)
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            channel_id, member_id = await _seed_message_context(connection)
            for seq in (1, 2, 3):
                await _insert_message(connection, channel_id, member_id, seq=seq)
        finally:
            await connection.close()

        run_alembic(postgres.database_url, "upgrade", IDENTITY_REVISION)
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            generated = await _insert_message(connection, channel_id, member_id, seq=None)
            assert generated > 3
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_head_reconciles_explicit_transition_writes_before_automatic_only_writers():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", BASELINE_REVISION)
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            channel_id, member_id = await _seed_message_context(connection)
            await _insert_message(connection, channel_id, member_id, seq=1)
        finally:
            await connection.close()

        run_alembic(postgres.database_url, "upgrade", IDENTITY_REVISION)
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            await _insert_message(connection, channel_id, member_id, seq=100)
        finally:
            await connection.close()

        run_alembic(postgres.database_url, "upgrade", "head")
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            generated = await _insert_message(connection, channel_id, member_id, seq=None)
            assert generated > 100
            with pytest.raises(asyncpg.GeneratedAlwaysError):
                await _insert_message(connection, channel_id, member_id, seq=101)
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_head_allocates_unique_message_seq_under_concurrency():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            channel_id, member_id = await _seed_message_context(connection)
        finally:
            await connection.close()

        async def insert_one() -> int:
            worker = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
            try:
                return await _insert_message(worker, channel_id, member_id, seq=None)
            finally:
                await worker.close()

        generated = await asyncio.gather(*(insert_one() for _ in range(20)))
        assert len(generated) == len(set(generated)) == 20
