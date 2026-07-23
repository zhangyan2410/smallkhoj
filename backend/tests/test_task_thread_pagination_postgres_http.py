import base64
from datetime import datetime, timedelta, timezone
import json
from urllib.parse import quote
import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from main import app
from models import Channel, Message, Task
from routers import public_api
from tests.postgres_test_support import disposable_postgres, run_alembic
from tests.test_serializer_query_budget_postgres_http import (
    _agent_headers,
    _public_headers,
    _seed_query_world,
)


async def _traverse(client, path, *, headers, item_key, limit=2, cursor=None):
    item_ids = []
    seen_cursors = set()
    for _ in range(20):
        separator = "&" if "?" in path else "?"
        request_path = f"{path}{separator}limit={limit}"
        if cursor:
            request_path += f"&cursor={quote(cursor, safe='')}"
        response = await client.get(request_path, headers=headers)
        assert response.status_code == 200, response.text
        body = response.json()
        items = body[item_key]
        assert len(items) <= limit
        item_ids.extend(item["id"] for item in items)
        cursor = body.get("nextCursor")
        if cursor is None:
            break
        assert cursor not in seen_cursors
        seen_cursors.add(cursor)
    else:
        pytest.fail("cursor traversal exceeded 20 pages")
    return item_ids


def _rewrite_cursor(cursor: str, **updates) -> str:
    padding = "=" * (-len(cursor) % 4)
    payload = json.loads(base64.urlsafe_b64decode(cursor + padding))
    payload.update(updates)
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


