"""Upload routes own bounded reads, handles, database state, and local blobs."""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from main import app
from models import Account, Channel, FileEntry, Member, Server, ServerMembership
from routers import agent_api, public_api
from services import upload_storage
from tests.postgres_test_support import disposable_postgres, run_alembic

REPO_ROOT = Path(__file__).resolve().parents[2]


class TrackingUpload:
    def __init__(self, payload: bytes, *, filename: str = "proof.txt", content_type: str = "text/plain"):
        self.payload = payload
        self.filename = filename
        self.content_type = content_type
        self.offset = 0
        self.read_sizes: list[int] = []
        self.closed = False

    async def read(self, size: int = -1) -> bytes:
        self.read_sizes.append(size)
        if self.offset >= len(self.payload):
            return b""
        if size is None or size < 0:
            chunk = self.payload[self.offset:]
            self.offset = len(self.payload)
            return chunk
        chunk = self.payload[self.offset:self.offset + size]
        self.offset += len(chunk)
        return chunk

    async def close(self) -> None:
        self.closed = True


class InterruptingUpload(TrackingUpload):
    def __init__(self, payload: bytes, error: BaseException):
        super().__init__(payload)
        self.error = error
        self.read_count = 0

    async def read(self, size: int = -1) -> bytes:
        self.read_count += 1
        if self.read_count == 2:
            raise self.error
        return await super().read(size)


class FakeResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class TrackingSession:
    def __init__(self, *, execute_values=(), commit_error: Exception | None = None):
        self.execute_values = list(execute_values)
        self.commit_error = commit_error
        self.added: list[object] = []
        self.flushed = False
        self.committed = False
        self.rolled_back = False

    async def execute(self, _statement):
        return FakeResult(self.execute_values.pop(0))

    def add(self, value) -> None:
        self.added.append(value)

    async def flush(self) -> None:
        self.flushed = True

    async def commit(self) -> None:
        if self.commit_error:
            raise self.commit_error
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True

    async def refresh(self, _value) -> None:
        return None


def _member(*, permission: str):
    return SimpleNamespace(
        id=uuid.uuid4(),
        display_name="upload-agent",
        handle="upload-agent",
        kind="agent",
        status="offline",
        config={"permissions": {permission: True}},
        skills=[],
        computer_id=None,
        backend=None,
        description=None,
        avatar_url=None,
        workspaces=[],
    )


def _server():
    return SimpleNamespace(id=uuid.uuid4())


def _assert_no_upload_residue(root: Path) -> None:
    assert not [path for path in root.rglob("*") if path.is_file()]


@pytest.mark.asyncio
async def test_staging_accepts_exact_limit_and_promotes_one_complete_blob(tmp_path):
    upload = TrackingUpload(b"12345678")
    final_path = tmp_path / "server" / "proof.txt"

    staged = await upload_storage.stage_upload(
        upload,  # type: ignore[arg-type]
        final_path=final_path,
        max_bytes=8,
        empty_detail="Empty file",
        chunk_bytes=3,
    )

    assert staged.size == 8
    assert staged.staging_path.read_bytes() == b"12345678"
    assert final_path.exists() is False
    assert upload.read_sizes == [3, 3, 3, 3]

    staged.promote()
    assert final_path.read_bytes() == b"12345678"
    assert staged.staging_path.exists() is False
    staged.cleanup()
    _assert_no_upload_residue(tmp_path)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [ConnectionError("interrupted body"), asyncio.CancelledError()],
)
async def test_staging_removes_partial_file_on_interruption_or_cancellation(tmp_path, error):
    upload = InterruptingUpload(b"partial body", error)

    with pytest.raises(type(error)):
        await upload_storage.stage_upload(
            upload,  # type: ignore[arg-type]
            final_path=tmp_path / "server" / "partial.txt",
            max_bytes=1024,
            empty_detail="Empty file",
            chunk_bytes=4,
        )

    _assert_no_upload_residue(tmp_path)


