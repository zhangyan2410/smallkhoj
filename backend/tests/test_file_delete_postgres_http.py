"""Real PostgreSQL and filesystem contract for authenticated File deletion."""

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
    FileEntry,
    Member,
    MemoryEntry,
    SavedItem,
    Server,
    ServerMembership,
)
from routers import public_api


def _headers(server_id: uuid.UUID, token: str) -> dict[str, str]:
    return {
        "X-Public-Key": public_api.PUBLIC_API_KEY,
        "X-Account-Token": token,
        "X-Server-Id": str(server_id),
    }


async def _seed_file_world(session_factory, *, role: str = "owner"):
    server = Server(
        id=uuid.uuid4(),
        name=f"file-delete-{uuid.uuid4().hex[:8]}",
        server_handle=f"s{uuid.uuid4().hex[:4]}",
    )
    account_id = uuid.uuid4()
    handle = f"file-owner-{uuid.uuid4().hex[:8]}"
    member = Member(
        id=uuid.uuid4(),
        origin_server_id=server.id,
        account_id=account_id,
        kind="human",
        handle=handle,
        handle_key=handle,
    )
    token = f"file_delete_{uuid.uuid4().hex}"
    account = Account(
        id=account_id,
        auth_subject=f"test:{token}",
        display_name="File Deleter",
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
        name=f"files-{uuid.uuid4().hex[:8]}",
        kind="public",
    )
    file_id = uuid.uuid4()
    original_path = public_api.UPLOAD_ROOT / f"audit-remediation-{file_id}.txt"
    original_path.parent.mkdir(parents=True, exist_ok=True)
    original_path.write_text("disposable file deletion evidence", encoding="utf-8")
    file_entry = FileEntry(
        id=file_id,
        server_id=server.id,
        channel_id=channel.id,
        uploaded_by=member.id,
        file_name=original_path.name,
        original_name="evidence.txt",
        mime_type="text/plain",
        size=original_path.stat().st_size,
        storage_path=str(original_path),
        metadata_json={},
    )

    async with session_factory() as db:
        db.add_all([server, member, account, membership, channel, file_entry])
        await db.flush()
        saved = SavedItem(
            server_id=server.id,
            account_id=account.id,
            member_id=member.id,
            item_type="file",
            item_id=file_entry.id,
        )
        memory = MemoryEntry(
            server_id=server.id,
            scope_type="channel",
            scope_id=channel.id,
            path=f"files/{file_entry.id}",
            entry_kind="file",
            file_id=file_entry.id,
            size_bytes=file_entry.size,
            content_sha256="0" * 64,
            source_channel_id=channel.id,
            author_member_id=member.id,
            metadata_json={},
        )
        db.add_all([saved, memory])
        await db.commit()
    return server, token, file_entry, saved, memory, original_path


@pytest.mark.asyncio
async def test_owner_file_delete_commits_tombstone_and_removes_blob(monkeypatch):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, token, file_entry, saved, memory, original_path = await _seed_file_world(sessions)
        published_after_commit: list[bool] = []

        async def assert_committed_before_publish(_db, *, server_id):
            async with sessions() as observer:
                published_after_commit.append(
                    (
                        await observer.execute(
                            select(FileEntry.id).where(FileEntry.id == file_entry.id)
                        )
                    ).scalar_one_or_none()
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
                    f"/api/v1/files/{file_entry.id}", headers=_headers(server.id, token)
                )
        finally:
            app.dependency_overrides = previous
            original_path.unlink(missing_ok=True)

        assert response.status_code == 200, response.text
        assert response.json() == {
            "deleted": True,
            "fileId": str(file_entry.id),
            "storageCleanup": "deleted",
        }
        assert published_after_commit == [True]
        assert not original_path.exists()
        assert not (public_api.UPLOAD_ROOT / ".deleted" / f"{file_entry.id}-{original_path.name}").exists()

        async with sessions() as db:
            assert (
                await db.execute(select(FileEntry).where(FileEntry.id == file_entry.id))
            ).scalar_one_or_none() is None
            assert (
                await db.execute(select(SavedItem).where(SavedItem.id == saved.id))
            ).scalar_one_or_none() is None
            retained_memory = (
                await db.execute(select(MemoryEntry).where(MemoryEntry.id == memory.id))
            ).scalar_one()
            assert retained_memory.file_id is None

            activity = (
                await db.execute(
                    select(ActivityLog).where(ActivityLog.kind == "supervisor_file_deleted")
                )
            ).scalar_one()
            event = (
                await db.execute(select(EventRecord).where(EventRecord.event_type == "file.deleted"))
            ).scalar_one()
            assert activity.details["tombstone"]["fileId"] == str(file_entry.id)
            assert event.payload["fileId"] == str(file_entry.id)
            assert event.payload["tombstone"]["originalName"] == "evidence.txt"
        await engine.dispose()


