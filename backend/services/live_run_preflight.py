"""No-network readiness checks for the initial release live-run."""

from dataclasses import dataclass
from typing import Any

from config import settings
from services.feishu_worker_runtime import load_feishu_worker_connectors, resolve_feishu_worker_config
from services.integration_gateway import resolve_external_route
from services.integration_runtime import resolve_jira_writeback_credentials
from services.jira_rest import JiraRestError, resolve_jira_config

LIVE_RUN_PREFLIGHT_READY = "LIVE_RUN_PREFLIGHT_READY"
LIVE_RUN_PREFLIGHT_CONNECTOR_CONFIG_INVALID = "LIVE_RUN_PREFLIGHT_CONNECTOR_CONFIG_INVALID"
LIVE_RUN_PREFLIGHT_JIRA_CREDENTIALS_MISSING = "LIVE_RUN_PREFLIGHT_JIRA_CREDENTIALS_MISSING"
LIVE_RUN_PREFLIGHT_ROUTE_TARGET_MISSING = "LIVE_RUN_PREFLIGHT_ROUTE_TARGET_MISSING"
LIVE_RUN_PREFLIGHT_WORKER_CONFIG_INCOMPLETE = "LIVE_RUN_PREFLIGHT_WORKER_CONFIG_INCOMPLETE"

WORKER_REQUIRED_SETTING_KEYS = (
    ("FEISHU_WORKER_CONNECTOR_ID", "feishu_worker_connector_id"),
    ("FEISHU_WORKER_JIRA_CONNECTOR_ID", "feishu_worker_jira_connector_id"),
    ("FEISHU_WORKER_CREATOR_ID", "feishu_worker_creator_id"),
    ("FEISHU_WORKER_APP_ID", "feishu_worker_app_id"),
    ("FEISHU_WORKER_APP_SECRET", "feishu_worker_app_secret"),
    ("FEISHU_REPLY_ACCESS_TOKEN", "feishu_reply_access_token"),
    ("JIRA_EMAIL", "jira_email"),
    ("JIRA_API_TOKEN", "jira_api_token"),
)


@dataclass(frozen=True)
class LiveRunPreflightRequest:
    feishu_chat_id: str
    feishu_chat_type: str = "group"
    command: str = "jira_analysis"


@dataclass(frozen=True)
class LiveRunPreflightCheck:
    name: str
    status: str
    reason_code: str
    reason: str
    details: dict[str, Any] | None = None


@dataclass(frozen=True)
class LiveRunPreflightReport:
    ready: bool
    checks: list[LiveRunPreflightCheck]


def _passed(name: str, reason: str, details: dict[str, Any] | None = None) -> LiveRunPreflightCheck:
    return LiveRunPreflightCheck(
        name=name,
        status="passed",
        reason_code=LIVE_RUN_PREFLIGHT_READY,
        reason=reason,
        details=details,
    )


def _failed(name: str, reason_code: str, reason: str, details: dict[str, Any] | None = None) -> LiveRunPreflightCheck:
    return LiveRunPreflightCheck(
        name=name,
        status="failed",
        reason_code=reason_code,
        reason=reason,
        details=details,
    )


def _report(checks: list[LiveRunPreflightCheck]) -> LiveRunPreflightReport:
    return LiveRunPreflightReport(
        ready=all(check.status == "passed" for check in checks),
        checks=checks,
    )


def _worker_required_settings_check(configured_settings: Any) -> LiveRunPreflightCheck | None:
    missing = []
    for env_key, attr_name in WORKER_REQUIRED_SETTING_KEYS:
        if not str(getattr(configured_settings, attr_name, "") or "").strip():
            missing.append(env_key)
    if not missing:
        return None
    return _failed(
        "workerConfig",
        LIVE_RUN_PREFLIGHT_WORKER_CONFIG_INCOMPLETE,
        "Feishu worker runtime settings are missing required values.",
        {"missing": missing},
    )


