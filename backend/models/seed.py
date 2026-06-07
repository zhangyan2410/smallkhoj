"""Database init: create tables and seed data."""

import asyncio
import hashlib
import uuid

from sqlalchemy import select, text

from models import (
    Base, Server, Member, Computer, AgentWorkspace, Channel, ChannelMember,
    Message, Task, ActivityLog, ApiKey, async_session, engine,
)


async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64)"))
        await conn.execute(text("ALTER TABLE computers ADD COLUMN IF NOT EXISTS machine_id VARCHAR(80)"))
        await conn.execute(text("ALTER TABLE computers ADD COLUMN IF NOT EXISTS active_daemon_id VARCHAR(80)"))
        await conn.execute(text("ALTER TABLE computers ADD COLUMN IF NOT EXISTS daemon_lease_expires_at TIMESTAMP WITH TIME ZONE"))
        await conn.execute(text(
            "ALTER TABLE members "
            "ADD COLUMN IF NOT EXISTS computer_id UUID REFERENCES computers(id) ON DELETE SET NULL"
        ))
        await conn.execute(text("ALTER TABLE members ADD COLUMN IF NOT EXISTS backend VARCHAR(40)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_members_computer ON members(computer_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_computers_server_machine ON computers(server_id, machine_id)"))
        await conn.execute(text("""
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM computers
                WHERE machine_id IS NOT NULL
                GROUP BY server_id, machine_id
                HAVING count(*) > 1
              ) THEN
                CREATE UNIQUE INDEX IF NOT EXISTS uq_computers_server_machine
                ON computers(server_id, machine_id)
                WHERE machine_id IS NOT NULL;
              END IF;
            END $$;
        """))
        await conn.execute(text("""
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM computers GROUP BY server_id, name HAVING count(*) > 1
              ) THEN
                CREATE UNIQUE INDEX IF NOT EXISTS uq_computers_server_name
                ON computers(server_id, name);
              END IF;
            END $$;
        """))
        await conn.execute(text("""
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM members GROUP BY server_id, display_name HAVING count(*) > 1
              ) THEN
                CREATE UNIQUE INDEX IF NOT EXISTS uq_members_server_display_name
                ON members(server_id, display_name);
              END IF;
            END $$;
        """))
        await conn.execute(text(
            "ALTER TABLE channel_members "
            "ADD COLUMN IF NOT EXISTS last_read_seq BIGINT NOT NULL DEFAULT 0"
        ))
        await conn.execute(text(
            "ALTER TABLE messages "
            "ADD COLUMN IF NOT EXISTS mentions UUID[] NOT NULL DEFAULT '{}'::uuid[]"
        ))
        await conn.execute(text("ALTER TABLE event_records DROP COLUMN IF EXISTS activity_id"))
        await conn.execute(text("""
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = 'event_records'::regclass
                  AND contype = 'p'
                  AND conname = 'event_records_pkey'
                  AND pg_get_constraintdef(oid) LIKE 'PRIMARY KEY (seq)%'
              ) THEN
                ALTER TABLE event_records DROP CONSTRAINT event_records_pkey;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = 'event_records'::regclass
                  AND contype = 'p'
              ) THEN
                ALTER TABLE event_records ADD PRIMARY KEY (id);
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = 'event_records'::regclass
                  AND conname = 'uq_event_records_server_seq'
              ) THEN
                ALTER TABLE event_records
                ADD CONSTRAINT uq_event_records_server_seq UNIQUE (server_id, seq);
              END IF;
            END $$;
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_messages_parent "
            "ON messages(parent_id) WHERE parent_id IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_server_seq "
            "ON event_records(server_id, seq)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_server_channel_seq "
            "ON event_records(server_id, channel_id, seq) WHERE channel_id IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_server_actor_seq "
            "ON event_records(server_id, actor_id, seq) WHERE actor_id IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_server_type_seq "
            "ON event_records(server_id, event_type, seq)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_created "
            "ON event_records(server_id, created_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_message "
            "ON event_records(message_id) WHERE message_id IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_task "
            "ON event_records(task_id) WHERE task_id IS NOT NULL"
        ))
        await conn.execute(text("""
            UPDATE members AS m
            SET computer_id = (m.config->>'computerId')::uuid
            WHERE m.computer_id IS NULL
              AND m.config ? 'computerId'
              AND (m.config->>'computerId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND EXISTS (
                SELECT 1
                FROM computers AS c
                WHERE c.id = (m.config->>'computerId')::uuid
              )
        """))
        await conn.execute(text("""
            UPDATE members
            SET backend = config->>'backend'
            WHERE backend IS NULL
              AND config ? 'backend'
        """))
    print("[DB] Tables created")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def ensure_api_key(db, server_id: uuid.UUID, resource_type: str, resource_id: uuid.UUID, token: str):
    key_prefix = token[:20]
    existing = (await db.execute(
        select(ApiKey).where(
            ApiKey.server_id == server_id,
            ApiKey.resource_type == resource_type,
            ApiKey.resource_id == resource_id,
            ApiKey.key_prefix == key_prefix,
        )
    )).scalar_one_or_none()
    if existing:
        existing.token_hash = _token_hash(token)
        return
    db.add(ApiKey(
        key_prefix=key_prefix,
        token_hash=_token_hash(token),
        resource_type=resource_type,
        resource_id=resource_id,
        server_id=server_id,
    ))


async def ensure_extended_seed(db, server_id: uuid.UUID):
    """Backfill newer baseline entities when an existing database was seeded earlier."""
    aaa_id = uuid.UUID("aaaa0000-0000-0000-0000-000000000001")
    deepseek_id = uuid.UUID("d7942034-805b-4ee4-956d-4fe9483fdcd8")
    computer_id = uuid.UUID("c0a10000-0000-0000-0000-000000000001")

    aaa = (await db.execute(select(Member).where(Member.id == aaa_id))).scalar_one_or_none()
    deepseek = (await db.execute(select(Member).where(Member.id == deepseek_id))).scalar_one_or_none()
    if not aaa or not deepseek:
        return

    computer = (await db.execute(select(Computer).where(Computer.id == computer_id))).scalar_one_or_none()
    if not computer:
        computer = Computer(
            id=computer_id,
            server_id=server_id,
            name="zhangyan-ean-mac",
            os="macOS",
            daemon_version="0.2.0",
            api_key_prefix="sk_machine_local",
            status="online",
            detected_runtimes=[
                {"type": "claude_code", "status": "available"},
                {"type": "codex_cli", "status": "available"},
                {"type": "kimi_cli", "status": "available"},
            ],
        )
        db.add(computer)
        await db.flush()

    for member, backend in [(aaa, "Claude"), (deepseek, "DeepSeek")]:
        member.computer_id = computer.id
        member.backend = backend
        member.config = {
            **(member.config or {}),
            "computerId": str(computer.id),
            "backend": backend,
            "permissions": {
                "fileRead": True,
                "fileWrite": True,
                "commandExecution": True,
                "networkAccess": True,
                "sendMessage": True,
                "createTask": True,
                "claimTask": True,
                "updateTask": True,
                "createReminder": True,
                "updateReminder": True,
                "updateProfile": True,
                "manageIntegration": True,
                "inviteMember": False,
                "manageChannel": False,
            },
            "actions": {"paused": False, "autoRestart": True},
        }

    workspace_specs = [
        (
            uuid.UUID("a0a10000-0000-0000-0000-000000000001"),
            aaa.id,
            "claude_code",
            "claude",
            "idle",
        ),
        (
            uuid.UUID("a0a10000-0000-0000-0000-000000000002"),
            deepseek.id,
            "custom",
            "deepseek",
            "stopped",
        ),
    ]
    workspace_ids_by_agent = {}
    for workspace_id, agent_id, runtime, runtime_command, status in workspace_specs:
        workspace_ids_by_agent[agent_id] = workspace_id
        workspace = (await db.execute(
            select(AgentWorkspace).where(AgentWorkspace.id == workspace_id)
        )).scalar_one_or_none()
        if not workspace:
            db.add(AgentWorkspace(
                id=workspace_id,
                computer_id=computer.id,
                agent_id=agent_id,
                runtime=runtime,
                runtime_command=runtime_command,
                status=status,
                cwd="/Users/code/project/smallkhoj",
            ))
        else:
            workspace.computer_id = computer.id
            workspace.agent_id = agent_id
            workspace.runtime = runtime

    for member, _backend in [(aaa, "Claude"), (deepseek, "DeepSeek")]:
        workspace_id = workspace_ids_by_agent.get(member.id)
        if workspace_id:
            member.config = {
                **(member.config or {}),
                "workspaceId": str(workspace_id),
            }

    await ensure_api_key(db, server_id, "agent", aaa.id, "sk_agent_aaa_local")
    await ensure_api_key(db, server_id, "agent", deepseek.id, "sk_agent_deepseek_local")
    await ensure_api_key(db, server_id, "computer", computer.id, "sk_machine_local")

    existing_activity = (await db.execute(
        select(ActivityLog).where(
            ActivityLog.server_id == server_id,
            ActivityLog.agent_id == aaa.id,
            ActivityLog.kind == "agent_started",
        ).limit(1)
    )).scalar_one_or_none()
    if not existing_activity:
        db.add(ActivityLog(
            server_id=server_id,
            agent_id=aaa.id,
            kind="agent_started",
            description="@aaa workspace registered on zhangyan-ean-mac",
            details={"runtime": "claude_code", "computerId": str(computer.id)},
        ))


async def seed():
    async with async_session() as db:
        # Check if already seeded
        result = await db.execute(select(Server).limit(1))
        existing_server = result.scalar_one_or_none()
        if existing_server:
            await ensure_extended_seed(db, existing_server.id)
            await db.commit()
            print("[DB] Already seeded, ensured extended baseline")
            return

        server_id = uuid.UUID("3893c518-c8f8-43ba-af0d-54a7773bbb6d")
        server = Server(id=server_id, name="Slock Server")
        db.add(server)

        # Members
        human = Member(
            id=uuid.UUID("e9abeddb-4137-430c-96a6-ae42a77344da"),
            server_id=server_id,
            kind="human",
            display_name="zy-ean",
            status="online",
        )
        deepseek = Member(
            id=uuid.UUID("d7942034-805b-4ee4-956d-4fe9483fdcd8"),
            server_id=server_id,
            kind="agent",
            display_name="deepseek",
            status="active",
        )
        aaa = Member(
            id=uuid.UUID("aaaa0000-0000-0000-0000-000000000001"),
            server_id=server_id,
            kind="agent",
            display_name="aaa",
            status="active",
        )
        db.add_all([human, deepseek, aaa])
        await db.flush()

        await ensure_extended_seed(db, server_id)
        computer = (await db.execute(
            select(Computer).where(Computer.id == uuid.UUID("c0a10000-0000-0000-0000-000000000001"))
        )).scalar_one()

        # Channels
        all_ch = Channel(
            id=uuid.uuid4(),
            server_id=server_id,
            name="all",
            kind="public",
            description="General channel for all members",
        )
        mac_ch = Channel(
            id=uuid.uuid4(),
            server_id=server_id,
            name="mac",
            kind="public",
            description="Mac agent workspace",
        )
        window_ch = Channel(
            id=uuid.uuid4(),
            server_id=server_id,
            name="window",
            kind="public",
            description="Windows agent workspace",
        )
        ab_ch = Channel(
            id=uuid.uuid4(),
            server_id=server_id,
            name="ab",
            kind="public",
            description="AB testing channel",
        )
        db.add_all([all_ch, mac_ch, window_ch, ab_ch])
        await db.flush()

        # Channel members
        for ch in [all_ch, mac_ch, window_ch, ab_ch]:
            db.add(ChannelMember(channel_id=ch.id, member_id=human.id))
            db.add(ChannelMember(channel_id=ch.id, member_id=deepseek.id))
            db.add(ChannelMember(channel_id=ch.id, member_id=aaa.id))

        # DM channel
        dm_ch = Channel(
            id=uuid.uuid4(),
            server_id=server_id,
            name=f"dm:{min(str(human.id), str(deepseek.id))}-{max(str(human.id), str(deepseek.id))}",
            kind="dm",
            creator_id=human.id,
        )
        db.add(dm_ch)
        await db.flush()
        db.add(ChannelMember(channel_id=dm_ch.id, member_id=human.id))
        db.add(ChannelMember(channel_id=dm_ch.id, member_id=deepseek.id))

        # Seed messages
        msg1 = Message(
            short_id=uuid.uuid4().hex[:8],
            channel_id=all_ch.id,
            sender_id=human.id,
            content="Hello everyone!",
            channel_type="channel",
            seq=1,
        )
        msg2 = Message(
            short_id=uuid.uuid4().hex[:8],
            channel_id=all_ch.id,
            sender_id=deepseek.id,
            content="你好！有什么可以帮你的吗？",
            channel_type="channel",
            seq=2,
        )
        db.add_all([msg1, msg2])

        # Seed tasks
        task1 = Task(
            task_number=1,
            channel_id=all_ch.id,
            title="Setup backend API",
            status="in_progress",
            creator_id=human.id,
            assignee_id=deepseek.id,
        )
        db.add(task1)
        await db.flush()

        db.add_all([
            ActivityLog(
                server_id=server_id,
                agent_id=deepseek.id,
                kind="task_claimed",
                description="@deepseek claimed task #1",
                details={"taskNumber": 1},
                channel_id=all_ch.id,
                task_id=task1.id,
            ),
        ])

        await db.commit()
        print("[DB] Seed data inserted")


async def main():
    await create_tables()
    await seed()


if __name__ == "__main__":
    asyncio.run(main())
