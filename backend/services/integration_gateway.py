"""Durable external integration gateway helpers."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models import ExternalConnector, ExternalEvent, ExternalMapping, ExternalRoute, ExternalSession


SENSITIVE_KEY_PARTS = ("token", "secret", "password", "credential", "authorization")
EXTERNAL_ROUTE_NOT_FOUND = "EXTERNAL_ROUTE_NOT_FOUND"
EXTERNAL_ROUTE_DISABLED = "EXTERNAL_ROUTE_DISABLED"


@dataclass(frozen=True)
class ExternalEventClaimOutcome:
    status: str
    event: ExternalEvent


@dataclass(frozen=True)
class ExternalRouteOutcome:
    status: str
    route: ExternalRoute | None = None
    failure_code: str | None = None
    failure_reason: str | None = None


@dataclass(frozen=True)
class ExternalSessionOutcome:
    status: str
    session: ExternalSession


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> str | None:
    return value.isoformat() if value else None


def _uuid(value: Any) -> str | None:
    return str(value) if value else None


def _is_sensitive_key(key: str) -> bool:
    normalized = key.replace("_", "").replace("-", "").lower()
    return any(part in normalized for part in SENSITIVE_KEY_PARTS)


def sanitize_external_payload(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[redacted]" if _is_sensitive_key(str(key)) else sanitize_external_payload(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize_external_payload(item) for item in value]
    return value


async def _find_event_by_dedup(
    db: AsyncSession,
    *,
    connector_id: uuid.UUID,
    dedup_key: str,
) -> ExternalEvent | None:
    result = await db.execute(
        select(ExternalEvent).where(
            ExternalEvent.connector_id == connector_id,
            ExternalEvent.dedup_key == dedup_key,
        )
    )
    return result.scalar_one_or_none()


async def claim_external_event(
    db: AsyncSession,
    *,
    server_id: uuid.UUID,
    connector_id: uuid.UUID,
    provider: str,
    event_type: str,
    dedup_key: str,
    source_event_id: str | None = None,
    source_message_id: str | None = None,
    source_thread_id: str | None = None,
    actor_external_id: str | None = None,
    normalized: dict[str, Any] | None = None,
    raw_ref: str | None = None,
) -> ExternalEventClaimOutcome:
    existing = await _find_event_by_dedup(db, connector_id=connector_id, dedup_key=dedup_key)
    if existing is not None:
        return ExternalEventClaimOutcome(status="duplicate", event=existing)

    event = ExternalEvent(
        server_id=server_id,
        connector_id=connector_id,
        provider=provider,
        source_event_id=source_event_id,
        source_message_id=source_message_id,
        source_thread_id=source_thread_id,
        dedup_key=dedup_key,
        status="received",
        event_type=event_type,
        actor_external_id=actor_external_id,
        normalized=sanitize_external_payload(normalized or {}),
        raw_ref=raw_ref,
    )
    db.add(event)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        duplicate = await _find_event_by_dedup(db, connector_id=connector_id, dedup_key=dedup_key)
        if duplicate is not None:
            return ExternalEventClaimOutcome(status="duplicate", event=duplicate)
        raise
    return ExternalEventClaimOutcome(status="claimed", event=event)


def _route_matches(route: ExternalRoute, source: dict[str, Any]) -> bool:
    selector = route.source_selector or {}
    if not isinstance(selector, dict):
        return False
    return all(source.get(key) == value for key, value in selector.items())


async def resolve_external_route(
    db: AsyncSession,
    *,
    connector_id: uuid.UUID,
    source: dict[str, Any],
) -> ExternalRouteOutcome:
    result = await db.execute(
        select(ExternalRoute)
        .where(ExternalRoute.connector_id == connector_id)
        .order_by(ExternalRoute.created_at.asc())
    )
    routes = result.scalars().all()
    for route in routes:
        if not _route_matches(route, source):
            continue
        if route.status == "disabled":
            return ExternalRouteOutcome(
                status="disabled",
                route=route,
                failure_code=EXTERNAL_ROUTE_DISABLED,
                failure_reason="Matched external route is disabled.",
            )
        return ExternalRouteOutcome(status="matched", route=route)
    return ExternalRouteOutcome(
        status="no_route",
        failure_code=EXTERNAL_ROUTE_NOT_FOUND,
        failure_reason="No active route matched this external source.",
    )


async def get_or_create_external_session(
    db: AsyncSession,
    *,
    server_id: uuid.UUID,
    connector_id: uuid.UUID,
    provider: str,
    external_scope_type: str,
    external_scope_id: str,
    channel_id: uuid.UUID | None = None,
    thread_root_message_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    member_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> ExternalSessionOutcome:
    result = await db.execute(
        select(ExternalSession).where(
            ExternalSession.connector_id == connector_id,
            ExternalSession.external_scope_type == external_scope_type,
            ExternalSession.external_scope_id == external_scope_id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return ExternalSessionOutcome(status="existing", session=existing)

    session = ExternalSession(
        server_id=server_id,
        connector_id=connector_id,
        provider=provider,
        external_scope_type=external_scope_type,
        external_scope_id=external_scope_id,
        channel_id=channel_id,
        thread_root_message_id=thread_root_message_id,
        task_id=task_id,
        member_id=member_id,
        status="active",
        metadata_json=sanitize_external_payload(metadata or {}),
    )
    db.add(session)
    await db.flush()
    return ExternalSessionOutcome(status="created", session=session)


async def create_external_mapping(
    db: AsyncSession,
    *,
    server_id: uuid.UUID,
    connector_id: uuid.UUID,
    provider: str,
    local_type: str,
    local_id: uuid.UUID,
    external_type: str,
    external_id: str,
    external_url: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> ExternalMapping:
    mapping = ExternalMapping(
        server_id=server_id,
        connector_id=connector_id,
        provider=provider,
        local_type=local_type,
        local_id=local_id,
        external_type=external_type,
        external_id=external_id,
        external_url=external_url,
        metadata_json=sanitize_external_payload(metadata or {}),
    )
    db.add(mapping)
    await db.flush()
    return mapping


async def list_external_mappings_for_local(
    db: AsyncSession,
    *,
    server_id: uuid.UUID,
    local_type: str,
    local_id: uuid.UUID,
) -> list[ExternalMapping]:
    result = await db.execute(
        select(ExternalMapping).where(
            ExternalMapping.server_id == server_id,
            ExternalMapping.local_type == local_type,
            ExternalMapping.local_id == local_id,
        )
    )
    return result.scalars().all()


async def list_external_mappings_for_external(
    db: AsyncSession,
    *,
    connector_id: uuid.UUID,
    external_type: str,
    external_id: str,
) -> list[ExternalMapping]:
    result = await db.execute(
        select(ExternalMapping).where(
            ExternalMapping.connector_id == connector_id,
            ExternalMapping.external_type == external_type,
            ExternalMapping.external_id == external_id,
        )
    )
    return result.scalars().all()


async def link_external_event(
    db: AsyncSession,
    event: ExternalEvent,
    *,
    route_id: uuid.UUID | None = None,
    session_id: uuid.UUID | None = None,
    channel_id: uuid.UUID | None = None,
    message_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    task_run_id: uuid.UUID | None = None,
) -> ExternalEvent:
    now = _utcnow()
    event.status = "accepted"
    event.route_id = route_id
    event.session_id = session_id
    event.channel_id = channel_id
    event.message_id = message_id
    event.task_id = task_id
    event.task_run_id = task_run_id
    event.processed_at = now
    event.updated_at = now
    await db.flush()
    return event


async def mark_external_event_accepted(db: AsyncSession, event: ExternalEvent) -> ExternalEvent:
    event.status = "accepted"
    event.processed_at = event.processed_at or _utcnow()
    event.updated_at = _utcnow()
    await db.flush()
    return event


async def mark_external_event_dropped(
    db: AsyncSession,
    event: ExternalEvent,
    *,
    failure_code: str,
    failure_reason: str,
) -> ExternalEvent:
    return await _mark_external_event_terminal(
        db,
        event,
        status="dropped",
        failure_code=failure_code,
        failure_reason=failure_reason,
    )


async def mark_external_event_failed(
    db: AsyncSession,
    event: ExternalEvent,
    *,
    failure_code: str,
    failure_reason: str,
) -> ExternalEvent:
    return await _mark_external_event_terminal(
        db,
        event,
        status="failed",
        failure_code=failure_code,
        failure_reason=failure_reason,
    )


async def mark_external_event_completed(db: AsyncSession, event: ExternalEvent) -> ExternalEvent:
    return await _mark_external_event_terminal(db, event, status="completed")


async def mark_external_event_writeback_failed(
    db: AsyncSession,
    event: ExternalEvent,
    *,
    failure_code: str,
    failure_reason: str,
) -> ExternalEvent:
    return await _mark_external_event_terminal(
        db,
        event,
        status="writeback_failed",
        failure_code=failure_code,
        failure_reason=failure_reason,
    )


async def _mark_external_event_terminal(
    db: AsyncSession,
    event: ExternalEvent,
    *,
    status: str,
    failure_code: str | None = None,
    failure_reason: str | None = None,
) -> ExternalEvent:
    now = _utcnow()
    event.status = status
    event.completed_at = now if status in {"completed", "failed", "dropped", "writeback_failed"} else event.completed_at
    event.updated_at = now
    if failure_code is not None:
        event.failure_code = failure_code
    if failure_reason is not None:
        event.failure_reason = failure_reason
    await db.flush()
    return event


def serialize_external_connector(connector: ExternalConnector) -> dict[str, Any]:
    return {
        "id": str(connector.id),
        "serverId": str(connector.server_id),
        "provider": connector.provider,
        "name": connector.name,
        "status": connector.status,
        "config": sanitize_external_payload(connector.config or {}),
        "secretRef": "[redacted]" if connector.secret_ref else None,
        "encryptedConfig": "[redacted]" if connector.encrypted_config else None,
        "lastErrorCode": connector.last_error_code,
        "lastErrorReason": connector.last_error_reason,
        "createdAt": _iso(connector.created_at),
        "updatedAt": _iso(connector.updated_at),
    }


def serialize_external_event(event: ExternalEvent) -> dict[str, Any]:
    return {
        "id": str(event.id),
        "serverId": str(event.server_id),
        "connectorId": str(event.connector_id),
        "routeId": _uuid(event.route_id),
        "sessionId": _uuid(event.session_id),
        "provider": event.provider,
        "sourceEventId": event.source_event_id,
        "sourceMessageId": event.source_message_id,
        "sourceThreadId": event.source_thread_id,
        "dedupKey": event.dedup_key,
        "status": event.status,
        "eventType": event.event_type,
        "actorExternalId": event.actor_external_id,
        "normalized": sanitize_external_payload(event.normalized or {}),
        "rawRef": event.raw_ref,
        "channelId": _uuid(event.channel_id),
        "messageId": _uuid(event.message_id),
        "taskId": _uuid(event.task_id),
        "taskRunId": _uuid(event.task_run_id),
        "failureCode": event.failure_code,
        "failureReason": event.failure_reason,
        "receivedAt": _iso(event.received_at),
        "processedAt": _iso(event.processed_at),
        "completedAt": _iso(event.completed_at),
        "createdAt": _iso(event.created_at),
        "updatedAt": _iso(event.updated_at),
    }
