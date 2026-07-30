import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import models.seed as seed
from models import Member, Server, TaskRunTemplate
from services.agent_permissions import AGENT_PERMISSION_CAPABILITIES
from tests.postgres_test_support import disposable_postgres, run_alembic


@pytest.mark.asyncio
async def test_runtime_seed_is_idempotent_and_materializes_only_missing_agent_permissions(
    monkeypatch,
):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            server = Server(id=uuid.uuid4(), name="runtime-seed-contract")
            legacy_missing = Member(
                id=uuid.uuid4(),
                server_id=server.id,
                kind="agent",
                display_name="legacy-missing-permissions",
                config={},
            )
            explicit_empty = Member(
                id=uuid.uuid4(),
                server_id=server.id,
                kind="agent",
                display_name="explicit-empty-permissions",
                config={"permissions": {}},
            )
            async with sessions.begin() as db:
                db.add_all([server, legacy_missing, explicit_empty])

            monkeypatch.setattr(seed, "engine", engine)
            await seed.create_tables()
            await seed.create_tables()

            async with sessions() as db:
                missing = await db.get(Member, legacy_missing.id)
                empty = await db.get(Member, explicit_empty.id)
                builtins = list(
                    (
                        await db.execute(
                            select(TaskRunTemplate).where(
                                TaskRunTemplate.visibility == "builtin"
                            )
                        )
                    )
                    .scalars()
                    .all()
                )

            assert set(missing.config["permissions"]) == set(AGENT_PERMISSION_CAPABILITIES)
            assert all(missing.config["permissions"].values())
            assert empty.config["permissions"] == {}
            assert {template.slug for template in builtins} == {
                "general-task-runner",
                "research-analyst",
            }
            assert all(template.server_id is None for template in builtins)
        finally:
            await engine.dispose()
