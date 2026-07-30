import os
import subprocess
import sys
import uuid
from pathlib import Path

import asyncpg
import pytest

from tests.postgres_test_support import disposable_postgres, run_alembic

BACKEND_DIR = Path(__file__).resolve().parents[1]
PRE_TEMPLATE_TENANCY_REVISION = "0003_messages_seq_auto"


async def _insert_server(connection, *, server_id, member_id, name):
    await connection.execute(
        """
        INSERT INTO servers (id, name, created_at, updated_at)
        VALUES ($1, $2, now(), now())
        """,
        server_id,
        name,
    )
    await connection.execute(
        """
        INSERT INTO members (
            id, server_id, type, display_name, status, skills, config,
            created_at, updated_at
        )
        VALUES ($1, $2, 'human', $3, 'online', '{}'::jsonb, '{}'::jsonb, now(), now())
        """,
        member_id,
        server_id,
        f"member-{name}",
    )


async def _insert_template(
    connection,
    *,
    template_id,
    slug,
    visibility,
    created_by=None,
    server_id_marker=False,
    server_id=None,
):
    columns = ""
    values = ""
    arguments = [template_id, slug, slug, visibility, created_by]
    if server_id_marker:
        columns = ", server_id"
        values = ", $6"
        arguments.append(server_id)
    await connection.execute(
        f"""
        INSERT INTO task_run_templates (
            id, slug, name, system_instruction,
            tool_policy, skill_policy, memory_policy, output_policy,
            runtime_policy, start_policy, role_presets,
            visibility, status, created_by, created_at, updated_at
            {columns}
        )
        VALUES (
            $1, $2, $3, 'Execute the task.',
            '{{}}'::jsonb, '{{}}'::jsonb, '{{}}'::jsonb, '{{}}'::jsonb,
            '{{}}'::jsonb, '{{}}'::jsonb, '[]'::jsonb,
            $4, 'active', $5, now(), now()
            {values}
        )
        """,
        *arguments,
    )


@pytest.mark.asyncio
async def test_template_tenancy_head_enforces_scoped_uniqueness_and_nullability():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            server_a, server_b = uuid.uuid4(), uuid.uuid4()
            member_a, member_b = uuid.uuid4(), uuid.uuid4()
            await _insert_server(connection, server_id=server_a, member_id=member_a, name="a")
            await _insert_server(connection, server_id=server_b, member_id=member_b, name="b")

            indexes = {
                row["indexname"]: row["indexdef"]
                for row in await connection.fetch(
                    "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'task_run_templates'"
                )
            }
            assert "uq_task_run_templates_builtin_slug" in indexes
            assert "'builtin'::text" in indexes["uq_task_run_templates_builtin_slug"]
            assert "server_id IS NULL" in indexes["uq_task_run_templates_builtin_slug"]
            assert "uq_task_run_templates_server_slug" in indexes
            assert "server_id" in indexes["uq_task_run_templates_server_slug"]

            await _insert_template(
                connection,
                template_id=uuid.uuid4(),
                slug="same-tenant-slug",
                visibility="user",
                created_by=member_a,
                server_id_marker=True,
                server_id=server_a,
            )
            await _insert_template(
                connection,
                template_id=uuid.uuid4(),
                slug="same-tenant-slug",
                visibility="user",
                created_by=member_b,
                server_id_marker=True,
                server_id=server_b,
            )

            with pytest.raises(asyncpg.UniqueViolationError):
                await _insert_template(
                    connection,
                    template_id=uuid.uuid4(),
                    slug="same-tenant-slug",
                    visibility="server",
                    created_by=member_a,
                    server_id_marker=True,
                    server_id=server_a,
                )

            with pytest.raises(asyncpg.CheckViolationError):
                await _insert_template(
                    connection,
                    template_id=uuid.uuid4(),
                    slug="orphan-human-template",
                    visibility="user",
                    created_by=member_a,
                    server_id_marker=True,
                    server_id=None,
                )

            with pytest.raises(asyncpg.CheckViolationError):
                await _insert_template(
                    connection,
                    template_id=uuid.uuid4(),
                    slug="tenant-builtin",
                    visibility="builtin",
                    server_id_marker=True,
                    server_id=server_a,
                )
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_template_tenancy_migration_classifies_defensible_legacy_rows():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", PRE_TEMPLATE_TENANCY_REVISION)
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            server_id, member_id = uuid.uuid4(), uuid.uuid4()
            await _insert_server(connection, server_id=server_id, member_id=member_id, name="legacy")
            human_template_id = uuid.uuid4()
            await _insert_template(
                connection,
                template_id=human_template_id,
                slug="legacy-human-template",
                visibility="user",
                created_by=member_id,
            )
            await _insert_template(
                connection,
                template_id=uuid.UUID("11111111-1111-4111-8111-111111111111"),
                slug="general-task-runner",
                visibility="builtin",
            )
        finally:
            await connection.close()

        run_alembic(postgres.database_url, "upgrade", "head")
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            row = await connection.fetchrow(
                "SELECT server_id, visibility FROM task_run_templates WHERE id = $1",
                human_template_id,
            )
            assert row["server_id"] == server_id
            builtin_server_id = await connection.fetchval(
                "SELECT server_id FROM task_run_templates WHERE slug = 'general-task-runner'"
            )
            assert builtin_server_id is None
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_template_tenancy_migration_refuses_ambiguous_legacy_null_row():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", PRE_TEMPLATE_TENANCY_REVISION)
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            await _insert_template(
                connection,
                template_id=uuid.uuid4(),
                slug="ambiguous-legacy-template",
                visibility="user",
                created_by=None,
            )
        finally:
            await connection.close()

        env = {
            **os.environ,
            "DATABASE_URL": postgres.database_url,
        }
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
            cwd=BACKEND_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert result.returncode != 0
        assert "ambiguous legacy task_run_templates" in (result.stdout + result.stderr)

        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            assert await connection.fetchval("SELECT version_num FROM alembic_version") == (
                PRE_TEMPLATE_TENANCY_REVISION
            )
            assert await connection.fetchval(
                """
                SELECT count(*)
                FROM information_schema.columns
                WHERE table_name = 'task_run_templates' AND column_name = 'server_id'
                """
            ) == 0
        finally:
            await connection.close()


