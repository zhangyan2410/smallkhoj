"""Slock data models — Phase 1 core tables."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


def _utcnow():
    return datetime.now(timezone.utc)


# ── Servers ──────────────────────────────────────────────────

class Server(Base):
    __tablename__ = "servers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    members = relationship("Member", back_populates="server", lazy="selectin")
    channels = relationship("Channel", back_populates="server", lazy="selectin")
    computers = relationship("Computer", back_populates="server", lazy="selectin")
    activity_logs = relationship("ActivityLog", back_populates="server", lazy="selectin")
    files = relationship("FileEntry", back_populates="server", lazy="selectin")
    reminders = relationship("Reminder", back_populates="server", lazy="selectin")
    api_keys = relationship("ApiKey", back_populates="server", lazy="selectin")
    saved_items = relationship("SavedItem", back_populates="server", lazy="selectin")


# ── Accounts ─────────────────────────────────────────────────

class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("name", name="uq_accounts_name"),
        Index("idx_accounts_member", "member_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    session_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server")
    member = relationship("Member")


class ServerMembership(Base):
    __tablename__ = "server_memberships"
    __table_args__ = (
        UniqueConstraint("server_id", "account_id", name="uq_server_memberships_server_account"),
        Index("idx_server_memberships_account", "account_id", "status"),
        Index("idx_server_memberships_server", "server_id", "status"),
        CheckConstraint("role IN ('owner', 'admin', 'member')", name="ck_server_memberships_role"),
        CheckConstraint("status IN ('active', 'invited', 'disabled')", name="ck_server_memberships_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="member")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server")
    account = relationship("Account")
    member = relationship("Member")


class ServerInvite(Base):
    __tablename__ = "server_invites"
    __table_args__ = (
        Index("idx_server_invites_token_hash", "token_hash", unique=True),
        Index("idx_server_invites_server", "server_id", "revoked_at", "expires_at"),
        CheckConstraint("role IN ('admin', 'member')", name="ck_server_invites_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="member")
    channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    invited_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server")
    channel = relationship("Channel")
    accepted_account = relationship("Account", foreign_keys=[accepted_account_id])
    creator = relationship("Member", foreign_keys=[created_by])


# ── Members ──────────────────────────────────────────────────

class Member(Base):
    __tablename__ = "members"
    __table_args__ = (
        UniqueConstraint("server_id", "display_name", name="uq_members_server_display_name"),
        Index("idx_members_server", "server_id"),
        Index("idx_members_computer", "computer_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column("type", String(10), nullable=False)  # 'human' | 'agent'
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="offline")
    skills: Mapped[list] = mapped_column(JSONB, default=list)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    computer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("computers.id", ondelete="SET NULL"),
        nullable=True,
    )
    backend: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server", back_populates="members")
    computer = relationship("Computer", back_populates="members")
    workspaces = relationship("AgentWorkspace", back_populates="agent", lazy="selectin")


# ── Computers / Workspaces ───────────────────────────────────

class Computer(Base):
    __tablename__ = "computers"
    __table_args__ = (
        UniqueConstraint("server_id", "name", name="uq_computers_server_name"),
        Index("idx_computers_server", "server_id"),
        Index("idx_computers_server_machine", "server_id", "machine_id"),
        Index(
            "uq_computers_server_machine",
            "server_id",
            "machine_id",
            unique=True,
            postgresql_where=text("machine_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    machine_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    os: Mapped[str] = mapped_column(String(80), nullable=False)
    daemon_version: Mapped[str] = mapped_column(String(80), nullable=False)
    api_key_prefix: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="offline")
    detected_runtimes: Mapped[list] = mapped_column(JSONB, default=list)
    active_daemon_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    daemon_lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server", back_populates="computers")
    members = relationship("Member", back_populates="computer", lazy="selectin")
    workspaces = relationship("AgentWorkspace", back_populates="computer", lazy="selectin")


class AgentWorkspace(Base):
    __tablename__ = "agent_workspaces"
    __table_args__ = (
        Index("idx_agent_workspaces_computer", "computer_id"),
        Index("idx_agent_workspaces_agent", "agent_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    computer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("computers.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    runtime: Mapped[str] = mapped_column(String(40), nullable=False, default="claude_code")
    runtime_command: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="stopped")
    session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cwd: Mapped[str | None] = mapped_column(Text, nullable=True)
    pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    computer = relationship("Computer", back_populates="workspaces")
    agent = relationship("Member", back_populates="workspaces")



class LlmRunLease(Base):
    __tablename__ = "llm_run_leases"
    __table_args__ = (
        Index("idx_llm_run_leases_status_expiry", "status", "expires_at"),
        Index("idx_llm_run_leases_server_created", "server_id", "created_at"),
        CheckConstraint(
            "status IN ('waiting', 'active', 'released', 'expired', 'failed')",
            name="ck_llm_run_leases_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    computer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("computers.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="waiting")
    failure_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    acquired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    server = relationship("Server")
    computer = relationship("Computer")
    agent = relationship("Member")


# ── Channels ─────────────────────────────────────────────────

class Channel(Base):
    __tablename__ = "channels"
    __table_args__ = (
        UniqueConstraint("server_id", "name"),
        Index("idx_channels_server", "server_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column("type", String(10), nullable=False, default="public")  # public | private | dm
    creator_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server", back_populates="channels")
    members = relationship("ChannelMember", back_populates="channel", lazy="selectin")
    messages = relationship("Message", back_populates="channel", lazy="selectin")
    tasks = relationship("Task", back_populates="channel", lazy="selectin")


class ChannelMember(Base):
    __tablename__ = "channel_members"

    channel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), primary_key=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    last_read_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"))

    channel = relationship("Channel", back_populates="members")
    member = relationship("Member")


# ── Messages ─────────────────────────────────────────────────

class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("idx_messages_channel", "channel_id", "created_at"),
        Index("idx_messages_seq", "seq"),
        Index("idx_messages_parent", "parent_id", postgresql_where=text("parent_id IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    short_id: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    channel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    sender_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id"), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id"), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    channel_type: Mapped[str] = mapped_column(String(10), nullable=False, default="channel")
    mentions: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)),
        nullable=False,
        default=list,
        server_default=text("'{}'::uuid[]"),
    )
    seq: Mapped[int] = mapped_column(
        BigInteger,
        # Alembic's final transition barrier reconciles legacy explicit values and
        # switches this column to GENERATED ALWAYS.  Application writers omit seq;
        # PostgreSQL is the only allocator.
        Identity(always=True, start=1, increment=1),
        unique=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    channel = relationship("Channel", back_populates="messages")
    sender = relationship("Member")


class ThreadSummary(Base):
    __tablename__ = "thread_summaries"
    __table_args__ = (
        UniqueConstraint("root_message_id", name="uq_thread_summaries_root_message"),
        Index("idx_thread_summaries_server", "server_id", "updated_at"),
        Index("idx_thread_summaries_channel", "channel_id", "updated_at"),
        Index("idx_thread_summaries_requested_agent", "requested_agent_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    channel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    root_message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="empty")
    requested_agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    reply_count_at_request: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    reply_count_at_summary: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    last_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    summarized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server")
    channel = relationship("Channel")
    root_message = relationship("Message", foreign_keys=[root_message_id])
    requested_agent = relationship("Member", foreign_keys=[requested_agent_id])
    updated_by_member = relationship("Member", foreign_keys=[updated_by])


class ChatThreadReadCursor(Base):
    __tablename__ = "chat_thread_read_cursors"
    __table_args__ = (
        Index(
            "uq_chat_thread_read_cursor_scope",
            "server_id",
            "member_id",
            "root_message_id",
            unique=True,
        ),
        Index("idx_chat_thread_read_cursors_member", "server_id", "member_id", "last_read_seq"),
        Index("idx_chat_thread_read_cursors_root", "root_message_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    root_message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    last_read_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"))
    last_seen_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server")
    member = relationship("Member")
    root_message = relationship("Message", foreign_keys=[root_message_id])
    last_seen_message = relationship("Message", foreign_keys=[last_seen_message_id])


# ── Tasks ────────────────────────────────────────────────────

class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("channel_id", "task_number"),
        Index("idx_tasks_channel", "channel_id", "status"),
        Index("idx_tasks_assignee", "assignee_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_number: Mapped[int] = mapped_column(Integer, nullable=False)
    channel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id"), nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="todo")
    creator_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id"), nullable=False)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id"), nullable=True)
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    channel = relationship("Channel", back_populates="tasks")
    creator = relationship("Member", foreign_keys=[creator_id])
    assignee = relationship("Member", foreign_keys=[assignee_id])
    assignments = relationship("TaskAssignment", back_populates="task", lazy="selectin")
    runs = relationship("TaskRun", back_populates="task", lazy="selectin")


class TaskAssignment(Base):
    __tablename__ = "task_assignments"
    __table_args__ = (
        Index("idx_task_assignments_task", "task_id"),
        Index("idx_task_assignments_assignee", "assignee_id", "status"),
        CheckConstraint("assignee_type IN ('member', 'agent')", name="ck_task_assignments_assignee_type"),
        CheckConstraint(
            "assignment_mode IN ('leader_designated', 'direct_drag', 'agent_delegated', 'system', 'task_created', 'external_feishu')",
            name="ck_task_assignments_mode",
        ),
        CheckConstraint("status IN ('active', 'completed', 'cancelled')", name="ck_task_assignments_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    assignee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    assignee_type: Mapped[str] = mapped_column(String(20), nullable=False, default="agent")
    role: Mapped[str] = mapped_column(String(80), nullable=False, default="worker")
    role_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    role_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    assignment_mode: Mapped[str] = mapped_column(String(40), nullable=False, default="task_created")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("task_run_templates.id", ondelete="SET NULL"), nullable=True)
    template_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    execution_strategy: Mapped[str] = mapped_column(String(40), nullable=False, default="parallel")
    run_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    task = relationship("Task", back_populates="assignments")
    assignee = relationship("Member", foreign_keys=[assignee_id])
    creator = relationship("Member", foreign_keys=[created_by])
    template = relationship("TaskRunTemplate")


class TaskRunTemplate(Base):
    __tablename__ = "task_run_templates"
    __table_args__ = (
        Index("idx_task_run_templates_status", "status"),
        Index("idx_task_run_templates_server", "server_id", "status"),
        Index(
            "uq_task_run_templates_builtin_slug",
            "slug",
            unique=True,
            postgresql_where=text("visibility = 'builtin' AND server_id IS NULL"),
        ),
        Index(
            "uq_task_run_templates_server_slug",
            "server_id",
            "slug",
            unique=True,
            postgresql_where=text("server_id IS NOT NULL"),
        ),
        CheckConstraint("status IN ('active', 'disabled')", name="ck_task_run_templates_status"),
        CheckConstraint("visibility IN ('builtin', 'server', 'user')", name="ck_task_run_templates_visibility"),
        CheckConstraint(
            "(visibility = 'builtin' AND server_id IS NULL) OR "
            "(visibility IN ('server', 'user') AND server_id IS NOT NULL)",
            name="ck_task_run_templates_tenant_scope",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("servers.id", ondelete="CASCADE"),
        nullable=True,
    )
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    system_instruction: Mapped[str] = mapped_column(Text, nullable=False)
    tool_policy: Mapped[dict] = mapped_column(JSONB, default=dict)
    skill_policy: Mapped[dict] = mapped_column(JSONB, default=dict)
    memory_policy: Mapped[dict] = mapped_column(JSONB, default=dict)
    output_policy: Mapped[dict] = mapped_column(JSONB, default=dict)
    runtime_policy: Mapped[dict] = mapped_column(JSONB, default=dict)
    start_policy: Mapped[dict] = mapped_column(JSONB, default=dict)
    role_presets: Mapped[list] = mapped_column(JSONB, default=list)
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, default="user")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    creator = relationship("Member", foreign_keys=[created_by])
    server = relationship("Server")


class TaskRun(Base):
    __tablename__ = "task_runs"
    __table_args__ = (
        Index("idx_task_runs_task", "task_id", "created_at"),
        Index("idx_task_runs_agent", "agent_id", "status"),
        Index("idx_task_runs_assignment", "assignment_id"),
        Index("idx_task_runs_workspace", "runtime_workspace_id"),
        CheckConstraint(
            "status IN ('queued', 'dispatched', 'running', 'awaiting_input', 'completed', 'failed', 'cancelled')",
            name="ck_task_runs_status",
        ),
        CheckConstraint(
            "context_scope IN ('channel', 'thread', 'task', 'run')",
            name="ck_task_runs_context_scope",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("task_assignments.id", ondelete="SET NULL"),
        nullable=True,
    )
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    channel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    source_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    thread_root_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    parent_run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("task_runs.id", ondelete="SET NULL"), nullable=True)
    template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("task_run_templates.id", ondelete="SET NULL"), nullable=True)
    template_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    role_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    role_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default=text("1"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")
    trigger_type: Mapped[str] = mapped_column(String(40), nullable=False, default="task_created")
    runtime_workspace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("agent_workspaces.id", ondelete="SET NULL"), nullable=True)
    computer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("computers.id", ondelete="SET NULL"), nullable=True)
    daemon_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    runtime: Mapped[str | None] = mapped_column(String(40), nullable=True)
    runtime_provider: Mapped[str | None] = mapped_column(String(80), nullable=True)
    runtime_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    prompt_profile: Mapped[str] = mapped_column(String(80), nullable=False, default="task.worker")
    workspace_session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    runtime_session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    context_session_id: Mapped[str] = mapped_column(String(255), nullable=False)
    cwd: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_scope: Mapped[str] = mapped_column(String(20), nullable=False, default="task")
    context_summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    context_usage: Mapped[dict] = mapped_column(JSONB, default=dict)
    token_usage: Mapped[dict] = mapped_column(JSONB, default=dict)
    tool_usage_summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    completion_policy: Mapped[str] = mapped_column(String(40), nullable=False, default="single_turn_result")
    output_refs: Mapped[list] = mapped_column(JSONB, default=list)
    output_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    task = relationship("Task", back_populates="runs")
    assignment = relationship("TaskAssignment")
    template = relationship("TaskRunTemplate")
    agent = relationship("Member", foreign_keys=[agent_id])
    channel = relationship("Channel")
    runtime_workspace = relationship("AgentWorkspace")
    computer = relationship("Computer")
    source_message = relationship("Message", foreign_keys=[source_message_id])
    thread_root_message = relationship("Message", foreign_keys=[thread_root_message_id])
    output_message = relationship("Message", foreign_keys=[output_message_id])


# ── Server-owned Memory ──────────────────────────────────────

class MemoryEntry(Base):
    __tablename__ = "memory_entries"
    __table_args__ = (
        Index(
            "uq_memory_entries_scope_path_active",
            "server_id",
            "scope_type",
            "scope_id",
            "path",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("idx_memory_entries_scope_updated", "server_id", "scope_type", "scope_id", text("updated_at DESC")),
        Index(
            "idx_memory_entries_source_message",
            "server_id",
            "source_message_id",
            postgresql_where=text("source_message_id IS NOT NULL"),
        ),
        Index(
            "idx_memory_entries_source_task",
            "server_id",
            "source_task_id",
            postgresql_where=text("source_task_id IS NOT NULL"),
        ),
        CheckConstraint("scope_type IN ('agent', 'channel', 'task', 'thread')", name="ck_memory_entries_scope_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    entry_kind: Mapped[str] = mapped_column(String(40), nullable=False, default="note")
    content_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    blob_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("files.id", ondelete="SET NULL"), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"))
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default=text("1"))
    source_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    source_channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    source_thread_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    source_task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    source_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_member_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, default="inherited", server_default=text("'inherited'"))
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    server = relationship("Server")
    file = relationship("FileEntry")
    source_message = relationship("Message", foreign_keys=[source_message_id])
    source_channel = relationship("Channel", foreign_keys=[source_channel_id])
    source_thread = relationship("Message", foreign_keys=[source_thread_id])
    source_task = relationship("Task", foreign_keys=[source_task_id])
    author = relationship("Member")


class MemoryProposal(Base):
    __tablename__ = "memory_proposals"
    __table_args__ = (
        Index("idx_memory_proposals_scope_status", "server_id", "scope_type", "scope_id", "status", text("updated_at DESC")),
        CheckConstraint("scope_type IN ('agent', 'channel', 'task', 'thread')", name="ck_memory_proposals_scope_type"),
        CheckConstraint("status IN ('open', 'accepted', 'rejected', 'superseded')", name="ck_memory_proposals_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    base_entry_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("memory_entries.id", ondelete="SET NULL"), nullable=True)
    base_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    proposed_content_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    proposed_blob_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default=text("'open'"))
    reviewer_member_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    server = relationship("Server")
    base_entry = relationship("MemoryEntry")
    author = relationship("Member", foreign_keys=[author_member_id])
    reviewer = relationship("Member", foreign_keys=[reviewer_member_id])


# ── Activity Logs ────────────────────────────────────────────

class ActivityLog(Base):
    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("idx_activity_server", "server_id", "occurred_at"),
        Index("idx_activity_agent", "agent_id", "occurred_at"),
        Index("idx_activity_task", "task_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column("type", String(40), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    server = relationship("Server", back_populates="activity_logs")
    agent = relationship("Member")
    channel = relationship("Channel")
    task = relationship("Task")


# ── Append-only Events ───────────────────────────────────────

class EventRecord(Base):
    __tablename__ = "event_records"
    __table_args__ = (
        UniqueConstraint("server_id", "seq", name="uq_event_records_server_seq"),
        Index("idx_event_records_server_seq", "server_id", "seq"),
        Index(
            "idx_event_records_server_channel_seq",
            "server_id",
            "channel_id",
            "seq",
            postgresql_where=text("channel_id IS NOT NULL"),
        ),
        Index(
            "idx_event_records_server_actor_seq",
            "server_id",
            "actor_id",
            "seq",
            postgresql_where=text("actor_id IS NOT NULL"),
        ),
        Index("idx_event_records_server_type_seq", "server_id", "event_type", "seq"),
        Index("idx_event_records_created", "server_id", text("created_at DESC")),
        Index("idx_event_records_message", "message_id", postgresql_where=text("message_id IS NOT NULL")),
        Index("idx_event_records_task", "task_id", postgresql_where=text("task_id IS NOT NULL")),
    )

    seq: Mapped[int] = mapped_column(BigInteger, Identity(), nullable=False)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    server = relationship("Server")
    actor = relationship("Member")
    channel = relationship("Channel")
    task = relationship("Task")
    message = relationship("Message")


# ── External Integrations ────────────────────────────────────

class ExternalConnector(Base):
    __tablename__ = "external_connectors"
    __table_args__ = (
        Index("idx_external_connectors_server_provider", "server_id", "provider", "status"),
        CheckConstraint("status IN ('active', 'disabled', 'error')", name="ck_external_connectors_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    secret_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    last_error_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server")
    routes = relationship("ExternalRoute", back_populates="connector", lazy="selectin")
    events = relationship("ExternalEvent", back_populates="connector", lazy="selectin")


class ExternalRoute(Base):
    __tablename__ = "external_routes"
    __table_args__ = (
        Index("idx_external_routes_connector_status", "connector_id", "status"),
        Index("idx_external_routes_channel", "channel_id"),
        CheckConstraint("status IN ('active', 'disabled')", name="ck_external_routes_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    connector_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("external_connectors.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    source_selector: Mapped[dict] = mapped_column(JSONB, default=dict)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    task_template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("task_run_templates.id", ondelete="SET NULL"), nullable=True)
    default_assignee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    runtime_rule: Mapped[dict] = mapped_column(JSONB, default=dict)
    writeback_policy: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server")
    connector = relationship("ExternalConnector", back_populates="routes")
    channel = relationship("Channel")
    task_template = relationship("TaskRunTemplate")
    default_assignee = relationship("Member")


class ExternalSession(Base):
    __tablename__ = "external_sessions"
    __table_args__ = (
        Index("uq_external_sessions_scope", "connector_id", "external_scope_type", "external_scope_id", unique=True),
        Index("idx_external_sessions_local_task", "server_id", "task_id", postgresql_where=text("task_id IS NOT NULL")),
        CheckConstraint(
            "external_scope_type IN ('chat', 'thread', 'topic', 'issue', 'project')",
            name="ck_external_sessions_scope_type",
        ),
        CheckConstraint("status IN ('active', 'archived', 'disabled')", name="ck_external_sessions_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    connector_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("external_connectors.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    external_scope_type: Mapped[str] = mapped_column(String(40), nullable=False)
    external_scope_id: Mapped[str] = mapped_column(Text, nullable=False)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    thread_root_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    member_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server")
    connector = relationship("ExternalConnector")
    channel = relationship("Channel")
    thread_root_message = relationship("Message", foreign_keys=[thread_root_message_id])
    task = relationship("Task")
    member = relationship("Member")


class ExternalEvent(Base):
    __tablename__ = "external_events"
    __table_args__ = (
        Index("uq_external_events_connector_dedup", "connector_id", "dedup_key", unique=True),
        Index("idx_external_events_server_created", "server_id", text("created_at DESC")),
        Index("idx_external_events_status", "server_id", "status"),
        Index("idx_external_events_task_run", "task_run_id", postgresql_where=text("task_run_id IS NOT NULL")),
        CheckConstraint(
            "status IN ('received', 'accepted', 'dropped', 'failed', 'completed', 'writeback_failed')",
            name="ck_external_events_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    connector_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("external_connectors.id", ondelete="CASCADE"), nullable=False)
    route_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("external_routes.id", ondelete="SET NULL"), nullable=True)
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("external_sessions.id", ondelete="SET NULL"), nullable=True)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    source_event_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_message_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_thread_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    dedup_key: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="received")
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    actor_external_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    normalized: Mapped[dict] = mapped_column(JSONB, default=dict)
    raw_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    task_run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("task_runs.id", ondelete="SET NULL"), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server")
    connector = relationship("ExternalConnector", back_populates="events")
    route = relationship("ExternalRoute")
    session = relationship("ExternalSession")
    channel = relationship("Channel")
    message = relationship("Message")
    task = relationship("Task")
    task_run = relationship("TaskRun")


class ExternalMapping(Base):
    __tablename__ = "external_mappings"
    __table_args__ = (
        Index("idx_external_mappings_local", "server_id", "local_type", "local_id"),
        Index("idx_external_mappings_external", "connector_id", "external_type", "external_id"),
        Index(
            "uq_external_mappings_pair",
            "connector_id",
            "local_type",
            "local_id",
            "external_type",
            "external_id",
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    connector_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("external_connectors.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    local_type: Mapped[str] = mapped_column(String(40), nullable=False)
    local_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    external_type: Mapped[str] = mapped_column(String(40), nullable=False)
    external_id: Mapped[str] = mapped_column(Text, nullable=False)
    external_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    server = relationship("Server")
    connector = relationship("ExternalConnector")


# ── Files / Attachments ──────────────────────────────────────

class FileEntry(Base):
    __tablename__ = "files"
    __table_args__ = (
        Index("idx_files_server", "server_id", "created_at"),
        Index("idx_files_channel", "channel_id", "created_at"),
        Index("idx_files_message", "message_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False, default="application/octet-stream")
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    server = relationship("Server", back_populates="files")
    channel = relationship("Channel")
    message = relationship("Message")
    uploader = relationship("Member")


# ── Saved Items ──────────────────────────────────────────────

class SavedItem(Base):
    __tablename__ = "saved_items"
    __table_args__ = (
        UniqueConstraint("account_id", "item_type", "item_id", name="uq_saved_items_account_item"),
        Index("idx_saved_items_account", "account_id", "created_at"),
        Index("idx_saved_items_server", "server_id", "created_at"),
        Index("idx_saved_items_item", "item_type", "item_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    item_type: Mapped[str] = mapped_column(String(20), nullable=False)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    server = relationship("Server", back_populates="saved_items")
    account = relationship("Account")
    member = relationship("Member")


# ── Message Reactions ────────────────────────────────────────

class MessageReaction(Base):
    __tablename__ = "message_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "member_id", "reaction"),
        Index("idx_message_reactions_message", "message_id"),
        Index("idx_message_reactions_member", "member_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    reaction: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    message = relationship("Message")
    member = relationship("Member")


# ── Reminders ────────────────────────────────────────────────

class Reminder(Base):
    __tablename__ = "reminders"
    __table_args__ = (
        Index("idx_reminders_server", "server_id", "status", "fire_at"),
        Index("idx_reminders_agent", "agent_id", "status", "fire_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    fire_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    repeat: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    fired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    server = relationship("Server", back_populates="reminders")
    agent = relationship("Member")
    channel = relationship("Channel")
    message = relationship("Message")
    task = relationship("Task")


# ── API Keys ─────────────────────────────────────────────────

class ApiKey(Base):
    __tablename__ = "api_keys"
    __table_args__ = (
        Index("idx_api_keys_prefix", "key_prefix"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key_prefix: Mapped[str] = mapped_column(String(20), nullable=False)
    token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)  # 'computer' | 'agent'
    resource_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    server = relationship("Server", back_populates="api_keys")


class ConnectTicket(Base):
    __tablename__ = "connect_tickets"
    __table_args__ = (
        Index("idx_connect_tickets_prefix", "key_prefix"),
        Index("idx_connect_tickets_server", "server_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id"), nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(20), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    requested_name: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    server = relationship("Server")
