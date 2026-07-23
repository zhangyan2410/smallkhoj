"""Read-only compatibility preflight for databases created before Alembic."""

from __future__ import annotations

import argparse
import asyncio
import os
from dataclasses import dataclass

import asyncpg

import models.slock  # noqa: F401 - register the complete schema metadata
from models import Base

BASELINE_REVISION = "77b8b147f689"

# ``Base.metadata`` describes the checkout's terminal schema, while this
# preflight fingerprints the historical 0001 baseline that an operator may
# explicitly stamp.  Every post-baseline schema revision must record its new
# objects here so a legitimate legacy DB is not rejected merely because the
# application model advanced.
POST_BASELINE_COLUMNS = {
    "task_run_templates": {"server_id"},
}
POST_BASELINE_INDEXES = {
    "idx_task_run_templates_server",
    "uq_task_run_templates_builtin_slug",
    "uq_task_run_templates_server_slug",
}
POST_BASELINE_CONSTRAINTS = {
    "ck_task_run_templates_tenant_scope",
    "fk_task_run_templates_server_id",
}
BASELINE_ONLY_CONSTRAINTS = {
    "uq_task_run_templates_slug",
}


@dataclass(frozen=True)
class LegacyPreflightReport:
    compatible: bool
    issues: tuple[str, ...]


async def inspect_legacy_schema(database_url: str) -> LegacyPreflightReport:
    """Read the legacy schema fingerprint without changing database state."""

    connection = await asyncpg.connect(database_url.replace("+asyncpg", ""))
    try:
        issues: list[str] = []
        if await connection.fetchval("SELECT to_regclass('alembic_version') IS NOT NULL"):
            issues.append(
                "alembic_version already exists; this is not an unversioned legacy database"
            )

        rows = await connection.fetch(
            """
            SELECT table_name, column_name, is_identity
            FROM information_schema.columns
            WHERE table_schema = current_schema()
            """
        )
        actual_columns: dict[str, set[str]] = {}
        identity_columns: dict[tuple[str, str], str] = {}
        for row in rows:
            actual_columns.setdefault(row["table_name"], set()).add(row["column_name"])
            identity_columns[(row["table_name"], row["column_name"])] = row["is_identity"]

        required_columns = {
            table.name: (
                {column.name for column in table.columns}
                - POST_BASELINE_COLUMNS.get(table.name, set())
            )
            for table in Base.metadata.sorted_tables
        }
        for table_name, columns in sorted(required_columns.items()):
            if table_name not in actual_columns:
                issues.append(f"missing required baseline table: {table_name}")
                continue
            missing_columns = sorted(columns - actual_columns[table_name])
            if missing_columns:
                issues.append(
                    f"table {table_name} is missing baseline columns: {', '.join(missing_columns)}"
                )

        # The baseline predates the identity revisions.  An identity here means
        # this DB is neither the baseline legacy state nor safe to stamp as such.
        if identity_columns.get(("messages", "seq")) not in {None, "NO"}:
            issues.append("messages.seq is already an identity column; refusing baseline stamp")

        actual_indexes = {
            row["indexname"]
            for row in await connection.fetch(
                "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()"
            )
        }
        required_indexes = {
            index.name
            for table in Base.metadata.sorted_tables
            for index in table.indexes
            if index.name
        } - POST_BASELINE_INDEXES
        missing_indexes = sorted(required_indexes - actual_indexes)
        if missing_indexes:
            issues.append(f"missing required baseline indexes: {', '.join(missing_indexes)}")

        actual_constraints = {
            row["conname"]
            for row in await connection.fetch(
                """
                SELECT conname
                FROM pg_constraint
                WHERE connamespace = current_schema()::regnamespace
                """
            )
        }
        required_constraints = (
            {
                constraint.name
                for table in Base.metadata.sorted_tables
                for constraint in table.constraints
                if constraint.name
            }
            - POST_BASELINE_CONSTRAINTS
        ) | BASELINE_ONLY_CONSTRAINTS
        missing_constraints = sorted(required_constraints - actual_constraints)
        if missing_constraints:
            issues.append(
                f"missing required baseline constraints: {', '.join(missing_constraints)}"
            )

        return LegacyPreflightReport(compatible=not issues, issues=tuple(issues))
    finally:
        await connection.close()


async def _run(database_url: str) -> int:
    report = await inspect_legacy_schema(database_url)
    if not report.compatible:
        print("Legacy schema is NOT compatible with the Alembic baseline:")
        for issue in report.issues:
            print(f"- {issue}")
        print("No database changes were made.")
        return 2

    print("Legacy schema matches the read-only baseline fingerprint.")
    print("No database changes were made. After reviewing this result, run:")
    print(f"  uv run alembic stamp {BASELINE_REVISION}")
    print("  uv run alembic upgrade head")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="explicit target URL (defaults to DATABASE_URL)",
    )
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    return asyncio.run(_run(args.database_url))


if __name__ == "__main__":
    raise SystemExit(main())
