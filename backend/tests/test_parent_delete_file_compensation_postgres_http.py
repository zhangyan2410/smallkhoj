"""Real PostgreSQL/filesystem contracts for parent-resource file cleanup."""

from __future__ import annotations

import uuid

import httpx
import pytest
from fastapi import HTTPException
from postgres_test_support import disposable_postgres, run_alembic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from main import app
from models import (
    Account,
    Channel,
    FileEntry,
    Member,
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


async def _seed_parent_delete_world(session_factory):
    suffix = uuid.uuid4().hex[:10]
    server = Server(
        id=uuid.uuid4(),
        name=f"parent-delete-{suffix}",
        server_handle=f"s{uuid.uuid4().hex[:4]}",
    )
    account_id = uuid.uuid4()
    owner = Member(
        id=uuid.uuid4(),
        origin_server_id=server.id,
        account_id=account_id,
        kind="human",
        handle=f"owner-{suffix}",
        handle_key=f"owner-{suffix}",
    )
    agent = Member(
        id=uuid.uuid4(),
        origin_server_id=server.id,
        kind="agent",
        handle=f"agent-{suffix}",
        handle_key=f"agent-{suffix}",
    )
    token = f"parent_delete_{uuid.uuid4().hex}"
    account = Account(
        id=account_id,
        auth_subject=f"test:{token}",
        display_name=f"Owner {suffix}",
        home_server_id=server.id,
        session_token_hash=public_api._hash_token(token),
    )
    membership = ServerMembership(
        id=uuid.uuid4(),
        server_id=server.id,
        account_id=account.id,
        member_id=owner.id,
        role="owner",
        status="active",
    )
    channel = Channel(
        id=uuid.uuid4(),
        server_id=server.id,
        creator_id=owner.id,
        name=f"parent-files-{suffix}",
        kind="public",
    )
    file_id = uuid.uuid4()
    original_path = public_api.UPLOAD_ROOT / f"parent-delete-{file_id}.txt"
    original_path.parent.mkdir(parents=True, exist_ok=True)
    original_path.write_text("parent deletion filesystem evidence", encoding="utf-8")
    file_entry = FileEntry(
        id=file_id,
        server_id=server.id,
        channel_id=channel.id,
        uploaded_by=agent.id,
        file_name=original_path.name,
        original_name="parent-delete-evidence.txt",
        mime_type="text/plain",
        size=original_path.stat().st_size,
        storage_path=str(original_path),
        metadata_json={},
    )

    async with session_factory() as db:
        db.add(server)
        await db.flush()
        db.add(account)
        await db.flush()
        db.add_all([owner, agent])
        await db.flush()
        db.add_all([membership, channel])
        await db.flush()
        db.add_all(
            [
                file_entry,
                SavedItem(
                    server_id=server.id,
                    account_id=account.id,
                    member_id=owner.id,
                    item_type="file",
                    item_id=file_entry.id,
                ),
            ]
        )
        await db.commit()

    return server, owner, agent, token, channel, file_entry, original_path


async def _request_with_database(session_factory, method: str, path: str, *, headers):
    async def override_db():
        async with session_factory() as db:
            yield db

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[public_api.get_db] = override_db
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            return await client.request(method, path, headers=headers)
    finally:
        app.dependency_overrides = previous


@pytest.mark.asyncio
async def test_agent_tombstone_preserves_historical_file_blob():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, _owner, agent, token, _channel, file_entry, original_path = (
            await _seed_parent_delete_world(sessions)
        )
        quarantine_path = (
            public_api.UPLOAD_ROOT / ".deleted" / f"{file_entry.id}-{original_path.name}"
        )
        try:
            response = await _request_with_database(
                sessions,
                "DELETE",
                f"/api/v1/members/{agent.id}",
                headers=_headers(server.id, token),
            )

            assert response.status_code == 200, response.text
            assert response.json()["historicalAttributionPreserved"] is True
            assert original_path.exists()
            assert not quarantine_path.exists()
            async with sessions() as db:
                tombstone = (
                    await db.execute(select(Member).where(Member.id == agent.id))
                ).scalar_one()
                assert tombstone.status == "deleted"
                assert tombstone.deleted_at is not None
                assert (
                    await db.execute(select(FileEntry).where(FileEntry.id == file_entry.id))
                ).scalar_one_or_none() is not None
                assert (
                    await db.execute(
                        select(SavedItem).where(
                            SavedItem.item_type == "file",
                            SavedItem.item_id == file_entry.id,
                        )
                    )
                ).scalar_one_or_none() is not None
        finally:
            original_path.unlink(missing_ok=True)
            quarantine_path.unlink(missing_ok=True)
            await engine.dispose()


@pytest.mark.asyncio
async def test_channel_delete_removes_file_blob():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, _owner, _agent, token, channel, file_entry, original_path = (
            await _seed_parent_delete_world(sessions)
        )
        quarantine_path = (
            public_api.UPLOAD_ROOT / ".deleted" / f"{file_entry.id}-{original_path.name}"
        )
        try:
            response = await _request_with_database(
                sessions,
                "DELETE",
                f"/api/v1/channels/{channel.id}",
                headers=_headers(server.id, token),
            )

            assert response.status_code == 200, response.text
            assert not original_path.exists()
            assert not quarantine_path.exists()
            async with sessions() as db:
                assert (
                    await db.execute(select(FileEntry).where(FileEntry.id == file_entry.id))
                ).scalar_one_or_none() is None
                assert (
                    await db.execute(
                        select(SavedItem).where(
                            SavedItem.item_type == "file",
                            SavedItem.item_id == file_entry.id,
                        )
                    )
                ).scalar_one_or_none() is None
        finally:
            original_path.unlink(missing_ok=True)
            quarantine_path.unlink(missing_ok=True)
            await engine.dispose()


@pytest.mark.asyncio
async def test_agent_tombstone_commit_failure_never_moves_file_blob():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, _owner, agent, token, _channel, file_entry, original_path = (
            await _seed_parent_delete_world(sessions)
        )
        quarantine_path = (
            public_api.UPLOAD_ROOT / ".deleted" / f"{file_entry.id}-{original_path.name}"
        )

        async def override_db():
            async with sessions() as db:
                async def fail_commit():
                    assert original_path.exists()
                    assert not quarantine_path.exists()
                    raise RuntimeError("forced parent-delete commit failure")

                db.commit = fail_commit  # type: ignore[method-assign]
                yield db

        previous = app.dependency_overrides.copy()
        app.dependency_overrides[public_api.get_db] = override_db
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://testserver",
            ) as client:
                with pytest.raises(RuntimeError, match="forced parent-delete commit failure"):
                    await client.delete(
                        f"/api/v1/members/{agent.id}",
                        headers=_headers(server.id, token),
                    )

            assert original_path.exists()
            assert not quarantine_path.exists()
            async with sessions() as db:
                persisted_agent = (
                    await db.execute(select(Member).where(Member.id == agent.id))
                ).scalar_one()
                assert persisted_agent.deleted_at is None
                assert persisted_agent.status != "deleted"
                assert (
                    await db.execute(select(FileEntry).where(FileEntry.id == file_entry.id))
                ).scalar_one_or_none() is not None
        finally:
            app.dependency_overrides = previous
            original_path.unlink(missing_ok=True)
            quarantine_path.unlink(missing_ok=True)
            await engine.dispose()