def _connector_config_check(feishu_connector: Any, jira_connector: Any) -> LiveRunPreflightCheck:
    feishu_config = getattr(feishu_connector, "config", None) or {}
    jira_config = getattr(jira_connector, "config", None) or {}
    missing = []
    for key in ("appId", "botOpenId", "botName"):
        if not str(feishu_config.get(key) or "").strip():
            missing.append(f"feishu.{key}")
    try:
        resolve_jira_config(jira_connector, credentials={"email": "preflight@example.com", "apiToken": "placeholder"})
    except JiraRestError as exc:
        return _failed("connectorConfig", exc.code, exc.reason)
    if not str(jira_config.get("siteUrl") or "").strip():
        missing.append("jira.siteUrl")
    if missing:
        return _failed(
            "connectorConfig",
            LIVE_RUN_PREFLIGHT_CONNECTOR_CONFIG_INVALID,
            "Connector config is missing required non-secret fields.",
            {"missing": missing},
        )
    return _passed("connectorConfig", "Connector non-secret config is ready.")


def _jira_credentials_check(jira_connector: Any, *, configured_settings: Any) -> LiveRunPreflightCheck:
    credentials = resolve_jira_writeback_credentials(jira_connector, configured_settings=configured_settings)
    if credentials is None:
        return _failed(
            "jiraCredentials",
            LIVE_RUN_PREFLIGHT_JIRA_CREDENTIALS_MISSING,
            "Jira email and API token are required in runtime settings for write-back.",
        )
    return _passed("jiraCredentials", "Jira runtime credentials are configured.")


def _route_target_check(route: Any) -> LiveRunPreflightCheck:
    missing = []
    if not getattr(route, "channel_id", None):
        missing.append("channelId")
    if not getattr(route, "default_assignee_id", None):
        missing.append("defaultAssigneeId")
    if missing:
        return _failed(
            "feishuRoute",
            LIVE_RUN_PREFLIGHT_ROUTE_TARGET_MISSING,
            "Matched Feishu route is missing a channel or default assignee.",
            {"missing": missing, "routeId": str(getattr(route, "id", ""))},
        )
    return _passed(
        "feishuRoute",
        "Feishu route matches the requested source selector.",
        {"routeId": str(getattr(route, "id", ""))},
    )


async def run_initial_release_preflight(
    db: Any,
    request: LiveRunPreflightRequest,
    *,
    configured_settings: Any = settings,
) -> LiveRunPreflightReport:
    checks: list[LiveRunPreflightCheck] = []
    worker_settings_check = _worker_required_settings_check(configured_settings)
    if worker_settings_check is not None:
        checks.append(worker_settings_check)
        return _report(checks)

    config_outcome = resolve_feishu_worker_config(configured_settings=configured_settings)
    if config_outcome.status != "ready" or config_outcome.config is None:
        checks.append(_failed("workerConfig", config_outcome.reason_code, config_outcome.reason))
        return _report(checks)
    checks.append(_passed("workerConfig", "Worker runtime settings are ready."))

    connectors = await load_feishu_worker_connectors(db, config_outcome.config)
    if connectors.status != "ready":
        checks.append(_failed("connectors", connectors.reason_code, connectors.reason))
        return _report(checks)
    checks.append(
        _passed(
            "connectors",
            "Feishu and Jira connectors are active.",
            {
                "feishuConnectorId": str(connectors.feishu_connector.id),
                "jiraConnectorId": str(connectors.jira_connector.id),
            },
        )
    )

    checks.append(_connector_config_check(connectors.feishu_connector, connectors.jira_connector))
    checks.append(_jira_credentials_check(connectors.jira_connector, configured_settings=configured_settings))

    route_outcome = await resolve_external_route(
        db,
        connector_id=connectors.feishu_connector.id,
        source={
            "chatId": request.feishu_chat_id,
            "chatType": request.feishu_chat_type,
            "command": request.command,
        },
    )
    if route_outcome.status != "matched" or route_outcome.route is None:
        checks.append(
            _failed(
                "feishuRoute",
                route_outcome.failure_code or "FEISHU_ROUTE_NOT_FOUND",
                route_outcome.failure_reason or "No Feishu route matched the requested source selector.",
            )
        )
        return _report(checks)
    checks.append(_route_target_check(route_outcome.route))
    return _report(checks)


def serialize_preflight_report(report: LiveRunPreflightReport) -> dict[str, Any]:
    checks = []
    for check in report.checks:
        payload = {
            "name": check.name,
            "status": check.status,
            "reasonCode": check.reason_code,
            "reason": check.reason,
        }
        if check.details is not None:
            payload["details"] = check.details
        checks.append(payload)
    return {
        "ready": report.ready,
        "checks": checks,
    }
