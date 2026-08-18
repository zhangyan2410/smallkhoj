#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Any

from lib.evidence import EvidenceRecorder
from lib.fixture import FixtureManager
from lib.budget import CallBudgetLedger
from lib.jsonrpc import JsonRpcError, JsonRpcTimeout
from lib.process_guard import OwnedProcessRegistry
from lib.preflight import ManifestError, PreflightResult, load_manifest, run_check
from surfaces.acp_stdio import AcpStdioProbe
from surfaces.codex_appserver import CodexAppServerProbe
from surfaces.claude_stream_json import ClaudeStreamJsonProbe, StreamJsonError


TASK_ROOT = Path(__file__).resolve().parent.parent
_SENSITIVE = re.compile(
    r"(?i)(?:bearer\s+(?!<redacted>)[A-Za-z0-9._~+/=-]+|\b(?:sk_(?:agent|machine|connect|session)|sap)_(?!<redacted>)[A-Za-z0-9_-]+)"
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Safe, task-local Agent runtime capability probes")
    subparsers = parser.add_subparsers(dest="command", required=True)

    preflight_parser = subparsers.add_parser("preflight", help="run non-model version/help/schema checks")
    preflight_parser.add_argument("--manifest", type=Path, required=True)
    preflight_parser.add_argument("--dry-run", action="store_true")
    preflight_parser.add_argument("--run-id")
    preflight_parser.add_argument("--evidence-root", type=Path, default=TASK_ROOT / "evidence")

    verify_parser = subparsers.add_parser("verify-evidence", help="validate sanitized evidence files")
    verify_parser.add_argument("--root", type=Path, required=True)

    appserver_parser = subparsers.add_parser(
        "appserver-handshake", help="run Codex app-server initialize/thread-start without model input"
    )
    appserver_parser.add_argument("--dry-run", action="store_true")
    appserver_parser.add_argument("--run-id")
    appserver_parser.add_argument("--evidence-root", type=Path, default=TASK_ROOT / "evidence")

    codex_steer_parser = subparsers.add_parser(
        "codex-appserver-steer",
        help="probe Codex app-server active-turn steer followed by a control interrupt",
    )
    codex_steer_parser.add_argument("--dry-run", action="store_true")
    codex_steer_parser.add_argument("--run-id")
    codex_steer_parser.add_argument("--evidence-root", type=Path, default=TASK_ROOT / "evidence")
    codex_steer_parser.add_argument("--timeout", type=float, default=45.0)

    acp_parser = subparsers.add_parser(
        "acp-handshake", help="run an ACP initialize/session-new probe without model input"
    )
    acp_parser.add_argument("--provider", choices=("kimi", "opencode"), required=True)
    acp_parser.add_argument("--dry-run", action="store_true")
    acp_parser.add_argument("--run-id")
    acp_parser.add_argument("--evidence-root", type=Path, default=TASK_ROOT / "evidence")
    acp_parser.add_argument("--timeout", type=float, default=30.0)

    acp_sequential_parser = subparsers.add_parser(
        "acp-sequential", help="probe two sequential ACP prompts in one isolated session"
    )
    acp_sequential_parser.add_argument("--provider", choices=("kimi", "opencode"), required=True)
    acp_sequential_parser.add_argument("--dry-run", action="store_true")
    acp_sequential_parser.add_argument("--run-id")
    acp_sequential_parser.add_argument("--evidence-root", type=Path, default=TASK_ROOT / "evidence")
    acp_sequential_parser.add_argument("--timeout", type=float, default=90.0)

    claude_parser = subparsers.add_parser(
        "claude-busy-input", help="probe Claude stream-json busy-time second-input behavior"
    )
    claude_parser.add_argument("--dry-run", action="store_true")
    claude_parser.add_argument("--run-id")
    claude_parser.add_argument("--evidence-root", type=Path, default=TASK_ROOT / "evidence")
    claude_parser.add_argument("--active-timeout", type=float, default=30.0)
    claude_parser.add_argument("--result-timeout", type=float, default=90.0)

    args = parser.parse_args(argv)
    try:
        if args.command == "preflight":
            return _preflight(args)
        if args.command == "verify-evidence":
            return _verify_evidence(args.root)
        if args.command == "appserver-handshake":
            return _appserver_handshake(args)
        if args.command == "codex-appserver-steer":
            return _codex_appserver_steer(args)
        if args.command == "acp-handshake":
            return _acp_handshake(args)
        if args.command == "acp-sequential":
            return _acp_sequential(args)
        if args.command == "claude-busy-input":
            return _claude_busy_input(args)
    except (ManifestError, ValueError, RuntimeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    raise AssertionError(f"unhandled command: {args.command}")


def _preflight(args: argparse.Namespace) -> int:
    manifest = load_manifest(args.manifest)
    if args.dry_run:
        _print_json(
            {
                "mode": "dry-run",
                "perProviderLimit": manifest.per_provider_limit,
                "modelBearingInputsReserved": 0,
                "checks": [
                    {
                        "id": check.id,
                        "provider": check.provider,
                        "surface": check.surface,
                        "mode": check.mode,
                        "argv": check.argv,
                    }
                    for check in manifest.checks
                ],
            }
        )
        return 0

    run_id = args.run_id or _run_id()
    fixture_manager = FixtureManager(manifest.fixture_root)
    raw_root = fixture_manager.root / run_id / "_raw"
    recorder = EvidenceRecorder(raw_root=raw_root, evidence_root=args.evidence_root)
    summaries: list[dict[str, Any]] = []
    for check in manifest.checks:
        fixture = fixture_manager.create(run_id, check.provider, check.id)
        handle = recorder.begin(run_id, check.id)
        started_at = _now()
        result = run_check(check, fixture.root)
        _record_result(recorder, handle, result)
        ended_at = _now()
        evidence_path = recorder.finalize(
            handle,
            _result_evidence(run_id, check.id, result, fixture, started_at=started_at, ended_at=ended_at),
        )
        summaries.append(
            {
                "id": check.id,
                "provider": check.provider,
                "surface": check.surface,
                "status": result.status,
                "evidence": str(evidence_path),
            }
        )
    run_manifest_path = Path(args.evidence_root) / "run-manifest.json"
    _atomic_json(
        run_manifest_path,
        {
            "schemaVersion": 1,
            "runId": run_id,
            "kind": "static-preflight",
            "perProviderLimit": manifest.per_provider_limit,
            "modelBearingInputsReserved": 0,
            "checks": summaries,
        },
    )
    _print_json({"mode": "preflight", "runId": run_id, "checks": summaries, "manifest": str(run_manifest_path)})
    return 0


def _record_result(recorder: EvidenceRecorder, handle: object, result: PreflightResult) -> None:
    recorder.append(handle, source="controller", kind="preflight-command", payload={"argv": result.argv})
    if result.stdout:
        recorder.append(handle, source="stdout", kind="output", payload={"text": result.stdout})
    if result.stderr:
        recorder.append(handle, source="stderr", kind="output", payload={"text": result.stderr})
    if result.reason:
        recorder.append(handle, source="controller", kind="result-reason", payload={"reason": result.reason})


def _result_evidence(
    run_id: str,
    case_id: str,
    result: PreflightResult,
    fixture: object,
    *,
    started_at: str,
    ended_at: str,
) -> dict[str, Any]:
    # Fixture is intentionally duck-typed here so the durable evidence shape
    # does not depend on a provider client or a production runtime type.
    before_digest = fixture.baseline_digest
    after_digest = FixtureManager(Path(fixture.root).parents[2]).digest(fixture.root)
    return {
        "schemaVersion": 1,
        "evidenceId": f"{run_id}/{case_id}/1",
        "runId": run_id,
        "caseId": case_id,
        "surface": result.check.surface,
        "provider": result.check.provider,
        "executionStatus": result.status,
        "startedAt": started_at,
        "endedAt": ended_at,
        "versions": {result.check.provider: result.version} if result.version else {},
        "fixture": {
            "root": str(fixture.root),
            "beforeDigest": before_digest,
            "afterDigest": after_digest,
        },
        "invocation": {"transport": "process", "commandRedacted": result.argv},
        "terminal": {
            "adapterState": result.status,
            "processExitCode": result.exit_code,
            "contradictorySignals": [],
        },
        "sideEffectAssessment": {"risk": "none", "observed": []},
        "cleanup": {"status": "not_needed", "remainingOwnedPids": [], "notes": []},
        "uncertainties": [result.reason] if result.reason else [],
    }


def _verify_evidence(root: Path) -> int:
    root = Path(root)
    if not root.is_dir():
        raise ValueError(f"evidence root does not exist: {root}")
    files = sorted(root.rglob("evidence.json"))
    failures: list[str] = []
    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
            data = json.loads(text)
        except (OSError, json.JSONDecodeError) as exc:
            failures.append(f"{path}: unreadable JSON ({exc})")
            continue
        if data.get("schemaVersion") != 1:
            failures.append(f"{path}: unsupported schemaVersion")
        if not data.get("executionStatus"):
            failures.append(f"{path}: missing executionStatus")
        if _SENSITIVE.search(text):
            failures.append(f"{path}: credential-shaped content remains")
    _print_json({"root": str(root), "files": len(files), "ok": not failures, "failures": failures})
    return 0 if not failures else 1


def _appserver_handshake(args: argparse.Namespace) -> int:
    if args.dry_run:
        _print_json(
            {
                "mode": "appserver-handshake-dry-run",
                "argv": ["codex", "app-server", "--stdio"],
                "controlMethods": ["initialize", "thread/start"],
                "modelBearingInputsReserved": 0,
            }
        )
        return 0

    run_id = args.run_id or dt.datetime.now(dt.UTC).strftime("appserver-%Y%m%dT%H%M%SZ")
    fixture_manager = FixtureManager(Path("/tmp/smallkhoj-agent-runtime-capability-matrix"))
    fixture = fixture_manager.create(run_id, "codex", "appserver-handshake")
    raw_root = fixture_manager.root / run_id / "_raw"
    recorder = EvidenceRecorder(raw_root=raw_root, evidence_root=args.evidence_root)
    handle = recorder.begin(run_id, "codex-appserver-handshake")
    ledger = CallBudgetLedger(raw_root / "call-budget.json", per_provider_limit=2)
    registry = OwnedProcessRegistry(raw_root / "processes.json")
    started_at = _now()
    probe: CodexAppServerProbe | None = None
    initialized: dict[str, Any] | None = None
    thread_id: str | None = None
    terminal: dict[str, Any] = {"adapterState": "blocked", "contradictorySignals": []}
    cleanup: dict[str, Any] = {"status": "not_needed", "remainingOwnedPids": [], "notes": []}
    uncertainty: list[str] = []
    status = "blocked"
    try:
        probe = CodexAppServerProbe.start(["codex", "app-server", "--stdio"], cwd=fixture.root, registry=registry)
        initialized = probe.initialize(timeout_seconds=30)
        thread_id = probe.start_thread(fixture.root, timeout_seconds=30)
        terminal = {"adapterState": "control_handshake_completed", "contradictorySignals": []}
        status = "passed"
    except Exception as exc:
        uncertainty.append(f"app-server control handshake failed: {type(exc).__name__}: {exc}")
        terminal = {"adapterState": "control_handshake_failed", "contradictorySignals": []}
    finally:
        if probe is not None:
            for event in probe.observations:
                recorder.append(
                    handle,
                    source=event.source,
                    kind="jsonrpc-frame",
                    payload={"text": event.text, "reservationId": event.reservation_id},
                    at=event.at,
                )
            try:
                process_result = probe.terminate(grace_seconds=1)
                cleanup = {
                    "status": "complete",
                    "remainingOwnedPids": [],
                    "notes": [f"process state: {process_result.state}"],
                }
            except Exception as exc:
                cleanup = {
                    "status": "partial",
                    "remainingOwnedPids": [probe.record.pid],
                    "notes": [f"cleanup error: {type(exc).__name__}: {exc}"],
                }
                status = "delivery_uncertain"
                uncertainty.append("app-server process cleanup could not be proven")
        ended_at = _now()
        evidence_path = recorder.finalize(
            handle,
            {
                "schemaVersion": 1,
                "evidenceId": f"{run_id}/codex-appserver-handshake/1",
                "runId": run_id,
                "caseId": "codex-appserver-handshake",
                "surface": "codex-appserver",
                "provider": "codex",
                "executionStatus": status,
                "startedAt": started_at,
                "endedAt": ended_at,
                "versions": {},
                "fixture": {
                    "root": str(fixture.root),
                    "beforeDigest": fixture.baseline_digest,
                    "afterDigest": fixture_manager.digest(fixture.root),
                },
                "invocation": {
                    "transport": "json_rpc",
                    "commandRedacted": ["codex", "app-server", "--stdio"],
                    "providerSessionIds": [thread_id] if thread_id else [],
                },
                "controlResult": initialized,
                "terminal": terminal,
                "sideEffectAssessment": {"risk": "none", "observed": []},
                "cleanup": cleanup,
                "uncertainties": uncertainty,
                "budget": ledger.summary(),
            },
        )
    _print_json(
        {
            "mode": "appserver-handshake",
            "runId": run_id,
            "status": status,
            "modelBearingInputsReserved": ledger.count_reserved_or_consumed("codex"),
            "evidence": str(evidence_path),
        }
    )
    return 0 if status == "passed" else 1


def _acp_handshake(args: argparse.Namespace) -> int:
    """Verify ACP control-plane startup without a model-bearing prompt."""
    if args.timeout <= 0:
        raise ValueError("ACP handshake timeout must be positive")
    if args.dry_run:
        _print_json(
            {
                "mode": "acp-handshake-dry-run",
                "provider": args.provider,
                "argv": _acp_argv(args.provider, Path("<fixture>")),
                "controlMethods": ["initialize", "session/new"],
                "modelBearingInputsReserved": 0,
            }
        )
        return 0

    run_id = args.run_id or dt.datetime.now(dt.UTC).strftime(f"{args.provider}-acp-%Y%m%dT%H%M%SZ")
    fixture_manager = FixtureManager(Path("/tmp/smallkhoj-agent-runtime-capability-matrix"))
    fixture = fixture_manager.create(run_id, args.provider, "acp-handshake")
    skills_dir = fixture.root / "empty-skills"
    skills_dir.mkdir(exist_ok=False)
    raw_root = fixture_manager.root / run_id / "_raw"
    recorder = EvidenceRecorder(raw_root=raw_root, evidence_root=args.evidence_root)
    case_id = f"{args.provider}-acp-handshake"
    handle = recorder.begin(run_id, case_id)
    ledger = CallBudgetLedger(raw_root / "call-budget.json", per_provider_limit=2)
    registry = OwnedProcessRegistry(raw_root / "processes.json")
    started_at = _now()
    probe: AcpStdioProbe | None = None
    initialized: dict[str, Any] | None = None
    session_id: str | None = None
    status = "failed"
    terminal: dict[str, Any] = {"adapterState": "not_started", "contradictorySignals": []}
    cleanup: dict[str, Any] = {"status": "not_needed", "remainingOwnedPids": [], "notes": []}
    uncertainty: list[str] = []
    try:
        probe = AcpStdioProbe.start(_acp_argv(args.provider, fixture.root), cwd=fixture.root, registry=registry)
        initialized = probe.initialize(timeout_seconds=args.timeout)
        session_id = probe.new_session(fixture.root, timeout_seconds=args.timeout)
        status = "passed"
        terminal = {"adapterState": "acp_initialize_and_session_new_completed", "contradictorySignals": []}
    except JsonRpcTimeout as exc:
        status = "timed_out"
        uncertainty.append(f"ACP handshake timed out: {exc}")
        terminal = {"adapterState": "acp_handshake_timeout", "contradictorySignals": []}
    except JsonRpcError as exc:
        if probe is not None and _looks_like_auth_or_login_error(probe.observations):
            status = "blocked"
        else:
            status = "failed"
        uncertainty.append(f"ACP handshake failed: {type(exc).__name__}: {exc}")
        terminal = {"adapterState": "acp_handshake_error", "contradictorySignals": []}
    except Exception as exc:
        status = "failed"
        uncertainty.append(f"ACP probe failed: {type(exc).__name__}: {exc}")
        terminal = {"adapterState": "acp_probe_error", "contradictorySignals": []}
    finally:
        if probe is not None:
            for event in probe.observations:
                recorder.append(
                    handle,
                    source=event.source,
                    kind="acp-frame",
                    payload={"text": event.text, "reservationId": event.reservation_id},
                    at=event.at,
                )
            try:
                process_result = probe.terminate(grace_seconds=2)
                cleanup = {
                    "status": "complete",
                    "remainingOwnedPids": [],
                    "notes": [f"process state: {process_result.state}"],
                }
            except Exception as exc:
                status = "delivery_uncertain"
                uncertainty.append(f"ACP cleanup failed: {type(exc).__name__}: {exc}")
                cleanup = {
                    "status": "partial",
                    "remainingOwnedPids": [probe.record.pid],
                    "notes": ["process ownership cleanup could not be proven"],
                }
        ended_at = _now()
        evidence_path = recorder.finalize(
            handle,
            {
                "schemaVersion": 1,
                "evidenceId": f"{run_id}/{case_id}/1",
                "runId": run_id,
                "caseId": case_id,
                "surface": f"{args.provider}-acp",
                "provider": args.provider,
                "executionStatus": status,
                "startedAt": started_at,
                "endedAt": ended_at,
                "versions": {},
                "fixture": {
                    "root": str(fixture.root),
                    "beforeDigest": fixture.baseline_digest,
                    "afterDigest": fixture_manager.digest(fixture.root),
                },
                "invocation": {
                    "transport": "acp",
                    "commandRedacted": _acp_argv(args.provider, fixture.root),
                    "providerSessionIds": [session_id] if session_id else [],
                },
                "initialize": initialized,
                "agentCapabilities": probe.agent_capabilities if probe else None,
                "terminal": terminal,
                "sideEffectAssessment": {"risk": "none", "observed": []},
                "cleanup": cleanup,
                "uncertainties": uncertainty,
                "budget": ledger.summary(),
            },
        )
    _print_json(
        {
            "mode": "acp-handshake",
            "provider": args.provider,
            "runId": run_id,
            "status": status,
            "modelBearingInputsReserved": ledger.count_reserved_or_consumed(args.provider),
            "evidence": str(evidence_path),
        }
    )
    return 0 if status == "passed" else 1


def _acp_argv(provider: str, fixture_root: Path) -> list[str]:
    fixture_root = Path(fixture_root)
    if provider == "kimi":
        # Kimi supports a per-invocation skills directory, so probe sessions do
        # not auto-load project/user skills as tools or prompt context.
        return ["kimi", "--skills-dir", str(fixture_root / "empty-skills"), "acp"]
    if provider == "opencode":
        # OpenCode's pure mode suppresses external plugins. ACP remains stdio,
        # while the process cwd and protocol session cwd both stay in /tmp.
        return ["opencode", "--pure", "acp", "--cwd", str(fixture_root)]
    raise ValueError(f"unsupported ACP provider: {provider}")


def _acp_sequential(args: argparse.Namespace) -> int:
    """Exercise two bounded ACP prompt turns in one disposable session.

    It intentionally measures session-scoped prompt/completion visibility, not
    active-turn injection. A third prompt is never started, so cancellation
    reuse and suspend continuation stay unverified.
    """
    if args.timeout <= 0:
        raise ValueError("ACP sequential probe timeout must be positive")
    if args.dry_run:
        _print_json(
            {
                "mode": "acp-sequential-dry-run",
                "provider": args.provider,
                "argv": _acp_argv(args.provider, Path("<fixture>")),
                "maximumModelBearingInputs": 2,
                "modelMethod": "session/prompt",
                "controlMethods": ["initialize", "session/new", "session/set_config_option"],
                "safetyMode": {"configId": "mode", "value": "plan"},
                "postSecondPrompt": "no_cancel_or_third_prompt",
            }
        )
        return 0

    run_id = args.run_id or dt.datetime.now(dt.UTC).strftime(f"{args.provider}-acp-sequential-%Y%m%dT%H%M%SZ")
    fixture_manager = FixtureManager(Path("/tmp/smallkhoj-agent-runtime-capability-matrix"))
    fixture = fixture_manager.create(run_id, args.provider, "acp-sequential")
    (fixture.root / "empty-skills").mkdir(exist_ok=False)
    raw_root = fixture_manager.root / run_id / "_raw"
    recorder = EvidenceRecorder(raw_root=raw_root, evidence_root=args.evidence_root)
    case_id = f"{args.provider}-acp-sequential-session"
    handle = recorder.begin(run_id, case_id)
    ledger = CallBudgetLedger(_live_budget_path(fixture_manager.root), per_provider_limit=2)
    registry = OwnedProcessRegistry(raw_root / "processes.json")
    started_at = _now()
    probe: AcpStdioProbe | None = None
    initialized: dict[str, Any] | None = None
    session_id: str | None = None
    plan_mode: dict[str, Any] | None = None
    first_result: dict[str, Any] | None = None
    second_result: dict[str, Any] | None = None
    status = "failed"
    terminal: dict[str, Any] = {"adapterState": "not_started", "contradictorySignals": []}
    cleanup: dict[str, Any] = {"status": "not_needed", "remainingOwnedPids": [], "notes": []}
    side_effect_assessment: dict[str, Any] = {"risk": "none", "observed": []}
    uncertainty: list[str] = []
    first_nonce = f"FIRST-{args.provider.upper()}-ACP-7e19"
    second_nonce = f"SECOND-{args.provider.upper()}-ACP-2b64"

    try:
        probe = AcpStdioProbe.start(_acp_argv(args.provider, fixture.root), cwd=fixture.root, registry=registry)
        initialized = probe.initialize(timeout_seconds=args.timeout)
        session_id = probe.new_session(fixture.root, timeout_seconds=args.timeout)
        # Both selected ACP surfaces advertised a `mode` config option during
        # the no-input handshake. Requiring plan mode prevents this probe from
        # relying solely on natural-language instructions for tool safety.
        plan_mode = probe.set_config_option(session_id, "mode", "plan", timeout_seconds=args.timeout)
        first_result = probe.prompt(
            ledger,
            args.provider,
            f"{case_id}-first-prompt",
            session_id,
            _acp_first_prompt(first_nonce),
            timeout_seconds=args.timeout,
        )
        if _acp_tool_call_observed(probe.notifications):
            status = "delivery_uncertain"
            side_effect_assessment = {
                "risk": "external_or_unknown",
                "observed": ["ACP session/update reported a tool call despite plan mode and no-tool prompt"],
            }
            uncertainty.append("second prompt was withheld after an unexpected ACP tool-call event")
            terminal = {"adapterState": "unexpected_tool_call_after_first_prompt", "contradictorySignals": []}
        else:
            second_result = probe.prompt(
                ledger,
                args.provider,
                f"{case_id}-second-prompt",
                session_id,
                _acp_second_prompt(second_nonce),
                timeout_seconds=args.timeout,
            )
            if _acp_tool_call_observed(probe.notifications):
                status = "delivery_uncertain"
                side_effect_assessment = {
                    "risk": "external_or_unknown",
                    "observed": ["ACP session/update reported a tool call despite plan mode and no-tool prompt"],
                }
                uncertainty.append("tool-call observation prevents a no-side-effect claim")
                terminal = {"adapterState": "unexpected_tool_call_after_second_prompt", "contradictorySignals": []}
            else:
                status = "passed"
                terminal = {"adapterState": "two_sequential_prompt_responses_observed", "contradictorySignals": []}
    except JsonRpcTimeout as exc:
        status = "timed_out"
        uncertainty.append(f"ACP sequential probe timed out: {exc}")
        terminal = {"adapterState": "acp_sequential_timeout", "contradictorySignals": []}
    except JsonRpcError as exc:
        if probe is not None and _looks_like_auth_or_login_error(probe.observations):
            status = "blocked"
        else:
            status = "failed"
        uncertainty.append(f"ACP sequential probe failed: {type(exc).__name__}: {exc}")
        terminal = {"adapterState": "acp_sequential_error", "contradictorySignals": []}
    except Exception as exc:
        status = "failed"
        uncertainty.append(f"ACP sequential probe failed: {type(exc).__name__}: {exc}")
        terminal = {"adapterState": "acp_sequential_probe_error", "contradictorySignals": []}
    finally:
        if probe is not None:
            for event in probe.observations:
                recorder.append(
                    handle,
                    source=event.source,
                    kind="acp-frame",
                    payload={"text": event.text, "reservationId": event.reservation_id},
                    at=event.at,
                )
            try:
                process_result = probe.terminate(grace_seconds=2)
                cleanup = {
                    "status": "complete",
                    "remainingOwnedPids": [],
                    "notes": [f"process state: {process_result.state}"],
                }
            except Exception as exc:
                status = "delivery_uncertain"
                uncertainty.append(f"ACP cleanup failed: {type(exc).__name__}: {exc}")
                cleanup = {
                    "status": "partial",
                    "remainingOwnedPids": [probe.record.pid],
                    "notes": ["process ownership cleanup could not be proven"],
                }
        ended_at = _now()
        evidence_path = recorder.finalize(
            handle,
            {
                "schemaVersion": 1,
                "evidenceId": f"{run_id}/{case_id}/1",
                "runId": run_id,
                "caseId": case_id,
                "surface": f"{args.provider}-acp",
                "provider": args.provider,
                "executionStatus": status,
                "startedAt": started_at,
                "endedAt": ended_at,
                "versions": {},
                "fixture": {
                    "root": str(fixture.root),
                    "beforeDigest": fixture.baseline_digest,
                    "afterDigest": fixture_manager.digest(fixture.root),
                },
                "invocation": {
                    "transport": "acp",
                    "commandRedacted": _acp_argv(args.provider, fixture.root),
                    "providerSessionIds": [session_id] if session_id else [],
                },
                "initialize": initialized,
                "agentCapabilities": probe.agent_capabilities if probe else None,
                "planMode": plan_mode,
                "firstPrompt": first_result,
                "secondPrompt": second_result,
                "sessionUpdateKinds": _acp_update_summary(probe.notifications if probe else []),
                "postSecondPrompt": "unverified_cancel_reuse_and_suspend_continuation",
                "terminal": terminal,
                "sideEffectAssessment": side_effect_assessment,
                "cleanup": cleanup,
                "uncertainties": uncertainty,
                "budget": ledger.summary(),
            },
        )
    _print_json(
        {
            "mode": "acp-sequential",
            "provider": args.provider,
            "runId": run_id,
            "status": status,
            "modelBearingInputsReserved": ledger.count_reserved_or_consumed(args.provider),
            "evidence": str(evidence_path),
        }
    )
    return 0 if status == "passed" else 1


def _acp_first_prompt(nonce: str) -> str:
    return (
        "This is an isolated capability probe in a disposable fixture. "
        "Do not use tools, read or write files, access the network, or send messages. "
        f"Reply only with this exact token: {nonce}."
    )


def _acp_second_prompt(nonce: str) -> str:
    return (
        "Remain in this same isolated ACP session. Do not use tools, read or write files, "
        "access the network, or send messages. Reply only with this exact token followed by a colon "
        f"and the exact token from the immediately preceding input: {nonce}:<previous-token>."
    )


def _acp_update_kinds(notifications: list[dict[str, Any]]) -> list[str]:
    kinds: list[str] = []
    for notification in notifications:
        if notification.get("method") != "session/update":
            continue
        params = notification.get("params")
        update = params.get("update") if isinstance(params, dict) else None
        kind = update.get("sessionUpdate") if isinstance(update, dict) else None
        if isinstance(kind, str):
            kinds.append(kind)
    return kinds


def _acp_update_summary(notifications: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for kind in _acp_update_kinds(notifications):
        counts[kind] = counts.get(kind, 0) + 1
    return dict(sorted(counts.items()))


def _acp_tool_call_observed(notifications: list[dict[str, Any]]) -> bool:
    return any(kind in {"tool_call", "tool_call_update"} for kind in _acp_update_summary(notifications))


def _codex_appserver_steer(args: argparse.Namespace) -> int:
    """Run exactly two Codex model-bearing frames against one disposable turn.

    The `turn/interrupt` request is deliberately sent over the non-model
    control path. No post-interrupt turn is started, so this probe cannot make
    a claim about post-cancel session usability.
    """
    if args.timeout <= 0:
        raise ValueError("Codex app-server probe timeout must be positive")
    if args.dry_run:
        _print_json(
            {
                "mode": "codex-appserver-steer-dry-run",
                "argv": ["codex", "app-server", "--stdio"],
                "maximumModelBearingInputs": 2,
                "modelMethods": ["turn/start", "turn/steer"],
                "controlMethods": ["initialize", "thread/start", "turn/interrupt"],
                "postInterruptTurn": "not_started",
            }
        )
        return 0

    run_id = args.run_id or dt.datetime.now(dt.UTC).strftime("codex-steer-%Y%m%dT%H%M%SZ")
    fixture_manager = FixtureManager(Path("/tmp/smallkhoj-agent-runtime-capability-matrix"))
    fixture = fixture_manager.create(run_id, "codex", "appserver-active-steer-interrupt")
    raw_root = fixture_manager.root / run_id / "_raw"
    recorder = EvidenceRecorder(raw_root=raw_root, evidence_root=args.evidence_root)
    handle = recorder.begin(run_id, "codex-appserver-active-steer-interrupt")
    ledger = CallBudgetLedger(_live_budget_path(fixture_manager.root), per_provider_limit=2)
    registry = OwnedProcessRegistry(raw_root / "processes.json")
    started_at = _now()
    probe: CodexAppServerProbe | None = None
    initialized: dict[str, Any] | None = None
    thread_id: str | None = None
    turn_id: str | None = None
    started_notification: dict[str, Any] | None = None
    steer: dict[str, Any] = {"attempted": False, "outcome": "not_attempted"}
    interrupt: dict[str, Any] = {"attempted": False, "outcome": "not_attempted"}
    status = "failed"
    terminal: dict[str, Any] = {"adapterState": "not_started", "contradictorySignals": []}
    cleanup: dict[str, Any] = {"status": "not_needed", "remainingOwnedPids": [], "notes": []}
    side_effect_assessment: dict[str, Any] = {"risk": "none", "observed": []}
    uncertainty: list[str] = []
    first_nonce = "FIRST-CODEX-STEER-8a17"
    second_nonce = "SECOND-CODEX-STEER-3d42"

    try:
        probe = CodexAppServerProbe.start(["codex", "app-server", "--stdio"], cwd=fixture.root, registry=registry)
        initialized = probe.initialize(timeout_seconds=args.timeout)
        thread_id = probe.start_thread(fixture.root, timeout_seconds=args.timeout)
        turn_id = probe.start_turn(
            ledger,
            "codex",
            "codex-appserver-turn-start",
            thread_id,
            _codex_prompt(first_nonce, phase="first"),
            timeout_seconds=args.timeout,
        )
        started_notification = probe.wait_for_turn_started(thread_id, turn_id, timeout_seconds=args.timeout)

        try:
            steered_turn_id = probe.steer_turn(
                ledger,
                "codex",
                "codex-appserver-turn-steer",
                thread_id,
                turn_id,
                _codex_prompt(second_nonce, phase="steer"),
                timeout_seconds=args.timeout,
            )
            steer = {"attempted": True, "outcome": "accepted", "turnId": steered_turn_id}
        except JsonRpcTimeout as exc:
            steer = {"attempted": True, "outcome": "unknown", "reason": str(exc)}
            uncertainty.append("turn/steer did not return an observable response")
        except JsonRpcError as exc:
            steer = {"attempted": True, "outcome": "rejected", "reason": str(exc)}

        try:
            interrupt_response = probe.interrupt_turn(thread_id, turn_id, timeout_seconds=args.timeout)
            interrupt = {"attempted": True, "outcome": "accepted", "response": interrupt_response}
        except JsonRpcTimeout as exc:
            interrupt = {"attempted": True, "outcome": "unknown", "reason": str(exc)}
            uncertainty.append("turn/interrupt did not return an observable response")
        except JsonRpcError as exc:
            interrupt = {"attempted": True, "outcome": "rejected", "reason": str(exc)}

        if steer["outcome"] == "unknown" or interrupt["outcome"] == "unknown":
            status = "timed_out"
            terminal = {"adapterState": "steer_or_interrupt_response_missing", "contradictorySignals": []}
        else:
            status = "passed"
            terminal = {
                "adapterState": "active_turn_steer_and_interrupt_observed",
                "contradictorySignals": [],
            }
    except JsonRpcTimeout as exc:
        status = "timed_out"
        uncertainty.append(f"app-server protocol timed out: {exc}")
        terminal = {"adapterState": "appserver_timeout", "contradictorySignals": []}
    except JsonRpcError as exc:
        if probe is not None and _looks_like_auth_or_login_error(probe.observations):
            status = "blocked"
        else:
            status = "failed"
        uncertainty.append(f"app-server protocol failed: {type(exc).__name__}: {exc}")
        terminal = {"adapterState": "appserver_protocol_error", "contradictorySignals": []}
    except Exception as exc:
        status = "failed"
        uncertainty.append(f"app-server probe failed: {type(exc).__name__}: {exc}")
        terminal = {"adapterState": "appserver_probe_error", "contradictorySignals": []}
    finally:
        if probe is not None:
            if _user_hook_execution_observed(probe.observations):
                # A user-global hook is neither an owned fixture nor a
                # declared Provider capability. Its command may have had
                # effects that this isolated runner cannot prove absent.
                status = "delivery_uncertain"
                side_effect_assessment = {
                    "risk": "external_or_unknown",
                    "observed": ["user-level Codex hook executed outside the disposable fixture"],
                }
                uncertainty.append("user-level Codex hook execution prevents a no-side-effect claim")
                contradictory = terminal.setdefault("contradictorySignals", [])
                if isinstance(contradictory, list):
                    contradictory.append("user-level hook ran outside fixture boundary")
            for event in probe.observations:
                recorder.append(
                    handle,
                    source=event.source,
                    kind="jsonrpc-frame",
                    payload={"text": event.text, "reservationId": event.reservation_id},
                    at=event.at,
                )
            try:
                process_result = probe.terminate(grace_seconds=2)
                cleanup = {
                    "status": "complete",
                    "remainingOwnedPids": [],
                    "notes": [f"process state: {process_result.state}"],
                }
            except Exception as exc:
                status = "delivery_uncertain"
                uncertainty.append(f"app-server cleanup failed: {type(exc).__name__}: {exc}")
                cleanup = {
                    "status": "partial",
                    "remainingOwnedPids": [probe.record.pid],
                    "notes": ["process ownership cleanup could not be proven"],
                }
        ended_at = _now()
        evidence_path = recorder.finalize(
            handle,
            {
                "schemaVersion": 1,
                "evidenceId": f"{run_id}/codex-appserver-active-steer-interrupt/1",
                "runId": run_id,
                "caseId": "codex-appserver-active-steer-interrupt",
                "surface": "codex-appserver",
                "provider": "codex",
                "executionStatus": status,
                "startedAt": started_at,
                "endedAt": ended_at,
                "versions": {},
                "fixture": {
                    "root": str(fixture.root),
                    "beforeDigest": fixture.baseline_digest,
                    "afterDigest": fixture_manager.digest(fixture.root),
                },
                "invocation": {
                    "transport": "json_rpc",
                    "commandRedacted": ["codex", "app-server", "--stdio"],
                    "providerSessionIds": [thread_id] if thread_id else [],
                    "providerTurnIds": [turn_id] if turn_id else [],
                },
                "controlResult": initialized,
                "turnStarted": started_notification,
                "steer": steer,
                "interrupt": interrupt,
                "postInterruptSessionUsability": "unverified_no_third_model_input",
                "terminal": terminal,
                "sideEffectAssessment": side_effect_assessment,
                "cleanup": cleanup,
                "uncertainties": uncertainty,
                "budget": ledger.summary(),
            },
        )
    _print_json(
        {
            "mode": "codex-appserver-steer",
            "runId": run_id,
            "status": status,
            "modelBearingInputsReserved": ledger.count_reserved_or_consumed("codex"),
            "evidence": str(evidence_path),
        }
    )
    return 0 if status == "passed" else 1


def _codex_prompt(nonce: str, *, phase: str) -> str:
    return (
        "This is an isolated capability probe in a disposable fixture. "
        "Do not invoke tools, read or write files, access the network, or send messages. "
        f"This is the {phase} input. Think only about the request, then reply only with the exact token: {nonce}."
    )


def _user_hook_execution_observed(observations: list[Any]) -> bool:
    """Return true when the app-server ran a hook from user-global config.

    We deliberately do not read the hook file: the protocol event already
    proves that it escaped the fixture boundary, while inspecting its content
    could expose unrelated local configuration.
    """
    for observation in observations:
        if getattr(observation, "source", None) != "stdout":
            continue
        try:
            event = json.loads(getattr(observation, "text", ""))
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(event, dict) or event.get("method") not in {"hook/started", "hook/completed"}:
            continue
        params = event.get("params")
        run = params.get("run") if isinstance(params, dict) else None
        if isinstance(run, dict) and run.get("source") == "user":
            return True
    return False


def _claude_busy_input(args: argparse.Namespace) -> int:
    if args.active_timeout <= 0 or args.result_timeout <= 0:
        raise ValueError("Claude probe timeouts must be positive")
    if args.dry_run:
        _print_json(
            {
                "mode": "claude-busy-input-dry-run",
                "argv": ClaudeStreamJsonProbe.default_argv(),
                "maximumModelBearingInputs": 2,
                "secondInputPrecondition": "a stream-json assistant event is observed before the first result",
            }
        )
        return 0

    run_id = args.run_id or dt.datetime.now(dt.UTC).strftime("claude-busy-%Y%m%dT%H%M%SZ")
    fixture_manager = FixtureManager(Path("/tmp/smallkhoj-agent-runtime-capability-matrix"))
    fixture = fixture_manager.create(run_id, "claude", "stream-json-busy")
    raw_root = fixture_manager.root / run_id / "_raw"
    recorder = EvidenceRecorder(raw_root=raw_root, evidence_root=args.evidence_root)
    handle = recorder.begin(run_id, "claude-stream-json-busy-input")
    ledger = CallBudgetLedger(_live_budget_path(fixture_manager.root), per_provider_limit=2)
    registry = OwnedProcessRegistry(raw_root / "processes.json")
    started_at = _now()
    probe: ClaudeStreamJsonProbe | None = None
    status = "failed"
    active_observed = False
    second_input_sent = False
    result_events = 0
    uncertainty: list[str] = []
    terminal: dict[str, Any] = {"adapterState": "not_started", "contradictorySignals": []}
    cleanup: dict[str, Any] = {"status": "not_needed", "remainingOwnedPids": [], "notes": []}
    first_nonce = "FIRST-CLAUDE-BUSY-9f7a"
    second_nonce = "SECOND-CLAUDE-BUSY-3c2e"
    try:
        probe = ClaudeStreamJsonProbe.start(ClaudeStreamJsonProbe.default_argv(), cwd=fixture.root, registry=registry)
        probe.send_user_input(
            ledger,
            "claude",
            "claude-stream-json-first-input",
            _claude_prompt(first_nonce, phase="first"),
        )
        active = probe.wait_for_event(lambda event: event.type == "assistant", timeout_seconds=args.active_timeout)
        active_observed = True
        probe.send_user_input(
            ledger,
            "claude",
            "claude-stream-json-second-input",
            _claude_prompt(second_nonce, phase="second"),
        )
        second_input_sent = True
        probe.wait_for_event(lambda event: event.type == "result", timeout_seconds=args.result_timeout)
        result_events += 1
        probe.wait_for_event(lambda event: event.type == "result", timeout_seconds=args.result_timeout)
        result_events += 1
        status = "passed"
        terminal = {"adapterState": "two_result_events_observed", "contradictorySignals": []}
    except StreamJsonError as exc:
        if probe is not None and _looks_like_auth_or_login_error(probe.observations):
            status = "blocked"
        else:
            status = "timed_out"
        uncertainty.append(f"stream-json observation failed: {type(exc).__name__}: {exc}")
        terminal = {"adapterState": "stream_json_timeout_or_block", "contradictorySignals": []}
    except Exception as exc:
        status = "failed"
        uncertainty.append(f"stream-json probe failed: {type(exc).__name__}: {exc}")
        terminal = {"adapterState": "stream_json_error", "contradictorySignals": []}
    finally:
        if probe is not None:
            try:
                process_result = probe.terminate(grace_seconds=2)
                cleanup = {
                    "status": "complete",
                    "remainingOwnedPids": [],
                    "notes": [f"process state: {process_result.state}"],
                }
            except Exception as exc:
                status = "delivery_uncertain"
                uncertainty.append(f"stream-json cleanup failed: {type(exc).__name__}: {exc}")
                cleanup = {
                    "status": "partial",
                    "remainingOwnedPids": [probe.record.pid],
                    "notes": ["process ownership cleanup could not be proven"],
                }
            for observed in probe.drain_observations():
                recorder.append(
                    handle,
                    source=observed.source,
                    kind="stream-json-frame",
                    payload={"text": observed.text, "reservationId": observed.reservation_id},
                    at=observed.at,
                )
        ended_at = _now()
        evidence_path = recorder.finalize(
            handle,
            {
                "schemaVersion": 1,
                "evidenceId": f"{run_id}/claude-stream-json-busy-input/1",
                "runId": run_id,
                "caseId": "claude-stream-json-busy-input",
                "surface": "claude-stream-json",
                "provider": "claude",
                "executionStatus": status,
                "startedAt": started_at,
                "endedAt": ended_at,
                "versions": {},
                "fixture": {
                    "root": str(fixture.root),
                    "beforeDigest": fixture.baseline_digest,
                    "afterDigest": fixture_manager.digest(fixture.root),
                },
                "invocation": {
                    "transport": "stdin_jsonl",
                    "commandRedacted": ClaudeStreamJsonProbe.default_argv(),
                    "providerSessionIds": [probe.session_id] if probe and probe.session_id else [],
                },
                "busyInput": {
                    "assistantObservedBeforeFirstResult": active_observed,
                    "secondInputSent": second_input_sent,
                    "resultEventsObserved": result_events,
                },
                "terminal": terminal,
                "sideEffectAssessment": {"risk": "none", "observed": []},
                "cleanup": cleanup,
                "uncertainties": uncertainty,
                "budget": ledger.summary(),
            },
        )
    _print_json(
        {
            "mode": "claude-busy-input",
            "runId": run_id,
            "status": status,
            "modelBearingInputsReserved": ledger.count_reserved_or_consumed("claude"),
            "evidence": str(evidence_path),
        }
    )
    return 0 if status == "passed" else 1


def _claude_prompt(nonce: str, *, phase: str) -> str:
    return (
        "This is an isolated capability probe in a disposable fixture. "
        "Do not call tools, do not read files, do not access the network, and do not send messages. "
        f"This is the {phase} input. Reply only with the exact token: {nonce}."
    )


def _looks_like_auth_or_login_error(observations: list[Any]) -> bool:
    text = "\n".join(getattr(observation, "text", "") for observation in observations).lower()
    return any(marker in text for marker in ("authentication", "login", "not authenticated", "sign in"))


def _atomic_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _run_id() -> str:
    return dt.datetime.now(dt.UTC).strftime("static-%Y%m%dT%H%M%SZ")


def _now() -> str:
    return dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")


def _live_budget_path(fixture_root: Path) -> Path:
    """One fail-closed Provider budget for all dynamic run IDs in this spike."""
    return Path(fixture_root) / "_live-budget" / "call-budget.json"


def _print_json(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    raise SystemExit(main())
