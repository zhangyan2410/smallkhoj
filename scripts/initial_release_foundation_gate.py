#!/usr/bin/env python3
"""Foundation reliability gates for the initial release.

This runner intentionally composes the existing deployment preflight and
post-deploy smoke checks instead of reimplementing them. It adds the release
risk mapping needed for Foundation Reliability Gates.
"""

from __future__ import annotations

import argparse
import json
import subprocess
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
FR03_BACKEND_TESTS = (
    "tests/test_daemon_control.py::test_expired_daemon_lease_does_not_block_new_daemon",
    "tests/test_daemon_control.py::test_active_daemon_lease_blocks_different_daemon",
    "tests/test_daemon_control.py::test_daemon_shutdown_only_releases_matching_active_daemon",
    "tests/test_daemon_control.py::test_daemon_ws_activity_does_not_extend_conflicting_active_lease",
    "tests/test_daemon_control.py::test_daemon_ws_activity_can_take_over_expired_lease",
    "tests/test_daemon_control.py::test_daemon_connect_reuses_offline_same_name_computer_when_machine_id_changed",
    "tests/test_daemon_control.py::test_daemon_connect_rejects_active_same_name_computer_when_machine_id_changed",
)
FR05_BACKEND_TESTS = (
    "tests/test_task_runs.py::test_agent_assignment_creates_queued_task_run_with_independent_context_session",
    "tests/test_task_runs.py::test_update_task_run_lifecycle_marks_running_with_context_usage",
    "tests/test_task_runs.py::test_update_task_run_lifecycle_marks_completed_with_token_and_output_evidence",
    "tests/test_task_runs.py::test_serialize_task_run_uses_public_camel_case_contract",
    "tests/test_task_runs.py::test_serialize_completed_task_run_classifies_missing_evidence",
    "tests/test_task_runs.py::test_serialize_running_task_run_surfaces_pending_result_staleness",
)


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


def check_daemon_distribution_artifact(root: Path) -> FoundationCheck:
    candidates = [
        root / "scripts" / "build_daemon_distribution.py",
        root / "scripts" / "package_daemon.py",
        root / "scripts" / "build-daemon-distribution.sh",
    ]
    existing = [path for path in candidates if path.is_file()]
    if not existing:
        return blocked(
            "daemon.distributionArtifact",
            "FOUNDATION_DAEMON_DISTRIBUTION_GATE_MISSING",
            "No versioned daemon distribution artifact builder is wired yet.",
            risk_id="FR-02",
            priority="P0",
            details={"expectedOneOf": [str(path) for path in candidates]},
        )
    marker_needles = ("smallkhoj-daemon", "version", "darwin", "arm64")
    for path in existing:
        content = path.read_text(encoding="utf-8")
        if all(marker in content for marker in marker_needles):
            return passed(
                "daemon.distributionArtifact",
                "Versioned daemon distribution artifact builder exists for the first supported platform.",
                risk_id="FR-02",
                priority="P0",
                details={"path": str(path)},
            )
    return warning(
        "daemon.distributionArtifact",
        "FOUNDATION_DAEMON_DISTRIBUTION_SHAPE_UNKNOWN",
        "Daemon distribution builder exists, but expected version/platform markers were not recognized.",
        risk_id="FR-02",
        priority="P0",
        details={"paths": [str(path) for path in existing], "expectedMarkers": list(marker_needles)},
    )


def _check_file_contains(
    *,
    root: Path,
    relative_path: str,
    name: str,
    required_markers: list[str],
    reason: str,
) -> FoundationCheck:
    path = root / relative_path
    if not path.is_file():
        return failed(
            name,
            "FOUNDATION_SECRET_GUARDRAIL_FILE_MISSING",
            f"Required config/secrets guardrail file is missing: {relative_path}.",
            risk_id="FR-08",
            priority="P0",
            details={"path": str(path)},
        )
    content = path.read_text(encoding="utf-8")
    missing = [marker for marker in required_markers if marker not in content]
    if missing:
        return failed(
            name,
            "FOUNDATION_SECRET_GUARDRAIL_MARKERS_MISSING",
            f"Config/secrets guardrail file is missing required markers: {relative_path}.",
            risk_id="FR-08",
            priority="P0",
            details={"path": str(path), "missingMarkers": missing},
        )
    return passed(
        name,
        reason,
        risk_id="FR-08",
        priority="P0",
        details={"path": str(path)},
    )


def config_secret_guardrail_checks(root: Path) -> list[FoundationCheck]:
    return [
        _check_file_contains(
            root=root,
            relative_path=".gitignore",
            name="secrets.gitignore",
            required_markers=[
                ".env",
                ".env.*",
                "*.pem",
                "*.key",
                ".mcp.json",
                "tengxun-ssh-key*",
            ],
            reason="Repository ignore rules cover env files, private keys, MCP config, and Tencent SSH key names.",
        ),
        _check_file_contains(
            root=root,
            relative_path="scripts/create_prod_env_template.py",
            name="secrets.envTemplate",
            required_markers=[
                "Do not commit",
                "POSTGRES_PASSWORD=<set-outside-repo>",
                "JIRA_API_TOKEN=<optional-set-outside-repo>",
                "FEISHU_WORKER_APP_SECRET=<optional-set-outside-repo>",
            ],
            reason="Production env template uses placeholders instead of real secrets.",
        ),
        _check_file_contains(
            root=root,
            relative_path="scripts/update_prod_env_from_stdin.py",
            name="secrets.envUpdater",
            required_markers=[
                "without printing values",
                "sanitized_details",
                "\"<set>\"",
                "\"<empty>\"",
                "\"<unchanged>\"",
            ],
            reason="Production env updater is designed to summarize keys without printing values.",
        ),
        _check_file_contains(
            root=root,
            relative_path="scripts/make_deployment_bundle.py",
            name="secrets.bundleExclusion",
            required_markers=[
                "does not include `.env.prod`",
                "Refusing to bundle env file",
                "secrets",
            ],
            reason="Deployment bundle builder refuses env files and documents no-secret bundle behavior.",
        ),
    ]


