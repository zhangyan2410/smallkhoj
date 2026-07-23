"""Read-only application schema revision guard."""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text


_BACKEND_DIR = Path(__file__).resolve().parents[1]


class SchemaReadinessError(RuntimeError):
    """The database revision is not safe for this application build."""


async def assert_schema_at_head(db) -> None:
    """Refuse application startup unless the DB reports this checkout's head."""

    alembic_config = Config(str(_BACKEND_DIR / "alembic.ini"))
    expected_heads = set(ScriptDirectory.from_config(alembic_config).get_heads())
    if len(expected_heads) != 1:
        raise SchemaReadinessError(
            f"application requires one Alembic head, found {sorted(expected_heads)}"
        )

    version_table_exists = bool(
        (
            await db.execute(
                text("SELECT to_regclass('alembic_version') IS NOT NULL")
            )
        ).scalar_one()
    )
    migration_hint = "cd backend && uv run alembic upgrade head"
    if not version_table_exists:
        raise SchemaReadinessError(
            "database has no Alembic revision; run the legacy preflight when "
            f"adopting an existing database, otherwise run `{migration_hint}`"
        )

    current_heads = set(
        (
            await db.execute(text("SELECT version_num FROM alembic_version"))
        ).scalars().all()
    )
    if current_heads != expected_heads:
        raise SchemaReadinessError(
            "database revision is not ready for this application build: "
            f"current={sorted(current_heads)}, expected={sorted(expected_heads)}; "
            f"run `{migration_hint}`"
        )
