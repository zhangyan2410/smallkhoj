"""durable capacity lease for built-in Pi LLM runs

Revision ID: 0005_llm_run_lease
Revises: 0004_template_tenancy
Create Date: 2026-07-29

Adds the ``llm_run_leases`` table that serializes concurrent built-in Pi
runtime turns against the shared backend MiniMax supply. One row per run_id;
status moves waiting -> active -> released/expired/failed. See
backend/services/llm_run_leases.py for the state machine and invariants.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_llm_run_lease"
down_revision: Union[str, Sequence[str], None] = "0004_template_tenancy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "llm_run_leases",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("run_id", sa.String(length=120), nullable=False),
        sa.Column("server_id", sa.UUID(), nullable=False),
        sa.Column("computer_id", sa.UUID(), nullable=False),
        sa.Column("agent_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("failure_code", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["agent_id"], ["members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["computer_id"], ["computers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", name="uq_llm_run_leases_run_id"),
        sa.CheckConstraint(
            "status IN ('waiting', 'active', 'released', 'expired', 'failed')",
            name="ck_llm_run_leases_status",
        ),
    )
    op.create_index(
        "idx_llm_run_leases_status_expiry",
        "llm_run_leases",
        ["status", "expires_at"],
        unique=False,
    )
    op.create_index(
        "idx_llm_run_leases_server_created",
        "llm_run_leases",
        ["server_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_llm_run_leases_server_created", table_name="llm_run_leases")
    op.drop_index("idx_llm_run_leases_status_expiry", table_name="llm_run_leases")
    op.drop_table("llm_run_leases")
