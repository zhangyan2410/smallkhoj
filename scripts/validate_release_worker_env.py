#!/usr/bin/env python3
"""Validate a repo-external release worker env file without printing values."""

from __future__ import annotations

import argparse
import io
import json
import sys
from contextlib import redirect_stdout
from dataclasses import dataclass
from pathlib import Path

try:
    from scripts import update_prod_env_from_stdin as env_updater
except ModuleNotFoundError:
    import update_prod_env_from_stdin as env_updater


READY = "RELEASE_WORKER_ENV_READY"
MISSING_REQUIRED_KEYS = "RELEASE_WORKER_ENV_MISSING_REQUIRED_KEYS"
PLACEHOLDER_PREFIXES = ("<", "TODO", "CHANGE_ME", "REPLACE_ME")


@dataclass(frozen=True)
class ReleaseWorkerEnvValidation:
    ready: bool
    reason_code: str
    provided_keys: list[str]
    missing_keys: list[str]


def _has_effective_value(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return False
    return not any(stripped.startswith(prefix) for prefix in PLACEHOLDER_PREFIXES)


def validate_release_worker_env(content: str) -> ReleaseWorkerEnvValidation:
    values = env_updater._parse_patch_lines(content)
    missing = [
        key
        for key in env_updater.RELEASE_WORKER_REQUIRED_KEYS
        if key not in values or not _has_effective_value(values[key])
    ]
    return ReleaseWorkerEnvValidation(
        ready=not missing,
        reason_code=READY if not missing else MISSING_REQUIRED_KEYS,
        provided_keys=sorted(values),
        missing_keys=missing,
    )


def result_payload(result: ReleaseWorkerEnvValidation) -> dict:
    return {
        "status": "ready" if result.ready else "failed",
        "ready": result.ready,
        "reasonCode": result.reason_code,
        "providedKeys": result.provided_keys,
        "missingKeys": result.missing_keys,
    }


def format_human(result: ReleaseWorkerEnvValidation) -> str:
    lines = [
        f"status: {'ready' if result.ready else 'failed'}",
        f"reasonCode: {result.reason_code}",
        "providedKeys:",
    ]
    lines.extend(f"- {key}" for key in result.provided_keys)
    if result.missing_keys:
        lines.append("missingKeys:")
        lines.extend(f"- {key}" for key in result.missing_keys)
    return "\n".join(lines) + "\n"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate a release-worker.env file without printing values or modifying .env.prod."
    )
    parser.add_argument("env_file", type=Path, help="Repo-external release worker env file to validate.")
    parser.add_argument("--json", action="store_true", help="Print JSON summary. Values are always redacted.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        content = args.env_file.read_text(encoding="utf-8")
        result = validate_release_worker_env(content)
    except (FileNotFoundError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(result_payload(result), ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(format_human(result), end="")
    return 0 if result.ready else 2


def run_cli(argv: list[str]) -> tuple[int, str]:
    stdout = io.StringIO()
    with redirect_stdout(stdout):
        exit_code = main(argv)
    return exit_code, stdout.getvalue()


if __name__ == "__main__":
    raise SystemExit(main())