@pytest.mark.asyncio
async def test_staging_removes_partial_file_when_local_write_fails(monkeypatch, tmp_path):
    upload = TrackingUpload(b"write failure")

    async def fail_to_thread(_function, *_args, **_kwargs):
        raise OSError("forced local write failure")

    monkeypatch.setattr(upload_storage.asyncio, "to_thread", fail_to_thread)
    with pytest.raises(OSError, match="forced local write failure"):
        await upload_storage.stage_upload(
            upload,  # type: ignore[arg-type]
            final_path=tmp_path / "server" / "write.txt",
            max_bytes=1024,
            empty_detail="Empty file",
        )

    _assert_no_upload_residue(tmp_path)


@pytest.mark.asyncio
async def test_agent_attachment_rejects_over_limit_without_unbounded_read_or_residue(
    monkeypatch, tmp_path
):
    upload = TrackingUpload(b"123456789")
    db = TrackingSession()
    member = _member(permission="fileWrite")
    server = _server()

    async def no_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(agent_api, "UPLOAD_ROOT", tmp_path)
    monkeypatch.setattr(agent_api, "MAX_UPLOAD_SIZE", 8, raising=False)
    monkeypatch.setattr(agent_api, "_record_activity", no_activity)

    with pytest.raises(HTTPException) as exc:
        await agent_api.upload_attachment(
            file=upload,  # type: ignore[arg-type]
            channelId=None,
            mimeType=None,
            agent=(member, server),
            db=db,  # type: ignore[arg-type]
        )

    assert exc.value.status_code == 413
    assert upload.closed is True
    assert upload.read_sizes and all(size > 0 for size in upload.read_sizes)
    assert db.added == []
    assert db.committed is False
    _assert_no_upload_residue(tmp_path)


@pytest.mark.asyncio
async def test_avatar_rejects_over_limit_without_unbounded_read_or_residue(monkeypatch, tmp_path):
    upload = TrackingUpload(b"123456789", filename="avatar.png", content_type="image/png")
    db = TrackingSession()
    member = _member(permission="updateProfile")
    server = _server()

    async def no_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(agent_api, "UPLOAD_ROOT", tmp_path)
    monkeypatch.setattr(agent_api, "MAX_UPLOAD_SIZE", 8, raising=False)
    monkeypatch.setattr(agent_api, "_record_activity", no_activity)

    with pytest.raises(HTTPException) as exc:
        await agent_api.update_profile_avatar(
            avatar=upload,  # type: ignore[arg-type]
            mimeType=None,
            agent=(member, server),
            db=db,  # type: ignore[arg-type]
        )

    assert exc.value.status_code == 413
    assert upload.closed is True
    assert upload.read_sizes and all(size > 0 for size in upload.read_sizes)
    assert db.added == []
    assert db.committed is False
    _assert_no_upload_residue(tmp_path)


@pytest.mark.asyncio
async def test_public_file_rejects_over_limit_without_unbounded_read_or_residue(
    monkeypatch, tmp_path
):
    upload = TrackingUpload(b"123456789")
    server = _server()
    member = _member(permission="fileWrite")
    channel = SimpleNamespace(id=uuid.uuid4(), server_id=server.id, kind="public")
    db = TrackingSession(execute_values=[channel])

    async def resolve_context(_db, _request):
        return SimpleNamespace(server=server, member=member)

    async def resolve_actor(_db, _server, _request, _actor, *, role):
        assert role == "file upload"
        return member

    monkeypatch.setattr(public_api, "UPLOAD_ROOT", tmp_path)
    monkeypatch.setattr(public_api, "MAX_UPLOAD_SIZE", 8)
    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "_resolve_human_actor", resolve_actor)

    with pytest.raises(HTTPException) as exc:
        await public_api.upload_file(
            request=SimpleNamespace(),  # type: ignore[arg-type]
            file=upload,  # type: ignore[arg-type]
            channel_id=str(channel.id),
            message_id=None,
            _auth=None,
            db=db,  # type: ignore[arg-type]
        )

    assert exc.value.status_code == 413
    assert upload.closed is True
    assert upload.read_sizes and all(size > 0 for size in upload.read_sizes)
    assert db.added == []
    assert db.committed is False
    _assert_no_upload_residue(tmp_path)


