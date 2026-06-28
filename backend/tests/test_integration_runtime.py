from types import SimpleNamespace

import pytest

from config import Settings
from services.integration_runtime import (
    build_feishu_reply_dependencies,
    build_task_run_writeback_dependencies,
    close_feishu_reply_dependencies,
    close_task_run_writeback_dependencies,
    resolve_feishu_reply_config,
    resolve_jira_writeback_credentials,
)


def test_settings_exposes_safe_default_jira_credentials(monkeypatch):
    monkeypatch.delenv("JIRA_EMAIL", raising=False)
    monkeypatch.delenv("JIRA_API_TOKEN", raising=False)

    settings = Settings(_env_file=None)

    assert settings.jira_email == ""
    assert settings.jira_api_token == ""
    assert settings.feishu_reply_base_url == "https://open.feishu.cn"
    assert settings.feishu_reply_access_token == ""


def test_resolve_jira_writeback_credentials_requires_email_and_token():
    missing = SimpleNamespace(jira_email="", jira_api_token="")
    incomplete = SimpleNamespace(jira_email="bot@example.com", jira_api_token="")
    complete = SimpleNamespace(jira_email=" bot@example.com ", jira_api_token=" token ")

    assert resolve_jira_writeback_credentials(SimpleNamespace(), configured_settings=missing) is None
    assert resolve_jira_writeback_credentials(SimpleNamespace(), configured_settings=incomplete) is None
    assert resolve_jira_writeback_credentials(SimpleNamespace(), configured_settings=complete) == {
        "email": "bot@example.com",
        "apiToken": "token",
    }


@pytest.mark.asyncio
async def test_build_task_run_writeback_dependencies_uses_settings_credentials():
    settings = SimpleNamespace(jira_email="bot@example.com", jira_api_token="token")

    dependencies = build_task_run_writeback_dependencies(configured_settings=settings)
    credentials = dependencies.jira_credentials_resolver(SimpleNamespace())

    assert credentials == {"email": "bot@example.com", "apiToken": "token"}
    assert dependencies.jira_http_client is not None
    assert getattr(dependencies.jira_http_client, "trust_env", False) is False
    await dependencies.jira_http_client.aclose()


@pytest.mark.asyncio
async def test_close_task_run_writeback_dependencies_closes_owned_http_client():
    closed = False

    class _Client:
        async def aclose(self):
            nonlocal closed
            closed = True

    dependencies = SimpleNamespace(jira_http_client=_Client())

    await close_task_run_writeback_dependencies(dependencies)

    assert closed is True


def test_resolve_feishu_reply_config_uses_settings_without_persisted_secrets():
    missing = SimpleNamespace(feishu_reply_base_url="https://open.feishu.cn", feishu_reply_access_token="")
    complete = SimpleNamespace(feishu_reply_base_url=" https://open.feishu.cn/ ", feishu_reply_access_token=" tenant-token ")

    missing_config = resolve_feishu_reply_config(configured_settings=missing)
    complete_config = resolve_feishu_reply_config(configured_settings=complete)

    assert missing_config.base_url == "https://open.feishu.cn"
    assert missing_config.access_token == ""
    assert complete_config.base_url == "https://open.feishu.cn"
    assert complete_config.access_token == "tenant-token"


@pytest.mark.asyncio
async def test_build_feishu_reply_dependencies_uses_settings_config_and_closes_client():
    settings = SimpleNamespace(feishu_reply_base_url="https://open.feishu.cn", feishu_reply_access_token="tenant-token")

    dependencies = build_feishu_reply_dependencies(configured_settings=settings)

    assert dependencies.config.base_url == "https://open.feishu.cn"
    assert dependencies.config.access_token == "tenant-token"
    assert dependencies.http_client is not None
    assert getattr(dependencies.http_client, "trust_env", False) is False
    await close_feishu_reply_dependencies(dependencies)
