"""Real PostgreSQL request-level contracts for bounded list serialization."""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from main import app
from models import (
    Account,
    ApiKey,
    Channel,
    ChannelMember,
    Member,
    Message,
    MessageReaction,
    Server,
    ServerMembership,
    Task,
)
from routers import agent_api, public_api
from routers.member_serialization import serialize_member
from routers.serialization_prefetch import (
    MemberSerializationContext,
    MessageSerializationContext,
)
from tests.postgres_test_support import disposable_postgres, run_alembic


# These ceilings include the authenticated active-Server/agent resolution
# queries, not only the endpoint body. They are intentionally just above the
# measured fixed costs so a future per-row regression remains visible.
AGENT_SEARCH_QUERY_BUDGET = 28
AGENT_HISTORY_QUERY_BUDGET = 30
AGENT_TASK_QUERY_BUDGET = 28
PUBLIC_MESSAGE_QUERY_BUDGET = 36
PUBLIC_SEARCH_QUERY_BUDGET = 32
PUBLIC_TASK_QUERY_BUDGET = 26
PUBLIC_MEMBER_QUERY_BUDGET = 24


def _public_headers(server_id: uuid.UUID, token: str) -> dict[str, str]:
    return {
        "X-Public-Key": public_api.PUBLIC_API_KEY,
        "X-Account-Token": token,
        "X-Server-Id": str(server_id),
    }


def _agent_headers(agent_id: uuid.UUID, token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Agent-Id": str(agent_id),
    }


async def _counted_get(client, engine, path: str, *, headers: dict[str, str]):
    statements: list[str] = []

    def before_cursor_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(" ".join(statement.split()))

    event.listen(engine.sync_engine, "before_cursor_execute", before_cursor_execute)
    try:
        response = await client.get(path, headers=headers)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", before_cursor_execute)
    return response, statements


async def _seed_query_world(session_factory, *, row_count: int = 100):
    now = datetime.now(timezone.utc)
    server = Server(id=uuid.uuid4(), name=f"query-budget-{uuid.uuid4().hex[:8]}")
    owner = Member(
        id=uuid.uuid4(),
        server_id=server.id,
        kind="human",
        display_name="Query Owner",
        status="online",
        config={},
        skills=[],
    )
    agent = Member(
        id=uuid.uuid4(),
        server_id=server.id,
        kind="agent",
        display_name="query-agent",
        status="offline",
        config={},
        skills=[],
    )
    account_token = f"query_session_{uuid.uuid4().hex}"
    account = Account(
        id=uuid.uuid4(),
        name=f"query-account-{uuid.uuid4().hex[:12]}",
        display_name=owner.display_name,
        server_id=server.id,
        member_id=owner.id,
        session_token_hash=public_api._hash_token(account_token),
    )
    membership = ServerMembership(
        id=uuid.uuid4(),
        server_id=server.id,
        account_id=account.id,
        member_id=owner.id,
        role="owner",
        status="active",
    )
    agent_token = f"sk_agent_{uuid.uuid4().hex}{uuid.uuid4().hex}"
    api_key = ApiKey(
        id=uuid.uuid4(),
        key_prefix=agent_token[:20],
        token_hash=hashlib.sha256(agent_token.encode()).hexdigest(),
        resource_type="agent",
        resource_id=agent.id,
        server_id=server.id,
    )
    channel = Channel(
        id=uuid.uuid4(),
        server_id=server.id,
        name="query-budget",
        kind="public",
        creator_id=owner.id,
    )
    channel_member = ChannelMember(channel_id=channel.id, member_id=agent.id)
    extra_agents = [
        Member(
            id=uuid.uuid4(),
            server_id=server.id,
            kind="agent",
            display_name=f"listed-agent-{index:03d}",
            status="offline",
            config={},
            skills=[],
        )
        for index in range(row_count - 1)
    ]

    async with session_factory() as db:
        # These models expose raw UUID foreign keys without relationships for
        # every edge, so make the fixture's dependency order explicit.
        db.add(server)
        await db.flush()
        db.add_all([owner, agent, *extra_agents])
        await db.flush()
        db.add_all([account, api_key, channel])
        await db.flush()
        db.add_all([membership, channel_member])
        await db.flush()

        messages = [
            Message(
                id=uuid.uuid4(),
                short_id=f"qb{index:06d}",
                channel_id=channel.id,
                sender_id=agent.id,
                content=f"query-budget-marker {index:03d}",
                channel_type="channel",
                mentions=[],
                created_at=now + timedelta(seconds=index),
                updated_at=now + timedelta(seconds=index),
            )
            for index in range(row_count)
        ]
        tasks = [
            Task(
                id=uuid.uuid4(),
                task_number=index + 1,
                channel_id=channel.id,
                title=f"Query budget task {index + 1}",
                description=f"task description {index + 1}",
                status="todo",
                creator_id=owner.id,
                assignee_id=agent.id,
                data={},
                created_at=now + timedelta(minutes=index),
                updated_at=now + timedelta(minutes=index),
            )
            for index in range(row_count)
        ]
        db.add_all([*messages, *tasks])
        await db.flush()
        reactions = [
            MessageReaction(
                id=uuid.uuid4(),
                message_id=message.id,
                member_id=owner.id,
                reaction="👍",
                created_at=now + timedelta(seconds=index, milliseconds=1),
            )
            for index, message in enumerate(messages)
        ]
        db.add_all(reactions)
        await db.commit()

    return {
        "server": server,
        "owner": owner,
        "agent": agent,
        "channel": channel,
        "account_token": account_token,
        "agent_token": agent_token,
        "messages": messages,
        "reactions": reactions,
        "tasks": tasks,
    }


