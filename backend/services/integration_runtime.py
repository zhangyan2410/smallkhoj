"""Runtime dependency builders for external integrations."""

from dataclasses import dataclass
from typing import Any

import httpx

from config import settings
from services.feishu_replies import FeishuReplyConfig
from services.task_run_writeback import TaskRunWritebackDependencies


@dataclass(frozen=True)
class FeishuReplyDependencies:
    http_client: Any
    config: FeishuReplyConfig


def resolve_jira_writeback_credentials(
    _connector: Any,
    *,
    configured_settings: Any = settings,
) -> dict[str, str] | None:
    email = str(getattr(configured_settings, "jira_email", "") or "").strip()
    api_token = str(getattr(configured_settings, "jira_api_token", "") or "").strip()
    if not email or not api_token:
        return None
    return {"email": email, "apiToken": api_token}


def build_task_run_writeback_dependencies(
    *,
    configured_settings: Any = settings,
) -> TaskRunWritebackDependencies:
    http_client = httpx.AsyncClient(trust_env=False)

    def credentials_resolver(connector: Any) -> dict[str, str] | None:
        return resolve_jira_writeback_credentials(connector, configured_settings=configured_settings)

    return TaskRunWritebackDependencies(
        jira_http_client=http_client,
        jira_credentials_resolver=credentials_resolver,
    )


async def close_task_run_writeback_dependencies(dependencies: Any) -> None:
    http_client = getattr(dependencies, "jira_http_client", None)
    close = getattr(http_client, "aclose", None)
    if close is not None:
        await close()


def resolve_feishu_reply_config(*, configured_settings: Any = settings) -> FeishuReplyConfig:
    base_url = str(getattr(configured_settings, "feishu_reply_base_url", "") or "").strip().rstrip("/")
    access_token = str(getattr(configured_settings, "feishu_reply_access_token", "") or "").strip()
    return FeishuReplyConfig(base_url=base_url or "https://open.feishu.cn", access_token=access_token)


def build_feishu_reply_dependencies(
    *,
    configured_settings: Any = settings,
) -> FeishuReplyDependencies:
    return FeishuReplyDependencies(
        http_client=httpx.AsyncClient(trust_env=False),
        config=resolve_feishu_reply_config(configured_settings=configured_settings),
    )


async def close_feishu_reply_dependencies(dependencies: Any) -> None:
    http_client = getattr(dependencies, "http_client", None)
    close = getattr(http_client, "aclose", None)
    if close is not None:
        await close()
