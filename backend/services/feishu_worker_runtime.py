"""Runtime boundary for the deployable Feishu long-connection worker."""

import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Iterable

from sqlalchemy import select

from config import settings
from models import ExternalConnector
from services.feishu_event_loop import process_feishu_raw_event
from services.integration_runtime import (
    build_feishu_reply_dependencies,
    build_task_run_writeback_dependencies,
)


FEISHU_WORKER_CONFIG_MISSING_CONNECTOR_ID = "FEISHU_WORKER_CONFIG_MISSING_CONNECTOR_ID"
FEISHU_WORKER_CONFIG_MISSING_JIRA_CONNECTOR_ID = "FEISHU_WORKER_CONFIG_MISSING_JIRA_CONNECTOR_ID"
FEISHU_WORKER_CONFIG_MISSING_CREATOR_ID = "FEISHU_WORKER_CONFIG_MISSING_CREATOR_ID"
FEISHU_WORKER_CONFIG_INVALID_UUID = "FEISHU_WORKER_CONFIG_INVALID_UUID"
FEISHU_WORKER_CONFIG_MISSING_APP_CREDENTIALS = "FEISHU_WORKER_CONFIG_MISSING_APP_CREDENTIALS"
FEISHU_WORKER_CONNECTOR_NOT_FOUND = "FEISHU_WORKER_CONNECTOR_NOT_FOUND"
FEISHU_WORKER_CONNECTOR_PROVIDER_MISMATCH = "FEISHU_WORKER_CONNECTOR_PROVIDER_MISMATCH"
FEISHU_WORKER_CONNECTOR_DISABLED = "FEISHU_WORKER_CONNECTOR_DISABLED"
FEISHU_WORKER_JIRA_CREDENTIALS_MISSING = "FEISHU_WORKER_JIRA_CREDENTIALS_MISSING"
FEISHU_WORKER_EVENT_LOOP_FAILED = "FEISHU_WORKER_EVENT_LOOP_FAILED"
FEISHU_WORKER_EVENT_PROCESSED = "FEISHU_WORKER_EVENT_PROCESSED"


@dataclass(frozen=True)
class FeishuWorkerConfig:
    feishu_connector_id: uuid.UUID
    jira_connector_id: uuid.UUID
    creator_id: uuid.UUID
    bot_open_id: str | None
    bot_name: str | None
    app_id: str
    app_secret: str
    enabled: bool = False


@dataclass(frozen=True)
class FeishuWorkerConfigOutcome:
    status: str
    reason_code: str
    reason: str
    config: FeishuWorkerConfig | None = None


@dataclass(frozen=True)
class FeishuWorkerConnectorsOutcome:
    status: str
    reason_code: str
    reason: str
    feishu_connector: ExternalConnector | Any | None = None
    jira_connector: ExternalConnector | Any | None = None


@dataclass(frozen=True)
class FeishuWorkerDependencies:
    jira_http_client: Any
    feishu_http_client: Any
    jira_credentials_resolver: Callable[[Any], dict[str, str] | None]
    feishu_reply_config: Any


@dataclass(frozen=True)
class FeishuWorkerEventOutcome:
    status: str
    reason_code: str
    reason: str
    event_loop_outcome: Any | None = None
    failure: Exception | None = None


def _failure(reason_code: str, reason: str) -> FeishuWorkerConfigOutcome:
    return FeishuWorkerConfigOutcome(status="failed", reason_code=reason_code, reason=reason)


def _parse_uuid(value: str, *, reason_code: str, label: str) -> tuple[uuid.UUID | None, FeishuWorkerConfigOutcome | None]:
    raw = str(value or "").strip()
    if not raw:
        return None, _failure(reason_code, f"{label} is required.")
    try:
        return uuid.UUID(raw), None
    except ValueError:
        return None, _failure(FEISHU_WORKER_CONFIG_INVALID_UUID, f"{label} must be a valid UUID.")


def resolve_feishu_worker_config(*, configured_settings: Any = settings) -> FeishuWorkerConfigOutcome:
    feishu_connector_id, failure = _parse_uuid(
        getattr(configured_settings, "feishu_worker_connector_id", ""),
        reason_code=FEISHU_WORKER_CONFIG_MISSING_CONNECTOR_ID,
        label="Feishu worker connector id",
    )
    if failure is not None:
        return failure

    jira_connector_id, failure = _parse_uuid(
        getattr(configured_settings, "feishu_worker_jira_connector_id", ""),
        reason_code=FEISHU_WORKER_CONFIG_MISSING_JIRA_CONNECTOR_ID,
        label="Feishu worker Jira connector id",
    )
    if failure is not None:
        return failure

    creator_id, failure = _parse_uuid(
        getattr(configured_settings, "feishu_worker_creator_id", ""),
        reason_code=FEISHU_WORKER_CONFIG_MISSING_CREATOR_ID,
        label="Feishu worker creator id",
    )
    if failure is not None:
        return failure

    app_id = str(getattr(configured_settings, "feishu_worker_app_id", "") or "").strip()
    app_secret = str(getattr(configured_settings, "feishu_worker_app_secret", "") or "").strip()
    if not app_id or not app_secret:
        return _failure(
            FEISHU_WORKER_CONFIG_MISSING_APP_CREDENTIALS,
            "Feishu worker app id and app secret are required.",
        )

    bot_open_id = str(getattr(configured_settings, "feishu_worker_bot_open_id", "") or "").strip() or None
    bot_name = str(getattr(configured_settings, "feishu_worker_bot_name", "") or "").strip() or None
    return FeishuWorkerConfigOutcome(
        status="ready",
        reason_code=FEISHU_WORKER_EVENT_PROCESSED,
        reason="Feishu worker config is ready.",
        config=FeishuWorkerConfig(
            enabled=bool(getattr(configured_settings, "feishu_worker_enabled", False)),
            feishu_connector_id=feishu_connector_id,
            jira_connector_id=jira_connector_id,
            creator_id=creator_id,
            bot_open_id=bot_open_id,
            bot_name=bot_name,
            app_id=app_id,
            app_secret=app_secret,
        ),
    )


async def _load_connector(db: Any, connector_id: uuid.UUID) -> ExternalConnector | None:
    result = await db.execute(select(ExternalConnector).where(ExternalConnector.id == connector_id))
    return result.scalar_one_or_none()


def _connector_failure(reason_code: str, reason: str) -> FeishuWorkerConnectorsOutcome:
    return FeishuWorkerConnectorsOutcome(status="failed", reason_code=reason_code, reason=reason)


def _validate_connector(connector: Any, *, provider: str, label: str) -> FeishuWorkerConnectorsOutcome | None:
    if connector is None:
        return _connector_failure(FEISHU_WORKER_CONNECTOR_NOT_FOUND, f"{label} connector was not found.")
    if getattr(connector, "provider", None) != provider:
        return _connector_failure(
            FEISHU_WORKER_CONNECTOR_PROVIDER_MISMATCH,
            f"{label} connector provider must be {provider}.",
        )
    if getattr(connector, "status", None) != "active":
        return _connector_failure(FEISHU_WORKER_CONNECTOR_DISABLED, f"{label} connector is not active.")
    return None


async def load_feishu_worker_connectors(db: Any, config: FeishuWorkerConfig) -> FeishuWorkerConnectorsOutcome:
    feishu_connector = await _load_connector(db, config.feishu_connector_id)
    jira_connector = await _load_connector(db, config.jira_connector_id)

    failure = _validate_connector(feishu_connector, provider="feishu", label="Feishu")
    if failure is not None:
        return failure
    failure = _validate_connector(jira_connector, provider="jira", label="Jira")
    if failure is not None:
        return failure

    return FeishuWorkerConnectorsOutcome(
        status="ready",
        reason_code=FEISHU_WORKER_EVENT_PROCESSED,
        reason="Feishu worker connectors are ready.",
        feishu_connector=feishu_connector,
        jira_connector=jira_connector,
    )


def build_feishu_worker_dependencies(*, configured_settings: Any = settings) -> FeishuWorkerDependencies:
    writeback_dependencies = build_task_run_writeback_dependencies(configured_settings=configured_settings)
    reply_dependencies = build_feishu_reply_dependencies(configured_settings=configured_settings)
    return FeishuWorkerDependencies(
        jira_http_client=writeback_dependencies.jira_http_client,
        jira_credentials_resolver=writeback_dependencies.jira_credentials_resolver,
        feishu_http_client=reply_dependencies.http_client,
        feishu_reply_config=reply_dependencies.config,
    )


async def close_feishu_worker_dependencies(dependencies: Any) -> None:
    for client in (getattr(dependencies, "jira_http_client", None), getattr(dependencies, "feishu_http_client", None)):
        close = getattr(client, "aclose", None)
        if close is not None:
            await close()


async def _maybe_await_credentials(value: dict[str, str] | None | Awaitable[dict[str, str] | None]) -> dict[str, str] | None:
    if hasattr(value, "__await__"):
        return await value  # type: ignore[return-value]
    return value


async def handle_feishu_worker_raw_event(
    db: Any,
    *,
    raw_event: dict[str, Any],
    config: FeishuWorkerConfig,
    connectors: FeishuWorkerConnectorsOutcome | Any,
    dependencies: FeishuWorkerDependencies,
    close_dependencies: bool = False,
) -> FeishuWorkerEventOutcome:
    try:
        jira_connector = connectors.jira_connector
        jira_credentials = await _maybe_await_credentials(dependencies.jira_credentials_resolver(jira_connector))
        if jira_credentials is None:
            return FeishuWorkerEventOutcome(
                status="failed",
                reason_code=FEISHU_WORKER_JIRA_CREDENTIALS_MISSING,
                reason="Jira credentials are required for Feishu worker event processing.",
            )

        event_loop_outcome = await process_feishu_raw_event(
            db,
            raw_event=raw_event,
            server_id=connectors.feishu_connector.server_id,
            feishu_connector_id=connectors.feishu_connector.id,
            jira_connector=jira_connector,
            creator_id=config.creator_id,
            jira_http_client=dependencies.jira_http_client,
            jira_credentials=jira_credentials,
            feishu_http_client=dependencies.feishu_http_client,
            feishu_reply_config=dependencies.feishu_reply_config,
            bot_open_id=config.bot_open_id,
            bot_name=config.bot_name,
        )
        return FeishuWorkerEventOutcome(
            status="processed",
            reason_code=FEISHU_WORKER_EVENT_PROCESSED,
            reason="Feishu worker event was processed.",
            event_loop_outcome=event_loop_outcome,
        )
    except Exception as exc:
        return FeishuWorkerEventOutcome(
            status="failed",
            reason_code=FEISHU_WORKER_EVENT_LOOP_FAILED,
            reason=str(exc),
            failure=exc,
        )
    finally:
        if close_dependencies:
            await close_feishu_worker_dependencies(dependencies)


class FakeFeishuEventTransport:
    def __init__(self, events: Iterable[dict[str, Any]]):
        self._events = list(events)

    async def events(self):
        for event in self._events:
            yield event


async def run_feishu_event_transport(
    transport: Any,
    *,
    db_factory: Callable[[], Any],
    config: FeishuWorkerConfig,
    connectors: FeishuWorkerConnectorsOutcome | Any,
    dependencies_factory: Callable[[], FeishuWorkerDependencies],
) -> list[FeishuWorkerEventOutcome]:
    results = []
    async for raw_event in transport.events():
        result = await handle_feishu_worker_raw_event(
            db_factory(),
            raw_event=raw_event,
            config=config,
            connectors=connectors,
            dependencies=dependencies_factory(),
            close_dependencies=True,
        )
        results.append(result)
    return results
