"""Fail-closed validation for destructive delivery and E2E environments."""

from __future__ import annotations

import ipaddress
import os
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import SplitResult, urlsplit


class DeliveryEnvError(ValueError):
    """The declared delivery environment is unsafe or incomplete."""


_SAFE_DATABASE_MARKERS = ("test", "audit", "remediation", "disposable", "e2e", "ci")
_POSTGRES_SCHEMES = {"postgresql", "postgresql+asyncpg"}


@dataclass(frozen=True)
class _DatabaseTarget:
    name: str
    hostname: str
    port: int
    username: str

    @property
    def server(self) -> tuple[str, int, str]:
        return (self.hostname, self.port, self.username)


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise DeliveryEnvError(f"{name} is required")
    return value


def _is_loopback(hostname: str) -> bool:
    normalized = hostname.strip().lower().rstrip(".")
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def _has_safe_database_marker(database_name: str) -> bool:
    tokens = set(re.findall(r"[a-z0-9]+", database_name.lower()))
    return any(marker in tokens for marker in _SAFE_DATABASE_MARKERS)


def _semantic_version(env: Mapping[str, str], name: str) -> tuple[int, int, int]:
    value = _required(env, name)
    match = re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", value)
    if not match:
        raise DeliveryEnvError(f"{name} must be a stable semantic version")
    major, minor, patch = (int(part) for part in match.groups())
    return major, minor, patch


def _parse_database_url(
    env: Mapping[str, str],
    name: str,
    *,
    destructive: bool,
    require_safe_marker: bool | None = None,
) -> _DatabaseTarget:
    raw = _required(env, name)
    parts = urlsplit(raw)
    if parts.scheme not in _POSTGRES_SCHEMES or not parts.hostname:
        raise DeliveryEnvError(f"{name} must use postgresql[+asyncpg]://")
    if destructive and not _is_loopback(parts.hostname):
        raise DeliveryEnvError(f"{name} must target a loopback PostgreSQL server")
    if destructive and (parts.query or parts.fragment):
        raise DeliveryEnvError(
            f"{name} must not contain query parameters or a fragment"
        )
    database_name = parts.path.removeprefix("/")
    if not database_name or "/" in database_name:
        raise DeliveryEnvError(f"{name} must name exactly one database")
    marker_required = destructive if require_safe_marker is None else require_safe_marker
    if marker_required and not _has_safe_database_marker(database_name):
        raise DeliveryEnvError(f"{name} database name must contain a safe marker")
    return _DatabaseTarget(
        name=database_name,
        hostname=parts.hostname.lower(),
        port=parts.port or 5432,
        username=parts.username or "",
    )


def _validate_admin_pair(
    env: Mapping[str, str],
    admin_name: str,
    target_name: str,
) -> tuple[_DatabaseTarget, _DatabaseTarget]:
    admin = _parse_database_url(
        env,
        admin_name,
        destructive=True,
        require_safe_marker=False,
    )
    target = _parse_database_url(env, target_name, destructive=True)
    if admin.server != target.server:
        raise DeliveryEnvError(f"{admin_name} and {target_name} must target the same PostgreSQL server")
    if admin.name == target.name:
        raise DeliveryEnvError(f"{target_name} must name a non-admin database")
    return admin, target


def _parse_web_url(
    env: Mapping[str, str],
    name: str,
    *,
    schemes: set[str],
    loopback: bool | None = None,
    allow_empty: bool = False,
) -> SplitResult | None:
    raw = env.get(name, "").strip()
    if not raw:
        if allow_empty:
            return None
        raise DeliveryEnvError(f"{name} is required")
    parts = urlsplit(raw)
    if parts.scheme not in schemes or not parts.hostname:
        raise DeliveryEnvError(f"{name} must be an absolute {sorted(schemes)} URL")
    if parts.username or parts.password:
        raise DeliveryEnvError(f"{name} must not contain credentials")
    if parts.query or parts.fragment:
        raise DeliveryEnvError(f"{name} must not contain query parameters or a fragment")
    is_loopback = _is_loopback(parts.hostname)
    if loopback is True and not is_loopback:
        raise DeliveryEnvError(f"{name} must target a loopback candidate")
    if loopback is False and is_loopback:
        raise DeliveryEnvError(f"{name} production browser URL must not target loopback")
    return parts


def _web_target(parts: SplitResult) -> tuple[str, str, int, str]:
    default_port = 443 if parts.scheme in {"https", "wss"} else 80
    path = parts.path.rstrip("/")
    return (
        parts.scheme,
        (parts.hostname or "").lower(),
        parts.port or default_port,
        path,
    )


