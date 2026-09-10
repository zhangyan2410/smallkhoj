"""Agent attachment upload must land as a channel file and emit file.uploaded."""

from __future__ import annotations

import hashlib
import uuid
from types import SimpleNamespace

import asyncio
import httpx
import pytest
from postgres_test_support import disposable_postgres, run_alembic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from main import app
from models import ActivityLog, ApiKey, Channel, EventRecord, FileEntry, Member, Server
from routers import agent_api

# ftyp/isom magic so the payload is a plausible MP4 head.
MP4_HEAD = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2mp41"


def test_file_created_activity_maps_to_channel_scoped_uploaded_event():
    """file_created 活动必须映射为 file.uploaded 事件，Files 标签页才能实时刷新。"""

    class FakeSession:
        def __init__(self):
            self.added: list[object] = []

        def add(self, value):
            self.added.append(value)

        async def flush(self):
            return None

    db = FakeSession()
    server = SimpleNamespace(id=uuid.uuid4())
    agent = SimpleNamespace(id=uuid.uuid4())
    channel_id = uuid.uuid4()

    activity = asyncio.run(
        agent_api._record_activity(
            db,
            server,
            agent,
            "file_created",
            "@uploader uploaded demo.mp4",
            {"fileId": "abc", "fileName": "demo.mp4", "mimeType": "video/mp4"},
            channel_id=channel_id,
        )
    )
    events = [item for item in db.added if isinstance(item, EventRecord)]
    assert len(events) == 1
    event = events[0]
    assert event.event_type == "file.uploaded"
    assert event.channel_id == channel_id
    assert event.payload["fileId"] == "abc"
    assert event.payload["type"] == "file.uploaded"
    assert event.payload["legacyType"] == "file_uploaded"
    assert isinstance(activity, ActivityLog)


async def _seed_agent_world(session_factory):
    server = Server(
        id=uuid.uuid4(),
        name=f"upload-event-{uuid.uuid4().hex[:8]}",
        server_handle=f"s{uuid.uuid4().hex[:4]}",
    )
    handle = f"uploader-{uuid.uuid4().hex[:8]}"
    agent = Member(
        id=uuid.uuid4(),
        origin_server_id=server.id,
        account_id=None,
        kind="agent",
        handle=handle,
        handle_key=handle,
        config={"permissions": {"fileWrite": True}},
    )
    token = f"sap_upload_{uuid.uuid4().hex}"
    api_key = ApiKey(
        id=uuid.uuid4(),
        key_prefix=token[:20],
        token_hash=hashlib.sha256(token.encode("utf-8")).hexdigest(),
        resource_type="agent",
        resource_id=agent.id,
        server_id=server.id,
    )
    channel = Channel(
        id=uuid.uuid4(),
        server_id=server.id,
        name=f"deliverables-{uuid.uuid4().hex[:8]}",
        kind="public",
    )
    async with session_factory() as db:
        db.add_all([server, agent, api_key, channel])
        await db.commit()
    return server, agent, token, channel


@pytest.mark.asyncio
async def test_agent_upload_emits_channel_file_uploaded_event_and_sniffs_mp4_mime():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, agent, token, channel = await _seed_agent_world(sessions)

        async def override_db():
            async with sessions() as db:
                yield db

        previous = app.dependency_overrides.copy()
        app.dependency_overrides[agent_api.get_db] = override_db
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as client:
                response = await client.post(
                    "/internal/agent-api/upload",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "X-Agent-Id": str(agent.id),
                    },
                    data={"channelId": str(channel.id)},
                    files={"file": ("demo.mp4", MP4_HEAD, "application/octet-stream")},
                )
        finally:
            app.dependency_overrides = previous

        assert response.status_code == 200, response.text
        attachment = response.json()["attachment"]
        file_id = uuid.UUID(attachment["id"])

        # 老 daemon 不带扩展名映射时，后端按文件名兜底识别 MP4，并给视频预览 URL。
        assert attachment["mimeType"] == "video/mp4"
        assert attachment["previewUrl"] == f"/api/attachments/{file_id}"
        assert attachment["channelId"] == str(channel.id)

        async with sessions() as db:
            entry = (
                await db.execute(select(FileEntry).where(FileEntry.id == file_id))
            ).scalar_one()
            assert entry.channel_id == channel.id
            assert entry.mime_type == "video/mp4"

            activity = (
                await db.execute(select(ActivityLog).where(ActivityLog.kind == "file_created"))
            ).scalar_one()
            assert activity.details["fileId"] == str(file_id)

            # 关键回归点：上传后必须落一条 channel 作用域的 file.uploaded 事件，
            # 否则前端 Files 标签页不会实时刷新，用户看不到 agent 交付的文件。
            event = (
                await db.execute(
                    select(EventRecord).where(EventRecord.event_type == "file.uploaded")
                )
            ).scalar_one()
            assert event.channel_id == channel.id
            assert event.payload["fileId"] == str(file_id)
            assert event.payload["mimeType"] == "video/mp4"
        await engine.dispose()


@pytest.mark.asyncio
async def test_agent_upload_rejected_with_507_when_quota_exhausted(monkeypatch):
    """存储治理：server 附件总量超过配额时 fail-closed 拒收，且不留残片。"""

    from config import settings as app_settings

    monkeypatch.setattr(app_settings, "upload_server_quota_bytes", 8)

    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        server, agent, token, channel = await _seed_agent_world(sessions)

        async def override_db():
            async with sessions() as db:
                yield db

        previous = app.dependency_overrides.copy()
        app.dependency_overrides[agent_api.get_db] = override_db
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as client:
                response = await client.post(
                    "/internal/agent-api/upload",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "X-Agent-Id": str(agent.id),
                    },
                    data={"channelId": str(channel.id)},
                    files={"file": ("demo.mp4", MP4_HEAD, "video/mp4")},
                )
        finally:
            app.dependency_overrides = previous

        assert response.status_code == 507, response.text
        assert "quota" in response.json()["detail"]

        async with sessions() as db:
            assert (await db.execute(select(FileEntry))).scalar_one_or_none() is None
            assert (
                await db.execute(
                    select(EventRecord).where(EventRecord.event_type == "file.uploaded")
                )
            ).scalar_one_or_none() is None
        server_dir = agent_api.UPLOAD_ROOT / str(server.id)
        assert not [path for path in server_dir.rglob("*") if path.is_file()]
        await engine.dispose()
