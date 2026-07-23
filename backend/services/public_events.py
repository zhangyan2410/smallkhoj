"""Browser-facing public realtime event stream.

The DB remains the source of truth. This module only turns committed
``event_records`` rows into product-safe wake-up events and fans them out to
SSE subscribers.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager
import json
import logging
import re
import uuid
from typing import Any, AsyncIterator

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models import EventRecord

logger = logging.getLogger(__name__)

PUBLIC_EVENT_NOTIFY_CHANNEL = "smallkhoj_public_events"
RECENT_EVENT_ID_LIMIT = 2048
POSTGRES_NOTIFY_PAYLOAD_LIMIT = 7800
POSTGRES_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")

PUBLIC_EVENT_TYPE_ALIASES = {
    "member.updated": "member.status.updated",
    "member.created": "member.created",
    "message.reaction_added": "reaction.updated",
    "message.reaction_removed": "reaction.updated",
}


def _stream_epoch() -> str:
    return uuid.uuid4().hex


def _scope_key(scope: dict[str, Any]) -> str:
    return f"{scope.get('kind') or 'server'}:{scope.get('id') or 'all'}"


class PublicEventHub:
    def __init__(self, *, epoch: str | None = None) -> None:
        self.epoch = epoch or _stream_epoch()
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._recent_event_ids: OrderedDict[str, None] = OrderedDict()
        self._server_cursors: dict[str, int] = {}

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def set_server_cursor(self, server_id: uuid.UUID | str, seq: int) -> None:
        self._server_cursors[str(server_id)] = int(seq or 0)

    def get_server_cursor(self, server_id: uuid.UUID | str) -> int:
        return self._server_cursors.get(str(server_id), 0)

    @asynccontextmanager
    async def subscribe_queue(self) -> AsyncIterator[asyncio.Queue[dict[str, Any]]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=200)
        self._subscribers.add(queue)
        logger.info("public event stream subscriber connected count=%s", self.subscriber_count)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)
            logger.info("public event stream subscriber disconnected count=%s", self.subscriber_count)

    async def publish(self, event: dict[str, Any]) -> bool:
        event_id = str(event.get("id") or "")
        if event_id:
            if event_id in self._recent_event_ids:
                logger.debug("public event duplicate dropped id=%s type=%s", event_id, event.get("type"))
                return False
            self._recent_event_ids[event_id] = None
            self._recent_event_ids.move_to_end(event_id)
            while len(self._recent_event_ids) > RECENT_EVENT_ID_LIMIT:
                self._recent_event_ids.popitem(last=False)

        delivered = 0
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
                delivered += 1
            except asyncio.QueueFull:
                logger.warning("public event subscriber queue full; dropping event id=%s", event_id)
        logger.debug(
            "public event published id=%s type=%s scope=%s subscribers=%s delivered=%s",
            event_id,
            event.get("type"),
            event.get("scope"),
            self.subscriber_count,
            delivered,
        )
        return True


public_event_hub = PublicEventHub()
_listener_task: asyncio.Task | None = None
_listener_stop: asyncio.Event | None = None


class PublicEventSubscription:
    def __init__(
        self,
        hub: "InMemoryPublicEventHub",
        *,
        scope_kind: str | None,
        scope_id: str | None,
        max_queue_size: int,
    ) -> None:
        self.hub = hub
        self.scope_kind = scope_kind
        self.scope_id = scope_id
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=max_queue_size)
        self.closed = False

    def matches(self, event: dict[str, Any]) -> bool:
        return should_deliver_public_event(event, scope_kind=self.scope_kind, scope_id=self.scope_id)

    async def get(self) -> dict[str, Any]:
        return await self.queue.get()

    async def close(self) -> None:
        if not self.closed:
            self.closed = True
            self.hub.unsubscribe(self)


class InMemoryPublicEventHub:
    """Small standalone hub used by unit tests and embedders that need filters."""

    def __init__(self) -> None:
        self._subscribers: set[PublicEventSubscription] = set()

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def subscribe(
        self,
        *,
        scope_kind: str | None = None,
        scope_id: str | None = None,
        max_queue_size: int = 100,
    ) -> PublicEventSubscription:
        subscription = PublicEventSubscription(
            self,
            scope_kind=scope_kind,
            scope_id=scope_id,
            max_queue_size=max_queue_size,
        )
        self._subscribers.add(subscription)
        return subscription

    def unsubscribe(self, subscription: PublicEventSubscription) -> None:
        self._subscribers.discard(subscription)

    async def publish(self, event: dict[str, Any]) -> int:
        delivered = 0
        for subscription in list(self._subscribers):
            if subscription.closed or not subscription.matches(event):
                continue
            if subscription.queue.full():
                try:
                    subscription.queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            await subscription.queue.put(event)
            delivered += 1
        return delivered


class PostgresNotifyPublicEventFanout:
    """Concrete Postgres LISTEN/NOTIFY seam for cross-process browser fanout."""

    def __init__(self, *, channel: str = PUBLIC_EVENT_NOTIFY_CHANNEL) -> None:
        if not POSTGRES_IDENTIFIER_RE.match(channel):
            raise ValueError("Postgres notify channel must be a safe identifier")
        self.channel = channel

    def listen_statement(self):
        return text(f"LISTEN {self.channel}")

    def notify_statement(self, event: dict[str, Any]):
        payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
        if len(payload.encode("utf-8")) > POSTGRES_NOTIFY_PAYLOAD_LIMIT:
            payload = json.dumps(_compact_notify_event(event), ensure_ascii=False, separators=(",", ":"))
        if len(payload.encode("utf-8")) > POSTGRES_NOTIFY_PAYLOAD_LIMIT:
            payload = json.dumps(_minimal_notify_event(event), ensure_ascii=False, separators=(",", ":"))
        return text("SELECT pg_notify(:channel, :payload)"), {
            "channel": self.channel,
            "payload": payload,
        }

    async def publish(self, db: AsyncSession, event: dict[str, Any]) -> None:
        statement, params = self.notify_statement(event)
        await db.execute(statement, params)


def _public_event_type(event_type: str) -> str:
    return PUBLIC_EVENT_TYPE_ALIASES.get(event_type, event_type)


def _compact_notify_event(event: dict[str, Any]) -> dict[str, Any]:
    """Keep Postgres NOTIFY as a wake-up signal when full event payloads are too large."""
    raw_payload = event.get("payload")
    payload = raw_payload if isinstance(raw_payload, dict) else {}
    compact_payload: dict[str, Any] = {"compacted": True}
    for key in (
        "eventId",
        "eventSeq",
        "messageId",
        "shortId",
        "taskId",
        "channelId",
        "target",
        "channel",
        "channelType",
        "parentId",
        "threadId",
    ):
        value = payload.get(key)
        if value is not None:
            compact_payload[key] = value
    return {
        "id": event.get("id"),
        "type": event.get("type"),
        "scope": event.get("scope") or {},
        "seq": event.get("seq"),
        "epoch": event.get("epoch"),
        "createdAt": event.get("createdAt"),
        "payload": compact_payload,
    }


def _minimal_notify_event(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": event.get("id"),
        "type": event.get("type"),
        "seq": event.get("seq"),
        "epoch": event.get("epoch"),
        "createdAt": event.get("createdAt"),
        "payload": {"compacted": True},
    }


def _event_scope(record: EventRecord) -> dict[str, Any]:
    payload = record.payload or {}
    event_type = _public_event_type(record.event_type)
    if event_type.startswith("memory."):
        scope_type = payload.get("scopeType") or payload.get("scope_type")
        scope_id = payload.get("scopeId") or payload.get("scope_id")
        if scope_type == "task":
            return {"kind": "task", "id": str(record.task_id or scope_id) if (record.task_id or scope_id) else None}
        if scope_type == "thread":
            return {"kind": "thread", "id": str(scope_id) if scope_id else None}
        if scope_type == "agent":
            return {"kind": "member", "id": str(scope_id) if scope_id else None}
        scope: dict[str, Any] = {"kind": "channel"}
        channel_id = record.channel_id or scope_id or payload.get("channelId")
        if channel_id:
            scope["id"] = str(channel_id)
        channel_name = payload.get("channel")
        if isinstance(channel_name, str) and channel_name.startswith("#"):
            scope["name"] = channel_name[1:]
        elif isinstance(channel_name, str) and channel_name:
            scope["name"] = channel_name
        return scope
    if event_type.startswith("message.") or event_type.startswith("file.") or event_type == "reaction.updated":
        scope: dict[str, Any] = {"kind": "channel"}
        channel_id = record.channel_id or payload.get("channelId")
        if channel_id:
            scope["id"] = str(channel_id)
        channel_name = payload.get("channel")
        if isinstance(channel_name, str) and channel_name.startswith("#"):
            scope["name"] = channel_name[1:]
        elif isinstance(channel_name, str) and channel_name:
            scope["name"] = channel_name
        return scope
    if event_type.startswith("task."):
        return {"kind": "task", "id": str(record.task_id or payload.get("taskId")) if (record.task_id or payload.get("taskId")) else None}
    if event_type == "member.status.updated" or event_type == "member.created":
        return {"kind": "member", "id": str(payload.get("memberId") or payload.get("agentId") or record.actor_id)}
    if event_type == "computer.status.updated":
        return {"kind": "computer", "id": str(payload.get("computerId")) if payload.get("computerId") else None}
    if event_type in {"workspace.updated", "runtime.updated"}:
        return {"kind": "workspace", "id": str(payload.get("workspaceId")) if payload.get("workspaceId") else None}
    return {"kind": "server", "id": str(record.server_id)}


def event_record_to_public_event(record: EventRecord) -> dict[str, Any]:
    payload = dict(record.payload or {})
    event_type = _public_event_type(record.event_type)
    payload.setdefault("serverId", str(record.server_id))
    if record.message_id:
        payload["messageId"] = str(record.message_id)
    if record.task_id:
        payload["taskId"] = str(record.task_id)
    if record.channel_id:
        payload["channelId"] = str(record.channel_id)
    payload.setdefault("eventId", str(record.id))
    payload.setdefault("eventSeq", record.seq)

    return {
        "id": str(record.id),
        "type": event_type,
        "serverId": str(record.server_id),
        "scope": {k: v for k, v in _event_scope(record).items() if v is not None},
        "seq": int(record.seq or 0),
        "epoch": public_event_hub.epoch,
        "createdAt": record.created_at.isoformat() if record.created_at else payload.get("createdAt"),
        "payload": payload,
    }


def public_event_envelope_from_record(record: EventRecord) -> dict[str, Any]:
    return event_record_to_public_event(record)


def sse_frame(event: dict[str, Any]) -> str:
    data = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    return f"id: {event.get('id', '')}\nevent: {event.get('type', 'message')}\ndata: {data}\n\n"


def sse_comment(comment: str) -> str:
    return f": {comment}\n\n"


def public_event_sse_frame(event: dict[str, Any]) -> str:
    data = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event.get('type', 'message')}\nid: {event.get('id', '')}\ndata: {data}\n\n"


def public_event_heartbeat_frame() -> str:
    return ": heartbeat\n\n"


def should_deliver_public_event(
    event: dict[str, Any],
    *,
    scope_kind: str | None,
    scope_id: str | None,
) -> bool:
    if not scope_kind and not scope_id:
        return True
    scope = event.get("scope") or {}
    if scope_kind and scope.get("kind") != scope_kind:
        return False
    if scope_id and str(scope.get("id") or scope.get("name") or "") != str(scope_id):
        return False
    return True


async def initialize_public_event_cursors(db: AsyncSession) -> None:
    rows = await db.execute(
        select(EventRecord.server_id, func.coalesce(func.max(EventRecord.seq), 0)).group_by(EventRecord.server_id)
    )
    for server_id, seq in rows.all():
        public_event_hub.set_server_cursor(server_id, int(seq or 0))


async def publish_latest_public_events(db: AsyncSession, *, server_id: uuid.UUID, limit: int = 200) -> int:
    cursor = public_event_hub.get_server_cursor(server_id)
    result = await db.execute(
        select(EventRecord)
        .where(EventRecord.server_id == server_id, EventRecord.seq > cursor)
        .order_by(EventRecord.seq)
        .limit(limit)
    )
    records = list(result.scalars().all())
    if not records:
        return 0

    published = 0
    for record in records:
        event = event_record_to_public_event(record)
        did_publish = await public_event_hub.publish(event)
        if did_publish:
            published += 1
        await _notify_postgres(db, event)
        public_event_hub.set_server_cursor(server_id, max(public_event_hub.get_server_cursor(server_id), int(record.seq or 0)))
    return published


async def _notify_postgres(db: AsyncSession, event: dict[str, Any]) -> None:
    del db
    if not settings.database_url.startswith("postgres"):
        return
    fanout = PostgresNotifyPublicEventFanout()
    _statement, params = fanout.notify_statement(event)
    import asyncpg

    conn = None
    try:
        conn = await asyncpg.connect(_asyncpg_dsn())
        await conn.execute("SELECT pg_notify($1, $2)", params["channel"], params["payload"])
    except Exception:
        logger.exception("public event postgres notify failed")
    finally:
        if conn is not None:
            try:
                await conn.close()
            except Exception:
                logger.debug("public event postgres notify close failed", exc_info=True)


def _asyncpg_dsn() -> str:
    return settings.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


async def start_postgres_public_event_listener() -> None:
    global _listener_task, _listener_stop
    if _listener_task or not settings.database_url.startswith("postgres"):
        return
    _listener_stop = asyncio.Event()
    _listener_task = asyncio.create_task(_postgres_listener_loop(_listener_stop))


async def stop_postgres_public_event_listener() -> None:
    global _listener_task, _listener_stop
    if not _listener_task:
        return
    if _listener_stop:
        _listener_stop.set()
    _listener_task.cancel()
    try:
        await _listener_task
    except asyncio.CancelledError:
        pass
    finally:
        _listener_task = None
        _listener_stop = None


async def _postgres_listener_loop(stop_event: asyncio.Event) -> None:
    import asyncpg

    conn = None
    while not stop_event.is_set():
        try:
            conn = await asyncpg.connect(_asyncpg_dsn())
            loop = asyncio.get_running_loop()

            def on_notify(_connection: Any, _pid: int, _channel: str, payload: str) -> None:
                loop.create_task(_publish_notify_payload(payload))

            await conn.add_listener(PUBLIC_EVENT_NOTIFY_CHANNEL, on_notify)
            logger.info("public event postgres listener started channel=%s", PUBLIC_EVENT_NOTIFY_CHANNEL)
            while not stop_event.is_set():
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("public event postgres listener failed; retrying")
            await asyncio.sleep(2)
        finally:
            if conn is not None:
                try:
                    await conn.close()
                except Exception:
                    logger.debug("public event postgres listener close failed", exc_info=True)
                conn = None


async def _publish_notify_payload(payload: str) -> None:
    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        logger.warning("public event postgres notify had invalid json")
        return
    if isinstance(event, dict):
        await public_event_hub.publish(event)