@pytest.mark.asyncio
async def test_agent_tombstone_does_not_invoke_file_purge(monkeypatch):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, _owner, agent, token, _channel, file_entry, original_path = (
            await _seed_parent_delete_world(sessions)
        )
        quarantine_path = (
            public_api.UPLOAD_ROOT / ".deleted" / f"{file_entry.id}-{original_path.name}"
        )
        purge_calls = []

        def record_purge(path):
            purge_calls.append(path)
            return False

        monkeypatch.setattr(public_api, "_purge_quarantined_file", record_purge)
        try:
            response = await _request_with_database(
                sessions,
                "DELETE",
                f"/api/v1/members/{agent.id}",
                headers=_headers(server.id, token),
            )

            assert response.status_code == 200, response.text
            assert response.json()["historicalAttributionPreserved"] is True
            assert purge_calls == []
            assert original_path.exists()
            assert not quarantine_path.exists()
            async with sessions() as db:
                assert (
                    await db.execute(select(FileEntry).where(FileEntry.id == file_entry.id))
                ).scalar_one_or_none() is not None
        finally:
            original_path.unlink(missing_ok=True)
            quarantine_path.unlink(missing_ok=True)
            await engine.dispose()


def test_batch_quarantine_failure_restores_already_moved_blobs(monkeypatch):
    server_id = uuid.uuid4()
    uploader_id = uuid.uuid4()
    entries = []
    original_paths = []
    quarantine_paths = []
    for index in range(2):
        file_id = uuid.uuid4()
        path = public_api.UPLOAD_ROOT / f"batch-quarantine-{index}-{file_id}.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"batch quarantine evidence {index}", encoding="utf-8")
        entries.append(
            FileEntry(
                id=file_id,
                server_id=server_id,
                uploaded_by=uploader_id,
                file_name=path.name,
                original_name=path.name,
                mime_type="text/plain",
                size=path.stat().st_size,
                storage_path=str(path),
                metadata_json={},
            )
        )
        original_paths.append(path)
        quarantine_paths.append(public_api.UPLOAD_ROOT / ".deleted" / f"{file_id}-{path.name}")

    real_quarantine = public_api._quarantine_file_for_deletion
    calls = 0

    def fail_second_quarantine(path, file_id):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise HTTPException(500, "forced second quarantine failure")
        return real_quarantine(path, file_id)

    monkeypatch.setattr(
        public_api,
        "_quarantine_file_for_deletion",
        fail_second_quarantine,
    )
    try:
        with pytest.raises(HTTPException, match="forced second quarantine failure"):
            public_api._quarantine_file_entries_for_deletion(entries)

        assert all(path.exists() for path in original_paths)
        assert not any(path.exists() for path in quarantine_paths)
    finally:
        for path in [*original_paths, *quarantine_paths]:
            path.unlink(missing_ok=True)