def backend_python(root: Path) -> Path | str:
    venv_python = root / "backend" / ".venv" / "bin" / "python"
    if venv_python.is_file():
        return venv_python
    return sys.executable


def check_daemon_identity_backend_tests(root: Path, *, timeout: float) -> FoundationCheck:
    backend_dir = root / "backend"
    test_file = backend_dir / "tests" / "test_daemon_control.py"
    if not test_file.is_file():
        return failed(
            "daemon.identityBackendTests",
            "FOUNDATION_DAEMON_IDENTITY_TEST_FILE_MISSING",
            "Daemon identity/reconnect backend test file is missing.",
            risk_id="FR-03",
            priority="P0",
            details={"path": str(test_file)},
        )
    command = [
        str(backend_python(root)),
        "-m",
        "pytest",
        *FR03_BACKEND_TESTS,
        "-q",
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=backend_dir,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return failed(
            "daemon.identityBackendTests",
            "FOUNDATION_DAEMON_IDENTITY_TESTS_UNRUNNABLE",
            "Daemon identity/reconnect backend tests could not be run.",
            risk_id="FR-03",
            priority="P0",
            details={"error": str(exc), "command": command},
        )
    output = "\n".join(part for part in (completed.stdout.strip(), completed.stderr.strip()) if part)
    details = {
        "command": command,
        "exitCode": completed.returncode,
        "tests": list(FR03_BACKEND_TESTS),
    }
    if output:
        details["outputTail"] = output[-4000:]
    if completed.returncode == 0:
        return passed(
            "daemon.identityBackendTests",
            "Daemon identity, reconnect, lease, and active-conflict backend tests passed.",
            risk_id="FR-03",
            priority="P0",
            details=details,
        )
    return failed(
        "daemon.identityBackendTests",
        "FOUNDATION_DAEMON_IDENTITY_TESTS_FAILED",
        "Daemon identity/reconnect backend tests failed.",
        risk_id="FR-03",
        priority="P0",
        details=details,
    )


def check_taskrun_lifecycle_backend_tests(root: Path, *, timeout: float) -> FoundationCheck:
    backend_dir = root / "backend"
    test_file = backend_dir / "tests" / "test_task_runs.py"
    if not test_file.is_file():
        return failed(
            "taskrun.lifecycleBackendTests",
            "FOUNDATION_TASKRUN_TEST_FILE_MISSING",
            "TaskRun lifecycle/evidence backend test file is missing.",
            risk_id="FR-05",
            priority="P0",
            details={"path": str(test_file)},
        )
    command = [
        str(backend_python(root)),
        "-m",
        "pytest",
        *FR05_BACKEND_TESTS,
        "-q",
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=backend_dir,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return failed(
            "taskrun.lifecycleBackendTests",
            "FOUNDATION_TASKRUN_TESTS_UNRUNNABLE",
            "TaskRun lifecycle/evidence backend tests could not be run.",
            risk_id="FR-05",
            priority="P0",
            details={"error": str(exc), "command": command},
        )
    output = "\n".join(part for part in (completed.stdout.strip(), completed.stderr.strip()) if part)
    details = {
        "command": command,
        "exitCode": completed.returncode,
        "tests": list(FR05_BACKEND_TESTS),
    }
    if output:
        details["outputTail"] = output[-4000:]
    if completed.returncode == 0:
        return passed(
            "taskrun.lifecycleBackendTests",
            "TaskRun creation, lifecycle status, and evidence serialization backend tests passed.",
            risk_id="FR-05",
            priority="P0",
            details=details,
        )
    return failed(
        "taskrun.lifecycleBackendTests",
        "FOUNDATION_TASKRUN_TESTS_FAILED",
        "TaskRun lifecycle/evidence backend tests failed.",
        risk_id="FR-05",
        priority="P0",
        details=details,
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
    include_backend_tests: bool = False,
) -> FoundationReport:
    resolved_root = root.resolve()
    checks: list[FoundationCheck] = [
        check_risk_register(resolved_root),
        check_daemon_command_shape(resolved_root),
        check_daemon_distribution_artifact(resolved_root),
        *config_secret_guardrail_checks(resolved_root),
    ]
    if include_backend_tests:
        checks.append(check_daemon_identity_backend_tests(resolved_root, timeout=max(timeout, 30.0)))
        checks.append(check_taskrun_lifecycle_backend_tests(resolved_root, timeout=max(timeout, 30.0)))
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
    parser.add_argument(
        "--skip-backend-tests",
        action="store_true",
        help="Skip backend foundation tests such as daemon identity/reconnect. Intended for fast local smoke only.",
    )
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
        include_backend_tests=not args.skip_backend_tests,
    )
    if args.json:
        print(json.dumps(report_to_dict(report), ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print_human(report)
    return exit_code_for(report, strict_warnings=args.strict_warnings)


if __name__ == "__main__":
    raise SystemExit(main())
