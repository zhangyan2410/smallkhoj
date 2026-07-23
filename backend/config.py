"""应用配置，使用 pydantic-settings 管理环境变量。"""
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEVELOPMENT_PUBLIC_API_KEY = "sk_public_local"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True
    backend_cors_origins: str = ""
    auth_bridge_secret: str = ""
    public_api_key: str = ""
    minimum_daemon_version: str = "0.2.0"
    daemon_release_version: str = "0.2.1"
    daemon_download_base_url: str = ""
    daemon_npx_package: str = ""

    database_url: str = "postgresql+asyncpg://smallkhoj:smallkhoj@localhost:5432/smallkhoj"

    llm_api_key: str = ""
    llm_api_base: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"

    jira_email: str = ""
    jira_api_token: str = ""

    feishu_reply_base_url: str = "https://open.feishu.cn"
    feishu_reply_access_token: str = ""

    feishu_worker_enabled: bool = False
    feishu_worker_connector_id: str = ""
    feishu_worker_jira_connector_id: str = ""
    feishu_worker_creator_id: str = ""
    feishu_worker_bot_open_id: str = ""
    feishu_worker_bot_name: str = "SmallKhoj"
    feishu_worker_app_id: str = ""
    feishu_worker_app_secret: str = ""

    thread_summary_scheduler_enabled: bool = False

    @model_validator(mode="after")
    def validate_public_api_key(self):
        configured = self.public_api_key.strip()
        if not configured:
            if not self.debug:
                raise ValueError("PUBLIC_API_KEY must be configured when DEBUG=false")
            self.public_api_key = DEVELOPMENT_PUBLIC_API_KEY
            return self
        if not self.debug and configured == DEVELOPMENT_PUBLIC_API_KEY:
            raise ValueError(
                "PUBLIC_API_KEY must not use the repository-known development value when DEBUG=false"
            )
        self.public_api_key = configured
        return self


settings = Settings()
