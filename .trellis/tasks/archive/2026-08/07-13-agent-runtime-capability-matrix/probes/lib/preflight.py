from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ManifestError(ValueError):
    """Raised when a preflight manifest is not demonstrably non-model-bearing."""


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SAFE_EXECUTABLES = frozenset({"codex", "claude", "kimi", "opencode", "qoder", "zcode", "pi"})
_MODES = frozenset({"version", "help", "schema"})
_SEMVER = re.compile(r"\b(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)\b")


@dataclass(frozen=True)
class PreflightCheck:
    id: str
    provider: str
    surface: str
    mode: str
    argv: list[str]


@dataclass(frozen=True)
class PreflightManifest:
    fixture_root: Path
    per_provider_limit: int
    checks: list[PreflightCheck]


@dataclass(frozen=True)
class PreflightResult:
    check: PreflightCheck
    status: str
    argv: list[str]
    exit_code: int | None
    stdout: str
    stderr: str
    reason: str | None = None
    version: str | None = None


def load_manifest(path: Path) -> PreflightManifest:
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(f"cannot read preflight manifest: {exc}") from exc
    if not isinstance(raw, dict) or raw.get("schemaVersion") != 1:
        raise ManifestError("preflight manifest must use schemaVersion 1")
    fixture_root = raw.get("fixtureRoot")
    if not isinstance(fixture_root, str) or not fixture_root:
        raise ManifestError("fixtureRoot must be a non-empty string")
    resolved_fixture_root = Path(fixture_root).resolve(strict=False)
    if not resolved_fixture_root.is_relative_to(Path("/tmp").resolve()):
        raise ManifestError("fixtureRoot must be below /tmp")
    limit = raw.get("perProviderLimit")
    if not isinstance(limit, int) or limit != 2:
        raise ManifestError("perProviderLimit must be exactly 2 for this spike")
    checks_raw = raw.get("checks")
    if not isinstance(checks_raw, list) or not checks_raw:
        raise ManifestError("checks must be a non-empty list")
    checks = [_parse_check(item) for item in checks_raw]
    ids = [check.id for check in checks]
    if len(ids) != len(set(ids)):
        raise ManifestError("check ids must be unique")
    return PreflightManifest(fixture_root=Path(fixture_root), per_provider_limit=limit, checks=checks)


def render_argv(check: PreflightCheck, fixture: Path) -> list[str]:
    fixture = Path(fixture).resolve(strict=False)
    rendered: list[str] = []
    for arg in check.argv:
        if "{fixture}" in arg:
            if check.mode != "schema" or not arg.startswith("{fixture}/"):
                raise ManifestError("fixture placeholders are allowed only for schema output paths")
            rendered.append(arg.replace("{fixture}", str(fixture)))
        else:
            rendered.append(arg)
    return rendered


def run_check(check: PreflightCheck, fixture: Path, *, timeout_seconds: float = 15) -> PreflightResult:
    if timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be positive")
    argv = render_argv(check, fixture)
    executable = shutil.which(argv[0])
    if executable is None:
        return PreflightResult(
            check=check,
            status="not_executed",
            argv=argv,
            exit_code=None,
            stdout="",
            stderr="",
            reason=f"{argv[0]} is not installed on PATH",
            version=None,
        )
    if check.mode == "schema":
        output_index = argv.index("-o") + 1
        Path(argv[output_index]).parent.mkdir(parents=True, exist_ok=True)
    try:
        completed = subprocess.run(
            argv,
            cwd=fixture,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired as exc:
        return PreflightResult(
            check=check,
            status="timed_out",
            argv=argv,
            exit_code=None,
            stdout=_text_or_empty(exc.stdout),
            stderr=_text_or_empty(exc.stderr),
            reason=f"timed out after {timeout_seconds:g}s",
            version=None,
        )
    except OSError as exc:
        return PreflightResult(
            check=check,
            status="failed",
            argv=argv,
            exit_code=None,
            stdout="",
            stderr="",
            reason=str(exc),
            version=None,
        )
    return PreflightResult(
        check=check,
        status="passed" if completed.returncode == 0 else "failed",
        argv=argv,
        exit_code=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
        reason=None if completed.returncode == 0 else f"exit {completed.returncode}",
        version=extract_version(completed.stdout) if check.mode == "version" and completed.returncode == 0 else None,
    )


def extract_version(output: str) -> str | None:
    """Extract the first semantic-version-shaped token without guessing a provider name."""

    if not isinstance(output, str):
        return None
    match = _SEMVER.search(output)
    return match.group(1) if match else None


def _parse_check(raw: Any) -> PreflightCheck:
    if not isinstance(raw, dict):
        raise ManifestError("each check must be an object")
    values: dict[str, str] = {}
    for field in ("id", "provider", "surface", "mode"):
        value = raw.get(field)
        if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
            raise ManifestError(f"{field} must match {_IDENTIFIER.pattern}")
        values[field] = value
    if values["mode"] not in _MODES:
        raise ManifestError(f"mode must be one of: {', '.join(sorted(_MODES))}")
    argv = raw.get("argv")
    if not isinstance(argv, list) or not argv or any(not isinstance(arg, str) or not arg for arg in argv):
        raise ManifestError("argv must be a non-empty list of non-empty strings")
    if argv[0] not in _SAFE_EXECUTABLES:
        raise ManifestError("preflight executable is not allowlisted")
    if any("\n" in arg or "\x00" in arg for arg in argv):
        raise ManifestError("argv must not contain newlines or NUL")
    _validate_non_model_command(values["mode"], argv)
    return PreflightCheck(argv=list(argv), **values)


def _validate_non_model_command(mode: str, argv: list[str]) -> None:
    joined = "\u0000".join(argv).lower()
    forbidden = ("--prompt", "-p", "--resume", "--continue", "--session", "--input")
    if any(flag in argv or flag in joined for flag in forbidden):
        raise ManifestError("preflight argv contains a model-input or session-continuation flag")
    if mode == "version":
        if argv != [argv[0], "--version"]:
            raise ManifestError("version checks must be exactly '<binary> --version'")
        return
    if mode == "help":
        if argv[-1] != "--help":
            raise ManifestError("help checks must end with --help")
        return
    expected = ["codex", "app-server", "generate-json-schema"]
    if argv[:3] != expected or "--experimental" not in argv or "-o" not in argv:
        raise ManifestError("schema checks must use the explicit Codex app-server schema command")
    output_index = argv.index("-o") + 1
    if output_index >= len(argv) or not argv[output_index].startswith("{fixture}/"):
        raise ManifestError("schema output must be a path below the fixture placeholder")


def _text_or_empty(value: str | bytes | None) -> str:
    if value is None:
        return ""
    return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value