def validate_backend_env(env: Mapping[str, str]) -> None:
    if _required(env, "E2E_DATABASE_SCOPE") != "disposable":
        raise DeliveryEnvError("E2E_DATABASE_SCOPE must be disposable")
    _required(env, "PUBLIC_API_KEY")
    _required(env, "AUTH_BRIDGE_SECRET")

    runtime = _parse_database_url(env, "DATABASE_URL", destructive=True)
    _, migration = _validate_admin_pair(
        env,
        "SMALLKHOJ_MIGRATION_TEST_ADMIN_URL",
        "SMALLKHOJ_MIGRATION_TEST_DATABASE_URL",
    )
    _, tests = _validate_admin_pair(
        env,
        "SMALLKHOJ_TEST_ADMIN_DATABASE_URL",
        "SMALLKHOJ_TEST_DATABASE_URL",
    )
    for name, target in (
        ("SMALLKHOJ_MIGRATION_TEST_DATABASE_URL", migration),
        ("SMALLKHOJ_TEST_DATABASE_URL", tests),
    ):
        if runtime.server != target.server:
            raise DeliveryEnvError(f"DATABASE_URL and {name} must target the same PostgreSQL server")


def validate_frontend_env(env: Mapping[str, str]) -> None:
    if _required(env, "NODE_ENV") != "production":
        raise DeliveryEnvError("NODE_ENV must be production")
    if _required(env, "NEXT_PUBLIC_DEPLOYMENT_ENV") != "production":
        raise DeliveryEnvError("NEXT_PUBLIC_DEPLOYMENT_ENV must be production")
    _required(env, "NEXT_PUBLIC_API_KEY")
    _required(env, "INTERNAL_API_BASE_URL")
    if len(_required(env, "BETTER_AUTH_SECRET")) < 32:
        raise DeliveryEnvError("BETTER_AUTH_SECRET must contain at least 32 characters")
    _required(env, "AUTH_BRIDGE_SECRET")
    _parse_web_url(env, "BETTER_AUTH_URL", schemes={"http", "https"})
    _parse_database_url(env, "BETTER_AUTH_DATABASE_URL", destructive=False)
    _parse_web_url(
        env,
        "NEXT_PUBLIC_API_BASE_URL",
        schemes={"http", "https"},
        loopback=False,
        allow_empty=True,
    )
    _parse_web_url(
        env,
        "NEXT_PUBLIC_WS_BASE_URL",
        schemes={"ws", "wss"},
        loopback=False,
        allow_empty=True,
    )


def validate_e2e_env(env: Mapping[str, str]) -> None:
    if _required(env, "E2E_DATABASE_SCOPE") != "disposable":
        raise DeliveryEnvError("E2E_DATABASE_SCOPE must be disposable")
    runtime_database = _parse_database_url(env, "DATABASE_URL", destructive=True)
    auth_database = _parse_database_url(
        env,
        "BETTER_AUTH_DATABASE_URL",
        destructive=True,
    )
    if (
        runtime_database.hostname,
        runtime_database.port,
        runtime_database.name,
    ) != (
        auth_database.hostname,
        auth_database.port,
        auth_database.name,
    ):
        raise DeliveryEnvError(
            "DATABASE_URL and BETTER_AUTH_DATABASE_URL must target the same disposable database"
        )
    _required(env, "E2E_PUBLIC_API_KEY")
    _required(env, "E2E_RUN_NAMESPACE")
    daemon_version = _semantic_version(env, "E2E_DAEMON_VERSION")
    minimum_daemon_version = _semantic_version(env, "MINIMUM_DAEMON_VERSION")
    release_daemon_version = _semantic_version(env, "DAEMON_RELEASE_VERSION")
    if daemon_version < minimum_daemon_version:
        raise DeliveryEnvError("E2E_DAEMON_VERSION must meet MINIMUM_DAEMON_VERSION")
    if daemon_version != release_daemon_version:
        raise DeliveryEnvError("E2E_DAEMON_VERSION must equal DAEMON_RELEASE_VERSION")
    api = _parse_web_url(env, "API_BASE", schemes={"http", "https"}, loopback=True)
    frontend = _parse_web_url(env, "FRONTEND_BASE", schemes={"http", "https"}, loopback=True)
    internal_api = _parse_web_url(
        env,
        "INTERNAL_API_BASE_URL",
        schemes={"http", "https"},
        loopback=True,
    )
    better_auth = _parse_web_url(
        env,
        "BETTER_AUTH_URL",
        schemes={"http", "https"},
        loopback=True,
    )
    assert (
        api is not None
        and frontend is not None
        and internal_api is not None
        and better_auth is not None
    )
    if _web_target(internal_api) != _web_target(api):
        raise DeliveryEnvError(
            "INTERNAL_API_BASE_URL must identify the same candidate as API_BASE"
        )
    if _web_target(better_auth) != _web_target(frontend):
        raise DeliveryEnvError(
            "BETTER_AUTH_URL must identify the same candidate as FRONTEND_BASE"
        )
    if api.port == frontend.port:
        raise DeliveryEnvError("API_BASE and FRONTEND_BASE must use distinct candidate ports")


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1 or args[0] not in {"backend", "frontend", "e2e"}:
        print("usage: validate_delivery_env.py {backend|frontend|e2e}", file=sys.stderr)
        return 2
    validators = {
        "backend": validate_backend_env,
        "frontend": validate_frontend_env,
        "e2e": validate_e2e_env,
    }
    try:
        validators[args[0]](os.environ)
    except DeliveryEnvError as error:
        print(f"delivery environment validation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
