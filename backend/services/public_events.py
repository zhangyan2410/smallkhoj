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
    await _postgres_notify_runtime.publish(event)


def _asyncpg_dsn() -> str:
    return settings.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


class PostgresNotifyRuntime:
    """One recoverable publisher/listener owner for a backend process."""

    def __init__(self) -> None:
        self.state = "stopped"
        self.last_error: str | None = None
        self.generation = 0
        self._pool: Any | None = None
        self._listener_task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._listener_connected = False
        self._lifecycle_lock = asyncio.Lock()
        self._publisher_recovery_lock = asyncio.Lock()
        self._callback_tasks: set[asyncio.Task] = set()

    async def start(self) -> None:
        if not settings.database_url.startswith("postgres"):
            return
        async with self._lifecycle_lock:
            if self.state != "stopped":
                return
            self.state = "starting"
            self.last_error = None
            self.generation += 1
            generation = self.generation
            self._stop_event = asyncio.Event()
            self._listener_connected = False
            try:
                self._pool = await self._create_pool()
            except Exception as exc:
                self.state = "stopped"
                self.last_error = str(exc)
                self._stop_event = None
                raise
            self._listener_task = asyncio.create_task(
                self._listener_loop(generation, self._stop_event),
                name=f"postgres-public-events-listener-{generation}",
            )

    async def stop(self) -> None:
        async with self._lifecycle_lock:
            if self.state == "stopped":
                return
            self.state = "stopping"
            self.generation += 1
            stop_event = self._stop_event
            listener_task = self._listener_task
            pool = self._pool
            callback_tasks = set(self._callback_tasks)
            self._stop_event = None
            self._listener_task = None
            self._pool = None
            self._listener_connected = False
            if stop_event is not None:
                stop_event.set()
            if listener_task is not None:
                listener_task.cancel()
            for task in callback_tasks:
                task.cancel()

        await self._wait_for_tasks(
            {task for task in callback_tasks | ({listener_task} if listener_task else set()) if task},
            label="listener/callback",
        )
        await self._close_resource(pool, label="publisher pool")

        async with self._lifecycle_lock:
            self._callback_tasks.difference_update(callback_tasks)
            self.state = "stopped"

    async def publish(self, event: dict[str, Any]) -> bool:
        if self._pool is None or self.state in {"stopped", "stopping"}:
            logger.error(
                "public event postgres publisher is not healthy state=%s generation=%s; notification dropped",
                self.state,
                self.generation,
            )
            return False

        fanout = PostgresNotifyPublicEventFanout()
        _statement, params = fanout.notify_statement(event)
        attempts = settings.notify_publish_attempts
        for attempt in range(attempts):
            generation = self.generation
            pool = self._pool
            if pool is None:
                return False
            try:
                async with pool.acquire(timeout=settings.notify_operation_timeout_seconds) as conn:
                    await asyncio.wait_for(
                        conn.execute(
                            "SELECT pg_notify($1, $2)",
                            params["channel"],
                            params["payload"],
                        ),
                        timeout=settings.notify_operation_timeout_seconds,
                    )
                if self._listener_connected:
                    self.state = "healthy"
                    self.last_error = None
                return True
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.state = "degraded"
                self.last_error = str(exc)
                logger.warning(
                    "public event postgres publisher failed attempt=%s/%s generation=%s: %s",
                    attempt + 1,
                    attempts,
                    generation,
                    exc,
                )
                if attempt + 1 >= attempts:
                    return False
                recovered = await self._recover_publisher_pool(generation, pool)
                if not recovered:
                    return False
        return False

    async def _create_pool(self) -> Any:
        import asyncpg

        return await asyncio.wait_for(
            asyncpg.create_pool(
                _asyncpg_dsn(),
                min_size=1,
                max_size=settings.notify_publisher_pool_size,
                timeout=settings.notify_connect_timeout_seconds,
                command_timeout=settings.notify_operation_timeout_seconds,
                server_settings={"application_name": "smallkhoj-notify-publisher"},
            ),
            timeout=settings.notify_connect_timeout_seconds,
        )

    async def _recover_publisher_pool(self, generation: int, failed_pool: Any) -> bool:
        async with self._publisher_recovery_lock:
            if generation != self.generation or self.state in {"stopped", "stopping"}:
                return False
            if self._pool is not failed_pool:
                return self._pool is not None
            self._pool = None
            await self._close_resource(failed_pool, label="invalid publisher pool")
            try:
                replacement = await self._create_pool()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.state = "degraded"
                self.last_error = str(exc)
                logger.exception("public event postgres publisher recovery failed")
                return False
            if generation != self.generation or self.state in {"stopped", "stopping"}:
                await self._close_resource(replacement, label="stale replacement publisher pool")
                return False
            self._pool = replacement
            logger.info("public event postgres publisher recovered generation=%s", generation)
            return True

    async def _listener_loop(self, generation: int, stop_event: asyncio.Event) -> None:
        import asyncpg

        delay = settings.notify_reconnect_initial_seconds
        while generation == self.generation and not stop_event.is_set():
            conn = None
            termination_event = asyncio.Event()
            try:
                conn = await asyncio.wait_for(
                    asyncpg.connect(
                        _asyncpg_dsn(),
                        timeout=settings.notify_connect_timeout_seconds,
                        command_timeout=settings.notify_operation_timeout_seconds,
                        server_settings={"application_name": "smallkhoj-notify-listener"},
                    ),
                    timeout=settings.notify_connect_timeout_seconds,
                )
                loop = asyncio.get_running_loop()

                def on_termination(_connection: Any) -> None:
                    loop.call_soon_threadsafe(termination_event.set)

                def on_notify(_connection: Any, _pid: int, _channel: str, payload: str) -> None:
                    if generation != self.generation or stop_event.is_set():
                        return
                    task = loop.create_task(self._publish_payload(generation, payload))
                    self._callback_tasks.add(task)
                    task.add_done_callback(self._callback_tasks.discard)

                conn.add_termination_listener(on_termination)
                await conn.add_listener(PUBLIC_EVENT_NOTIFY_CHANNEL, on_notify)
                self._listener_connected = True
                self.state = "healthy"
                self.last_error = None
                delay = settings.notify_reconnect_initial_seconds
                logger.info(
                    "public event postgres listener healthy channel=%s generation=%s",
                    PUBLIC_EVENT_NOTIFY_CHANNEL,
                    generation,
                )
                await self._wait_for_listener_loss(conn, stop_event, termination_event)
                if stop_event.is_set() or generation != self.generation:
                    break
                self.state = "reconnecting"
                self._listener_connected = False
                logger.warning("public event postgres listener connection lost; reconnecting")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if stop_event.is_set() or generation != self.generation:
                    break
                self.state = "degraded"
                self._listener_connected = False
                self.last_error = str(exc)
                logger.exception("public event postgres listener failed; retrying")
            finally:
                self._listener_connected = False
                await self._close_resource(conn, label="listener connection")

            if stop_event.is_set() or generation != self.generation:
                break
            await self._wait_for_stop(stop_event, delay)
            delay = min(delay * 2, settings.notify_reconnect_max_seconds)

    async def _publish_payload(self, generation: int, payload: str) -> None:
        if generation != self.generation or self.state in {"stopped", "stopping"}:
            return
        await _publish_notify_payload(payload)

    @staticmethod
    async def _wait_for_listener_loss(
        conn: Any,
        stop_event: asyncio.Event,
        termination_event: asyncio.Event,
    ) -> None:
        while not stop_event.is_set() and not termination_event.is_set():
            if conn.is_closed():
                return
            try:
                await asyncio.wait_for(termination_event.wait(), timeout=0.25)
            except TimeoutError:
                continue

    @staticmethod
    async def _wait_for_stop(stop_event: asyncio.Event, delay: float) -> None:
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=delay)
        except TimeoutError:
            pass

    async def _wait_for_tasks(self, tasks: set[asyncio.Task], *, label: str) -> None:
        if not tasks:
            return
        done, pending = await asyncio.wait(tasks, timeout=settings.notify_shutdown_timeout_seconds)
        for task in done:
            if task.cancelled():
                continue
            try:
                task.result()
            except Exception:
                logger.debug("public event postgres %s task failed during shutdown", label, exc_info=True)
        if pending:
            logger.error(
                "public event postgres %s shutdown timed out pending=%s",
                label,
                len(pending),
            )

    @staticmethod
    async def _close_resource(resource: Any | None, *, label: str) -> None:
        if resource is None:
            return
        try:
            await asyncio.wait_for(
                resource.close(),
                timeout=settings.notify_shutdown_timeout_seconds,
            )
        except TimeoutError:
            logger.error("public event postgres %s close timed out", label)
            terminate = getattr(resource, "terminate", None)
            if terminate is not None:
                terminate()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("public event postgres %s close failed", label, exc_info=True)


_postgres_notify_runtime = PostgresNotifyRuntime()


async def start_postgres_public_event_listener() -> None:
    await _postgres_notify_runtime.start()


async def stop_postgres_public_event_listener() -> None:
    await _postgres_notify_runtime.stop()


async def _publish_notify_payload(payload: str) -> None:
    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        logger.warning("public event postgres notify had invalid json")
        return
    if isinstance(event, dict):
        await public_event_hub.publish(event)
