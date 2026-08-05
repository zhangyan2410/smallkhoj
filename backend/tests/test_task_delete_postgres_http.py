"""Real PostgreSQL contract for authenticated Task deletion."""

from __future__ import annotations

import uuid

import httpx
import pytest
from postgres_test_support import disposable_postgres, run_alembic
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from main import app
from models import (
    Account,
    ActivityLog,
    Channel,
    EventRecord,
    Member,
    SavedItem,
    Server,
    ServerMembership,
    Task,
    TaskAssignment,
    TaskRun,
)
from routers import public_api


def _headers(server_id: uuid.UUID, token: str) -> dict[str, str]:
    return {
        "X-Public-Key": public_api.PUBLIC_API_KEY,
        "X-Account-Token": token,
        "X-Server-Id": str(server_id),
    }


async def _seed_task_world(session_factory, *, role: str = "owner"):
    server = Server(
        id=uuid.uuid4(),
        name=f"task-delete-{uuid.uuid4().hex[:8]}",
        server_handle=f"s{uuid.uuid4().hex[:4]}",
    )
    account_id = uuid.uuid4()
    handle = f"owner-{uuid.uuid4().hex[:8]}"
    member = Member(
        id=uuid.uuid4(),
        origin_server_id=server.id,
        account_id=account_id,
        kind="human",
        handle=handle,
        handle_key=handle,
    )
    token = f"task_delete_{uuid.uuid4().hex}"
    account = Account(
        id=account_id,
        auth_subject=f"test:{token}",
        display_name="Task Deleter",
        home_server_id=server.id,
        session_token_hash=public_api._hash_token(token),
    )
    membership = ServerMembership(
        id=uuid.uuid4(),
        server_id=server.id,
        account_id=account.id,
        member_id=member.id,
        role=role,
        status="active",
    )
    channel = Channel(
        id=uuid.uuid4(),
        server_id=server.id,
        name=f"tasks-{uuid.uuid4().hex[:8]}",
        kind="public",
    )

    async with session_factory() as db:
        db.add_all([server, member, account, membership, channel])
        await db.flush()
        task = Task(
            task_number=7,
            channel_id=channel.id,
            title="Delete me safely",
            status="todo",
            creator_id=member.id,
            assignee_id=member.id,
            data={"source": "postgres-delete-test"},
        )
        db.add(task)
        await db.flush()
        saved = SavedItem(
            server_id=server.id,
            account_id=account.id,
            member_id=member.id,
            item_type="task",
            item_id=task.id,
        )
        assignment = TaskAssignment(
            task_id=task.id,
            assignee_id=member.id,
            assignee_type="member",
            role="worker",
            assignment_mode="system",
            status="active",
            created_by=member.id,
        )
        db.add_all([saved, assignment])
        await db.flush()
        run = TaskRun(
            task_id=task.id,
            assignment_id=assignment.id,
            agent_id=member.id,
            channel_id=channel.id,
            context_session_id=f"task:{task.id}",
            status="queued",
        )
        prior_activity = ActivityLog(
            server_id=server.id,
            agent_id=member.id,
            kind="supervisor_task_updated",
            description="prior task activity",
            details={"taskId": str(task.id)},
            channel_id=channel.id,
            task_id=task.id,
        )
        prior_event = EventRecord(
            server_id=server.id,
            event_type="task.updated",
            actor_id=member.id,
            channel_id=channel.id,
            task_id=task.id,
            payload={"taskId": str(task.id)},
        )
        db.add_all([run, prior_activity, prior_event])
        await db.commit()
    return server, member, token, task, assignment, run, saved, prior_activity, prior_event