@pytest.mark.asyncio
async def test_template_tenancy_downgrade_fails_closed_on_cross_server_slug_collision():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            server_a, server_b = uuid.uuid4(), uuid.uuid4()
            member_a, member_b = uuid.uuid4(), uuid.uuid4()
            await _insert_server(connection, server_id=server_a, member_id=member_a, name="down-a")
            await _insert_server(connection, server_id=server_b, member_id=member_b, name="down-b")
            await _insert_template(
                connection,
                template_id=uuid.uuid4(),
                slug="cross-server-downgrade-collision",
                visibility="user",
                created_by=member_a,
                server_id_marker=True,
                server_id=server_a,
            )
            second_template_id = uuid.uuid4()
            await _insert_template(
                connection,
                template_id=second_template_id,
                slug="cross-server-downgrade-collision",
                visibility="user",
                created_by=member_b,
                server_id_marker=True,
                server_id=server_b,
            )
        finally:
            await connection.close()

        env = {**os.environ, "DATABASE_URL": postgres.database_url}
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "-c",
                "alembic.ini",
                "downgrade",
                PRE_TEMPLATE_TENANCY_REVISION,
            ],
            cwd=BACKEND_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert result.returncode != 0
        assert "TEMPLATE_TENANCY_DOWNGRADE_SLUG_COLLISION" in (
            result.stdout + result.stderr
        )

        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            assert await connection.fetchval("SELECT version_num FROM alembic_version") == (
                "0005_llm_run_lease"
            )
            assert await connection.fetchval(
                """
                SELECT count(*)
                FROM information_schema.columns
                WHERE table_name = 'task_run_templates' AND column_name = 'server_id'
                """
            ) == 1
            assert await connection.fetchval(
                "SELECT to_regclass('uq_task_run_templates_server_slug') IS NOT NULL"
            ) is True
            await connection.execute(
                "UPDATE task_run_templates SET slug = $1 WHERE id = $2",
                "cross-server-downgrade-resolved",
                second_template_id,
            )
        finally:
            await connection.close()

        run_alembic(
            postgres.database_url,
            "downgrade",
            PRE_TEMPLATE_TENANCY_REVISION,
        )
        connection = await asyncpg.connect(postgres.database_url.replace("+asyncpg", ""))
        try:
            assert await connection.fetchval("SELECT version_num FROM alembic_version") == (
                PRE_TEMPLATE_TENANCY_REVISION
            )
            assert await connection.fetchval(
                """
                SELECT count(*)
                FROM information_schema.columns
                WHERE table_name = 'task_run_templates' AND column_name = 'server_id'
                """
            ) == 0
            assert await connection.fetchval(
                """
                SELECT count(*)
                FROM pg_constraint
                WHERE conname = 'uq_task_run_templates_slug'
                  AND contype = 'u'
                """
            ) == 1
        finally:
            await connection.close()
