"""Feishu Channel SDK transport adapter for the worker runtime."""

import json
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable

from config import settings
from services.feishu_worker_runtime import (
    build_feishu_worker_dependencies,
    handle_feishu_worker_raw_event,
    load_feishu_worker_connectors,
    resolve_feishu_worker_config,
)


FEISHU_CHANNEL_TRANSPORT_SDK_MISSING = "FEISHU_CHANNEL_TRANSPORT_SDK_MISSING"
FEISHU_CHANNEL_TRANSPORT_STARTED = "FEISHU_CHANNEL_TRANSPORT_STARTED"
FEISHU_CHANNEL_TRANSPORT_CONFIG_FAILED = "FEISHU_CHANNEL_TRANSPORT_CONFIG_FAILED"
FEISHU_CHANNEL_TRANSPORT_CONNECTOR_FAILED = "FEISHU_CHANNEL_TRANSPORT_CONNECTOR_FAILED"
FEISHU_CHANNEL_TRANSPORT_START_FAILED = "FEISHU_CHANNEL_TRANSPORT_START_FAILED"


@dataclass(frozen=True)
class FeishuChannelWorkerOutcome:
    status: str
    reason_code: str
    reason: str
    transport: Any | None = None
    failure: Exception | None = None


def _get(value: Any, *names: str) -> Any:
    for name in names:
        if isinstance(value, dict) and name in value:
            return value.get(name)
        if hasattr(value, name):
            return getattr(value, name)
    return None


def _nested(value: Any, *names: str) -> Any:
    current = value
    for name in names:
        current = _get(current, name)
        if current is None:
            return None
    return current


def _text(message: Any) -> str:
    value = _get(message, "content_text", "text", "content")
    if isinstance(value, dict):
        return str(value.get("text") or value.get("content") or "")
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return value
        if isinstance(parsed, dict):
            return str(parsed.get("text") or parsed.get("content") or value)
    return str(value or "")


def sdk_message_to_raw_event(message: Any, config: Any) -> dict[str, Any]:
    sender_open_id = _get(message, "sender_open_id", "open_id") or _nested(message, "sender", "sender_id", "open_id")
    event_id = _get(message, "event_id") or _get(message, "message_id") or _get(message, "id") or ""
    message_id = _get(message, "message_id", "id") or ""
    return {
        "header": {
            "event_id": str(event_id),
            "event_type": str(_get(message, "event_type") or "im.message.receive_v1"),
            "app_id": getattr(config, "app_id", None),
        },
        "event": {
            "sender": {
                "sender_id": {
                    "open_id": sender_open_id,
                }
            },
            "message": {
                "message_id": str(message_id),
                "chat_id": str(_get(message, "chat_id") or ""),
                "chat_type": str(_get(message, "chat_type") or "unknown"),
                "content": json.dumps({"text": _text(message)}, ensure_ascii=False),
                "mentions": _get(message, "mentions") or [],
                "thread_id": _get(message, "thread_id"),
                "root_id": _get(message, "root_id"),
                "parent_id": _get(message, "parent_id"),
                "create_time": _get(message, "create_time"),
            },
        },
    }


def create_feishu_channel(config: Any) -> Any:
    try:
        from lark_channel import FeishuChannel
    except ImportError as exc:
        raise RuntimeError(f"{FEISHU_CHANNEL_TRANSPORT_SDK_MISSING}: lark-channel-sdk is required") from exc
    return FeishuChannel(app_id=config.app_id, app_secret=config.app_secret)


@asynccontextmanager
async def _db_session_from_factory(db_factory: Callable[[], Any]) -> AsyncIterator[Any]:
    db_or_context = db_factory()
    enter = getattr(db_or_context, "__aenter__", None)
    exit_ = getattr(db_or_context, "__aexit__", None)
    if enter is not None and exit_ is not None:
        async with db_or_context as db:
            yield db
        return
    yield db_or_context


class FeishuChannelSDKTransport:
    def __init__(
        self,
        *,
        channel: Any,
        config: Any,
        connectors: Any,
        db_factory: Callable[[], Any],
        dependencies_factory: Callable[[], Any] = build_feishu_worker_dependencies,
    ):
        self.channel = channel
        self.config = config
        self.connectors = connectors
        self.db_factory = db_factory
        self.dependencies_factory = dependencies_factory
        self.outcomes: list[Any] = []

    async def _on_message(self, message: Any) -> Any:
        async with _db_session_from_factory(self.db_factory) as db:
            outcome = await handle_feishu_worker_raw_event(
                db,
                raw_event=sdk_message_to_raw_event(message, self.config),
                config=self.config,
                connectors=self.connectors,
                dependencies=self.dependencies_factory(),
                close_dependencies=True,
            )
        self.outcomes.append(outcome)
        return outcome

    async def connect(self) -> None:
        self.channel.on("message", self._on_message)
        await self.channel.connect()

    async def disconnect(self) -> None:
        disconnect = getattr(self.channel, "disconnect", None)
        if disconnect is not None:
            await disconnect()


async def run_feishu_channel_worker(
    *,
    db_factory: Callable[[], Any],
    configured_settings: Any = settings,
    channel_factory: Callable[[Any], Any] = create_feishu_channel,
    dependencies_factory: Callable[[], Any] = build_feishu_worker_dependencies,
) -> FeishuChannelWorkerOutcome:
    config_outcome = resolve_feishu_worker_config(configured_settings=configured_settings)
    if config_outcome.status != "ready" or config_outcome.config is None:
        return FeishuChannelWorkerOutcome(
            status="failed",
            reason_code=FEISHU_CHANNEL_TRANSPORT_CONFIG_FAILED,
            reason=config_outcome.reason,
        )

    async with db_factory() as db:
        connectors = await load_feishu_worker_connectors(db, config_outcome.config)
    if connectors.status != "ready":
        return FeishuChannelWorkerOutcome(
            status="failed",
            reason_code=FEISHU_CHANNEL_TRANSPORT_CONNECTOR_FAILED,
            reason=connectors.reason,
        )

    try:
        transport = FeishuChannelSDKTransport(
            channel=channel_factory(config_outcome.config),
            config=config_outcome.config,
            connectors=connectors,
            db_factory=db_factory,
            dependencies_factory=dependencies_factory,
        )
        await transport.connect()
    except Exception as exc:
        reason_code = FEISHU_CHANNEL_TRANSPORT_SDK_MISSING if FEISHU_CHANNEL_TRANSPORT_SDK_MISSING in str(exc) else FEISHU_CHANNEL_TRANSPORT_START_FAILED
        return FeishuChannelWorkerOutcome(
            status="failed",
            reason_code=reason_code,
            reason=str(exc),
            failure=exc,
        )

    return FeishuChannelWorkerOutcome(
        status="started",
        reason_code=FEISHU_CHANNEL_TRANSPORT_STARTED,
        reason="Feishu Channel SDK transport started.",
        transport=transport,
    )
