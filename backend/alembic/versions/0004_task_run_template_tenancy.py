"""scope TaskRun templates to a Server while preserving trusted builtins

Revision ID: 0004_template_tenancy
Revises: 0003_messages_seq_auto
Create Date: 2026-07-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_template_tenancy"
down_revision: Union[str, Sequence[str], None] = "0003_messages_seq_auto"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "task_run_templates",
        sa.Column("server_id", sa.UUID(as_uuid=True), nullable=True),
    )

    # Only repository-shipped builtin identities and human templates whose
    # creator still proves a Server have defensible legacy provenance.  Abort
    # the whole transactional migration for anything else.
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM task_run_templates AS template
                LEFT JOIN members AS creator ON creator.id = template.created_by
                WHERE
                    (
                        template.visibility = 'builtin'
                        AND NOT (
                            (
                                template.id = '11111111-1111-4111-8111-111111111111'::uuid
                                AND template.slug = 'general-task-runner'
                                AND template.created_by IS NULL
                            )
                            OR (
                                template.id = '22222222-2222-4222-8222-222222222222'::uuid
                                AND template.slug = 'research-analyst'
                                AND template.created_by IS NULL
                            )
                        )
                    )
                    OR (
                        template.visibility IN ('server', 'user')
                        AND creator.id IS NULL
                    )
            ) THEN
                RAISE EXCEPTION
                    'ambiguous legacy task_run_templates rows require explicit operator classification';
            END IF;
        END
        $$;
    """)

    op.execute("""
        UPDATE task_run_templates AS template
        SET server_id = creator.server_id
        FROM members AS creator
        WHERE template.created_by = creator.id
          AND template.visibility IN ('server', 'user');
    """)

    op.drop_constraint(
        "uq_task_run_templates_slug",
        "task_run_templates",
        type_="unique",
    )
    op.create_foreign_key(
        "fk_task_run_templates_server_id",
        "task_run_templates",
        "servers",
        ["server_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "ck_task_run_templates_tenant_scope",
        "task_run_templates",
        "(visibility = 'builtin' AND server_id IS NULL) OR "
        "(visibility IN ('server', 'user') AND server_id IS NOT NULL)",
    )
    op.create_index(
        "idx_task_run_templates_server",
        "task_run_templates",
        ["server_id", "status"],
        unique=False,
    )
    op.create_index(
        "uq_task_run_templates_builtin_slug",
        "task_run_templates",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("visibility = 'builtin' AND server_id IS NULL"),
    )
    op.create_index(
        "uq_task_run_templates_server_slug",
        "task_run_templates",
        ["server_id", "slug"],
        unique=True,
        postgresql_where=sa.text("server_id IS NOT NULL"),
    )


def downgrade() -> None:
    # The pre-0004 schema can represent only one row per slug globally.  New
    # tenant-scoped duplicates are valid, so refuse before changing any DDL and
    # require an operator to make the data representable without guessing which
    # tenant should lose or rename a template.
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM task_run_templates
                GROUP BY slug
                HAVING COUNT(*) > 1
            ) THEN
                RAISE EXCEPTION
                    'TEMPLATE_TENANCY_DOWNGRADE_SLUG_COLLISION: '
                    'duplicate template slugs must be explicitly renamed or merged '
                    'before downgrading to 0003';
            END IF;
        END
        $$;
    """)

    op.drop_index(
        "uq_task_run_templates_server_slug",
        table_name="task_run_templates",
    )
    op.drop_index(
        "uq_task_run_templates_builtin_slug",
        table_name="task_run_templates",
    )
    op.drop_index("idx_task_run_templates_server", table_name="task_run_templates")
    op.drop_constraint(
        "ck_task_run_templates_tenant_scope",
        "task_run_templates",
        type_="check",
    )
    op.drop_constraint(
        "fk_task_run_templates_server_id",
        "task_run_templates",
        type_="foreignkey",
    )
    op.create_unique_constraint(
        "uq_task_run_templates_slug",
        "task_run_templates",
        ["slug"],
    )
    op.drop_column("task_run_templates", "server_id")