@pytest.mark.asyncio
async def test_owner_task_delete_commits_tombstone_without_deleted_foreign_key(monkeypatch):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, member, token, task, assignment, run, saved, prior_activity, prior_event = (
            await _seed_task_world(sessions)
        )
        published_after_commit: list[bool] = []

        async def assert_committed_before_publish(_db, *, server_id):
            async with sessions() as observer:
                published_after_commit.append(
                    (await observer.execute(select(Task.id).where(Task.id == task.id))).scalar_one_or_none()
                    is None
                )
            return 1

        monkeypatch.setattr(public_api, "_push_committed_events", assert_committed_before_publish)

        async def override_db():
            async with sessions() as db:
                yield db

        previous = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as client:
                response = await client.delete(
                    f"/api/v1/tasks/{task.id}", headers=_headers(server.id, token)
                )
        finally:
            app.dependency_overrides = previous

        assert response.status_code == 200, response.text
        assert response.json() == {
            "deleted": True,
            "taskId": str(task.id),
            "taskNumber": task.task_number,
        }
        assert published_after_commit == [True]

        async with sessions() as db:
            assert (await db.execute(select(Task).where(Task.id == task.id))).scalar_one_or_none() is None
            assert (await db.execute(select(TaskAssignment).where(TaskAssignment.id == assignment.id))).scalar_one_or_none() is None
            assert (await db.execute(select(TaskRun).where(TaskRun.id == run.id))).scalar_one_or_none() is None
            assert (await db.execute(select(SavedItem).where(SavedItem.id == saved.id))).scalar_one_or_none() is None

            old_activity = (
                await db.execute(select(ActivityLog).where(ActivityLog.id == prior_activity.id))
            ).scalar_one()
            old_event = (
                await db.execute(select(EventRecord).where(EventRecord.id == prior_event.id))
            ).scalar_one()
            assert old_activity.task_id is None
            assert old_event.task_id is None

            tombstone_activity = (
                await db.execute(
                    select(ActivityLog).where(
                        ActivityLog.server_id == server.id,
                        ActivityLog.kind == "supervisor_task_deleted",
                    )
                )
            ).scalar_one()
            tombstone_event = (
                await db.execute(
                    select(EventRecord).where(
                        EventRecord.server_id == server.id,
                        EventRecord.event_type == "task.deleted",
                    )
                )
            ).scalar_one()
            assert tombstone_activity.task_id is None
            assert tombstone_activity.details["tombstone"] == {
                "taskId": str(task.id),
                "taskNumber": task.task_number,
                "title": task.title,
            }
            assert tombstone_event.task_id is None
            assert tombstone_event.payload["taskId"] == str(task.id)
            assert tombstone_event.payload["tombstone"]["taskNumber"] == task.task_number
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "role,target,expected_status",
    [("member", "own", 403), ("owner", "missing", 404), ("owner", "cross", 404)],
)
async def test_task_delete_rejects_non_admin_missing_and_cross_server_scope(
    role, target, expected_status
):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, _member, token, task, *_ = await _seed_task_world(sessions, role=role)
        requested_task_id = task.id
        expected_task_count = 1
        if target == "missing":
            requested_task_id = uuid.uuid4()
        elif target == "cross":
            _other_server, _other_member, _other_token, other_task, *_ = await _seed_task_world(
                sessions
            )
            requested_task_id = other_task.id
            expected_task_count = 2

        async def override_db():
            async with sessions() as db:
                yield db

        previous = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as client:
                response = await client.delete(
                    f"/api/v1/tasks/{requested_task_id}", headers=_headers(server.id, token)
                )
        finally:
            app.dependency_overrides = previous

        assert response.status_code == expected_status
        async with sessions() as db:
            assert (
                await db.execute(select(func.count()).select_from(Task))
            ).scalar_one() == expected_task_count
            assert (
                await db.execute(
                    select(func.count()).select_from(ActivityLog).where(
                        ActivityLog.kind == "supervisor_task_deleted"
                    )
                )
            ).scalar_one() == 0
        await engine.dispose()


@pytest.mark.asyncio
async def test_task_delete_commit_failure_rolls_back_entity_dependencies_and_audit():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, _member, token, task, assignment, run, saved, *_ = await _seed_task_world(
            sessions
        )

        async def override_db():
            async with sessions() as db:
                async def fail_commit():
                    raise RuntimeError("forced task commit failure")

                db.commit = fail_commit  # type: ignore[method-assign]
                yield db

        previous = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as client:
                with pytest.raises(RuntimeError, match="forced task commit failure"):
                    await client.delete(
                        f"/api/v1/tasks/{task.id}", headers=_headers(server.id, token)
                    )
        finally:
            app.dependency_overrides = previous

        async with sessions() as db:
            assert (await db.execute(select(Task.id).where(Task.id == task.id))).scalar_one() == task.id
            assert (
                await db.execute(select(TaskAssignment.id).where(TaskAssignment.id == assignment.id))
            ).scalar_one() == assignment.id
            assert (await db.execute(select(TaskRun.id).where(TaskRun.id == run.id))).scalar_one() == run.id
            assert (await db.execute(select(SavedItem.id).where(SavedItem.id == saved.id))).scalar_one() == saved.id
            assert (
                await db.execute(
                    select(func.count()).select_from(ActivityLog).where(
                        ActivityLog.kind == "supervisor_task_deleted"
                    )
                )
            ).scalar_one() == 0
        await engine.dispose()
