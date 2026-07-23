"""Alembic is the only process allowed to mutate database schema."""

from __future__ import annotations

import inspect
from pathlib import Path

from models import seed


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent


def test_runtime_seed_contains_data_changes_only():
    source = inspect.getsource(seed.create_tables).lower()
    assert "create_all" not in source
    for schema_ddl in (
        "create table",
        "alter table",
        "create index",
        "create extension",
        "drop table",
        "drop index",
    ):
        assert schema_ddl not in source


def test_compose_backends_upgrade_schema_before_starting_the_app():
    expected = "uv run alembic upgrade head && uv run uvicorn"
    for compose_file in ("docker-compose.yml", "docker-compose.prod.yml"):
        source = (PROJECT_DIR / compose_file).read_text()
        assert expected in source