@pytest.mark.asyncio
async def test_attachment_commit_failure_rolls_back_closes_and_unlinks(monkeypatch, tmp_path):
    upload = TrackingUpload(b"valid body")
    db = TrackingSession(commit_error=RuntimeError("forced commit failure"))
    member = _member(permission="fileWrite")
    server = _server()

    async def no_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(agent_api, "UPLOAD_ROOT", tmp_path)
    monkeypatch.setattr(agent_api, "MAX_UPLOAD_SIZE", 1024, raising=False)
    monkeypatch.setattr(agent_api, "_record_activity", no_activity)

    with pytest.raises(RuntimeError, match="forced commit failure"):
        await agent_api.upload_attachment(
            file=upload,  # type: ignore[arg-type]
            channelId=None,
            mimeType=None,
            agent=(member, server),
            db=db,  # type: ignore[arg-type]
        )

    assert db.rolled_back is True
    assert upload.closed is True
    _assert_no_upload_residue(tmp_path)


@pytest.mark.asyncio
async def test_avatar_commit_failure_rolls_back_closes_and_unlinks(monkeypatch, tmp_path):
    upload = TrackingUpload(b"valid avatar", filename="avatar.png", content_type="image/png")
    db = TrackingSession(commit_error=RuntimeError("forced avatar commit failure"))
    member = _member(permission="updateProfile")
    server = _server()

    async def no_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(agent_api, "UPLOAD_ROOT", tmp_path)
    monkeypatch.setattr(agent_api, "MAX_UPLOAD_SIZE", 1024)
    monkeypatch.setattr(agent_api, "_record_activity", no_activity)

    with pytest.raises(RuntimeError, match="forced avatar commit failure"):
        await agent_api.update_profile_avatar(
            avatar=upload,  # type: ignore[arg-type]
            mimeType=None,
            agent=(member, server),
            db=db,  # type: ignore[arg-type]
        )

    assert db.rolled_back is True
    assert upload.closed is True
    _assert_no_upload_residue(tmp_path)


@pytest.mark.asyncio
async def test_public_commit_failure_rolls_back_closes_and_unlinks(monkeypatch, tmp_path):
    upload = TrackingUpload(b"valid public file")
    server = _server()
    member = _member(permission="fileWrite")
    channel = SimpleNamespace(id=uuid.uuid4(), server_id=server.id, kind="public")
    db = TrackingSession(
        execute_values=[channel],
        commit_error=RuntimeError("forced public commit failure"),
    )

    async def resolve_context(_db, _request):
        return SimpleNamespace(server=server, member=member)

    async def resolve_actor(_db, _server, _request, _actor, *, role):
        assert role == "file upload"
        return member

    monkeypatch.setattr(public_api, "UPLOAD_ROOT", tmp_path)
    monkeypatch.setattr(public_api, "MAX_UPLOAD_SIZE", 1024)
    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "_resolve_human_actor", resolve_actor)

    with pytest.raises(RuntimeError, match="forced public commit failure"):
        await public_api.upload_file(
            request=SimpleNamespace(),  # type: ignore[arg-type]
            file=upload,  # type: ignore[arg-type]
            channel_id=str(channel.id),
            message_id=None,
            _auth=None,
            db=db,  # type: ignore[arg-type]
        )

    assert db.rolled_back is True
    assert upload.closed is True
    _assert_no_upload_residue(tmp_path)


@pytest.mark.asyncio
async def test_cancelled_agent_read_closes_handle_and_removes_partial_file(monkeypatch, tmp_path):
    upload = InterruptingUpload(b"partial attachment", asyncio.CancelledError())
    db = TrackingSession()
    member = _member(permission="fileWrite")
    server = _server()

    monkeypatch.setattr(agent_api, "UPLOAD_ROOT", tmp_path)
    monkeypatch.setattr(agent_api, "MAX_UPLOAD_SIZE", 1024)

    with pytest.raises(asyncio.CancelledError):
        await agent_api.upload_attachment(
            file=upload,  # type: ignore[arg-type]
            channelId=None,
            mimeType=None,
            agent=(member, server),
            db=db,  # type: ignore[arg-type]
        )

    assert upload.closed is True
    assert db.added == []
    _assert_no_upload_residue(tmp_path)


