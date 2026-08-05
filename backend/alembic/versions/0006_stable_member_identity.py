"""stable member identity and Channel roster revisions

Revision ID: 0006_stable_member_identity
Revises: 0005_llm_run_lease
Create Date: 2026-08-05

This is intentionally a clean-reset migration.  The old schema encoded Human
identity as one Member per Server and used mutable display names as keys; there
is no truthful automatic backfill into the new one-Account/one-Human model.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_stable_member_identity"
down_revision: Union[str, Sequence[str], None] = "0005_llm_run_lease"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_EMPTY_IDENTITY_SQL = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM servers LIMIT 1)
       OR EXISTS (SELECT 1 FROM accounts LIMIT 1)
       OR EXISTS (SELECT 1 FROM members LIMIT 1)
       OR EXISTS (SELECT 1 FROM channels LIMIT 1)
       OR EXISTS (SELECT 1 FROM messages LIMIT 1)
    THEN
        RAISE EXCEPTION 'IDENTITY_CLEAN_RESET_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
END
$$
"""


def _require_empty_identity_data() -> None:
    op.execute(_EMPTY_IDENTITY_SQL)


def upgrade() -> None:
    _require_empty_identity_data()

    op.add_column("servers", sa.Column("server_handle", sa.String(length=5), nullable=False))
    op.create_unique_constraint("uq_servers_server_handle", "servers", ["server_handle"])
    op.create_check_constraint(
        "ck_servers_server_handle_format",
        "servers",
        "server_handle ~ '^s[0-9abcdefghjkmnpqrstvwxyz]{4}$'",
    )

    op.drop_index("idx_accounts_member", table_name="accounts")
    op.drop_constraint("accounts_member_id_fkey", "accounts", type_="foreignkey")
    op.drop_constraint("accounts_server_id_fkey", "accounts", type_="foreignkey")
    op.drop_constraint("uq_accounts_name", "accounts", type_="unique")
    op.drop_column("accounts", "member_id")
    op.drop_column("accounts", "server_id")
    op.drop_column("accounts", "name")
    op.add_column("accounts", sa.Column("auth_subject", sa.String(length=255), nullable=False))
    op.add_column("accounts", sa.Column("home_server_id", sa.UUID(), nullable=False))
    op.create_foreign_key(
        "accounts_home_server_id_fkey",
        "accounts",
        "servers",
        ["home_server_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint("uq_accounts_auth_subject", "accounts", ["auth_subject"])
    op.create_unique_constraint("uq_accounts_home_server", "accounts", ["home_server_id"])
    op.create_unique_constraint(
        "uq_accounts_id_home_server",
        "accounts",
        ["id", "home_server_id"],
    )

    op.drop_constraint("uq_members_server_display_name", "members", type_="unique")
    op.drop_index("idx_members_server", table_name="members")
    op.drop_constraint("members_server_id_fkey", "members", type_="foreignkey")
    op.alter_column("members", "server_id", new_column_name="origin_server_id")
    op.alter_column("members", "display_name", new_column_name="handle")
    op.alter_column(
        "members",
        "handle",
        existing_type=sa.String(length=255),
        type_=sa.String(length=32),
        existing_nullable=False,
    )
    op.add_column("members", sa.Column("account_id", sa.UUID(), nullable=True))
    op.add_column("members", sa.Column("handle_key", sa.String(length=128), nullable=False))
    op.add_column("members", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "members_origin_server_id_fkey",
        "members",
        "servers",
        ["origin_server_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint("uq_members_account_id_id", "members", ["account_id", "id"])
    op.create_foreign_key(
        "fk_members_account_origin_server",
        "members",
        "accounts",
        ["account_id", "origin_server_id"],
        ["id", "home_server_id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint("ck_members_type", "members", "type IN ('human', 'agent')")
    op.create_check_constraint(
        "ck_members_account_kind",
        "members",
        "(type = 'human' AND account_id IS NOT NULL) OR (type = 'agent' AND account_id IS NULL)",
    )
    op.create_check_constraint(
        "ck_members_handle_length",
        "members",
        "char_length(handle) BETWEEN 1 AND 32",
    )
    op.create_check_constraint(
        "ck_members_agent_description",
        "members",
        "type = 'agent' OR description IS NULL",
    )
    op.create_check_constraint(
        "ck_members_description_length",
        "members",
        "description IS NULL OR char_length(description) <= 200",
    )
    op.create_index("idx_members_origin_server", "members", ["origin_server_id"], unique=False)
    op.create_index(
        "uq_members_account_identity",
        "members",
        ["account_id"],
        unique=True,
        postgresql_where=sa.text("account_id IS NOT NULL"),
    )
    op.create_index(
        "uq_members_origin_active_name",
        "members",
        ["origin_server_id", "handle_key"],
        unique=True,
        postgresql_where=sa.text("type = 'human' OR (type = 'agent' AND deleted_at IS NULL)"),
    )

    op.create_foreign_key(
        "fk_server_memberships_account_member",
        "server_memberships",
        "members",
        ["account_id", "member_id"],
        ["account_id", "id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "uq_server_memberships_active_owner",
        "server_memberships",
        ["server_id"],
        unique=True,
        postgresql_where=sa.text("role = 'owner' AND status = 'active'"),
    )

    op.add_column(
        "channels",
        sa.Column("membership_revision", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    _require_empty_identity_data()

    op.drop_column("channels", "membership_revision")

    op.drop_index("uq_server_memberships_active_owner", table_name="server_memberships")
    op.drop_constraint(
        "fk_server_memberships_account_member",
        "server_memberships",
        type_="foreignkey",
    )

    op.drop_index("uq_members_origin_active_name", table_name="members")
    op.drop_index("uq_members_account_identity", table_name="members")
    op.drop_index("idx_members_origin_server", table_name="members")
    op.drop_constraint("ck_members_description_length", "members", type_="check")
    op.drop_constraint("ck_members_agent_description", "members", type_="check")
    op.drop_constraint("ck_members_handle_length", "members", type_="check")
    op.drop_constraint("ck_members_account_kind", "members", type_="check")
    op.drop_constraint("ck_members_type", "members", type_="check")
    op.drop_constraint("fk_members_account_origin_server", "members", type_="foreignkey")
    op.drop_constraint("uq_members_account_id_id", "members", type_="unique")
    op.drop_constraint("members_origin_server_id_fkey", "members", type_="foreignkey")
    op.drop_column("members", "deleted_at")
    op.drop_column("members", "handle_key")
    op.drop_column("members", "account_id")
    op.alter_column(
        "members",
        "handle",
        existing_type=sa.String(length=32),
        type_=sa.String(length=255),
        existing_nullable=False,
    )
    op.alter_column("members", "handle", new_column_name="display_name")
    op.alter_column("members", "origin_server_id", new_column_name="server_id")
    op.create_foreign_key(
        "members_server_id_fkey",
        "members",
        "servers",
        ["server_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("idx_members_server", "members", ["server_id"], unique=False)
    op.create_unique_constraint(
        "uq_members_server_display_name",
        "members",
        ["server_id", "display_name"],
    )

    op.drop_constraint("uq_accounts_id_home_server", "accounts", type_="unique")
    op.drop_constraint("uq_accounts_home_server", "accounts", type_="unique")
    op.drop_constraint("uq_accounts_auth_subject", "accounts", type_="unique")
    op.drop_constraint("accounts_home_server_id_fkey", "accounts", type_="foreignkey")
    op.drop_column("accounts", "home_server_id")
    op.drop_column("accounts", "auth_subject")
    op.add_column("accounts", sa.Column("name", sa.String(length=255), nullable=False))
    op.add_column("accounts", sa.Column("server_id", sa.UUID(), nullable=False))
    op.add_column("accounts", sa.Column("member_id", sa.UUID(), nullable=False))
    op.create_foreign_key(
        "accounts_server_id_fkey",
        "accounts",
        "servers",
        ["server_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "accounts_member_id_fkey",
        "accounts",
        "members",
        ["member_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint("uq_accounts_name", "accounts", ["name"])
    op.create_index("idx_accounts_member", "accounts", ["member_id"], unique=False)

    op.drop_constraint("ck_servers_server_handle_format", "servers", type_="check")
    op.drop_constraint("uq_servers_server_handle", "servers", type_="unique")
    op.drop_column("servers", "server_handle")
