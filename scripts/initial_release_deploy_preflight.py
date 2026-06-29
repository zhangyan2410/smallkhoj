#!/usr/bin/env python3
"""Initial-release production deployment preflight checks.

The checks intentionally avoid contacting Tencent Cloud, Feishu, Jira, or LLM
providers. They validate local deployment contracts and, when requested,
current-host readiness.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


READY = "DEPLOY_PREFLIGHT_READY"
STATUS_PASSED = "passed"
STATUS_WARNING = "warning"
STATUS_FAILED = "failed"

REQUIRED_SERVICES = ("db", "backend", "frontend", "caddy", "feishu-worker")
REQUIRED_ENV_KEYS = (
    "SMALLKHOJ_SITE_ADDRESS",
    "SMALLKHOJ_BACKEND_IMAGE",
    "SMALLKHOJ_FRONTEND_IMAGE",
    "POSTGRES_PASSWORD",
    "BACKEND_CORS_ORIGINS",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "AUTH_BRIDGE_SECRET",
)
SECRET_ENV_KEYS = {
    "POSTGRES_PASSWORD",
    "BETTER_AUTH_SECRET",
    "AUTH_BRIDGE_SECRET",
    "JIRA_API_TOKEN",
    "FEISHU_REPLY_ACCESS_TOKEN",
    "FEISHU_WORKER_APP_SECRET",
    "LLM_API_KEY",
}
PLACEHOLDER_PREFIXES = ("<", "TODO", "CHANGE_ME", "REPLACE_ME")


@dataclass(frozen=True)
class CheckResult:
    name: str
    status: str
    reason_code: str
    reason: str
    details: dict[str, Any] | None = None


@dataclass(frozen=True)
class PreflightReport:
    checks: list[CheckResult]

    @property
    def failures(self) -> int:
        return sum(1 for check in self.checks if check.status == STATUS_FAILED)

    @property
    def warnings(self) -> int:
        return sum(1 for check in self.checks if check.status == STATUS_WARNING)

    @property
    def ready(self) -> bool:
        return self.failures == 0


def passed(name: str, reason: str, details: dict[str, Any] | None = None) -> CheckResult:
    return CheckResult(name=name, status=STATUS_PASSED, reason_code=READY, reason=reason, details=details)


def warning(name: str, reason_code: str, reason: str, details: dict[str, Any] | None = None) -> CheckResult:
    return CheckResult(name=name, status=STATUS_WARNING, reason_code=reason_code, reason=reason, details=details)


def failed(name: str, reason_code: str, reason: str, details: dict[str, Any] | None = None) -> CheckResult:
    return CheckResult(name=name, status=STATUS_FAILED, reason_code=reason_code, reason=reason, details=details)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def require_file(root: Path, relative_path: str) -> tuple[Path, CheckResult | None]:
    path = root / relative_path
    if not path.is_file():
        return path, failed(
            f"repo.file.{relative_path}",
            "DEPLOY_PREFLIGHT_FILE_MISSING",
            f"Required deployment file is missing: {relative_path}.",
        )
    return path, None


def contains_all(text: str, needles: tuple[str, ...] | list[str]) -> bool:
    return all(needle in text for needle in needles)


def has_caddy_port_contract(compose_text: str) -> bool:
    http_contracts = ('"80:80"', "'80:80'", "${SMALLKHOJ_HTTP_PORT:-80}:80")
    https_contracts = ('"443:443"', "'443:443'", "${SMALLKHOJ_HTTPS_PORT:-443}:443")
    return any(marker in compose_text for marker in http_contracts) and any(
        marker in compose_text for marker in https_contracts
    )


def has_caddy_build_contract(compose_text: str) -> bool:
    return contains_all(compose_text, ("caddy:", "build:", "context: ./deploy/caddy"))


def check_repo_config(root: Path) -> list[CheckResult]:
    checks: list[CheckResult] = []

    compose_path, compose_error = require_file(root, "docker-compose.prod.yml")
    if compose_error:
        checks.append(compose_error)
    else:
        compose_text = read_text(compose_path)
        missing_services = [service for service in REQUIRED_SERVICES if f"  {service}:" not in compose_text]
        if missing_services:
            checks.append(failed(
                "repo.compose.services",
                "DEPLOY_PREFLIGHT_COMPOSE_SERVICES_MISSING",
                "Production compose file is missing required services.",
                {"missing": missing_services},
            ))
        else:
            checks.append(passed(
                "repo.compose.services",
                "Production compose declares db, backend, frontend, caddy, and feishu-worker.",
            ))

        if has_caddy_port_contract(compose_text):
            checks.append(passed(
                "repo.compose.caddyPorts",
                "Production compose binds Caddy to default public ports and may allow local smoke overrides.",
            ))
        else:
            checks.append(failed(
                "repo.compose.caddyPorts",
                "DEPLOY_PREFLIGHT_COMPOSE_CONTRACT_MISSING",
                "Production compose is missing Caddy host port bindings for HTTP and HTTPS.",
                {
                    "requiredMarkers": [
                        '"80:80" or "${SMALLKHOJ_HTTP_PORT:-80}:80"',
                        '"443:443" or "${SMALLKHOJ_HTTPS_PORT:-443}:443"',
                    ]
                },
            ))

        if has_caddy_build_contract(compose_text):
            checks.append(passed(
                "repo.compose.caddyBuild",
                "Production compose builds the Caddy image from the tracked deploy/caddy config.",
            ))
        else:
            checks.append(failed(
                "repo.compose.caddyBuild",
                "DEPLOY_PREFLIGHT_COMPOSE_CONTRACT_MISSING",
                "Production compose must build the Caddy image from ./deploy/caddy.",
                {"requiredMarkers": ["build:", "context: ./deploy/caddy"]},
            ))

        compose_expectations = {
            "repo.compose.backendExpose": ('backend:', 'expose:', '"8000"'),
            "repo.compose.frontendExpose": ('frontend:', 'expose:', '"3000"'),
            "repo.compose.feishuWorkerProfile": ("feishu-worker:", "profiles:", "- feishu-worker"),
        }
        for name, needles in compose_expectations.items():
            if contains_all(compose_text, needles):
                checks.append(passed(name, "Production compose contains the expected deployment contract."))
            else:
                checks.append(failed(
                    name,
                    "DEPLOY_PREFLIGHT_COMPOSE_CONTRACT_MISSING",
                    f"Production compose is missing expected markers for {name}.",
                    {"requiredMarkers": list(needles)},
                ))

    caddy_path, caddy_error = require_file(root, "deploy/caddy/Caddyfile")
    if caddy_error:
        checks.append(caddy_error)
    else:
        caddy_text = read_text(caddy_path)
        caddy_expectations = {
            "repo.caddy.apiRoute": ("/api", "/api/*", "reverse_proxy @backend_api backend:8000"),
            "repo.caddy.internalRoute": ("/internal", "/internal/*", "reverse_proxy @backend_internal backend:8000"),
            "repo.caddy.docsRoute": ("/docs", "/docs/*", "/openapi.json", "reverse_proxy @backend_docs backend:8000"),
            "repo.caddy.frontendRoute": ("reverse_proxy frontend:3000",),
        }
        for name, needles in caddy_expectations.items():
            if contains_all(caddy_text, needles):
                checks.append(passed(name, "Caddyfile contains the expected reverse-proxy route."))
            else:
                checks.append(failed(
                    name,
                    "DEPLOY_PREFLIGHT_CADDY_ROUTE_MISSING",
                    f"Caddyfile is missing expected markers for {name}.",
                    {"requiredMarkers": list(needles)},
                ))

    caddy_dockerfile_path, caddy_dockerfile_error = require_file(root, "deploy/caddy/Dockerfile")
    if caddy_dockerfile_error:
        checks.append(caddy_dockerfile_error)
    else:
        caddy_dockerfile = read_text(caddy_dockerfile_path)
        if contains_all(caddy_dockerfile, ("FROM caddy:2", "COPY Caddyfile /etc/caddy/Caddyfile")):
            checks.append(passed("repo.caddy.dockerfile", "Caddy Dockerfile bakes the tracked Caddyfile into the image."))
        else:
            checks.append(failed(
                "repo.caddy.dockerfile",
                "DEPLOY_PREFLIGHT_CADDY_DOCKERFILE_CONTRACT_MISSING",
                "deploy/caddy/Dockerfile must copy Caddyfile to /etc/caddy/Caddyfile.",
            ))

    next_config_path, next_config_error = require_file(root, "frontend/next.config.mjs")
    if next_config_error:
        checks.append(next_config_error)
    else:
        next_config = read_text(next_config_path)
        if 'output: "standalone"' in next_config or "output: 'standalone'" in next_config:
            checks.append(passed("repo.frontend.standalone", "Next production config emits standalone output."))
        else:
            checks.append(failed(
                "repo.frontend.standalone",
                "DEPLOY_PREFLIGHT_FRONTEND_STANDALONE_MISSING",
                'frontend/next.config.mjs must set output: "standalone" for the production Dockerfile.',
            ))

    dockerfile_path, dockerfile_error = require_file(root, "frontend/Dockerfile")
    if dockerfile_error:
        checks.append(dockerfile_error)
    else:
        dockerfile = read_text(dockerfile_path)
        if contains_all(dockerfile, ("/app/.next/standalone", "server.js")):
            checks.append(passed("repo.frontend.dockerfile", "Frontend Dockerfile copies standalone output and starts server.js."))
        else:
            checks.append(failed(
                "repo.frontend.dockerfile",
                "DEPLOY_PREFLIGHT_FRONTEND_DOCKERFILE_CONTRACT_MISSING",
                "Frontend Dockerfile must copy .next/standalone and start server.js.",
            ))

    return checks


def strip_env_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[7:].strip()
        if not key:
            continue
        values[key] = strip_env_quotes(value)
    return values


def sanitize_env_details(env: dict[str, str], keys: tuple[str, ...] | list[str]) -> dict[str, str]:
    sanitized: dict[str, str] = {}
    for key in keys:
        value = env.get(key, "")
        if key in SECRET_ENV_KEYS and value:
            sanitized[key] = "<set>"
        elif value:
            sanitized[key] = "<set>"
        else:
            sanitized[key] = "<empty>"
    return sanitized


def is_placeholder_value(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return False
    upper = stripped.upper()
    if stripped.startswith("<") and stripped.endswith(">"):
        return True
    return any(upper.startswith(prefix) for prefix in PLACEHOLDER_PREFIXES[1:])


def site_origin(site_address: str) -> str:
    value = site_address.strip().rstrip("/")
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://"):
        return value
    if value.startswith(":"):
        return ""
    return f"https://{value}"


def check_env_file(env_file: Path) -> list[CheckResult]:
    if not env_file.is_file():
        return [failed(
            "env.file",
            "DEPLOY_PREFLIGHT_ENV_FILE_MISSING",
            f"Env file does not exist: {env_file}.",
        )]

    env = parse_env_file(env_file)
    checks: list[CheckResult] = []
    missing = [key for key in REQUIRED_ENV_KEYS if not env.get(key, "").strip()]
    placeholders = [key for key in REQUIRED_ENV_KEYS if is_placeholder_value(env.get(key, ""))]
    if missing or placeholders:
        checks.append(failed(
            "env.required",
            "DEPLOY_PREFLIGHT_ENV_REQUIRED_MISSING",
            "Deployment env file is missing required values or still contains placeholders.",
            {"missing": missing, "placeholder": placeholders},
        ))
    else:
        checks.append(passed(
            "env.required",
            "Deployment env file contains required production values.",
            sanitize_env_details(env, REQUIRED_ENV_KEYS),
        ))

    site = env.get("SMALLKHOJ_SITE_ADDRESS", "").strip()
    cors_raw = env.get("BACKEND_CORS_ORIGINS", "")
    site_placeholder = is_placeholder_value(site)
    cors_placeholder = any(is_placeholder_value(item.strip()) for item in cors_raw.split(",") if item.strip())
    if site_placeholder:
        checks.append(warning(
            "env.siteAddress",
            "DEPLOY_PREFLIGHT_SITE_ADDRESS_PLACEHOLDER",
            "SMALLKHOJ_SITE_ADDRESS still contains a placeholder and must be replaced before deployment.",
        ))
    elif site in {"", ":80", "localhost"} or site.startswith("localhost") or site.startswith("http://"):
        checks.append(warning(
            "env.siteAddress",
            "DEPLOY_PREFLIGHT_SITE_ADDRESS_NOT_HTTPS_DOMAIN",
            "SMALLKHOJ_SITE_ADDRESS is not an HTTPS production domain; this is acceptable only for IP-only or tunnel smoke tests.",
        ))
    elif site.startswith("https://"):
        checks.append(passed("env.siteAddress", "Site address is an HTTPS origin."))
    else:
        checks.append(passed("env.siteAddress", "Site address can be used by Caddy for HTTPS certificate issuance."))

    origin = "" if site_placeholder else site_origin(site)
    cors_origins = [item.strip().rstrip("/") for item in cors_raw.split(",") if item.strip()]
    if cors_placeholder:
        checks.append(warning(
            "env.cors",
            "DEPLOY_PREFLIGHT_CORS_PLACEHOLDER",
            "BACKEND_CORS_ORIGINS still contains a placeholder and must be replaced before deployment.",
        ))
    elif origin and cors_origins and origin not in cors_origins:
        checks.append(warning(
            "env.cors",
            "DEPLOY_PREFLIGHT_CORS_SITE_ORIGIN_MISSING",
            "BACKEND_CORS_ORIGINS does not include the derived public site origin.",
            {"expectedOrigin": origin},
        ))
    elif origin:
        checks.append(passed("env.cors", "BACKEND_CORS_ORIGINS includes the public site origin."))

    public_overrides = [key for key in ("NEXT_PUBLIC_API_BASE_URL", "NEXT_PUBLIC_WS_BASE_URL") if env.get(key, "").strip()]
    if public_overrides:
        checks.append(warning(
            "env.frontendPublicOverrides",
            "DEPLOY_PREFLIGHT_FRONTEND_PUBLIC_OVERRIDES_SET",
            "NEXT_PUBLIC API/WS overrides are set; same-origin deployment should usually leave them empty at image build time.",
            {"setKeys": public_overrides},
        ))
    else:
        checks.append(passed("env.frontendPublicOverrides", "Same-origin frontend public API/WS overrides are empty."))

    return checks


def run_command(args: list[str], *, timeout: float = 5.0) -> tuple[int, str]:
    try:
        completed = subprocess.run(args, check=False, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 127, str(exc)
    output = "\n".join(part for part in (completed.stdout.strip(), completed.stderr.strip()) if part)
    return completed.returncode, output


def total_memory_bytes() -> int | None:
    if hasattr(os, "sysconf"):
        try:
            page_size = os.sysconf("SC_PAGE_SIZE")
            pages = os.sysconf("SC_PHYS_PAGES")
            if isinstance(page_size, int) and isinstance(pages, int):
                return page_size * pages
        except (OSError, ValueError):
            return None
    return None


def gib(bytes_value: int) -> float:
    return bytes_value / (1024 ** 3)


def port_appears_available(port: int) -> CheckResult:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        result = sock.connect_ex(("127.0.0.1", port))
    if result == 0:
        return failed(
            f"runtime.port.{port}",
            "DEPLOY_PREFLIGHT_PORT_IN_USE",
            f"Port {port} is already accepting local TCP connections.",
        )
    return passed(f"runtime.port.{port}", f"Port {port} does not appear to be occupied on 127.0.0.1.")


def check_runtime_host(root: Path) -> list[CheckResult]:
    checks: list[CheckResult] = []

    docker_path = shutil.which("docker")
    if docker_path:
        checks.append(passed("runtime.docker.command", "docker command is available.", {"path": docker_path}))
    else:
        checks.append(failed("runtime.docker.command", "DEPLOY_PREFLIGHT_DOCKER_COMMAND_MISSING", "docker command is not available."))
        return checks

    info_code, info_output = run_command(["docker", "info", "--format", "{{.ServerVersion}}"], timeout=8.0)
    if info_code == 0:
        checks.append(passed("runtime.docker.daemon", "Docker daemon responds.", {"serverVersion": info_output.strip()}))
    else:
        checks.append(failed(
            "runtime.docker.daemon",
            "DEPLOY_PREFLIGHT_DOCKER_DAEMON_UNAVAILABLE",
            "Docker daemon did not respond to docker info.",
        ))

    compose_code, compose_output = run_command(["docker", "compose", "version"], timeout=8.0)
    if compose_code == 0:
        checks.append(passed("runtime.docker.compose", "docker compose is available.", {"version": compose_output.splitlines()[0] if compose_output else ""}))
    else:
        checks.append(failed(
            "runtime.docker.compose",
            "DEPLOY_PREFLIGHT_DOCKER_COMPOSE_UNAVAILABLE",
            "docker compose did not respond.",
        ))

    memory = total_memory_bytes()
    if memory is None:
        checks.append(warning("runtime.memory", "DEPLOY_PREFLIGHT_MEMORY_UNKNOWN", "Could not determine total host memory."))
    elif memory < int(1.5 * 1024 ** 3):
        checks.append(failed(
            "runtime.memory",
            "DEPLOY_PREFLIGHT_MEMORY_TOO_LOW",
            "Host memory is below the minimum deployment threshold.",
            {"totalGiB": round(gib(memory), 2), "minimumGiB": 1.5},
        ))
    elif memory < int(2 * 1024 ** 3):
        checks.append(warning(
            "runtime.memory",
            "DEPLOY_PREFLIGHT_MEMORY_LOW",
            "Host memory is below the recommended 2 GiB threshold; add swap and avoid on-server builds.",
            {"totalGiB": round(gib(memory), 2), "recommendedGiB": 2},
        ))
    else:
        checks.append(passed("runtime.memory", "Host memory meets the recommended threshold.", {"totalGiB": round(gib(memory), 2)}))

    disk = shutil.disk_usage(root)
    free_gib = gib(disk.free)
    if disk.free < 8 * 1024 ** 3:
        checks.append(failed(
            "runtime.disk",
            "DEPLOY_PREFLIGHT_DISK_TOO_LOW",
            "Free disk space is below the minimum deployment threshold.",
            {"freeGiB": round(free_gib, 2), "minimumGiB": 8},
        ))
    elif disk.free < 12 * 1024 ** 3:
        checks.append(warning(
            "runtime.disk",
            "DEPLOY_PREFLIGHT_DISK_LOW",
            "Free disk space is below the recommended 12 GiB threshold.",
            {"freeGiB": round(free_gib, 2), "recommendedGiB": 12},
        ))
    else:
        checks.append(passed("runtime.disk", "Free disk space meets the recommended threshold.", {"freeGiB": round(free_gib, 2)}))

    checks.append(port_appears_available(80))
    checks.append(port_appears_available(443))
    return checks


def run_preflight(
    *,
    root: Path,
    env_file: Path | None = None,
    include_runtime: bool = False,
) -> PreflightReport:
    checks = check_repo_config(root)
    if env_file is not None:
        checks.extend(check_env_file(env_file))
    if include_runtime:
        checks.extend(check_runtime_host(root))
    return PreflightReport(checks=checks)


def report_to_dict(report: PreflightReport) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
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
        "warnings": report.warnings,
        "failures": report.failures,
        "checks": checks,
    }


def to_json(report: PreflightReport) -> str:
    return json.dumps(report_to_dict(report), ensure_ascii=False, sort_keys=True)


def exit_code_for(report: PreflightReport, *, strict_warnings: bool) -> int:
    if report.failures:
        return 1
    if strict_warnings and report.warnings:
        return 2
    return 0


def print_human(report: PreflightReport) -> None:
    status = "READY" if report.ready else "NOT READY"
    print(f"Initial release deploy preflight: {status} ({report.failures} failed, {report.warnings} warnings)")
    for check in report.checks:
        marker = {"passed": "PASS", "warning": "WARN", "failed": "FAIL"}.get(check.status, check.status.upper())
        print(f"[{marker}] {check.name}: {check.reason}")
        if check.details:
            print(f"       details: {json.dumps(check.details, ensure_ascii=False, sort_keys=True)}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run SmallKhoj initial-release production deployment preflight checks.")
    parser.add_argument("--root", default=".", help="Project root to inspect. Defaults to current directory.")
    parser.add_argument("--env-file", help="Deployment env file to inspect without printing secret values.")
    parser.add_argument("--runtime", action="store_true", help="Inspect current host Docker, resources, and public port readiness.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--strict-warnings", action="store_true", help="Return exit code 2 when warnings are present.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.root).resolve()
    env_file = Path(args.env_file).resolve() if args.env_file else None
    report = run_preflight(root=root, env_file=env_file, include_runtime=args.runtime)
    if args.json:
        print(json.dumps(report_to_dict(report), ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print_human(report)
    return exit_code_for(report, strict_warnings=args.strict_warnings)


if __name__ == "__main__":
    raise SystemExit(main())
