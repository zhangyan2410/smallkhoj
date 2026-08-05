from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from postgres_test_support import disposable_postgres, run_alembic
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import Channel, EventRecord, Member
from routers import agent_api
from services.account_bootstrap import bootstrap_account
from services.channel_membership import add_channel_member, remove_channel_member
from services.daemon_control import event_visible_to_agent
from services.member_identity import normalize_handle
from services.server_invites import accept_server_invite, create_server_invite


@pytest.mark.asyncio
async def test_membership_revision_collision_updates_and_compact_events():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with sessions() as db:
                first = await bootstrap_account(db, auth_subject="auth:first", name="ean")
                second = await bootstrap_account(db, auth_subject="auth:second", name="Ean")
                invite = await create_server_invite(
                    db,
                    server=first.server,
                    creator=first.member,
                    public_base_url="http://localhost:3000",
                )
                await accept_server_invite(db, token=invite.token, account=second.account)
                channel = Channel(
                    id=uuid.uuid4(),
                    server_id=first.server.id,
                    name="general",
                    kind="public",
                    creator_id=first.member.id,
                )
                db.add(channel)
                await db.flush()

                joined_first = await add_channel_member(
                    db,
                    channel_id=channel.id,
                    member_id=first.member.id,
                    actor_id=first.member.id,
                )
                joined_second = await add_channel_member(
                    db,
                    channel_id=channel.id,
                    member_id=second.member.id,
                    actor_id=first.member.id,
                )
                duplicate = await add_channel_member(
                    db,
                    channel_id=channel.id,
                    member_id=second.member.id,
                    actor_id=first.member.id,
                )

                assert joined_first.payload["member"]["reference"] == "@ean"
                assert joined_second.roster_revision == 2
                assert joined_second.payload["member"]["reference"].endswith(
                    f"-{second.server.server_handle}"
                )
                assert joined_second.payload["referenceUpdates"] == [
                    {
                        "memberId": str(first.member.id),
                        "reference": f"@ean-{first.server.server_handle}",
                    }
                ]
                assert "description" not in str(joined_second.payload).lower()
                assert duplicate.changed is False
                assert duplicate.roster_revision == 2

                left = await remove_channel_member(
                    db,
                    channel_id=channel.id,
                    member_id=second.member.id,
                    actor_id=first.member.id,
                )
                assert left.roster_revision == 3
                assert left.payload["member"]["reference"].endswith(
                    f"-{second.server.server_handle}"
                )
                assert left.payload["referenceUpdates"] == [
                    {"memberId": str(first.member.id), "reference": "@ean"}
                ]
                await db.commit()

                assert await db.scalar(
                    select(func.count()).select_from(EventRecord).where(
                        EventRecord.channel_id == channel.id
                    )
                ) == 3
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_removed_agent_event_has_exact_final_recipient_without_description():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with sessions() as db:
                owner = await bootstrap_account(db, auth_subject="auth:owner", name="owner")
                channel = Channel(
                    id=uuid.uuid4(),
                    server_id=owner.server.id,
                    name="runtime",
                    kind="private",
                    creator_id=owner.member.id,
                )
                db.add(channel)
                identity = normalize_handle("helper")
                agent = Member(
                    id=uuid.uuid4(),
                    origin_server_id=owner.server.id,
                    kind="agent",
                    handle=identity.handle,
                    handle_key=identity.handle_key,
                    description="擅长数据库迁移",
                    status="online",
                )
                db.add(agent)
                await db.flush()
                await add_channel_member(
                    db,
                    channel_id=channel.id,
                    member_id=owner.member.id,
                    actor_id=owner.member.id,
                )
                await add_channel_member(
                    db,
                    channel_id=channel.id,
                    member_id=agent.id,
                    actor_id=owner.member.id,
                )
                left = await remove_channel_member(
                    db,
                    channel_id=channel.id,
                    member_id=agent.id,
                    actor_id=owner.member.id,
                )

                assert left.payload["removedAgentId"] == str(agent.id)
                assert left.payload["member"] == {
                    "memberId": str(agent.id),
                    "kind": "agent",
                    "reference": "@helper",
                }
                assert "description" not in str(left.payload).lower()

                assert left.event is not None
                assert event_visible_to_agent(left.event, agent, set()) is True
                other_agent = Member(
                    id=uuid.uuid4(),
                    origin_server_id=owner.server.id,
                    kind="agent",
                    handle="other",
                    handle_key="other",
                    status="online",
                )
                assert event_visible_to_agent(left.event, other_agent, set()) is False

                with pytest.raises(HTTPException) as denied:
                    await agent_api._resolve_existing_channel_ref(
                        db,
                        owner.server,
                        "#runtime",
                        member=agent,
                    )
                assert denied.value.status_code == 403

                with pytest.raises(HTTPException) as stale_remove:
                    await remove_channel_member(
                        db,
                        channel_id=channel.id,
                        member_id=agent.id,
                        actor_id=owner.member.id,
                    )
                assert stale_remove.value.status_code == 404
                assert await db.scalar(
                    select(func.count()).select_from(EventRecord).where(
                        EventRecord.channel_id == channel.id,
                        EventRecord.event_type == "channel.member_left",
                    )
                ) == 1
        finally:
            await engine.dispose()