def _expected_member(member: Member) -> dict:
    return {
        "id": str(member.id),
        "name": member.display_name,
        "displayName": member.display_name,
        "handle": f"@{member.display_name}",
        "kind": member.kind,
        "type": member.kind,
        "profile": {
            "displayName": member.display_name,
            "description": member.description,
            "avatarUrl": member.avatar_url,
        },
        "status": member.status,
        "description": member.description,
        "avatarUrl": member.avatar_url,
        "skills": member.skills or [],
        "config": member.config or {},
        "computerId": None,
        "workspaceId": None,
        "backend": None,
        "runtimeProvider": None,
        "permissions": {},
        "actions": {},
    }


def _expected_agent_message(world: dict, message: Message, reaction: MessageReaction) -> dict:
    agent = world["agent"]
    channel = world["channel"]
    return {
        "id": str(message.id),
        "messageId": str(message.id),
        "shortId": message.short_id,
        "seq": message.seq,
        "channelId": str(channel.id),
        "channel": f"#{channel.name}",
        "senderId": str(agent.id),
        "sender": f"@{agent.display_name}",
        "senderType": "agent",
        "content": message.content,
        "mentions": [],
        "parentId": None,
        "threadId": str(message.id),
        "threadRootId": str(message.id),
        "replyCount": 0,
        "reactions": [
            {
                "id": str(reaction.id),
                "reaction": "👍",
                "memberId": str(world["owner"].id),
                "member": f"@{world['owner'].display_name}",
                "createdAt": reaction.created_at.isoformat(),
            }
        ],
        "reactionCounts": {"👍": 1},
        "channelType": "channel",
        "createdAt": message.created_at.isoformat(),
        "updatedAt": message.updated_at.isoformat(),
    }


def _expected_public_task(world: dict, task: Task) -> dict:
    channel = world["channel"]
    owner = world["owner"]
    agent = world["agent"]
    return {
        "id": str(task.id),
        "number": task.task_number,
        "taskNumber": task.task_number,
        "channelId": str(channel.id),
        "messageId": None,
        "channel": f"#{channel.name}",
        "title": task.title,
        "description": task.description,
        "status": "todo",
        "creator": owner.display_name,
        "creatorId": str(owner.id),
        "creatorMember": _expected_member(owner),
        "assignee": agent.display_name,
        "assigneeId": str(agent.id),
        "assigneeMember": _expected_member(agent),
        "runs": [],
        "data": {},
        "createdAt": task.created_at.isoformat(),
        "updatedAt": task.updated_at.isoformat(),
    }


def _expected_agent_task(world: dict, task: Task) -> dict:
    channel = world["channel"]
    owner = world["owner"]
    agent = world["agent"]
    return {
        "id": str(task.id),
        "number": task.task_number,
        "taskNumber": task.task_number,
        "channel": f"#{channel.name}",
        "channelId": str(channel.id),
        "messageId": None,
        "title": task.title,
        "description": task.description,
        "status": "todo",
        "creator": f"@{owner.display_name}",
        "creatorId": str(owner.id),
        "assignee": f"@{agent.display_name}",
        "assigneeId": str(agent.id),
        "runs": [],
        "data": {},
        "createdAt": task.created_at.isoformat(),
        "updatedAt": task.updated_at.isoformat(),
    }