@pytest.mark.asyncio
async def test_invalid_public_metadata_still_closes_upload(monkeypatch):
    upload = TrackingUpload(b"never read")

    async def resolve_context(_db, _request):
        return SimpleNamespace(server=_server())

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)

    with pytest.raises(HTTPException) as exc:
        await public_api.upload_file(
            request=SimpleNamespace(),  # type: ignore[arg-type]
            file=upload,  # type: ignore[arg-type]
            channel_id="not-a-uuid",
            message_id=None,
            _auth=None,
            db=TrackingSession(),  # type: ignore[arg-type]
        )

    assert exc.value.status_code == 400
    assert upload.closed is True
    assert upload.read_sizes == []


@pytest.mark.asyncio
async def test_public_upload_exact_limit_and_over_limit_leave_consistent_postgres_and_files(
    monkeypatch, tmp_path
):
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            server = Server(
                id=uuid.uuid4(),
                name=f"upload-{uuid.uuid4().hex[:8]}",
                server_handle=f"s{uuid.uuid4().hex[:4]}",
            )
            account_id = uuid.uuid4()
            member = Member(
                id=uuid.uuid4(),
                origin_server_id=server.id,
                account_id=account_id,
                kind="human",
                handle="upload-owner",
                handle_key="upload-owner",
                status="online",
                config={},
                skills=[],
            )
            token = f"upload_session_{uuid.uuid4().hex}"
            account = Account(
                id=account_id,
                auth_subject=f"test:{token}",
                display_name="Upload Owner",
                home_server_id=server.id,
                session_token_hash=public_api._hash_token(token),
            )
            membership = ServerMembership(
                id=uuid.uuid4(),
                server_id=server.id,
                account_id=account.id,
                member_id=member.id,
                role="owner",
                status="active",
            )
            channel = Channel(
                id=uuid.uuid4(),
                server_id=server.id,
                name="uploads",
                kind="public",
                creator_id=member.id,
            )
            async with sessions() as db:
                db.add(server)
                await db.flush()
                db.add(account)
                await db.flush()
                db.add(member)
                await db.flush()
                db.add(channel)
                await db.flush()
                db.add(membership)
                await db.commit()

            async def override_db():
                async with sessions() as db:
                    yield db

            monkeypatch.setattr(public_api, "UPLOAD_ROOT", tmp_path)
            monkeypatch.setattr(public_api, "MAX_UPLOAD_SIZE", 8)
            previous = app.dependency_overrides.copy()
            app.dependency_overrides[public_api.get_db] = override_db
            headers = {
                "X-Public-Key": public_api.PUBLIC_API_KEY,
                "X-Account-Token": token,
                "X-Server-Id": str(server.id),
            }
            try:
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://testserver",
                ) as client:
                    accepted = await client.post(
                        f"/api/v1/files?channelId={channel.id}",
                        headers=headers,
                        files={"file": ("exact.txt", b"12345678", "text/plain")},
                    )
                    rejected = await client.post(
                        f"/api/v1/files?channelId={channel.id}",
                        headers=headers,
                        files={"file": ("over.txt", b"123456789", "text/plain")},
                    )
            finally:
                app.dependency_overrides = previous

            assert accepted.status_code == 200, accepted.text
            assert accepted.json()["size"] == 8
            assert rejected.status_code == 413, rejected.text
            async with sessions() as db:
                assert await db.scalar(select(func.count()).select_from(FileEntry)) == 1
                stored = (await db.execute(select(FileEntry))).scalar_one()
                assert Path(stored.storage_path).read_bytes() == b"12345678"
            files = [path for path in tmp_path.rglob("*") if path.is_file()]
            assert len(files) == 1
            assert not any(path.name.endswith(".uploading") for path in files)
        finally:
            await engine.dispose()


def test_local_prod_declares_a_separate_multipart_ingress_budget():
    caddy = (REPO_ROOT / "deploy" / "caddy" / "Caddyfile").read_text()
    compose = (REPO_ROOT / "docker-compose.prod.yml").read_text()

    assert "@upload_requests path /api/v1/files /internal/agent-api/upload" in caddy
    assert "/internal/agent-api/profile/avatar" in caddy
    assert "request_body @upload_requests" in caddy
    assert "SMALLKHOJ_UPLOAD_REQUEST_BODY_MAX" in caddy
    assert "SMALLKHOJ_UPLOAD_REQUEST_BODY_MAX:" in compose
    assert "UPLOAD_MAX_BYTES:" in compose
