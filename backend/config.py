"""应用配置，使用 pydantic-settings 管理环境变量。"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True

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


settings = Settings()
