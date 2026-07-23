"""Safety helpers for destructive PostgreSQL migration tests.

These helpers deliberately have no localhost/default fallback.  Migration tests
only run when the caller supplies an explicit admin URL and an explicitly named
disposable database URL template.  Every test gets a new database and the
database is dropped in ``finally``.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import SplitResult, urlsplit, urlunsplit

import asyncpg
import pytest


ADMIN_URL_ENV = "SMALLKHOJ_MIGRATION_TEST_ADMIN_URL"
DATABASE_URL_ENV = "SMALLKHOJ_MIGRATION_TEST_DATABASE_URL"
_SAFE_DATABASE_MARKERS = ("test", "audit", "remediation", "disposable")
_SAFE_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
_BACKEND_DIR = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class DisposablePostgres:
    admin_url: str
    database_url: str
    database_name: str


def _asyncpg_url(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


def _alembic_url(url: str) -> str:
    if url.startswith("postgresql+asyncpg://"):
        return url
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


def _database_name(parts: SplitResult) -> str:
    return parts.path.removeprefix("/")


def _load_explicit_urls() -> tuple[str, str, SplitResult, SplitResult]:
    admin_url = os.environ.get(ADMIN_URL_ENV)
    database_url = os.environ.get(DATABASE_URL_ENV)
    if not admin_url or not database_url:
        pytest.skip(
            "destructive migration test requires explicit "
            f"{ADMIN_URL_ENV} and {DATABASE_URL_ENV}"
        )

    admin_parts = urlsplit(admin_url)
    database_parts = urlsplit(database_url)
    supported_schemes = {"postgresql", "postgresql+asyncpg"}
    if admin_parts.scheme not in supported_schemes or database_parts.scheme not in supported_schemes:
        pytest.fail("migration test URLs must use postgresql[+asyncpg]://")

    same_server = (
        admin_parts.hostname,
        admin_parts.port or 5432,
        admin_parts.username,
    ) == (
        database_parts.hostname,
        database_parts.port or 5432,
        database_parts.username,
    )
    if not same_server:
        pytest.fail("admin and disposable database URLs must target the same PostgreSQL server")

    admin_database = _database_name(admin_parts)
    template_database = _database_name(database_parts)
    if not template_database or template_database == admin_database:
        pytest.fail("disposable database URL must name a non-admin database template")
    if not any(marker in template_database.lower() for marker in _SAFE_DATABASE_MARKERS):
        pytest.fail(
            "refusing destructive migration test: disposable database name must contain "
            f"one of {_SAFE_DATABASE_MARKERS}"
        )

    return admin_url, database_url, admin_parts, database_parts


def _with_database(url_parts: SplitResult, database_name: str) -> str:
    return urlunsplit(url_parts._replace(path=f"/{database_name}"))


@asynccontextmanager
async def disposable_postgres():
    """Create and eventually remove one uniquely named PostgreSQL database."""

    admin_url, _, _, database_parts = _load_explicit_urls()
    prefix = _database_name(database_parts).lower()
    prefix = re.sub(r"[^a-z0-9_]", "_", prefix).strip("_")[:44]
    database_name = f"{prefix}_{uuid.uuid4().hex[:12]}"
    if not _SAFE_IDENTIFIER.fullmatch(database_name):
        pytest.fail(f"unsafe generated database identifier: {database_name!r}")

    admin_connection = await asyncpg.connect(_asyncpg_url(admin_url))
    try:
        await admin_connection.execute(f'CREATE DATABASE "{database_name}"')
    finally:
        await admin_connection.close()

    database_url = _with_database(database_parts, database_name)
    try:
        yield DisposablePostgres(
            admin_url=admin_url,
            database_url=database_url,
            database_name=database_name,
        )
    finally:
        admin_connection = await asyncpg.connect(_asyncpg_url(admin_url))
        try:
            await admin_connection.execute(
                """
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = $1 AND pid <> pg_backend_pid()
                """,
                database_name,
            )
            await admin_connection.execute(f'DROP DATABASE IF EXISTS "{database_name}"')
        finally:
            await admin_connection.close()


def run_alembic(database_url: str, *arguments: str, timeout_seconds: int = 60) -> None:
    """Run the repository's actual Alembic environment against a disposable DB."""

    env = os.environ.copy()
    env["DATABASE_URL"] = _alembic_url(database_url)
    completed = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", *arguments],
        cwd=_BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )
    if completed.returncode != 0:
        pytest.fail(
            "Alembic command failed\n"
            f"command: {' '.join(arguments)}\n"
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )

