"""Initial-release integration bootstrap helpers."""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from models import Channel, ChannelMember, ExternalConnector, ExternalRoute, Member, Server

BOOTSTRAP_REFERENCE_NOT_FOUND = "BOOTSTRAP_REFERENCE_NOT_FOUND"
BOOTSTRAP_REFERENCE_SCOPE_MISMATCH = "BOOTSTRAP_REFERENCE_SCOPE_MISMATCH"

FEISHU_CONNECTOR_NAME = "Initial release Feishu"
JIRA_CONNECTOR_NAME = "Initial release Jira"
FEISHU_JIRA_ROUTE_NAME = "Feishu Jira analysis"


class BootstrapError(Exception):
    def __init__(self, code: str, reason: str):
        super().__init__(reason)
        self.code = code
        self.reason = reason


@dataclass(frozen=True)
class IntegrationBootstrapRequest:
    server_id: uuid.UUID
    channel_id: uuid.UUID
    creator_id: uuid.UUID
    assignee_id: uuid.UUID
    feishu_chat_id: str
    feishu_chat_type: str
    feishu_app_id: str
    feishu_bot_open_id: str
    feishu_bot_name: str
    jira_site_url: str
    feishu_connector_name: str = FEISHU_CONNECTOR_NAME
    jira_connector_name: str = JIRA_CONNECTOR_NAME
    feishu_route_name: str = FEISHU_JIRA_ROUTE_NAME


@dataclass(frozen=True)
class IntegrationBootstrapResult:
    status: str
    server: Server
    channel: Channel
    creator: Member
    assignee: Member
    feishu_connector: ExternalConnector
    jira_connector: ExternalConnector
    feishu_route: ExternalRoute


async def _one(db: Any, model: Any, row_id: uuid.UUID) -> Any | None:
    result = await db.execute(select(model).where(model.id == row_id))
    return result.scalar_one_or_none()


def _require_same_server(row: Any, *, server_id: uuid.UUID, label: str) -> None:
    if getattr(row, "server_id", server_id) != server_id:
        raise BootstrapError(
            BOOTSTRAP_REFERENCE_SCOPE_MISMATCH,
            f"{label} does not belong to the selected server.",
        )


async def _load_references(db: Any, request: IntegrationBootstrapRequest) -> tuple[Server, Channel, Member, Member]:
    server = await _one(db, Server, request.server_id)
    if server is None:
        raise BootstrapError(BOOTSTRAP_REFERENCE_NOT_FOUND, "Server was not found.")

    channel = await _one(db, Channel, request.channel_id)
    if channel is None:
        raise BootstrapError(BOOTSTRAP_REFERENCE_NOT_FOUND, "Channel was not found.")
    _require_same_server(channel, server_id=request.server_id, label="Channel")

    creator = await _one(db, Member, request.creator_id)
    if creator is None:
        raise BootstrapError(BOOTSTRAP_REFERENCE_NOT_FOUND, "Creator member was not found.")
    _require_same_server(creator, server_id=request.server_id, label="Creator member")

    assignee = await _one(db, Member, request.assignee_id)
    if assignee is None:
        raise BootstrapError(BOOTSTRAP_REFERENCE_NOT_FOUND, "Assignee member was not found.")
    _require_same_server(assignee, server_id=request.server_id, label="Assignee member")

    return server, channel, creator, assignee


async def _find_connector(db: Any, *, server_id: uuid.UUID, provider: str, name: str) -> ExternalConnector | None:
    result = await db.execute(
        select(ExternalConnector).where(
            ExternalConnector.server_id == server_id,
            ExternalConnector.provider == provider,
            ExternalConnector.name == name,
        )
    )
    return result.scalar_one_or_none()


async def _upsert_connector(
    db: Any,
    *,
    server_id: uuid.UUID,
    provider: str,
    name: str,
    config: dict[str, Any],
) -> ExternalConnector:
    connector = await _find_connector(db, server_id=server_id, provider=provider, name=name)
    if connector is None:
        connector = ExternalConnector(
            server_id=server_id,
            provider=provider,
            name=name,
        )
        db.add(connector)
    connector.status = "active"
    connector.config = config
    connector.last_error_code = None
    connector.last_error_reason = None
    await db.flush()
    return connector


async def _find_route(
    db: Any,
    *,
    server_id: uuid.UUID,
    connector_id: uuid.UUID,
    name: str,
) -> ExternalRoute | None:
    result = await db.execute(
        select(ExternalRoute).where(
            ExternalRoute.server_id == server_id,
            ExternalRoute.connector_id == connector_id,
            ExternalRoute.name == name,
        )
    )
    return result.scalar_one_or_none()


