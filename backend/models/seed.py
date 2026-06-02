"""Database init: create tables and seed data."""

import asyncio
import uuid

from sqlalchemy import select

from models import Base, Server, Member, Channel, ChannelMember, Message, Task, async_session, engine


async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[DB] Tables created")


async def seed():
    async with async_session() as db:
        # Check if already seeded
        result = await db.execute(select(Server).limit(1))
        if result.scalar_one_or_none():
            print("[DB] Already seeded, skipping")
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

        await db.commit()
        print("[DB] Seed data inserted")


async def main():
    await create_tables()
    await seed()


if __name__ == "__main__":
    asyncio.run(main())