def _expected_public_message(world: dict, message: Message, reaction: MessageReaction) -> dict:
    agent = world["agent"]
    return {
        "seq": message.seq,
        "id": str(message.id),
        "shortId": message.short_id,
        "channelId": str(world["channel"].id),
        "sender": f"@{agent.display_name}",
        "senderId": str(agent.id),
        "senderType": "agent",
        "senderMember": _expected_member(agent),
        "content": message.content,
        "mentions": [],
        "parentId": None,
        "threadId": str(message.id),
        "threadShortId": message.short_id,
        "channelType": "channel",
        "replyCount": 0,
        "threadSummary": None,
        "threadLatestSeq": 0,
        "threadUnreadCount": 0,
        "hasThreadUnread": False,
        "reactions": [
            {
                "id": str(reaction.id),
                "reaction": "👍",
                "memberId": str(world["owner"].id),
                "member": f"@{world['owner'].display_name}",
                "createdAt": reaction.created_at.isoformat(),
            }
        ],
        "reactionCounts": {"👍": 1},
        "time": message.created_at.strftime("%Y-%m-%d %H:%M:%S"),
        "createdAt": message.created_at.isoformat(),
    }


@pytest.mark.asyncio
async def test_explicit_prefetched_missing_values_do_not_fall_back_to_sql():
    class RejectingSession:
        async def execute(self, _statement):
            raise AssertionError("explicit prefetch miss must not execute fallback SQL")

    server_id = uuid.uuid4()
    sender_id = uuid.uuid4()
    message = Message(
        id=uuid.uuid4(),
        short_id="missingprefetch",
        channel_id=uuid.uuid4(),
        sender_id=sender_id,
        content="missing related rows are a real prefetched result",
        channel_type="channel",
        mentions=[],
        seq=7,
    )
    context = MessageSerializationContext(
        channels={},
        members={},
        reply_counts={message.id: 0},
        reactions={message.id: []},
        member_details=MemberSerializationContext({}, {}),
    )
    payload = await agent_api._serialize_message(
        RejectingSession(),  # type: ignore[arg-type]
        message,
        _context=context,
    )
    assert payload["channel"] is None
    assert payload["sender"] == "unknown"
    assert payload["replyCount"] == 0

    agent = Member(
        id=sender_id,
        server_id=server_id,
        kind="agent",
        display_name="missing-workspace",
        status="offline",
        config={},
        skills=[],
    )
    member_payload = await serialize_member(
        RejectingSession(),  # type: ignore[arg-type]
        agent,
        _computer=None,
        _workspace_id=None,
    )
    assert member_payload["workspaceId"] is None


