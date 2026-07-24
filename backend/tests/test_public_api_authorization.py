"""Endpoint regressions for human identity and private-channel authorization."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest

from main import app
from models import Account, Channel, ChannelMember, FileEntry, Member, Message, SavedItem, Server, Task
from routers import public_api


class _ScalarRows:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


class _Result:
    def __init__(self, *, scalar=None, scalar_rows=(), rows=()):
        self._scalar = scalar
        self._scalar_rows = list(scalar_rows)
        self._rows = list(rows)

    def scalar_one_or_none(self):
        return self._scalar

    def one_or_none(self):
        if not self._rows:
            return None
        if len(self._rows) != 1:
            raise AssertionError(f"expected at most one row, got {len(self._rows)}")
        return self._rows[0]

    def scalars(self):
        return _ScalarRows(self._scalar_rows)

    def all(self):
        return list(self._rows)


class _TrackingSession:
    def __init__(self, *results):
        self._results = list(results)
        self.statements = []
        self.added = []
        self.deleted = []
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, statement):
        self.statements.append(str(statement))
        if not self._results:
            return _Result()
        return self._results.pop(0)

    def add(self, value):
        self.added.append(value)

    async def delete(self, value):
        self.deleted.append(value)

    async def flush(self):
        return None

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def refresh(self, _value):
        return None


async def _asgi_request(db, method: str, path: str, **kwargs):
    async def override_db():
        yield db

    async def override_public_auth():
        return None

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[public_api.get_db] = override_db
    app.dependency_overrides[public_api.verify_public_api_key] = override_public_auth
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            return await client.request(method, path, **kwargs)
    finally:
        app.dependency_overrides = previous


def _server_context(*, role: str = "member"):
    server = Server(id=uuid.uuid4(), name="Authorization Test")
    member = Member(
        id=uuid.uuid4(),
        server_id=server.id,
        kind="human",
        display_name=f"{role}-viewer",
    )
    account = Account(
        id=uuid.uuid4(),
        name=f"{role}-account",
        server_id=server.id,
        member_id=member.id,
    )
    membership = SimpleNamespace(role=role)
    return SimpleNamespace(
        server=server,
        member=member,
        account=account,
        membership=membership,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/api/v1/auth/register", "/api/v1/auth/login"])
async def test_legacy_public_key_auth_cannot_rotate_existing_owner_token(monkeypatch, path):
    context = _server_context(role="owner")
    account = context.account
    account.session_token_hash = "unchanged-owner-session-hash"
    bootstrap_called = False

    async def unsafe_bootstrap(_db, *, name, display_name):
        nonlocal bootstrap_called
        bootstrap_called = True
        account.session_token_hash = "attacker-rotated-hash"
        return account, context.server, context.member, "attacker-token"

    async def serialize(_db, _account, _server, _member):
        return {"account": {"name": account.name}}

    monkeypatch.setattr(public_api, "_bootstrap_account", unsafe_bootstrap)
    monkeypatch.setattr(public_api, "_serialize_account", serialize)
    db = _TrackingSession()

    response = await _asgi_request(
        db,
        "POST",
        path,
        json={"name": account.name, "displayName": "Attacker"},
    )

    assert response.status_code == 410
    assert response.json()["detail"] == "Legacy passwordless authentication is disabled"
    assert bootstrap_called is False
    assert account.session_token_hash == "unchanged-owner-session-hash"
    assert db.commits == 0


async def _channel_admin_request(monkeypatch, *, operation: str, role: str, kind: str):
    context = _server_context(role=role)
    channel = Channel(
        id=uuid.uuid4(),
        server_id=context.server.id,
        name=f"{kind}-channel",
        kind=kind,
        creator_id=context.member.id,
    )
    target = Member(
        id=uuid.uuid4(),
        server_id=context.server.id,
        kind="human",
        display_name="target-member",
    )
    channel_membership = ChannelMember(channel_id=channel.id, member_id=target.id)
    side_effects = []

    async def resolve_context(_db, _request):
        return context

    async def resolve_actor(_db, _server, _request, _name, *, role, required=True):
        return context.member

    async def delete_channels(_db, channel_ids):
        side_effects.append(("delete_channels", tuple(channel_ids)))
        return {"messages": 0, "tasks": 0}

    async def record_activity(*_args, **_kwargs):
        side_effects.append(("activity",))

    async def push_events(*_args, **_kwargs):
        side_effects.append(("push",))

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "_resolve_human_actor", resolve_actor)
    monkeypatch.setattr(public_api, "_delete_channels_by_id", delete_channels)
    monkeypatch.setattr(public_api, "_record_activity", record_activity)
    monkeypatch.setattr(public_api, "_push_committed_events", push_events)

    if operation == "delete":
        db = _TrackingSession(_Result(scalar=channel))
        response = await _asgi_request(db, "DELETE", f"/api/v1/channels/{channel.id}")
    elif operation == "add":
        db = _TrackingSession(
            _Result(scalar=channel),
            _Result(scalar_rows=[target]),
            _Result(rows=[]),
        )
        response = await _asgi_request(
            db,
            "POST",
            f"/api/v1/channels/{channel.id}/members",
            json={"memberId": str(target.id)},
        )
    else:
        db = _TrackingSession(
            _Result(scalar=channel),
            _Result(scalar=channel_membership),
        )
        response = await _asgi_request(
            db,
            "DELETE",
            f"/api/v1/channels/{channel.id}/members/{target.id}",
        )
    return response, db, side_effects


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["delete", "add", "remove"])
async def test_ordinary_server_member_cannot_administer_channels(monkeypatch, operation):
    response, db, side_effects = await _channel_admin_request(
        monkeypatch,
        operation=operation,
        role="member",
        kind="private",
    )

    assert response.status_code == 403
    assert db.added == []
    assert db.deleted == []
    assert db.commits == 0
    assert side_effects == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("operation", "role"),
    [("delete", "owner"), ("add", "admin"), ("remove", "owner")],
)
async def test_owner_or_admin_can_administer_non_dm_channels(monkeypatch, operation, role):
    response, db, side_effects = await _channel_admin_request(
        monkeypatch,
        operation=operation,
        role=role,
        kind="private",
    )

    assert response.status_code == 200, response.text
    assert db.commits == 1
    if operation == "delete":
        assert any(item[0] == "delete_channels" for item in side_effects)
    elif operation == "add":
        assert len(db.added) == 1
    else:
        assert len(db.deleted) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["add", "remove"])
async def test_dm_membership_mutation_is_forbidden_even_for_admin(monkeypatch, operation):
    response, db, side_effects = await _channel_admin_request(
        monkeypatch,
        operation=operation,
        role="admin",
        kind="dm",
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "DM membership is managed by the DM lifecycle"
    assert db.added == []
    assert db.deleted == []
    assert db.commits == 0
    assert side_effects == []


async def _list_channel_members_request(monkeypatch, *, kind: str, is_participant: bool):
    context = _server_context()
    channel = Channel(
        id=uuid.uuid4(),
        server_id=context.server.id,
        name=f"{kind}-members",
        kind=kind,
        creator_id=context.member.id,
    )
    listed_member = Member(
        id=uuid.uuid4(),
        server_id=context.server.id,
        kind="human",
        display_name="listed-member",
    )
    channel_membership = ChannelMember(channel_id=channel.id, member_id=listed_member.id)
    db = _TrackingSession(
        _Result(scalar=channel),
        _Result(scalar_rows=[channel_membership]),
        _Result(scalar_rows=[listed_member]),
    )

    async def resolve_context(_db, _request):
        return context

    async def channel_member(_db, *, channel_id, member_id):
        return is_participant

    async def load_context(_db, _members):
        return SimpleNamespace(computers={}, workspace_ids={})

    async def serialize(_db, member, **_kwargs):
        return {"id": str(member.id), "name": member.display_name}

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "is_channel_member", channel_member)
    monkeypatch.setattr(public_api, "load_member_serialization_context", load_context)
    monkeypatch.setattr(public_api, "serialize_member", serialize)

    response = await _asgi_request(db, "GET", f"/api/v1/channels/{channel.id}/members")
    return response, db


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["private", "dm"])
async def test_nonparticipant_cannot_list_private_or_dm_members(monkeypatch, kind):
    response, db = await _list_channel_members_request(
        monkeypatch,
        kind=kind,
        is_participant=False,
    )

    assert response.status_code == 403
    assert db.commits == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kind", "is_participant"),
    [("public", False), ("private", True), ("dm", True)],
)
async def test_channel_member_listing_preserves_public_and_participant_access(
    monkeypatch,
    kind,
    is_participant,
):
    response, _db = await _list_channel_members_request(
        monkeypatch,
        kind=kind,
        is_participant=is_participant,
    )

    assert response.status_code == 200, response.text
    assert response.json()["members"][0]["name"] == "listed-member"


def _message_resource(context, channel, *, content="classified message"):
    return Message(
        id=uuid.uuid4(),
        short_id=uuid.uuid4().hex[:8],
        channel_id=channel.id,
        sender_id=context.member.id,
        parent_id=None,
        content=content,
        channel_type=channel.kind,
        mentions=[],
        created_at=datetime.now(timezone.utc),
    )


def _task_resource(context, channel, *, title="classified task"):
    return Task(
        id=uuid.uuid4(),
        task_number=7,
        channel_id=channel.id,
        message_id=None,
        title=title,
        description="private task details",
        status="todo",
        creator_id=context.member.id,
        assignee_id=None,
        data={},
        created_at=datetime.now(timezone.utc),
    )


async def _reaction_request(
    monkeypatch,
    *,
    method: str,
    kind: str,
    is_participant: bool,
):
    context = _server_context()
    channel = Channel(
        id=uuid.uuid4(),
        server_id=context.server.id,
        name=f"{kind}-reaction",
        kind=kind,
        creator_id=context.member.id,
    )
    message = _message_resource(context, channel)
    db = _TrackingSession(_Result(scalar=channel))
    side_effects = []

    async def resolve_context(_db, _request):
        return context

    async def resolve_actor(_db, _server, _request, _name, *, role, required=True):
        return context.member

    async def resolve_message(_db, _server, _message_ref):
        return message

    async def channel_member(_db, *, channel_id, member_id):
        return is_participant

    async def record_activity(*_args, **_kwargs):
        side_effects.append("activity")

    async def push_events(*_args, **_kwargs):
        side_effects.append("push")

    async def serialize_reactions(*_args, **_kwargs):
        return []

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "_resolve_human_actor", resolve_actor)
    monkeypatch.setattr(public_api, "_resolve_message_ref", resolve_message)
    monkeypatch.setattr(public_api, "is_channel_member", channel_member)
    monkeypatch.setattr(public_api, "_record_activity", record_activity)
    monkeypatch.setattr(public_api, "_push_committed_events", push_events)
    monkeypatch.setattr(public_api, "_serialize_public_reactions", serialize_reactions)

    response = await _asgi_request(
        db,
        method,
        f"/api/v1/messages/{message.id}/reactions",
        json={"reaction": "eyes"},
    )
    return response, db, side_effects


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["POST", "DELETE"])
@pytest.mark.parametrize("kind", ["private", "dm"])
async def test_nonparticipant_cannot_mutate_private_message_reactions(
    monkeypatch,
    method,
    kind,
):
    response, db, side_effects = await _reaction_request(
        monkeypatch,
        method=method,
        kind=kind,
        is_participant=False,
    )

    assert response.status_code == 403
    assert db.added == []
    assert db.deleted == []
    assert db.commits == 0
    assert side_effects == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kind", "is_participant"),
    [("public", False), ("private", True), ("dm", True)],
)
async def test_reaction_mutation_preserves_public_and_participant_access(
    monkeypatch,
    kind,
    is_participant,
):
    response, db, _side_effects = await _reaction_request(
        monkeypatch,
        method="POST",
        kind=kind,
        is_participant=is_participant,
    )

    assert response.status_code == 200, response.text
    assert db.commits == 1


def _file_entry(*, server_id, member_id, channel_id, storage_path="/tmp/not-read", name="proof.txt"):
    return FileEntry(
        id=uuid.uuid4(),
        server_id=server_id,
        channel_id=channel_id,
        message_id=None,
        uploaded_by=member_id,
        file_name=name,
        original_name=name,
        mime_type="text/plain",
        size=5,
        storage_path=str(storage_path),
        metadata_json={},
        created_at=datetime.now(timezone.utc),
    )


class _SavedTargetSession(_TrackingSession):
    def __init__(self, *, context, channel, item_type):
        super().__init__()
        self.context = context
        self.channel = channel
        self.message = _message_resource(context, channel)
        self.task = _task_resource(context, channel)
        self.file = _file_entry(
            server_id=context.server.id,
            member_id=context.member.id,
            channel_id=channel.id,
            name="classified-file.txt",
        )
        self.item_type = item_type

    @property
    def target(self):
        return {
            "message": self.message,
            "task": self.task,
            "file": self.file,
        }[self.item_type]

    async def execute(self, statement):
        sql = str(statement)
        self.statements.append(sql)
        if "FROM saved_items" in sql:
            return _Result()
        if "FROM messages JOIN channels" in sql:
            return _Result(
                scalar=self.message,
                rows=[(self.message, self.channel)],
            )
        if "FROM tasks JOIN channels" in sql:
            return _Result(
                scalar=self.task,
                rows=[(self.task, self.channel)],
            )
        if "FROM files LEFT OUTER JOIN channels" in sql:
            return _Result(
                scalar=self.file,
                rows=[(self.file, self.channel)],
            )
        if "FROM members" in sql:
            return _Result(scalar=self.context.member)
        if "FROM channels" in sql:
            return _Result(scalar=self.channel)
        return _Result()


async def _saved_target_request(
    monkeypatch,
    *,
    item_type: str,
    kind: str,
    is_participant: bool,
):
    context = _server_context()
    channel = Channel(
        id=uuid.uuid4(),
        server_id=context.server.id,
        name=f"{kind}-saved-{item_type}",
        kind=kind,
        creator_id=context.member.id,
    )
    db = _SavedTargetSession(
        context=context,
        channel=channel,
        item_type=item_type,
    )

    async def resolve_context(_db, _request):
        return context

    async def channel_member(_db, *, channel_id, member_id):
        return is_participant

    async def serialize_task(_db, task, **_kwargs):
        return {"id": str(task.id), "channel": f"#{channel.name}"}

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "is_channel_member", channel_member)
    monkeypatch.setattr(public_api, "_serialize_task", serialize_task)

    response = await _asgi_request(
        db,
        "POST",
        "/api/v1/saved",
        json={"itemType": item_type, "itemId": str(db.target.id)},
    )
    return response, db


@pytest.mark.asyncio
@pytest.mark.parametrize("item_type", ["message", "task", "file"])
@pytest.mark.parametrize("kind", ["private", "dm"])
async def test_nonparticipant_cannot_save_private_channel_resource(
    monkeypatch,
    item_type,
    kind,
):
    response, db = await _saved_target_request(
        monkeypatch,
        item_type=item_type,
        kind=kind,
        is_participant=False,
    )

    assert response.status_code == 403
    assert db.added == []
    assert db.commits == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("item_type", ["message", "task", "file"])
async def test_saved_item_creation_preserves_private_participant_access(
    monkeypatch,
    item_type,
):
    response, db = await _saved_target_request(
        monkeypatch,
        item_type=item_type,
        kind="private",
        is_participant=True,
    )

    assert response.status_code == 200, response.text
    assert db.commits == 1


class _SavedListSession(_TrackingSession):
    def __init__(self, *, context):
        super().__init__()
        self.context = context
        self.scope_loaded = False
        self.public_channel = Channel(
            id=uuid.uuid4(),
            server_id=context.server.id,
            name="public-saved",
            kind="public",
            creator_id=context.member.id,
        )
        self.private_channel = Channel(
            id=uuid.uuid4(),
            server_id=context.server.id,
            name="private-saved",
            kind="private",
            creator_id=context.member.id,
        )
        self.public_message = _message_resource(
            context,
            self.public_channel,
            content="public saved message",
        )
        self.private_message = _message_resource(
            context,
            self.private_channel,
            content="private saved message",
        )
        now = datetime.now(timezone.utc)
        self.public_saved = SavedItem(
            id=uuid.uuid4(),
            server_id=context.server.id,
            account_id=context.account.id,
            member_id=context.member.id,
            item_type="message",
            item_id=self.public_message.id,
            created_at=now,
        )
        self.private_saved = SavedItem(
            id=uuid.uuid4(),
            server_id=context.server.id,
            account_id=context.account.id,
            member_id=context.member.id,
            item_type="message",
            item_id=self.private_message.id,
            created_at=now,
        )
        self.pending_messages = []

    async def execute(self, statement):
        sql = str(statement)
        self.statements.append(sql)
        if "FROM channels" in sql and "JOIN channel_members" in sql:
            self.scope_loaded = True
            return _Result(
                rows=[
                    (self.public_channel, None),
                    (self.private_channel, None),
                ]
            )
        if "FROM saved_items" in sql:
            if self.scope_loaded:
                items = [self.public_saved]
                self.pending_messages = [
                    (self.public_message, self.public_channel),
                ]
            else:
                items = [self.private_saved, self.public_saved]
                self.pending_messages = [
                    (self.private_message, self.private_channel),
                    (self.public_message, self.public_channel),
                ]
            return _Result(scalar_rows=items)
        if "FROM messages JOIN channels" in sql:
            message, channel = self.pending_messages.pop(0)
            return _Result(scalar=message, rows=[(message, channel)])
        if "FROM members" in sql:
            return _Result(scalar=self.context.member)
        return _Result()


@pytest.mark.asyncio
async def test_saved_list_filters_inaccessible_private_bookmarks(monkeypatch):
    context = _server_context()
    db = _SavedListSession(context=context)

    async def resolve_context(_db, _request):
        return context

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    response = await _asgi_request(db, "GET", "/api/v1/saved")

    assert response.status_code == 200, response.text
    assert response.json()["count"] == 1
    assert [item["title"] for item in response.json()["saved"]] == [
        "public saved message"
    ]
    assert db.scope_loaded is True


class _FileListSession(_TrackingSession):
    def __init__(self, *, context, participant):
        super().__init__()
        self.context = context
        self.participant = participant
        self.scope_loaded = False
        self.public_channel = Channel(
            id=uuid.uuid4(),
            server_id=context.server.id,
            name="public-files",
            kind="public",
            creator_id=context.member.id,
        )
        self.private_channel = Channel(
            id=uuid.uuid4(),
            server_id=context.server.id,
            name="private-files",
            kind="private",
            creator_id=context.member.id,
        )
        self.dm_channel = Channel(
            id=uuid.uuid4(),
            server_id=context.server.id,
            name="dm-files",
            kind="dm",
            creator_id=context.member.id,
        )
        self.files = [
            _file_entry(
                server_id=context.server.id,
                member_id=context.member.id,
                channel_id=None,
                name="unbound.txt",
            ),
            _file_entry(
                server_id=context.server.id,
                member_id=context.member.id,
                channel_id=self.public_channel.id,
                name="public.txt",
            ),
            _file_entry(
                server_id=context.server.id,
                member_id=context.member.id,
                channel_id=self.private_channel.id,
                name="private.txt",
            ),
            _file_entry(
                server_id=context.server.id,
                member_id=context.member.id,
                channel_id=self.dm_channel.id,
                name="dm.txt",
            ),
        ]

    async def execute(self, statement):
        sql = str(statement)
        self.statements.append(sql)
        if "FROM channels" in sql and "JOIN channel_members" in sql:
            self.scope_loaded = True
            participant_id = self.context.member.id if self.participant else None
            return _Result(
                rows=[
                    (self.public_channel, None),
                    (self.private_channel, participant_id),
                    (self.dm_channel, participant_id),
                ]
            )
        if "FROM files" in sql:
            if not self.scope_loaded or self.participant:
                visible = self.files
            else:
                visible = self.files[:2]
            return _Result(scalar_rows=visible)
        return _Result()


@pytest.mark.asyncio
async def test_file_list_filters_private_and_dm_files_for_nonparticipant(monkeypatch):
    context = _server_context()
    db = _FileListSession(context=context, participant=False)

    async def resolve_context(_db, _request):
        return context

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    response = await _asgi_request(db, "GET", "/api/v1/files")

    assert response.status_code == 200, response.text
    assert [item["fileName"] for item in response.json()["files"]] == [
        "unbound.txt",
        "public.txt",
    ]
    assert db.scope_loaded is True


@pytest.mark.asyncio
async def test_file_list_preserves_private_and_dm_files_for_participant(monkeypatch):
    context = _server_context()
    db = _FileListSession(context=context, participant=True)

    async def resolve_context(_db, _request):
        return context

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    response = await _asgi_request(db, "GET", "/api/v1/files")

    assert response.status_code == 200, response.text
    assert {item["fileName"] for item in response.json()["files"]} == {
        "unbound.txt",
        "public.txt",
        "private.txt",
        "dm.txt",
    }


class _GlobalSearchSession(_TrackingSession):
    def __init__(self, *, context, participant):
        super().__init__()
        self.context = context
        self.participant = participant
        self.scope_loaded = False
        self.channel = Channel(
            id=uuid.uuid4(),
            server_id=context.server.id,
            name="secret-search",
            kind="private",
            creator_id=context.member.id,
        )
        self.message = SimpleNamespace(
            id=uuid.uuid4(),
            sender_id=context.member.id,
            parent_id=None,
            content="classified marker",
            created_at=datetime.now(timezone.utc),
        )
        self.task = SimpleNamespace(
            id=uuid.uuid4(),
            task_number=1,
            title="classified marker",
            description="private task",
            status="open",
            created_at=datetime.now(timezone.utc),
        )
        self.file = _file_entry(
            server_id=context.server.id,
            member_id=context.member.id,
            channel_id=self.channel.id,
            name="classified-marker.txt",
        )

    def _allowed(self, sql):
        if "channel_members" in sql:
            self.scope_loaded = True
        return not self.scope_loaded or self.participant

    async def execute(self, statement):
        sql = str(statement)
        self.statements.append(sql)
        if "FROM channels" in sql and "JOIN channel_members" in sql:
            self.scope_loaded = True
            member_id = self.context.member.id if self.participant else None
            return _Result(rows=[(self.channel, member_id)])
        if "FROM messages JOIN channels" in sql:
            return _Result(
                rows=[(self.message, self.channel)] if self._allowed(sql) else []
            )
        if "FROM tasks JOIN channels" in sql:
            return _Result(rows=[(self.task, self.channel)] if self._allowed(sql) else [])
        if "FROM files LEFT OUTER JOIN channels" in sql:
            return _Result(rows=[(self.file, self.channel)] if self._allowed(sql) else [])
        if "FROM channels" in sql:
            return _Result(scalar_rows=[self.channel] if self._allowed(sql) else [])
        return _Result(scalar_rows=[])


@pytest.mark.asyncio
async def test_global_search_hides_all_private_channel_bound_resources_from_nonparticipant(
    monkeypatch,
):
    context = _server_context()
    db = _GlobalSearchSession(context=context, participant=False)

    async def resolve_context(_db, _request):
        return context

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    response = await _asgi_request(db, "GET", "/api/v1/search?q=classified")

    assert response.status_code == 200, response.text
    channel_bound = {
        item["type"]
        for item in response.json()["results"]
        if item["type"] in {"message", "task", "channel", "file"}
    }
    assert channel_bound == set()
    assert db.scope_loaded is True


@pytest.mark.asyncio
async def test_global_search_preserves_private_resources_for_participant(monkeypatch):
    context = _server_context()
    db = _GlobalSearchSession(context=context, participant=True)

    async def resolve_context(_db, _request):
        return context

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    response = await _asgi_request(db, "GET", "/api/v1/search?q=classified")

    assert response.status_code == 200, response.text
    assert {
        item["type"]
        for item in response.json()["results"]
        if item["type"] in {"message", "task", "channel", "file"}
    } == {"message", "task", "channel", "file"}


class _TaskListSession(_TrackingSession):
    def __init__(self, *, context):
        super().__init__()
        self.context = context
        self.scope_loaded = False
        self.channel = Channel(
            id=uuid.uuid4(),
            server_id=context.server.id,
            name="private-task-list",
            kind="private",
            creator_id=context.member.id,
        )
        self.task = _task_resource(context, self.channel)

    async def execute(self, statement):
        sql = str(statement)
        self.statements.append(sql)
        if "FROM channels" in sql and "JOIN channel_members" in sql:
            self.scope_loaded = True
            return _Result(rows=[(self.channel, None)])
        if "FROM tasks JOIN channels" in sql:
            if "channel_members" in sql:
                self.scope_loaded = True
            return _Result(
                scalar_rows=[] if self.scope_loaded else [self.task],
            )
        return _Result()


@pytest.mark.asyncio
async def test_task_list_filters_inaccessible_private_tasks_before_pagination(
    monkeypatch,
):
    context = _server_context()
    db = _TaskListSession(context=context)

    async def resolve_context(_db, _request):
        return context

    async def load_context(_db, _tasks):
        return SimpleNamespace()

    async def serialize_task(_db, task, **_kwargs):
        return {"id": str(task.id), "title": task.title}

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "load_task_serialization_context", load_context)
    monkeypatch.setattr(public_api, "_serialize_task", serialize_task)

    response = await _asgi_request(db, "GET", "/api/v1/tasks?limit=1")

    assert response.status_code == 200, response.text
    assert response.json() == {"tasks": [], "nextCursor": None}
    assert db.scope_loaded is True


async def _task_route_request(
    monkeypatch,
    *,
    operation: str,
    kind: str = "private",
    is_participant: bool = False,
):
    context = _server_context()
    channel = Channel(
        id=uuid.uuid4(),
        server_id=context.server.id,
        name=f"{kind}-task-route",
        kind=kind,
        creator_id=context.member.id,
    )
    task = _task_resource(context, channel)
    agent = Member(
        id=uuid.uuid4(),
        server_id=context.server.id,
        kind="agent",
        display_name="task-agent",
    )
    db = _TrackingSession(_Result(scalar=channel))
    side_effects = []

    async def resolve_context(_db, _request):
        return context

    async def resolve_task(_db, _server, _task_id):
        return task

    async def resolve_channel(_db, _server, _channel_name):
        return channel

    async def resolve_member(_db, _server, member_ref, **_kwargs):
        return agent if member_ref else None

    async def resolve_actor(_db, _server, _request, _name, *, role, required=True):
        return context.member

    async def channel_member(_db, *, channel_id, member_id):
        return is_participant

    async def resolve_template(*_args, **_kwargs):
        return None, None, None, None

    async def create_assignment(*_args, **kwargs):
        side_effects.append("assignment")
        if kwargs.get("assignee") is None:
            return None, None
        return SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(
            id=uuid.uuid4(),
            prompt_profile=None,
            context_session_id=None,
        )

    async def task_target(*_args, **_kwargs):
        return f"#{channel.name}"

    async def record_activity(*_args, **_kwargs):
        side_effects.append("activity")

    async def push_events(*_args, **_kwargs):
        side_effects.append("push")

    async def serialize_task(_db, value, **_kwargs):
        return {"id": str(value.id), "title": getattr(value, "title", None)}

    async def next_task_number(*_args, **_kwargs):
        return 8

    async def add_memory_request(*_args, **_kwargs):
        side_effects.append("memory-request")
        return SimpleNamespace(id=uuid.uuid4())

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "_resolve_task_by_id_or_number", resolve_task)
    monkeypatch.setattr(public_api, "_resolve_channel", resolve_channel)
    monkeypatch.setattr(public_api, "_resolve_member", resolve_member)
    monkeypatch.setattr(public_api, "_resolve_human_actor", resolve_actor)
    monkeypatch.setattr(public_api, "is_channel_member", channel_member)
    monkeypatch.setattr(public_api, "_resolve_task_run_template_request", resolve_template)
    monkeypatch.setattr(public_api, "create_task_assignment_and_run", create_assignment)
    monkeypatch.setattr(public_api, "_task_channel_target", task_target)
    monkeypatch.setattr(public_api, "_record_activity", record_activity)
    monkeypatch.setattr(public_api, "_push_committed_events", push_events)
    monkeypatch.setattr(public_api, "_serialize_task", serialize_task)
    monkeypatch.setattr(public_api, "_next_task_number", next_task_number)
    monkeypatch.setattr(public_api, "add_task_memory_request_event", add_memory_request)
    monkeypatch.setattr(public_api, "serialize_task_run", lambda _run: {"id": "run"})

    if operation == "get":
        response = await _asgi_request(db, "GET", f"/api/v1/tasks/{task.id}")
    elif operation == "update":
        response = await _asgi_request(
            db,
            "PATCH",
            f"/api/v1/tasks/{task.id}",
            json={"title": "unauthorized update"},
        )
    elif operation == "assignment":
        response = await _asgi_request(
            db,
            "POST",
            f"/api/v1/tasks/{task.id}/assignments",
            json={"assignee": str(agent.id)},
        )
    elif operation == "memory-request":
        response = await _asgi_request(
            db,
            "POST",
            f"/api/v1/tasks/{task.id}/memory/request",
            json={},
        )
    else:
        response = await _asgi_request(
            db,
            "POST",
            "/api/v1/tasks",
            json={"title": "unauthorized create", "channel": channel.name},
        )
    return response, db, side_effects, task


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation",
    ["get", "create", "update", "assignment", "memory-request"],
)
@pytest.mark.parametrize("kind", ["private", "dm"])
async def test_nonparticipant_cannot_read_or_mutate_private_channel_tasks(
    monkeypatch,
    operation,
    kind,
):
    response, db, side_effects, task = await _task_route_request(
        monkeypatch,
        operation=operation,
        kind=kind,
        is_participant=False,
    )

    assert response.status_code == 403
    assert db.added == []
    assert db.deleted == []
    assert db.commits == 0
    assert side_effects == []
    assert task.title == "classified task"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kind", "is_participant"),
    [("public", False), ("private", True), ("dm", True)],
)
async def test_task_get_preserves_public_and_participant_access(
    monkeypatch,
    kind,
    is_participant,
):
    response, _db, _side_effects, _task = await _task_route_request(
        monkeypatch,
        operation="get",
        kind=kind,
        is_participant=is_participant,
    )

    assert response.status_code == 200, response.text


class _StagedUpload:
    size = 5

    def __init__(self):
        self.promoted = False

    def promote(self):
        self.promoted = True


async def _upload_request(monkeypatch, *, kind: str, is_participant: bool, channel_exists=True):
    context = _server_context()
    channel = Channel(
        id=uuid.uuid4(),
        server_id=context.server.id,
        name=f"{kind}-upload",
        kind=kind,
        creator_id=context.member.id,
    )
    db = _TrackingSession(_Result(scalar=channel if channel_exists else None))
    staged = _StagedUpload()
    stage_calls = []

    async def resolve_context(_db, _request):
        return context

    async def resolve_actor(_db, _server, _request, _name, *, role, required=True):
        return context.member

    async def channel_member(_db, *, channel_id, member_id):
        return is_participant

    async def stage(*_args, **_kwargs):
        stage_calls.append(True)
        return staged

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "_resolve_human_actor", resolve_actor)
    monkeypatch.setattr(public_api, "is_channel_member", channel_member)
    monkeypatch.setattr(public_api, "stage_upload", stage)

    response = await _asgi_request(
        db,
        "POST",
        f"/api/v1/files?channelId={channel.id}",
        files={"file": ("proof.txt", b"proof", "text/plain")},
    )
    return response, db, stage_calls


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["private", "dm"])
async def test_nonparticipant_cannot_upload_to_private_or_dm_channel(monkeypatch, kind):
    response, db, stage_calls = await _upload_request(
        monkeypatch,
        kind=kind,
        is_participant=False,
    )

    assert response.status_code == 403
    assert stage_calls == []
    assert db.added == []
    assert db.commits == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kind", "is_participant"),
    [("public", False), ("private", True), ("dm", True)],
)
async def test_upload_preserves_public_and_participant_access(
    monkeypatch,
    kind,
    is_participant,
):
    response, db, stage_calls = await _upload_request(
        monkeypatch,
        kind=kind,
        is_participant=is_participant,
    )

    assert response.status_code == 200, response.text
    assert stage_calls == [True]
    assert len(db.added) == 1
    assert db.commits == 1


@pytest.mark.asyncio
async def test_upload_rejects_foreign_server_channel_without_staging(monkeypatch):
    response, db, stage_calls = await _upload_request(
        monkeypatch,
        kind="private",
        is_participant=True,
        channel_exists=False,
    )

    assert response.status_code == 404
    assert stage_calls == []
    assert db.added == []
    assert db.commits == 0


async def _attachment_request(
    monkeypatch,
    tmp_path,
    *,
    suffix: str,
    kind: str | None,
    is_participant: bool,
    attachment_exists: bool = True,
):
    context = _server_context()
    path = tmp_path / f"{uuid.uuid4()}.txt"
    path.write_bytes(b"proof")
    channel = None
    if kind is not None:
        channel = Channel(
            id=uuid.uuid4(),
            server_id=context.server.id,
            name=f"{kind}-attachment",
            kind=kind,
            creator_id=context.member.id,
        )
    entry = _file_entry(
        server_id=context.server.id,
        member_id=context.member.id,
        channel_id=channel.id if channel else None,
        storage_path=path,
    )
    results = [_Result(scalar=entry if attachment_exists else None)]
    if channel is not None:
        results.append(_Result(scalar=channel))
    db = _TrackingSession(*results)

    async def resolve_context(_db, _request):
        return context

    async def resolve_actor(_db, _server, _request, _name, *, role, required=True):
        return context.member

    async def channel_member(_db, *, channel_id, member_id):
        return is_participant

    monkeypatch.setattr(public_api, "UPLOAD_ROOT", tmp_path)
    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "_resolve_human_actor", resolve_actor)
    monkeypatch.setattr(public_api, "is_channel_member", channel_member)

    response = await _asgi_request(
        db,
        "GET",
        f"/api/v1/attachments/{entry.id}{suffix}",
    )
    return response, db


@pytest.mark.asyncio
@pytest.mark.parametrize("suffix", ["", "/download"])
@pytest.mark.parametrize("kind", ["private", "dm"])
async def test_nonparticipant_cannot_preview_or_download_private_attachment(
    monkeypatch,
    tmp_path,
    suffix,
    kind,
):
    response, db = await _attachment_request(
        monkeypatch,
        tmp_path,
        suffix=suffix,
        kind=kind,
        is_participant=False,
    )

    assert response.status_code == 403
    assert db.commits == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("suffix", ["", "/download"])
@pytest.mark.parametrize(
    ("kind", "is_participant"),
    [(None, False), ("public", False), ("private", True), ("dm", True)],
)
async def test_attachment_access_preserves_unbound_public_and_participant_behavior(
    monkeypatch,
    tmp_path,
    suffix,
    kind,
    is_participant,
):
    response, _db = await _attachment_request(
        monkeypatch,
        tmp_path,
        suffix=suffix,
        kind=kind,
        is_participant=is_participant,
    )

    assert response.status_code == 200, response.text
    assert response.content == b"proof"


@pytest.mark.asyncio
@pytest.mark.parametrize("suffix", ["", "/download"])
async def test_attachment_lookup_is_tenant_scoped(monkeypatch, tmp_path, suffix):
    response, db = await _attachment_request(
        monkeypatch,
        tmp_path,
        suffix=suffix,
        kind=None,
        is_participant=True,
        attachment_exists=False,
    )

    assert response.status_code == 404
    assert "files.server_id" in db.statements[0]


class _CancelledDeleteSession(_TrackingSession):
    def __init__(self):
        super().__init__()
        self.row_exists = True
        self.delete_pending = False

    async def execute(self, statement):
        self.statements.append(str(statement))
        if str(statement).lstrip().startswith("DELETE FROM files"):
            self.delete_pending = True
        return _Result()

    async def commit(self):
        self.commits += 1
        raise asyncio.CancelledError

    async def rollback(self):
        self.rollbacks += 1
        self.delete_pending = False
        self.row_exists = True


@pytest.mark.asyncio
async def test_file_delete_precommit_cancellation_restores_blob_and_database_row(
    monkeypatch,
    tmp_path,
):
    context = _server_context(role="owner")
    original_path = tmp_path / "cancelled-delete.txt"
    original_path.write_bytes(b"must survive cancellation")
    entry = _file_entry(
        server_id=context.server.id,
        member_id=context.member.id,
        channel_id=None,
        storage_path=original_path,
    )
    db = _CancelledDeleteSession()

    async def resolve_context(_db, _request):
        return context

    async def get_attachment(_db, _server, _file_id):
        return entry

    async def resolve_actor(_db, _server, _request, _name, *, role, required=True):
        return context.member

    async def no_saved_items(*_args, **_kwargs):
        return None

    async def no_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(public_api, "UPLOAD_ROOT", tmp_path)
    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "_get_public_attachment", get_attachment)
    monkeypatch.setattr(public_api, "_resolve_human_actor", resolve_actor)
    monkeypatch.setattr(public_api, "_delete_saved_item_references", no_saved_items)
    monkeypatch.setattr(public_api, "_record_activity", no_activity)

    with pytest.raises(asyncio.CancelledError):
        await public_api.delete_file(
            str(entry.id),
            SimpleNamespace(),
            _auth=None,
            db=db,
        )

    assert db.commits == 1
    assert db.rollbacks == 1
    assert db.delete_pending is False
    assert db.row_exists is True
    assert original_path.read_bytes() == b"must survive cancellation"
    assert not any(path.is_file() for path in (tmp_path / ".deleted").glob("*"))
