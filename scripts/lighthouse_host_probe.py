#!/usr/bin/env python3
"""Read-only host probe for the initial-release Lighthouse candidate."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.initial_release_deploy_preflight import (
    CheckResult,
    STATUS_FAILED,
    STATUS_PASSED,
    STATUS_WARNING,
    gib,
    run_command,
)


READY = "HOST_PROBE_READY"
MIN_MEMORY_BYTES = int(1.5 * 1024**3)
RECOMMENDED_MEMORY_BYTES = 2 * 1024**3
MIN_DISK_BYTES = 8 * 1024**3
RECOMMENDED_DISK_BYTES = 12 * 1024**3
RECOMMENDED_SWAP_BYTES = 2 * 1024**3


@dataclass(frozen=True)
class HostProbeReport:
    checks: list[CheckResult]
    suggested_commands: list[dict[str, str]]

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


def detect_os_release(path: Path = Path("/etc/os-release")) -> dict[str, str]:
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"')
    return values


def detect_package_manager() -> str | None:
    for command in ("apt-get", "dnf", "yum", "apk"):
        if shutil.which(command):
            return command
    return None


def detect_firewall_tools() -> list[str]:
    return [command for command in ("ufw", "firewall-cmd", "iptables", "nft") if shutil.which(command)]


def cpu_count() -> int | None:
    return os.cpu_count()


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


def total_swap_bytes(path: Path = Path("/proc/meminfo")) -> int | None:
    if not path.is_file():
        return None
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if raw_line.startswith("SwapTotal:"):
            parts = raw_line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                return int(parts[1]) * 1024
    return None


def can_use_sudo() -> bool:
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        return True
    if not shutil.which("sudo"):
        return False
    code, _ = run_command(["sudo", "-n", "true"], timeout=3.0)
    return code == 0


def port_check(port: int) -> CheckResult:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        result = sock.connect_ex(("127.0.0.1", port))
    if result == 0:
        return failed(
            f"host.port.{port}",
            "HOST_PROBE_PORT_IN_USE",
            f"Port {port} is already accepting local TCP connections.",
        )
    return passed(f"host.port.{port}", f"Port {port} does not appear occupied on 127.0.0.1.")


def classify_resources(
    *,
    cpu_count: int | None,
    memory_bytes: int | None,
    swap_bytes: int | None,
    disk_free_bytes: int,
) -> list[CheckResult]:
    checks: list[CheckResult] = []

    if cpu_count is None:
        checks.append(warning("host.cpu", "HOST_PROBE_CPU_UNKNOWN", "Could not determine CPU count."))
    elif cpu_count < 2:
        checks.append(warning(
            "host.cpu",
            "HOST_PROBE_CPU_LOW",
            "Host has fewer than 2 CPU cores; use only for light validation.",
            {"cpuCount": cpu_count, "recommended": 2},
        ))
    else:
        checks.append(passed("host.cpu", "Host CPU count meets the initial-release baseline.", {"cpuCount": cpu_count}))

    if memory_bytes is None:
        checks.append(warning("host.memory", "HOST_PROBE_MEMORY_UNKNOWN", "Could not determine total host memory."))
    elif memory_bytes < MIN_MEMORY_BYTES:
        checks.append(failed(
            "host.memory",
            "HOST_PROBE_MEMORY_TOO_LOW",
            "Host memory is below the minimum deployment threshold.",
            {"totalGiB": round(gib(memory_bytes), 2), "minimumGiB": round(gib(MIN_MEMORY_BYTES), 2)},
        ))
    elif memory_bytes < RECOMMENDED_MEMORY_BYTES:
        checks.append(warning(
            "host.memory",
            "HOST_PROBE_MEMORY_LOW",
            "Host memory is below the recommended 2 GiB threshold; add swap and avoid on-host builds.",
            {"totalGiB": round(gib(memory_bytes), 2), "recommendedGiB": 2},
        ))
    else:
        checks.append(passed("host.memory", "Host memory meets the recommended threshold.", {"totalGiB": round(gib(memory_bytes), 2)}))

    if swap_bytes is None:
        checks.append(warning("host.swap", "HOST_PROBE_SWAP_UNKNOWN", "Could not determine swap size."))
    elif swap_bytes < RECOMMENDED_SWAP_BYTES:
        checks.append(warning(
            "host.swap",
            "HOST_PROBE_SWAP_LOW",
            "Swap is below the recommended 2 GiB for a small Lighthouse host.",
            {"swapGiB": round(gib(swap_bytes), 2), "recommendedGiB": 2},
        ))
    else:
        checks.append(passed("host.swap", "Swap meets the recommended threshold.", {"swapGiB": round(gib(swap_bytes), 2)}))

    if disk_free_bytes < MIN_DISK_BYTES:
        checks.append(failed(
            "host.disk",
            "HOST_PROBE_DISK_TOO_LOW",
            "Free disk is below the minimum deployment threshold.",
            {"freeGiB": round(gib(disk_free_bytes), 2), "minimumGiB": round(gib(MIN_DISK_BYTES), 2)},
        ))
    elif disk_free_bytes < RECOMMENDED_DISK_BYTES:
        checks.append(warning(
            "host.disk",
            "HOST_PROBE_DISK_LOW",
            "Free disk is below the recommended threshold.",
            {"freeGiB": round(gib(disk_free_bytes), 2), "recommendedGiB": round(gib(RECOMMENDED_DISK_BYTES), 2)},
        ))
    else:
        checks.append(passed("host.disk", "Free disk meets the recommended threshold.", {"freeGiB": round(gib(disk_free_bytes), 2)}))

    return checks


def classify_runtime_dependencies(
    *,
    docker_path: str | None,
    docker_info_code: int | None,
    docker_info_output: str,
    compose_code: int | None,
    compose_output: str,
) -> list[CheckResult]:
    checks: list[CheckResult] = []
    if docker_path:
        checks.append(passed("host.docker.command", "docker command is available.", {"path": docker_path}))
    else:
        checks.append(failed("host.docker.command", "HOST_PROBE_DOCKER_COMMAND_MISSING", "docker command is not available."))

    if docker_path and docker_info_code == 0:
        checks.append(passed("host.docker.daemon", "Docker daemon responds.", {"serverVersion": docker_info_output.strip()}))
    else:
        checks.append(failed("host.docker.daemon", "HOST_PROBE_DOCKER_DAEMON_UNAVAILABLE", "Docker daemon is not available."))

    if docker_path and compose_code == 0:
        checks.append(passed("host.docker.compose", "Docker Compose plugin responds.", {"version": compose_output.splitlines()[0] if compose_output else ""}))
    else:
        checks.append(failed("host.docker.compose", "HOST_PROBE_DOCKER_COMPOSE_UNAVAILABLE", "Docker Compose plugin is not available."))
    return checks


def classify_host_access(*, package_manager: str | None, sudo_available: bool, firewall_tools: list[str]) -> list[CheckResult]:
    checks: list[CheckResult] = []
    if package_manager:
        checks.append(passed("host.packageManager", "Package manager detected.", {"packageManager": package_manager}))
    else:
        checks.append(warning("host.packageManager", "HOST_PROBE_PACKAGE_MANAGER_UNKNOWN", "No supported package manager detected."))

    if sudo_available:
        checks.append(passed("host.sudo", "Current user can run privileged bootstrap commands."))
    else:
        checks.append(warning("host.sudo", "HOST_PROBE_SUDO_UNAVAILABLE", "Current user is not root and non-interactive sudo is unavailable."))

    if firewall_tools:
        checks.append(passed("host.firewallTools", "Firewall tooling detected.", {"tools": firewall_tools}))
    else:
        checks.append(warning("host.firewallTools", "HOST_PROBE_FIREWALL_TOOLING_MISSING", "No common firewall tools detected. Check Tencent Cloud firewall/security group separately."))
    return checks


def suggest_bootstrap_commands(
    *,
    os_id: str,
    package_manager: str | None,
    docker_available: bool,
    memory_bytes: int | None,
    swap_bytes: int | None,
    firewall_tools: list[str],
) -> list[dict[str, str]]:
    commands: list[dict[str, str]] = []
    normalized_os = os_id.lower()

    if not docker_available and package_manager == "apt-get" and normalized_os in {"ubuntu", "debian"}:
        commands.extend([
            {
                "mode": "suggested",
                "name": "install-docker-prereqs",
                "command": "sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg",
            },
            {
                "mode": "suggested",
                "name": "install-docker-keyring",
                "command": "sudo install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo \"$ID\")/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg && sudo chmod a+r /etc/apt/keyrings/docker.gpg",
            },
            {
                "mode": "suggested",
                "name": "install-docker-repo",
                "command": "echo \"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo \"$ID\") $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable\" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null",
            },
            {
                "mode": "suggested",
                "name": "install-docker-packages",
                "command": "sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
            },
        ])

    needs_swap = (
        memory_bytes is not None
        and memory_bytes <= RECOMMENDED_MEMORY_BYTES
        and (swap_bytes is None or swap_bytes < RECOMMENDED_SWAP_BYTES)
    )
    if needs_swap:
        commands.extend([
            {"mode": "suggested", "name": "create-swapfile", "command": "sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile"},
            {"mode": "suggested", "name": "enable-swapfile", "command": "sudo mkswap /swapfile && sudo swapon /swapfile"},
            {"mode": "suggested", "name": "persist-swapfile", "command": "grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"},
        ])

    if "ufw" in firewall_tools:
        commands.extend([
            {"mode": "suggested", "name": "allow-http", "command": "sudo ufw allow 80/tcp"},
            {"mode": "suggested", "name": "allow-https", "command": "sudo ufw allow 443/tcp"},
        ])

    return commands


def gather_host_report(root: Path) -> HostProbeReport:
    os_release = detect_os_release()
    package_manager = detect_package_manager()
    firewall_tools = detect_firewall_tools()
    docker_path = shutil.which("docker")
    docker_info_code, docker_info_output = run_command(["docker", "info", "--format", "{{.ServerVersion}}"], timeout=8.0) if docker_path else (None, "")
    compose_code, compose_output = run_command(["docker", "compose", "version"], timeout=8.0) if docker_path else (None, "")
    memory = total_memory_bytes()
    swap = total_swap_bytes()
    disk = shutil.disk_usage(root)

    checks: list[CheckResult] = []
    checks.extend(classify_host_access(package_manager=package_manager, sudo_available=can_use_sudo(), firewall_tools=firewall_tools))
    checks.extend(classify_resources(cpu_count=cpu_count(), memory_bytes=memory, swap_bytes=swap, disk_free_bytes=disk.free))
    checks.extend(classify_runtime_dependencies(
        docker_path=docker_path,
        docker_info_code=docker_info_code,
        docker_info_output=docker_info_output,
        compose_code=compose_code,
        compose_output=compose_output,
    ))
    checks.append(port_check(80))
    checks.append(port_check(443))

    commands = suggest_bootstrap_commands(
        os_id=os_release.get("ID", ""),
        package_manager=package_manager,
        docker_available=bool(docker_path and docker_info_code == 0 and compose_code == 0),
        memory_bytes=memory,
        swap_bytes=swap,
        firewall_tools=firewall_tools,
    )
    return HostProbeReport(checks=checks, suggested_commands=commands)


def report_to_dict(report: HostProbeReport) -> dict[str, Any]:
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
        "suggestedCommands": report.suggested_commands,
    }


def exit_code_for(report: HostProbeReport, *, strict_warnings: bool) -> int:
    if report.failures:
        return 1
    if strict_warnings and report.warnings:
        return 2
    return 0


def print_human(report: HostProbeReport) -> None:
    status = "READY" if report.ready else "NOT READY"
    print(f"Lighthouse host probe: {status} ({report.failures} failed, {report.warnings} warnings)")
    for check in report.checks:
        marker = {STATUS_PASSED: "PASS", STATUS_WARNING: "WARN", STATUS_FAILED: "FAIL"}.get(check.status, check.status.upper())
        print(f"[{marker}] {check.name}: {check.reason}")
        if check.details:
            print(f"       details: {json.dumps(check.details, ensure_ascii=False, sort_keys=True)}")
    if report.suggested_commands:
        print("\nSuggested commands (not executed):")
        for command in report.suggested_commands:
            print(f"- {command['name']}: {command['command']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Read-only SmallKhoj initial-release Lighthouse host probe.")
    parser.add_argument("--root", default=".", help="Path whose filesystem should be checked for free disk. Defaults to current directory.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--strict-warnings", action="store_true", help="Return exit code 2 when warnings are present.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    report = gather_host_report(Path(args.root).resolve())
    if args.json:
        print(json.dumps(report_to_dict(report), ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print_human(report)
    return exit_code_for(report, strict_warnings=args.strict_warnings)


if __name__ == "__main__":
    raise SystemExit(main())