@pytest.mark.asyncio
async def test_public_and_agent_tasks_traverse_cross_channel_number_ties_once():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            world = await _seed_query_world(sessions, row_count=1)
            second_channel = Channel(
                id=uuid.uuid4(),
                server_id=world["server"].id,
                name="pagination-second",
                kind="public",
                creator_id=world["owner"].id,
            )
            extra_tasks = [
                Task(
                    id=uuid.uuid4(),
                    task_number=number,
                    channel_id=channel_id,
                    title=f"Pagination task {channel_id} #{number}",
                    status="todo",
                    creator_id=world["owner"].id,
                    assignee_id=world["agent"].id,
                    data={},
                )
                for channel_id, numbers in (
                    (world["channel"].id, (2, 3)),
                    (second_channel.id, (1, 2, 3)),
                )
                for number in numbers
            ]
            async with sessions.begin() as db:
                db.add(second_channel)
                await db.flush()
                db.add_all(extra_tasks)

            all_tasks = [world["tasks"][0], *extra_tasks]
            expected_ids = [
                str(task.id)
                for task in sorted(
                    all_tasks,
                    key=lambda task: (task.task_number, task.channel_id, task.id),
                )
            ]

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
                    public_ids = await _traverse(
                        client,
                        "/api/v1/tasks",
                        headers=_public_headers(world["server"].id, world["account_token"]),
                        item_key="tasks",
                    )
                    agent_ids = await _traverse(
                        client,
                        "/internal/agent-api/tasks",
                        headers=_agent_headers(world["agent"].id, world["agent_token"]),
                        item_key="tasks",
                    )
            finally:
                app.dependency_overrides = previous

            assert public_ids == expected_ids
            assert agent_ids == expected_ids
            assert len(set(public_ids)) == len(expected_ids)
            assert len(set(agent_ids)) == len(expected_ids)
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_agent_threads_traverse_equal_timestamp_roots_once():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            world = await _seed_query_world(sessions, row_count=1)
            tied_at = datetime(2026, 7, 23, 12, 0, tzinfo=timezone.utc)
            roots = [
                Message(
                    id=uuid.uuid4(),
                    short_id=f"pgroot{index:02d}",
                    channel_id=world["channel"].id,
                    sender_id=world["agent"].id,
                    content=f"pagination root {index}",
                    channel_type="channel",
                    mentions=[],
                    created_at=tied_at,
                    updated_at=tied_at,
                )
                for index in range(5)
            ]
            replies = [
                Message(
                    id=uuid.uuid4(),
                    short_id=f"pgreply{index:02d}",
                    channel_id=world["channel"].id,
                    sender_id=world["owner"].id,
                    parent_id=root.id,
                    content=f"pagination reply {index}",
                    channel_type="thread",
                    mentions=[],
                    created_at=tied_at,
                    updated_at=tied_at,
                )
                for index, root in enumerate(roots)
            ]
            async with sessions.begin() as db:
                db.add_all([*roots, *replies])

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
                    thread_ids = await _traverse(
                        client,
                        "/internal/agent-api/threads?channel=query-budget",
                        headers=_agent_headers(world["agent"].id, world["agent_token"]),
                        item_key="threads",
                    )
            finally:
                app.dependency_overrides = previous

            expected_ids = [str(root.id) for root in sorted(roots, key=lambda root: root.id, reverse=True)]
            assert thread_ids == expected_ids
            assert len(set(thread_ids)) == len(expected_ids)
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_task_cursors_reject_malformed_foreign_and_over_limit_requests():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            world = await _seed_query_world(sessions, row_count=2)

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
                    public_headers = _public_headers(
                        world["server"].id,
                        world["account_token"],
                    )
                    malformed = await client.get(
                        "/api/v1/tasks?cursor=!!!",
                        headers=public_headers,
                    )
                    over_limit = await client.get(
                        "/api/v1/tasks?limit=201",
                        headers=public_headers,
                    )
                    first_page = await client.get(
                        "/api/v1/tasks?limit=1",
                        headers=public_headers,
                    )
                    public_cursor = first_page.json()["nextCursor"]
                    foreign = await client.get(
                        f"/internal/agent-api/tasks?limit=1&cursor={quote(public_cursor, safe='')}",
                        headers=_agent_headers(world["agent"].id, world["agent_token"]),
                    )
            finally:
                app.dependency_overrides = previous

            assert malformed.status_code == 400
            assert malformed.json() == {"detail": "Invalid pagination cursor"}
            assert over_limit.status_code == 422
            assert first_page.status_code == 200
            assert foreign.status_code == 400
            assert foreign.json() == {"detail": "Invalid pagination cursor"}
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_task_cursor_survives_deleted_boundary_and_ignores_insert_before_it():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            world = await _seed_query_world(sessions, row_count=5)
            expected_ids = [
                str(task.id)
                for task in sorted(
                    world["tasks"],
                    key=lambda task: (task.task_number, task.channel_id, task.id),
                )
            ]

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
                    headers = _public_headers(world["server"].id, world["account_token"])
                    first_response = await client.get(
                        "/api/v1/tasks?limit=2",
                        headers=headers,
                    )
                    assert first_response.status_code == 200, first_response.text
                    first_body = first_response.json()
                    first_ids = [item["id"] for item in first_body["tasks"]]
                    cursor = first_body["nextCursor"]
                    assert cursor is not None

                    boundary_id = uuid.UUID(first_ids[-1])
                    inserted = Task(
                        id=uuid.uuid4(),
                        task_number=0,
                        channel_id=world["channel"].id,
                        title="Inserted before the cursor",
                        status="todo",
                        creator_id=world["owner"].id,
                        assignee_id=world["agent"].id,
                        data={},
                    )
                    async with sessions.begin() as db:
                        boundary = await db.get(Task, boundary_id)
                        assert boundary is not None
                        await db.delete(boundary)
                        db.add(inserted)

                    remaining_ids = await _traverse(
                        client,
                        "/api/v1/tasks",
                        headers=headers,
                        item_key="tasks",
                        cursor=cursor,
                    )
            finally:
                app.dependency_overrides = previous

            traversed_ids = [*first_ids, *remaining_ids]
            assert traversed_ids == expected_ids
            assert str(inserted.id) not in traversed_ids
            assert len(set(traversed_ids)) == len(expected_ids)
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_thread_cursor_survives_deleted_boundary_and_ignores_newer_insert():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            world = await _seed_query_world(sessions, row_count=1)
            tied_at = datetime(2026, 7, 23, 12, 0, tzinfo=timezone.utc)
            roots = [
                Message(
                    id=uuid.uuid4(),
                    short_id=f"mutroot{index:02d}",
                    channel_id=world["channel"].id,
                    sender_id=world["agent"].id,
                    content=f"mutation root {index}",
                    channel_type="channel",
                    mentions=[],
                    created_at=tied_at,
                    updated_at=tied_at,
                )
                for index in range(5)
            ]
            replies = [
                Message(
                    id=uuid.uuid4(),
                    short_id=f"mutreply{index:02d}",
                    channel_id=world["channel"].id,
                    sender_id=world["owner"].id,
                    parent_id=root.id,
                    content=f"mutation reply {index}",
                    channel_type="thread",
                    mentions=[],
                    created_at=tied_at,
                    updated_at=tied_at,
                )
                for index, root in enumerate(roots)
            ]
            async with sessions.begin() as db:
                db.add_all([*roots, *replies])

            expected_ids = [
                str(root.id)
                for root in sorted(roots, key=lambda root: root.id, reverse=True)
            ]

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
                    headers = _agent_headers(world["agent"].id, world["agent_token"])
                    path = "/internal/agent-api/threads?channel=query-budget"
                    first_response = await client.get(f"{path}&limit=2", headers=headers)
                    assert first_response.status_code == 200, first_response.text
                    first_body = first_response.json()
                    first_ids = [item["id"] for item in first_body["threads"]]
                    cursor = first_body["nextCursor"]
                    assert cursor is not None

                    boundary_id = uuid.UUID(first_ids[-1])
                    boundary_index = next(
                        index for index, root in enumerate(roots) if root.id == boundary_id
                    )
                    newer_root = Message(
                        id=uuid.uuid4(),
                        short_id="mutnewroot",
                        channel_id=world["channel"].id,
                        sender_id=world["agent"].id,
                        content="inserted newer root",
                        channel_type="channel",
                        mentions=[],
                        created_at=tied_at + timedelta(seconds=1),
                        updated_at=tied_at + timedelta(seconds=1),
                    )
                    newer_reply = Message(
                        id=uuid.uuid4(),
                        short_id="mutnewreply",
                        channel_id=world["channel"].id,
                        sender_id=world["owner"].id,
                        parent_id=newer_root.id,
                        content="inserted newer reply",
                        channel_type="thread",
                        mentions=[],
                        created_at=tied_at + timedelta(seconds=1),
                        updated_at=tied_at + timedelta(seconds=1),
                    )
                    async with sessions.begin() as db:
                        boundary_reply = await db.get(Message, replies[boundary_index].id)
                        boundary_root = await db.get(Message, boundary_id)
                        assert boundary_reply is not None
                        assert boundary_root is not None
                        await db.delete(boundary_reply)
                        await db.flush()
                        await db.delete(boundary_root)
                        db.add_all([newer_root, newer_reply])

                    remaining_ids = await _traverse(
                        client,
                        path,
                        headers=headers,
                        item_key="threads",
                        cursor=cursor,
                    )
            finally:
                app.dependency_overrides = previous

            traversed_ids = [*first_ids, *remaining_ids]
            assert traversed_ids == expected_ids
            assert str(newer_root.id) not in traversed_ids
            assert len(set(traversed_ids)) == len(expected_ids)
        finally:
            await engine.dispose()