async def _upsert_feishu_route(
    db: Any,
    *,
    request: IntegrationBootstrapRequest,
    feishu_connector: ExternalConnector,
) -> ExternalRoute:
    route = await _find_route(
        db,
        server_id=request.server_id,
        connector_id=feishu_connector.id,
        name=request.feishu_route_name,
    )
    if route is None:
        route = ExternalRoute(
            server_id=request.server_id,
            connector_id=feishu_connector.id,
            name=request.feishu_route_name,
        )
        db.add(route)
    route.status = "active"
    route.source_selector = {
        "chatId": request.feishu_chat_id,
        "chatType": request.feishu_chat_type,
        "command": "jira_analysis",
    }
    route.channel_id = request.channel_id
    route.task_template_id = None
    route.default_assignee_id = request.assignee_id
    route.runtime_rule = {
        "source": "initial_release_bootstrap",
        "target": "default_assignee",
    }
    route.writeback_policy = {"feishu": True, "jira": True}
    await db.flush()
    return route


async def _find_channel_membership(
    db: Any,
    *,
    channel_id: uuid.UUID,
    member_id: uuid.UUID,
) -> ChannelMember | None:
    result = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel_id,
            ChannelMember.member_id == member_id,
        )
    )
    return result.scalar_one_or_none()


async def _ensure_channel_membership(db: Any, *, channel_id: uuid.UUID, member_id: uuid.UUID) -> ChannelMember:
    membership = await _find_channel_membership(db, channel_id=channel_id, member_id=member_id)
    if membership is not None:
        return membership
    membership = ChannelMember(channel_id=channel_id, member_id=member_id)
    db.add(membership)
    await db.flush()
    return membership


async def bootstrap_initial_release_integrations(
    db: Any,
    request: IntegrationBootstrapRequest,
) -> IntegrationBootstrapResult:
    server, channel, creator, assignee = await _load_references(db, request)
    feishu_connector = await _upsert_connector(
        db,
        server_id=request.server_id,
        provider="feishu",
        name=request.feishu_connector_name,
        config={
            "appId": request.feishu_app_id,
            "botOpenId": request.feishu_bot_open_id,
            "botName": request.feishu_bot_name,
        },
    )
    jira_connector = await _upsert_connector(
        db,
        server_id=request.server_id,
        provider="jira",
        name=request.jira_connector_name,
        config={"siteUrl": request.jira_site_url.rstrip("/")},
    )
    feishu_route = await _upsert_feishu_route(db, request=request, feishu_connector=feishu_connector)
    await _ensure_channel_membership(db, channel_id=request.channel_id, member_id=request.creator_id)
    await _ensure_channel_membership(db, channel_id=request.channel_id, member_id=request.assignee_id)
    return IntegrationBootstrapResult(
        status="ready",
        server=server,
        channel=channel,
        creator=creator,
        assignee=assignee,
        feishu_connector=feishu_connector,
        jira_connector=jira_connector,
        feishu_route=feishu_route,
    )


def serialize_bootstrap_result(result: IntegrationBootstrapResult) -> dict[str, Any]:
    return {
        "status": result.status,
        "serverId": str(result.server.id),
        "channelId": str(result.channel.id),
        "creatorId": str(result.creator.id),
        "assigneeId": str(result.assignee.id),
        "feishuConnectorId": str(result.feishu_connector.id),
        "jiraConnectorId": str(result.jira_connector.id),
        "feishuRouteId": str(result.feishu_route.id),
        "env": {
            "FEISHU_WORKER_ENABLED": "true",
            "FEISHU_WORKER_CONNECTOR_ID": str(result.feishu_connector.id),
            "FEISHU_WORKER_JIRA_CONNECTOR_ID": str(result.jira_connector.id),
            "FEISHU_WORKER_CREATOR_ID": str(result.creator.id),
            "FEISHU_WORKER_BOT_OPEN_ID": result.feishu_connector.config.get("botOpenId", ""),
            "FEISHU_WORKER_BOT_NAME": result.feishu_connector.config.get("botName", "SmallKhoj"),
            "FEISHU_WORKER_APP_ID": result.feishu_connector.config.get("appId", ""),
            "FEISHU_WORKER_APP_SECRET": "<set-in-runtime-env>",
            "JIRA_EMAIL": "<set-in-runtime-env>",
            "JIRA_API_TOKEN": "<set-in-runtime-env>",
        },
    }
