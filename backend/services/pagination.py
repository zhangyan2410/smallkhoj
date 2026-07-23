"""Scoped, versioned cursor contracts for bounded API traversal."""

from __future__ import annotations

import base64
from datetime import datetime
import json
import uuid
from typing import Any


CURSOR_VERSION = 1
MAX_CURSOR_LENGTH = 4096


class PaginationCursorError(ValueError):
    pass


def _encode(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode(
    token: str,
    *,
    endpoint: str,
    server_id: uuid.UUID,
    filters: dict[str, str | None],
) -> dict[str, Any]:
    try:
        if not token or len(token) > MAX_CURSOR_LENGTH:
            raise PaginationCursorError
        padding = "=" * (-len(token) % 4)
        raw = base64.b64decode(token + padding, altchars=b"-_", validate=True)
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise PaginationCursorError
        if payload.get("v") != CURSOR_VERSION:
            raise PaginationCursorError
        if payload.get("endpoint") != endpoint:
            raise PaginationCursorError
        if payload.get("serverId") != str(server_id):
            raise PaginationCursorError
        if payload.get("filters") != filters:
            raise PaginationCursorError
        position = payload.get("position")
        if not isinstance(position, dict):
            raise PaginationCursorError
        return position
    except (PaginationCursorError, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise PaginationCursorError("Invalid pagination cursor") from exc


def encode_task_cursor(
    *,
    endpoint: str,
    server_id: uuid.UUID,
    channel_id: uuid.UUID | None,
    status: str | None,
    task_number: int,
    position_channel_id: uuid.UUID,
    task_id: uuid.UUID,
) -> str:
    return _encode({
        "v": CURSOR_VERSION,
        "endpoint": endpoint,
        "serverId": str(server_id),
        "filters": {
            "channelId": str(channel_id) if channel_id else None,
            "status": status,
        },
        "position": {
            "taskNumber": task_number,
            "channelId": str(position_channel_id),
            "id": str(task_id),
        },
    })


def decode_task_cursor(
    token: str,
    *,
    endpoint: str,
    server_id: uuid.UUID,
    channel_id: uuid.UUID | None,
    status: str | None,
) -> tuple[int, uuid.UUID, uuid.UUID]:
    position = _decode(
        token,
        endpoint=endpoint,
        server_id=server_id,
        filters={
            "channelId": str(channel_id) if channel_id else None,
            "status": status,
        },
    )
    try:
        task_number = position["taskNumber"]
        if not isinstance(task_number, int) or isinstance(task_number, bool):
            raise PaginationCursorError
        return (
            task_number,
            uuid.UUID(position["channelId"]),
            uuid.UUID(position["id"]),
        )
    except (KeyError, TypeError, ValueError, PaginationCursorError) as exc:
        raise PaginationCursorError("Invalid pagination cursor") from exc


def encode_thread_cursor(
    *,
    endpoint: str,
    server_id: uuid.UUID,
    channel_id: uuid.UUID | None,
    created_at: datetime,
    message_id: uuid.UUID,
) -> str:
    return _encode({
        "v": CURSOR_VERSION,
        "endpoint": endpoint,
        "serverId": str(server_id),
        "filters": {"channelId": str(channel_id) if channel_id else None},
        "position": {
            "createdAt": created_at.isoformat(),
            "id": str(message_id),
        },
    })


def decode_thread_cursor(
    token: str,
    *,
    endpoint: str,
    server_id: uuid.UUID,
    channel_id: uuid.UUID | None,
) -> tuple[datetime, uuid.UUID]:
    position = _decode(
        token,
        endpoint=endpoint,
        server_id=server_id,
        filters={"channelId": str(channel_id) if channel_id else None},
    )
    try:
        created_at = datetime.fromisoformat(position["createdAt"])
        if created_at.tzinfo is None:
            raise PaginationCursorError
        return created_at, uuid.UUID(position["id"])
    except (KeyError, TypeError, ValueError, PaginationCursorError) as exc:
        raise PaginationCursorError("Invalid pagination cursor") from exc