@pytest.mark.asyncio
async def test_task_and_thread_cursors_reject_changed_query_scope():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            world = await _seed_query_world(sessions, row_count=3)
            second_channel = Channel(
                id=uuid.uuid4(),
                server_id=world["server"].id,
                name="pagination-scope-second",
                kind="public",
                creator_id=world["owner"].id,
            )
            tied_at = datetime(2026, 7, 23, 13, 0, tzinfo=timezone.utc)
            roots = []
            replies = []
            for index, channel_id in enumerate((
                world["channel"].id,
                world["channel"].id,
                second_channel.id,
            )):
                root = Message(
                    id=uuid.uuid4(),
                    short_id=f"scoperoot{index}",
                    channel_id=channel_id,
                    sender_id=world["agent"].id,
                    content=f"scope root {index}",
                    channel_type="channel",
                    mentions=[],
                    created_at=tied_at,
                    updated_at=tied_at,
                )
                roots.append(root)
                replies.append(Message(
                    id=uuid.uuid4(),
                    short_id=f"scopereply{index}",
                    channel_id=channel_id,
                    sender_id=world["owner"].id,
                    parent_id=root.id,
                    content=f"scope reply {index}",
                    channel_type="thread",
                    mentions=[],
                    created_at=tied_at,
                    updated_at=tied_at,
                ))
            async with sessions.begin() as db:
                db.add(second_channel)
                await db.flush()
                db.add_all([*roots, *replies])

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
                    task_page = await client.get(
                        "/internal/agent-api/tasks?limit=1",
                        headers=agent_headers,
                    )
                    assert task_page.status_code == 200, task_page.text
                    task_cursor = task_page.json()["nextCursor"]
                    assert task_cursor is not None

                    changed_filter = await client.get(
                        f"/internal/agent-api/tasks?status=todo&limit=1&cursor={quote(task_cursor, safe='')}",
                        headers=agent_headers,
                    )
                    changed_version_cursor = _rewrite_cursor(task_cursor, v=2)
                    changed_version = await client.get(
                        f"/internal/agent-api/tasks?limit=1&cursor={quote(changed_version_cursor, safe='')}",
                        headers=agent_headers,
                    )
                    foreign_server_cursor = _rewrite_cursor(
                        task_cursor,
                        serverId=str(uuid.uuid4()),
                    )
                    foreign_server = await client.get(
                        f"/internal/agent-api/tasks?limit=1&cursor={quote(foreign_server_cursor, safe='')}",
                        headers=agent_headers,
                    )

                    thread_page = await client.get(
                        "/internal/agent-api/threads?channel=query-budget&limit=1",
                        headers=agent_headers,
                    )
                    assert thread_page.status_code == 200, thread_page.text
                    thread_cursor = thread_page.json()["nextCursor"]
                    assert thread_cursor is not None
                    changed_channel = await client.get(
                        "/internal/agent-api/threads"
                        f"?channel={second_channel.name}&limit=1"
                        f"&cursor={quote(thread_cursor, safe='')}",
                        headers=agent_headers,
                    )
            finally:
                app.dependency_overrides = previous

            for response in (
                changed_filter,
                changed_version,
                foreign_server,
                changed_channel,
            ):
                assert response.status_code == 400
                assert response.json() == {"detail": "Invalid pagination cursor"}
        finally:
            await engine.dispose()
