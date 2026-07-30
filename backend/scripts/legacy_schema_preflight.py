"""Read-only compatibility preflight for databases created before Alembic."""

from __future__ import annotations

import argparse
import asyncio
import os
import re
from dataclasses import dataclass

import asyncpg
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

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
# Entire tables introduced after the 0001 baseline. A stamped legacy DB has
# none of these; preflight must skip them so a legitimate legacy fingerprint
# is not rejected merely because the model added a new table post-baseline.
POST_BASELINE_TABLES = {
    "llm_run_leases",
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
POST_BASELINE_FOREIGN_KEYS = {
    ("task_run_templates", ("server_id",)),
}
BASELINE_ONLY_UNIQUE_CONSTRAINTS = {
    "uq_task_run_templates_slug": ("task_run_templates", ("slug",)),
}

_POSTGRES_DIALECT = postgresql.dialect()
_CHECK_IN_PATTERN = re.compile(
    r"^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+IN\s*\((.*)\)\s*$",
    re.DOTALL,
)
_SQL_STRING_PATTERN = re.compile(r"'(?:''|[^'])*'")
_SQL_QUOTED_TOKEN_PATTERN = re.compile(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"")
_UNQUOTED_IDENTIFIER_PATTERN = re.compile(r"[a-z_][a-z0-9_$]*")


@dataclass(frozen=True)
class ColumnDefinition:
    data_type: str
    nullable: bool
    identity_generation: str | None
    default: str | None


@dataclass(frozen=True)
class IndexDefinition:
    table_name: str
    unique: bool
    method: str
    expressions: tuple[str, ...]
    predicate: str | None


@dataclass(frozen=True)
class ForeignKeyDefinition:
    table_name: str
    columns: tuple[str, ...]
    referenced_table: str
    referenced_columns: tuple[str, ...]
    on_delete: str


@dataclass(frozen=True)
class LegacyPreflightReport:
    compatible: bool
    issues: tuple[str, ...]


def _strip_outer_parentheses(value: str) -> str:
    normalized = value.strip()
    while normalized.startswith("(") and normalized.endswith(")"):
        masked = _SQL_QUOTED_TOKEN_PATTERN.sub(
            lambda match: " " * len(match.group(0)),
            normalized,
        )
        depth = 0
        encloses_everything = True
        for index, character in enumerate(masked):
            if character == "(":
                depth += 1
            elif character == ")":
                depth -= 1
                if depth == 0 and index != len(normalized) - 1:
                    encloses_everything = False
                    break
        if not encloses_everything or depth != 0:
            break
        normalized = normalized[1:-1].strip()
    return normalized


def _protect_semantic_sql_tokens(value: str) -> tuple[str, tuple[tuple[str, str], ...]]:
    protected_tokens: list[tuple[str, str]] = []

    def replace(match: re.Match[str]) -> str:
        token = match.group(0)
        if token.startswith('"'):
            identifier = token[1:-1].replace('""', '"')
            if (
                identifier == identifier.lower()
                and _UNQUOTED_IDENTIFIER_PATTERN.fullmatch(identifier)
            ):
                return identifier

        marker = f"\x00sql_token_{len(protected_tokens)}\x00"
        protected_tokens.append((marker, token))
        return marker

    return _SQL_QUOTED_TOKEN_PATTERN.sub(replace, value), tuple(protected_tokens)


def _normalize_sql(value: str | None) -> str | None:
    if value is None:
        return None
    normalized, protected_tokens = _protect_semantic_sql_tokens(value)
    normalized = normalized.lower()
    normalized = re.sub(r"\b[a-z_][a-z0-9_]*\.", "", normalized)
    normalized = re.sub(
        r"::\s*(?:character varying|varchar|text)(?:\(\d+\))?(?:\[\])?",
        "",
        normalized,
    )
    normalized = re.sub(r"\s+", " ", normalized).strip()
    normalized = _strip_outer_parentheses(normalized)
    for marker, token in protected_tokens:
        normalized = normalized.replace(marker, token)
    return normalized


def _normalize_type(value: str) -> str:
    normalized = value.lower().strip()
    normalized = normalized.replace("character varying", "varchar")
    normalized = normalized.replace("timestamp with time zone", "timestamptz")
    return re.sub(r"\s+", " ", normalized)


def _normalize_default(value: str | None) -> str | None:
    return _normalize_sql(value)


def _expected_column_definitions() -> dict[tuple[str, str], ColumnDefinition]:
    definitions: dict[tuple[str, str], ColumnDefinition] = {}
    for table in Base.metadata.sorted_tables:
        if table.name in POST_BASELINE_TABLES:
            continue
        excluded_columns = POST_BASELINE_COLUMNS.get(table.name, set())
        for column in table.columns:
            if column.name in excluded_columns:
                continue

            identity_generation: str | None = None
            if column.identity is not None and (table.name, column.name) != (
                "messages",
                "seq",
            ):
                identity_generation = "ALWAYS" if column.identity.always else "BY DEFAULT"

            default: str | None = None
            if column.server_default is not None and not isinstance(
                column.server_default,
                sa.Identity,
            ):
                default = _normalize_default(
                    str(column.server_default.arg.compile(dialect=_POSTGRES_DIALECT))
                )

            definitions[(table.name, column.name)] = ColumnDefinition(
                data_type=_normalize_type(column.type.compile(dialect=_POSTGRES_DIALECT)),
                nullable=column.nullable,
                identity_generation=identity_generation,
                default=default,
            )
    return definitions


def _index_expression(expression: object) -> str:
    name = getattr(expression, "name", None)
    if isinstance(name, str) and name:
        return _normalize_sql(name) or ""
    compiled = str(expression.compile(dialect=_POSTGRES_DIALECT))
    return _normalize_sql(compiled) or ""


def _expected_index_definitions() -> dict[str, IndexDefinition]:
    definitions: dict[str, IndexDefinition] = {}
    for table in Base.metadata.sorted_tables:
        if table.name in POST_BASELINE_TABLES:
            continue
        for index in table.indexes:
            if not index.name or index.name in POST_BASELINE_INDEXES:
                continue
            predicate = index.dialect_options["postgresql"].get("where")
            method = index.dialect_options["postgresql"].get("using") or "btree"
            definitions[index.name] = IndexDefinition(
                table_name=table.name,
                unique=bool(index.unique),
                method=str(method).lower(),
                expressions=tuple(_index_expression(expression) for expression in index.expressions),
                predicate=_normalize_sql(
                    str(predicate.compile(dialect=_POSTGRES_DIALECT))
                    if predicate is not None
                    else None
                ),
            )
    return definitions


def _sql_string_values(value: str) -> tuple[str, ...]:
    return tuple(
        sorted(
            match.group(0)[1:-1].replace("''", "'")
            for match in _SQL_STRING_PATTERN.finditer(value)
        )
    )


def _expected_check_signature(constraint: sa.CheckConstraint) -> tuple[str, tuple[str, ...]]:
    match = _CHECK_IN_PATTERN.fullmatch(str(constraint.sqltext))
    if match is None:
        raise ValueError(f"unsupported baseline check expression: {constraint.name}")
    return match.group(1), _sql_string_values(match.group(2))


def _actual_check_signature(
    columns: tuple[str, ...],
    definition: str,
) -> tuple[str, tuple[str, ...]] | None:
    if len(columns) != 1:
        return None
    column = columns[0]
    if _UNQUOTED_IDENTIFIER_PATTERN.fullmatch(column) is None:
        return None

    normalized = _normalize_sql(definition)
    if normalized is None or not normalized.startswith("check "):
        return None
    body = _strip_outer_parentheses(normalized.removeprefix("check ").strip())
    shape = _SQL_STRING_PATTERN.sub("__sql_literal__", body)
    literal_list = r"__sql_literal__(?:\s*,\s*__sql_literal__)*"
    column_pattern = re.escape(column)
    allowed_shapes = (
        rf"{column_pattern}\s+in\s*\(\s*{literal_list}\s*\)",
        rf"{column_pattern}\s*=\s*any\s*\(\s*array\s*\[\s*{literal_list}\s*\]\s*\)",
    )
    if not any(re.fullmatch(pattern, shape) for pattern in allowed_shapes):
        return None
    return column, _sql_string_values(definition)


def _on_delete(value: str | None) -> str:
    return (value or "NO ACTION").upper().replace("_", " ")


def _expected_constraint_definitions() -> tuple[
    list[tuple[str, str, str | None, tuple[str, ...]]],
    dict[str, tuple[str, tuple[str, ...]]],
    dict[str, tuple[str, tuple[str, ...]]],
    set[ForeignKeyDefinition],
]:
    primary_and_unique: list[tuple[str, str, str | None, tuple[str, ...]]] = []
    named_uniques: dict[str, tuple[str, tuple[str, ...]]] = {}
    checks: dict[str, tuple[str, tuple[str, ...]]] = {}
    foreign_keys: set[ForeignKeyDefinition] = set()

    for table in Base.metadata.sorted_tables:
        if table.name in POST_BASELINE_TABLES:
            continue
        primary_and_unique.append(
            (
                "primary key",
                table.name,
                None,
                tuple(column.name for column in table.primary_key.columns),
            )
        )
        for constraint in table.constraints:
            if isinstance(constraint, sa.UniqueConstraint):
                if constraint.name in POST_BASELINE_CONSTRAINTS:
                    continue
                columns = tuple(column.name for column in constraint.columns)
                primary_and_unique.append(
                    ("unique constraint", table.name, constraint.name, columns)
                )
                if constraint.name:
                    named_uniques[constraint.name] = (table.name, columns)
            elif isinstance(constraint, sa.CheckConstraint):
                if not constraint.name or constraint.name in POST_BASELINE_CONSTRAINTS:
                    continue
                checks[constraint.name] = _expected_check_signature(constraint)
            elif isinstance(constraint, sa.ForeignKeyConstraint):
                columns = tuple(element.parent.name for element in constraint.elements)
                if (table.name, columns) in POST_BASELINE_FOREIGN_KEYS:
                    continue
                referenced_table = constraint.elements[0].column.table.name
                referenced_columns = tuple(element.column.name for element in constraint.elements)
                foreign_keys.add(
                    ForeignKeyDefinition(
                        table_name=table.name,
                        columns=columns,
                        referenced_table=referenced_table,
                        referenced_columns=referenced_columns,
                        on_delete=_on_delete(constraint.ondelete),
                    )
                )

    for name, definition in BASELINE_ONLY_UNIQUE_CONSTRAINTS.items():
        table_name, columns = definition
        primary_and_unique.append(("unique constraint", table_name, name, columns))
        named_uniques[name] = definition

    return primary_and_unique, named_uniques, checks, foreign_keys


async def inspect_legacy_schema(database_url: str) -> LegacyPreflightReport:
    """Read the legacy schema fingerprint without changing database state."""

    connection = await asyncpg.connect(database_url.replace("+asyncpg", ""))
    try:
        issues: list[str] = []
        if await connection.fetchval("SELECT to_regclass('alembic_version') IS NOT NULL"):
            issues.append(
                "alembic_version already exists; this is not an unversioned legacy database"
            )

        expected_columns = _expected_column_definitions()
        column_rows = await connection.fetch(
            """
            SELECT
                relation.relname AS table_name,
                attribute.attname AS column_name,
                format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
                NOT attribute.attnotnull AS nullable,
                attribute.attidentity::text AS identity_code,
                pg_get_expr(default_value.adbin, default_value.adrelid, true) AS column_default
            FROM pg_attribute AS attribute
            JOIN pg_class AS relation ON relation.oid = attribute.attrelid
            JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
            LEFT JOIN pg_attrdef AS default_value
                ON default_value.adrelid = relation.oid
               AND default_value.adnum = attribute.attnum
            WHERE namespace.nspname = current_schema()
              AND relation.relkind IN ('r', 'p')
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
            """
        )
        identity_generations = {"": None, "a": "ALWAYS", "d": "BY DEFAULT"}
        actual_columns = {
            (row["table_name"], row["column_name"]): ColumnDefinition(
                data_type=_normalize_type(row["data_type"]),
                nullable=row["nullable"],
                identity_generation=identity_generations.get(row["identity_code"]),
                default=_normalize_default(row["column_default"]),
            )
            for row in column_rows
        }
        expected_columns_by_table: dict[str, set[str]] = {}
        actual_columns_by_table: dict[str, set[str]] = {}
        for table_name, column_name in expected_columns:
            expected_columns_by_table.setdefault(table_name, set()).add(column_name)
        for table_name, column_name in actual_columns:
            actual_columns_by_table.setdefault(table_name, set()).add(column_name)

        for table_name, columns in sorted(expected_columns_by_table.items()):
            if table_name not in actual_columns_by_table:
                issues.append(f"missing required baseline table: {table_name}")
                continue
            missing_columns = sorted(columns - actual_columns_by_table[table_name])
            if missing_columns:
                issues.append(
                    f"table {table_name} is missing baseline columns: {', '.join(missing_columns)}"
                )
            unexpected_columns = sorted(actual_columns_by_table[table_name] - columns)
            if unexpected_columns:
                issues.append(
                    f"table {table_name} has unexpected non-baseline columns: "
                    f"{', '.join(unexpected_columns)}"
                )

        for key, expected in sorted(expected_columns.items()):
            actual = actual_columns.get(key)
            if actual is not None and actual != expected:
                issues.append(
                    "column definition mismatch: "
                    f"{key[0]}.{key[1]} expected={expected!r} actual={actual!r}"
                )

        expected_indexes = _expected_index_definitions()
        index_rows = await connection.fetch(
            """
            SELECT
                table_relation.relname AS table_name,
                index_relation.relname AS index_name,
                index_state.indisunique AS is_unique,
                access_method.amname AS access_method,
                ARRAY(
                    SELECT
                        pg_get_indexdef(
                            index_state.indexrelid,
                            position.position,
                            true
                        )
                        || CASE
                            WHEN (
                                index_state.indoption[position.position - 1] & 1
                            ) = 1 THEN ' DESC'
                            ELSE ''
                        END
                        || CASE
                            WHEN (
                                index_state.indoption[position.position - 1] & 1
                            ) = 1
                            AND (
                                index_state.indoption[position.position - 1] & 2
                            ) = 0 THEN ' NULLS LAST'
                            WHEN (
                                index_state.indoption[position.position - 1] & 1
                            ) = 0
                            AND (
                                index_state.indoption[position.position - 1] & 2
                            ) = 2 THEN ' NULLS FIRST'
                            ELSE ''
                        END
                    FROM generate_series(
                        1,
                        index_state.indnkeyatts
                    ) AS position(position)
                    ORDER BY position.position
                ) AS expressions,
                pg_get_expr(index_state.indpred, index_state.indrelid, true) AS predicate
            FROM pg_index AS index_state
            JOIN pg_class AS index_relation
                ON index_relation.oid = index_state.indexrelid
            JOIN pg_class AS table_relation
                ON table_relation.oid = index_state.indrelid
            JOIN pg_namespace AS namespace
                ON namespace.oid = table_relation.relnamespace
            JOIN pg_am AS access_method
                ON access_method.oid = index_relation.relam
            WHERE namespace.nspname = current_schema()
              AND NOT index_state.indisprimary
            """
        )
        actual_indexes = {
            row["index_name"]: IndexDefinition(
                table_name=row["table_name"],
                unique=row["is_unique"],
                method=row["access_method"].lower(),
                expressions=tuple(
                    _normalize_sql(expression) or "" for expression in row["expressions"]
                ),
                predicate=_normalize_sql(row["predicate"]),
            )
            for row in index_rows
        }
        missing_indexes = sorted(set(expected_indexes) - set(actual_indexes))
        if missing_indexes:
            issues.append(f"missing required baseline indexes: {', '.join(missing_indexes)}")
        for name, expected in sorted(expected_indexes.items()):
            actual = actual_indexes.get(name)
            if actual is not None and actual != expected:
                issues.append(
                    f"index definition mismatch: {name} "
                    f"expected={expected!r} actual={actual!r}"
                )
        present_post_baseline_indexes = sorted(
            POST_BASELINE_INDEXES.intersection(actual_indexes)
        )
        if present_post_baseline_indexes:
            issues.append(
                "unexpected post-baseline indexes: "
                f"{', '.join(present_post_baseline_indexes)}"
            )

        constraint_rows = await connection.fetch(
            """
            SELECT
                constraint_state.conname AS constraint_name,
                table_relation.relname AS table_name,
                constraint_state.contype::text AS constraint_type,
                ARRAY(
                    SELECT attribute.attname
                    FROM unnest(constraint_state.conkey)
                        WITH ORDINALITY AS key_column(attribute_number, position)
                    JOIN pg_attribute AS attribute
                      ON attribute.attrelid = constraint_state.conrelid
                     AND attribute.attnum = key_column.attribute_number
                    ORDER BY key_column.position
                ) AS columns,
                referenced_relation.relname AS referenced_table,
                ARRAY(
                    SELECT attribute.attname
                    FROM unnest(constraint_state.confkey)
                        WITH ORDINALITY AS key_column(attribute_number, position)
                    JOIN pg_attribute AS attribute
                      ON attribute.attrelid = constraint_state.confrelid
                     AND attribute.attnum = key_column.attribute_number
                    ORDER BY key_column.position
                ) AS referenced_columns,
                constraint_state.confdeltype::text AS delete_action,
                pg_get_constraintdef(constraint_state.oid, true) AS definition
            FROM pg_constraint AS constraint_state
            JOIN pg_class AS table_relation
                ON table_relation.oid = constraint_state.conrelid
            JOIN pg_namespace AS namespace
                ON namespace.oid = table_relation.relnamespace
            LEFT JOIN pg_class AS referenced_relation
                ON referenced_relation.oid = constraint_state.confrelid
            WHERE namespace.nspname = current_schema()
            """
        )
        actual_constraints = [
            {
                "name": row["constraint_name"],
                "table": row["table_name"],
                "kind": row["constraint_type"],
                "columns": tuple(row["columns"]),
                "referenced_table": row["referenced_table"],
                "referenced_columns": tuple(row["referenced_columns"]),
                "delete_action": row["delete_action"],
                "definition": row["definition"],
            }
            for row in constraint_rows
        ]

        required_keys, named_uniques, expected_checks, expected_foreign_keys = (
            _expected_constraint_definitions()
        )
        kind_codes = {"primary key": "p", "unique constraint": "u"}
        for kind, table_name, name, columns in required_keys:
            matches = [
                constraint
                for constraint in actual_constraints
                if constraint["table"] == table_name
                and constraint["kind"] == kind_codes[kind]
                and constraint["columns"] == columns
                and (name is None or constraint["name"] == name)
            ]
            if not matches:
                label = name or f"{table_name}({', '.join(columns)})"
                issues.append(f"{kind} definition mismatch: {label}")

        for name, (table_name, columns) in sorted(named_uniques.items()):
            same_name = [
                constraint
                for constraint in actual_constraints
                if constraint["table"] == table_name and constraint["name"] == name
            ]
            if same_name and not any(
                constraint["kind"] == "u" and constraint["columns"] == columns
                for constraint in same_name
            ):
                issues.append(f"unique constraint definition mismatch: {name}")

        actual_by_table_and_name = {
            (constraint["table"], constraint["name"]): constraint
            for constraint in actual_constraints
        }
        for name, expected_signature in sorted(expected_checks.items()):
            table_name = next(
                table.name
                for table in Base.metadata.sorted_tables
                if any(constraint.name == name for constraint in table.constraints)
            )
            actual = actual_by_table_and_name.get((table_name, name))
            if actual is None or actual["kind"] != "c":
                issues.append(f"check constraint definition mismatch: {name}")
                continue
            actual_signature = _actual_check_signature(
                actual["columns"],
                actual["definition"],
            )
            if actual_signature != expected_signature:
                issues.append(f"check constraint definition mismatch: {name}")

        delete_actions = {
            "a": "NO ACTION",
            "r": "RESTRICT",
            "c": "CASCADE",
            "n": "SET NULL",
            "d": "SET DEFAULT",
        }
        actual_foreign_keys = {
            ForeignKeyDefinition(
                table_name=constraint["table"],
                columns=constraint["columns"],
                referenced_table=constraint["referenced_table"],
                referenced_columns=constraint["referenced_columns"],
                on_delete=delete_actions.get(constraint["delete_action"], "UNKNOWN"),
            )
            for constraint in actual_constraints
            if constraint["kind"] == "f"
        }
        for expected in sorted(
            expected_foreign_keys,
            key=lambda value: (value.table_name, value.columns),
        ):
            if expected not in actual_foreign_keys:
                issues.append(
                    "foreign key definition mismatch: "
                    f"{expected.table_name}({', '.join(expected.columns)})"
                )

        actual_constraint_names = {
            constraint["name"] for constraint in actual_constraints
        }
        present_post_baseline_constraints = sorted(
            POST_BASELINE_CONSTRAINTS.intersection(actual_constraint_names)
        )
        if present_post_baseline_constraints:
            issues.append(
                "unexpected post-baseline constraints: "
                f"{', '.join(present_post_baseline_constraints)}"
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
