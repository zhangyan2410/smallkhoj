"""应用配置，使用 pydantic-settings 管理环境变量。"""
import json
import re
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEVELOPMENT_PUBLIC_API_KEY = "sk_public_local"
_STABLE_SEMVER_RE = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$")


def _discover_daemon_release_version(project_root: Path | None = None) -> str:
    """Discover one locally generated, downloadable Daemon package version.

    ``package.json.version`` identifies the source candidate, not a file that
    the backend can serve.  Only a generated release manifest whose referenced
    npm tarball exists is allowed to populate this local fallback.  Production
    Compose still requires ``DAEMON_RELEASE_VERSION`` explicitly so an image
    cannot silently advertise whichever artifact happened to be copied into
    the build context.
    """

    project_root = project_root or Path(__file__).resolve().parents[1]
    artifact_dir = project_root / "release-artifacts" / "smallkhoj-daemon"
    versions: set[str] = set()
    for manifest_path in sorted(artifact_dir.glob("*.manifest.json")):
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        value = payload.get("version")
        if not isinstance(value, str):
            continue
        version = value.strip()
        if not _STABLE_SEMVER_RE.fullmatch(version):
            continue
        npm_package = payload.get("npmPackage")
        package_name = Path(npm_package).name if isinstance(npm_package, str) else ""
        if not package_name.endswith(f"-{version}.tgz"):
            continue
        package_path = artifact_dir / package_name
        if package_path.is_file() and not package_path.is_symlink():
            versions.add(version)
    if len(versions) == 1:
        return next(iter(versions))
    if len(versions) > 1:
        return ""

    # A package-only artifact directory is valid for older local build output,
    # but it must still be unambiguous. Never consult source package metadata
    # here: doing so can generate a URL for a tarball that does not exist.
    for package_path in sorted(artifact_dir.glob("*.tgz")):
        match = re.search(r"-(?P<version>\d+\.\d+\.\d+)\.tgz$", package_path.name)
        if match and package_path.is_file() and not package_path.is_symlink():
            versions.add(match.group("version"))
    return next(iter(versions)) if len(versions) == 1 else ""


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
    # Production supplies this compatibility policy through .env.prod. An
    # empty local default means a checkout cannot silently reject a daemon
    # based on an historical version literal.
    minimum_daemon_version: str = ""
    daemon_release_version: str = _discover_daemon_release_version()
    daemon_download_base_url: str = ""
    daemon_npx_package: str = ""

    # Optional official Server: every newly registered Account auto-joins the
    # Server with this handle as a plain member. Empty disables the auto-join.
    official_server_handle: str = ""

    database_url: str = "postgresql+asyncpg://smallkhoj:smallkhoj@localhost:5432/smallkhoj"
    database_pool_size: int = Field(default=5, ge=1)
    database_max_overflow: int = Field(default=10, ge=0)
    better_auth_database_pool_size: int = Field(default=10, ge=1)
    backend_workers: int = Field(default=1, ge=1)
    postgres_max_connections: int = Field(default=100, ge=1)
    postgres_connection_headroom: int = Field(default=5, ge=1)

    notify_publisher_pool_size: int = Field(default=2, ge=1)
    notify_connect_timeout_seconds: float = Field(default=3.0, gt=0)
    notify_operation_timeout_seconds: float = Field(default=3.0, gt=0)
    notify_reconnect_initial_seconds: float = Field(default=0.25, gt=0)
    notify_reconnect_max_seconds: float = Field(default=5.0, gt=0)
    notify_shutdown_timeout_seconds: float = Field(default=5.0, gt=0)
    notify_publish_attempts: int = Field(default=2, ge=1, le=5)

    @property
    def backend_connections_per_process(self) -> int:
        return (
            self.database_pool_size
            + self.database_max_overflow
            + self.notify_publisher_pool_size
            + 1
        )

    @property
    def backend_deployment_connections(self) -> int:
        return self.backend_connections_per_process * self.backend_workers

    @property
    def frontend_deployment_connections(self) -> int:
        return self.better_auth_database_pool_size

    @property
    def feishu_worker_deployment_connections(self) -> int:
        # The production worker is an independent process using the same
        # explicitly wired SQLAlchemy pool limits as each backend process.
        return self.database_pool_size + self.database_max_overflow

    @property
    def required_postgres_connections(self) -> int:
        return (
            self.backend_deployment_connections
            + self.frontend_deployment_connections
            + self.feishu_worker_deployment_connections
            + self.postgres_connection_headroom
        )

    llm_api_key: str = ""
    llm_api_base: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"

    pi_llm_api_key: str = ""
    pi_llm_api_base: str = ""
    pi_llm_model: str = ""
    pi_llm_max_active_runs: int = 1
    pi_llm_lease_seconds: int = 120

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

    # Multipart parts are spooled by Starlette before route code runs. These
    # values govern the application read/staging boundary and cleanup timeout;
    # reverse-proxy request-body limits are configured separately in Caddy.
    upload_max_bytes: int = 50 * 1024 * 1024
    upload_read_chunk_bytes: int = 64 * 1024
    upload_cleanup_timeout_seconds: float = 5.0

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

    @model_validator(mode="after")
    def validate_connection_budget(self):
        if self.required_postgres_connections > self.postgres_max_connections:
            raise ValueError(
                "PostgreSQL connection budget exceeds capacity: "
                f"required={self.required_postgres_connections} "
                f"capacity={self.postgres_max_connections} "
                f"per_process={self.backend_connections_per_process} "
                f"workers={self.backend_workers} "
                f"backend={self.backend_deployment_connections} "
                f"frontend={self.frontend_deployment_connections} "
                f"feishu_worker={self.feishu_worker_deployment_connections} "
                f"headroom={self.postgres_connection_headroom}"
            )
        return self


settings = Settings()
