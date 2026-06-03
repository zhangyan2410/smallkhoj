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
    for workspace_id, agent_id, runtime, runtime_command, status in workspace_specs:
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
