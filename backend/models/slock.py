"""Slock data models — Phase 1 core tables."""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Column, DateTime, ForeignKey,
    Identity, Index, Integer, String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


def _utcnow():
    return datetime.utcnow()


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
    seq: Mapped[int] = mapped_column(BigInteger, autoincrement=True, unique=True)
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