@pytest.mark.asyncio
async def test_file_delete_reports_quarantined_when_post_commit_purge_fails(monkeypatch):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, token, file_entry, _saved, _memory, original_path = await _seed_file_world(sessions)

        monkeypatch.setattr(public_api, "_purge_quarantined_file", lambda _path: False, raising=False)

        async def override_db():
            async with sessions() as db:
                yield db

        previous = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        quarantine_path = public_api.UPLOAD_ROOT / ".deleted" / f"{file_entry.id}-{original_path.name}"
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as client:
                response = await client.delete(
                    f"/api/v1/files/{file_entry.id}", headers=_headers(server.id, token)
                )
            assert response.status_code == 200, response.text
            assert response.json()["storageCleanup"] == "quarantined"
            assert not original_path.exists()
            assert quarantine_path.exists()
            async with sessions() as db:
                assert (
                    await db.execute(select(func.count()).select_from(FileEntry))
                ).scalar_one() == 0
        finally:
            app.dependency_overrides = previous
            original_path.unlink(missing_ok=True)
            quarantine_path.unlink(missing_ok=True)
            await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "role,target,expected_status",
    [("member", "own", 403), ("owner", "missing", 404), ("owner", "cross", 404)],
)
async def test_file_delete_rejects_non_admin_missing_and_cross_server_scope(
    role, target, expected_status
):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, token, file_entry, *_rest, original_path = await _seed_file_world(
            sessions, role=role
        )
        requested_file_id = file_entry.id
        paths = [original_path]
        if target == "missing":
            requested_file_id = uuid.uuid4()
        elif target == "cross":
            _other_server, _other_token, other_file, *_other_rest, other_path = (
                await _seed_file_world(sessions)
            )
            requested_file_id = other_file.id
            paths.append(other_path)

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
                    f"/api/v1/files/{requested_file_id}", headers=_headers(server.id, token)
                )
            assert response.status_code == expected_status
            async with sessions() as db:
                assert (
                    await db.execute(select(func.count()).select_from(FileEntry))
                ).scalar_one() == len(paths)
                assert (
                    await db.execute(
                        select(func.count()).select_from(ActivityLog).where(
                            ActivityLog.kind == "supervisor_file_deleted"
                        )
                    )
                ).scalar_one() == 0
        finally:
            app.dependency_overrides = previous
            for path in paths:
                path.unlink(missing_ok=True)
            await engine.dispose()


@pytest.mark.asyncio
async def test_file_delete_db_failure_restores_blob_and_rolls_back_audit():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, token, file_entry, _saved, _memory, original_path = await _seed_file_world(sessions)
        quarantine_path = public_api.UPLOAD_ROOT / ".deleted" / f"{file_entry.id}-{original_path.name}"

        async def override_db():
            async with sessions() as db:
                async def fail_commit():
                    raise RuntimeError("forced commit failure")

                db.commit = fail_commit  # type: ignore[method-assign]
                yield db

        previous = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as client:
                with pytest.raises(RuntimeError, match="forced commit failure"):
                    await client.delete(
                        f"/api/v1/files/{file_entry.id}", headers=_headers(server.id, token)
                    )

            assert original_path.exists()
            assert not quarantine_path.exists()
            async with sessions() as db:
                assert (
                    await db.execute(select(func.count()).select_from(FileEntry))
                ).scalar_one() == 1
                assert (
                    await db.execute(
                        select(func.count()).select_from(ActivityLog).where(
                            ActivityLog.kind == "supervisor_file_deleted"
                        )
                    )
                ).scalar_one() == 0
        finally:
            app.dependency_overrides = previous
            original_path.unlink(missing_ok=True)
            quarantine_path.unlink(missing_ok=True)
            await engine.dispose()