@pytest.mark.asyncio
async def test_list_response_shapes_stay_canonical_and_queries_stay_constant():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            world = await _seed_query_world(sessions)

            async def override_db():
                async with sessions() as db:
                    yield db

            previous = app.dependency_overrides.copy()
            app.dependency_overrides[public_api.get_db] = override_db
            try:
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://testserver",
                ) as client:
                    agent_headers = _agent_headers(world["agent"].id, world["agent_token"])
                    public_headers = _public_headers(world["server"].id, world["account_token"])

                    search_50, search_50_sql = await _counted_get(
                        client,
                        engine,
                        "/internal/agent-api/search?q=query-budget-marker&limit=50",
                        headers=agent_headers,
                    )
                    search_100, search_100_sql = await _counted_get(
                        client,
                        engine,
                        "/internal/agent-api/search?q=query-budget-marker&limit=100",
                        headers=agent_headers,
                    )
                    history_100, history_100_sql = await _counted_get(
                        client,
                        engine,
                        "/internal/agent-api/history?channel=query-budget&limit=100",
                        headers=agent_headers,
                    )
                    agent_tasks, agent_tasks_sql = await _counted_get(
                        client,
                        engine,
                        "/internal/agent-api/tasks",
                        headers=agent_headers,
                    )
                    public_messages, public_messages_sql = await _counted_get(
                        client,
                        engine,
                        "/api/v1/channels/query-budget/messages?limit=100",
                        headers=public_headers,
                    )
                    public_search, public_search_sql = await _counted_get(
                        client,
                        engine,
                        "/api/v1/search?q=query-budget-marker&limit=50",
                        headers=public_headers,
                    )
                    public_tasks, public_tasks_sql = await _counted_get(
                        client,
                        engine,
                        "/api/v1/tasks?limit=100",
                        headers=public_headers,
                    )
                    public_members, public_members_sql = await _counted_get(
                        client,
                        engine,
                        "/api/v1/members",
                        headers=public_headers,
                    )
            finally:
                app.dependency_overrides = previous

            for response in (
                search_50,
                search_100,
                history_100,
                agent_tasks,
                public_messages,
                public_search,
                public_tasks,
                public_members,
            ):
                assert response.status_code == 200, response.text

            assert search_100.json()["messages"][0] == _expected_agent_message(
                world,
                world["messages"][0],
                world["reactions"][0],
            )
            assert public_tasks.json()["tasks"][0] == _expected_public_task(
                world,
                world["tasks"][0],
            )
            assert agent_tasks.json()["tasks"][0] == _expected_agent_task(
                world,
                world["tasks"][0],
            )
            assert public_messages.json()["messages"][0] == _expected_public_message(
                world,
                world["messages"][0],
                world["reactions"][0],
            )
            listed_agent = next(
                item for item in public_members.json()["members"]
                if item["id"] == str(world["agent"].id)
            )
            assert listed_agent == _expected_member(world["agent"])

            counts = {
                "agent search 50": (len(search_50_sql), AGENT_SEARCH_QUERY_BUDGET),
                "agent search 100": (len(search_100_sql), AGENT_SEARCH_QUERY_BUDGET),
                "agent history 100": (len(history_100_sql), AGENT_HISTORY_QUERY_BUDGET),
                "agent tasks 100": (len(agent_tasks_sql), AGENT_TASK_QUERY_BUDGET),
                "public messages 100": (
                    len(public_messages_sql),
                    PUBLIC_MESSAGE_QUERY_BUDGET,
                ),
                "public search 50": (len(public_search_sql), PUBLIC_SEARCH_QUERY_BUDGET),
                "public tasks 100": (len(public_tasks_sql), PUBLIC_TASK_QUERY_BUDGET),
                "public members 100": (len(public_members_sql), PUBLIC_MEMBER_QUERY_BUDGET),
            }
            violations = [
                f"{name}: {actual} statements exceeds ceiling {budget}"
                for name, (actual, budget) in counts.items()
                if actual > budget
            ]
            if len(search_100_sql) > len(search_50_sql) + 2:
                violations.append(
                    "agent search statement count grows with page size: "
                    f"50 rows={len(search_50_sql)}, 100 rows={len(search_100_sql)}"
                )
            assert not violations, "\n".join(violations)
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_threads_qualify_reply_bearing_roots_before_limit():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            world = await _seed_query_world(sessions, row_count=1)
            now = datetime.now(timezone.utc)
            empty_roots = [
                Message(
                    id=uuid.uuid4(),
                    short_id=f"empty{index:02d}",
                    channel_id=world["channel"].id,
                    sender_id=world["agent"].id,
                    content=f"newer empty root {index}",
                    channel_type="channel",
                    mentions=[],
                    created_at=now - timedelta(minutes=index),
                    updated_at=now - timedelta(minutes=index),
                )
                for index in range(6)
            ]
            eligible_roots = [
                Message(
                    id=uuid.uuid4(),
                    short_id=f"eligible{index:02d}",
                    channel_id=world["channel"].id,
                    sender_id=world["agent"].id,
                    content=f"older eligible root {index}",
                    channel_type="channel",
                    mentions=[],
                    created_at=now - timedelta(hours=index + 1),
                    updated_at=now - timedelta(hours=index + 1),
                )
                for index in range(2)
            ]
            replies = [
                Message(
                    id=uuid.uuid4(),
                    short_id=f"reply{index:04d}",
                    channel_id=world["channel"].id,
                    sender_id=world["owner"].id,
                    parent_id=root.id,
                    content=f"reply {index}",
                    channel_type="thread",
                    mentions=[],
                    created_at=now - timedelta(minutes=index),
                    updated_at=now - timedelta(minutes=index),
                )
                for index, root in enumerate(eligible_roots)
            ]
            async with sessions.begin() as db:
                db.add_all([*empty_roots, *eligible_roots, *replies])

            async def override_db():
                async with sessions() as db:
                    yield db

            previous = app.dependency_overrides.copy()
            app.dependency_overrides[public_api.get_db] = override_db
            try:
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://testserver",
                ) as client:
                    response = await client.get(
                        "/internal/agent-api/threads?channel=query-budget&limit=2",
                        headers=_agent_headers(world["agent"].id, world["agent_token"]),
                    )
            finally:
                app.dependency_overrides = previous

            assert response.status_code == 200, response.text
            body = response.json()
            assert body["count"] == 2
            assert [item["id"] for item in body["threads"]] == [
                str(root.id) for root in eligible_roots
            ]
        finally:
            await engine.dispose()
