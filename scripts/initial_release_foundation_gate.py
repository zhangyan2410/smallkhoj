#!/usr/bin/env python3
"""Foundation reliability gates for the initial release.

This runner intentionally composes the existing deployment preflight and
post-deploy smoke checks instead of reimplementing them. It adds the release
risk mapping needed for Foundation Reliability Gates.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import initial_release_deploy_preflight as preflight  # noqa: E402
from scripts import post_deploy_smoke as smoke  # noqa: E402


STATUS_PASSED = preflight.STATUS_PASSED
STATUS_WARNING = preflight.STATUS_WARNING
STATUS_FAILED = preflight.STATUS_FAILED
STATUS_BLOCKED = "blocked"
READY = "FOUNDATION_GATE_READY"

FOUNDATION_TASK = ".trellis/tasks/06-29-06-29-initial-release-foundation-reliability-risk-gates"
P0_RISKS = ("FR-01", "FR-02", "FR-03", "FR-04", "FR-05", "FR-06", "FR-07", "FR-08")


@dataclass(frozen=True)
class FoundationCheck:
    name: str
    status: str
    reason_code: str
    reason: str
    risk_id: str
    priority: str
    details: dict[str, Any] | None = None


@dataclass(frozen=True)
class FoundationReport:
    checks: list[FoundationCheck]

    @property
    def failures(self) -> int:
        return sum(1 for check in self.checks if check.status == STATUS_FAILED)

    @property
    def warnings(self) -> int:
        return sum(1 for check in self.checks if check.status == STATUS_WARNING)

    @property
    def blocked(self) -> int:
        return sum(1 for check in self.checks if check.status == STATUS_BLOCKED)

    @property
    def ready(self) -> bool:
        return self.failures == 0 and self.blocked == 0


def passed(
    name: str,
    reason: str,
    *,
    risk_id: str,
    priority: str,
    details: dict[str, Any] | None = None,
) -> FoundationCheck:
    return FoundationCheck(
        name=name,
        status=STATUS_PASSED,
        reason_code=READY,
        reason=reason,
        risk_id=risk_id,
        priority=priority,
        details=details,
    )


def warning(
    name: str,
    reason_code: str,
    reason: str,
    *,
    risk_id: str,
    priority: str,
    details: dict[str, Any] | None = None,
) -> FoundationCheck:
    return FoundationCheck(
        name=name,
        status=STATUS_WARNING,
        reason_code=reason_code,
        reason=reason,
        risk_id=risk_id,
        priority=priority,
        details=details,
    )


def failed(
    name: str,
    reason_code: str,
    reason: str,
    *,
    risk_id: str,
    priority: str,
    details: dict[str, Any] | None = None,
) -> FoundationCheck:
    return FoundationCheck(
        name=name,
        status=STATUS_FAILED,
        reason_code=reason_code,
        reason=reason,
        risk_id=risk_id,
        priority=priority,
        details=details,
    )


def blocked(
    name: str,
    reason_code: str,
    reason: str,
    *,
    risk_id: str,
    priority: str,
    details: dict[str, Any] | None = None,
) -> FoundationCheck:
    return FoundationCheck(
        name=name,
        status=STATUS_BLOCKED,
        reason_code=reason_code,
        reason=reason,
        risk_id=risk_id,
        priority=priority,
        details=details,
    )


def _prefix_name(prefix: str, name: str) -> str:
    return f"{prefix}.{name}"


def _risk_for_preflight_check(check: preflight.CheckResult) -> tuple[str, str]:
    if check.name.startswith("env."):
        return "FR-08", "P0"
    if check.name.startswith("runtime.memory") or check.name.startswith("runtime.disk"):
        return "FR-09", "P1"
    if check.name.startswith("runtime.docker") or check.name.startswith("runtime.port"):
        return "FR-06", "P0"
    return "FR-06", "P0"


def _risk_for_smoke_check(check: preflight.CheckResult) -> tuple[str, str]:
    if check.name == "ws.daemonAuth":
        return "FR-04", "P0"
    return "FR-06", "P0"


def _from_check_result(prefix: str, check: preflight.CheckResult, *, risk_id: str, priority: str) -> FoundationCheck:
    return FoundationCheck(
        name=_prefix_name(prefix, check.name),
        status=check.status,
        reason_code=check.reason_code,
        reason=check.reason,
        risk_id=risk_id,
        priority=priority,
        details=check.details,
    )


def check_risk_register(root: Path) -> FoundationCheck:
    path = root / FOUNDATION_TASK / "risk-register.md"
    if not path.is_file():
        return failed(
            "foundation.riskRegister",
            "FOUNDATION_RISK_REGISTER_MISSING",
            "Foundation risk register is missing.",
            risk_id="FR-01",
            priority="P0",
            details={"path": str(path)},
        )
    content = path.read_text(encoding="utf-8")
    missing = [risk_id for risk_id in P0_RISKS if risk_id not in content]
    if missing:
        return failed(
            "foundation.riskRegister",
            "FOUNDATION_RISK_REGISTER_INCOMPLETE",
            "Foundation risk register is missing required P0 risks.",
            risk_id="FR-01",
            priority="P0",
            details={"missing": missing},
        )
    return passed(
        "foundation.riskRegister",
        "Foundation risk register exists and includes required P0 risks.",
        risk_id="FR-01",
        priority="P0",
        details={"path": str(path), "p0Risks": list(P0_RISKS)},
    )


def check_daemon_command_shape(root: Path) -> FoundationCheck:
    path = root / "backend" / "routers" / "public_api.py"
    if not path.is_file():
        return failed(
            "daemon.commandShape",
            "FOUNDATION_DAEMON_COMMAND_SOURCE_MISSING",
            "Cannot inspect daemon command generation because public_api.py is missing.",
            risk_id="FR-02",
            priority="P0",
            details={"path": str(path)},
        )
    source = path.read_text(encoding="utf-8")
    dev_path_markers = [
        "DEFAULT_DAEMON_LAUNCHER",
        'Path(__file__).resolve().parents[2] / "smallkhoj-daemon"',
        "agent\" / \"daemon\" / \"aaa-daemon",
    ]
    found_markers = [marker for marker in dev_path_markers if marker in source]
    if found_markers:
        return failed(
            "daemon.commandShape",
            "FOUNDATION_DAEMON_COMMAND_USES_DEVELOPMENT_PATH",
            "Product daemon connect command still depends on a source-checkout launcher path.",
            risk_id="FR-02",
            priority="P0",
            details={"path": str(path), "markers": found_markers},
        )
    if "smallkhoj-daemon" not in source or "connect" not in source:
        return warning(
            "daemon.commandShape",
            "FOUNDATION_DAEMON_COMMAND_SHAPE_UNKNOWN",
            "Daemon command generation no longer exposes known dev-path markers, but the installed command shape was not recognized.",
            risk_id="FR-02",
            priority="P0",
            details={"path": str(path)},
        )
    return passed(
        "daemon.commandShape",
        "Daemon command generation does not use known source-checkout launcher markers.",
        risk_id="FR-02",
        priority="P0",
        details={"path": str(path)},
    )


def _append_preflight_checks(
    checks: list[FoundationCheck],
    *,
    root: Path,
    env_file: Path | None,
    include_runtime: bool,
) -> None:
    report = preflight.run_preflight(root=root, env_file=env_file, include_runtime=include_runtime)
    for check in report.checks:
        risk_id, priority = _risk_for_preflight_check(check)
        checks.append(_from_check_result("preflight", check, risk_id=risk_id, priority=priority))


def _append_smoke_checks(
    checks: list[FoundationCheck],
    *,
    base_url: str | None,
    allow_http: bool,
    timeout: float,
) -> None:
    if not base_url:
        checks.append(blocked(
            "smoke.publicUrl",
            "FOUNDATION_PUBLIC_URL_NOT_PROVIDED",
            "Public deployment smoke was not run because --base-url was not provided.",
            risk_id="FR-06",
            priority="P0",
        ))
        checks.append(blocked(
            "smoke.daemonWebSocket",
            "FOUNDATION_PUBLIC_URL_NOT_PROVIDED",
            "Daemon WebSocket production-route smoke was not run because --base-url was not provided.",
            risk_id="FR-04",
            priority="P0",
        ))
        return
    report = smoke.run_smoke(base_url=base_url, allow_http=allow_http, timeout=timeout)
    for check in report.checks:
        risk_id, priority = _risk_for_smoke_check(check)
        checks.append(_from_check_result("smoke", check, risk_id=risk_id, priority=priority))


def run_foundation_gate(
    *,
    root: Path,
    env_file: Path | None = None,
    base_url: str | None = None,
    allow_http: bool = False,
    include_runtime: bool = False,
    timeout: float = 8.0,
    require_all_p0: bool = True,
) -> FoundationReport:
    resolved_root = root.resolve()
    checks: list[FoundationCheck] = [
        check_risk_register(resolved_root),
        check_daemon_command_shape(resolved_root),
    ]
    _append_preflight_checks(checks, root=resolved_root, env_file=env_file, include_runtime=include_runtime)
    _append_smoke_checks(checks, base_url=base_url, allow_http=allow_http, timeout=timeout)
    if require_all_p0:
        checks.extend(missing_p0_coverage_checks(checks))
    return FoundationReport(checks=checks)


def missing_p0_coverage_checks(checks: list[FoundationCheck]) -> list[FoundationCheck]:
    covered = {check.risk_id for check in checks}
    missing = [risk_id for risk_id in P0_RISKS if risk_id not in covered]
    return [
        blocked(
            f"risk.{risk_id}.coverage",
            "FOUNDATION_P0_RISK_HAS_NO_EXECUTABLE_GATE",
            "No executable foundation gate has been wired for this P0 risk yet.",
            risk_id=risk_id,
            priority="P0",
        )
        for risk_id in missing
    ]


def risk_summary(report: FoundationReport) -> dict[str, dict[str, Any]]:
    summary: dict[str, dict[str, Any]] = {}
    order = {
        STATUS_FAILED: 4,
        STATUS_BLOCKED: 3,
        STATUS_WARNING: 2,
        STATUS_PASSED: 1,
    }
    for check in report.checks:
        item = summary.setdefault(
            check.risk_id,
            {
                "priority": check.priority,
                "status": STATUS_PASSED,
                "checks": [],
            },
        )
        if order.get(check.status, 0) > order.get(item["status"], 0):
            item["status"] = check.status
        item["checks"].append(check.name)
    return dict(sorted(summary.items()))


def report_to_dict(report: FoundationReport) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    for check in report.checks:
        payload = {
            "name": check.name,
            "status": check.status,
            "reasonCode": check.reason_code,
            "reason": check.reason,
            "riskId": check.risk_id,
            "priority": check.priority,
        }
        if check.details is not None:
            payload["details"] = check.details
        checks.append(payload)
    return {
        "ready": report.ready,
        "failures": report.failures,
        "warnings": report.warnings,
        "blocked": report.blocked,
        "risks": risk_summary(report),
        "checks": checks,
    }


def to_json(report: FoundationReport) -> str:
    return json.dumps(report_to_dict(report), ensure_ascii=False, sort_keys=True)


def exit_code_for(report: FoundationReport, *, strict_warnings: bool) -> int:
    if report.failures:
        return 1
    if report.blocked:
        return 3
    if strict_warnings and report.warnings:
        return 2
    return 0


def print_human(report: FoundationReport) -> None:
    status = "READY" if report.ready else "NOT READY"
    print(
        "Initial release foundation gate: "
        f"{status} ({report.failures} failed, {report.blocked} blocked, {report.warnings} warnings)"
    )
    for check in report.checks:
        marker = {
            STATUS_PASSED: "PASS",
            STATUS_WARNING: "WARN",
            STATUS_FAILED: "FAIL",
            STATUS_BLOCKED: "BLOCKED",
        }.get(check.status, check.status.upper())
        print(f"[{marker}] {check.name} ({check.risk_id}): {check.reason}")
        if check.details:
            print(f"       details: {json.dumps(check.details, ensure_ascii=False, sort_keys=True)}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run SmallKhoj initial-release Foundation Reliability Gates.")
    parser.add_argument("--root", default=".", help="Project root to inspect. Defaults to current directory.")
    parser.add_argument("--env-file", help="Deployment env file to inspect without printing secret values.")
    parser.add_argument("--base-url", help="Public deployment base URL for post-deploy smoke checks.")
    parser.add_argument("--allow-http", action="store_true", help="Accept HTTP for IP-only or tunnel smoke tests.")
    parser.add_argument("--runtime", action="store_true", help="Inspect current host Docker, resources, and public port readiness.")
    parser.add_argument("--timeout", type=float, default=8.0, help="Per-network-operation timeout in seconds.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--strict-warnings", action="store_true", help="Return exit code 2 when warnings are present.")
    parser.add_argument(
        "--partial",
        action="store_true",
        help="Run only wired checks without blocking on missing P0 risk coverage. Intended for development only.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.root).resolve()
    env_file = Path(args.env_file).resolve() if args.env_file else None
    report = run_foundation_gate(
        root=root,
        env_file=env_file,
        base_url=args.base_url,
        allow_http=args.allow_http,
        include_runtime=args.runtime,
        timeout=args.timeout,
        require_all_p0=not args.partial,
    )
    if args.json:
        print(json.dumps(report_to_dict(report), ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print_human(report)
    return exit_code_for(report, strict_warnings=args.strict_warnings)


if __name__ == "__main__":
    raise SystemExit(main())
