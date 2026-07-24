#!/usr/bin/env python3
"""Patch a production env file from KEY=value lines on stdin.

The command intentionally avoids printing values. Use it over SSH with stdin
redirection so secrets do not appear in command arguments or shell history.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path


ALLOWED_KEYS = {
    "SMALLKHOJ_SITE_ADDRESS",
    "SMALLKHOJ_BACKEND_IMAGE",
    "SMALLKHOJ_FRONTEND_IMAGE",
    "SMALLKHOJ_CADDY_IMAGE",
    "POSTGRES_USER",
    "POSTGRES_DB",
    "POSTGRES_PASSWORD",
    "BACKEND_CORS_ORIGINS",
    "MINIMUM_DAEMON_VERSION",
    "DAEMON_RELEASE_VERSION",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "AUTH_BRIDGE_SECRET",
    "PUBLIC_API_KEY",
    "NEXT_PUBLIC_API_BASE_URL",
    "NEXT_PUBLIC_WS_BASE_URL",
    "LLM_API_KEY",
    "LLM_API_BASE",
    "LLM_MODEL",
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
    "FEISHU_REPLY_BASE_URL",
    "FEISHU_REPLY_ACCESS_TOKEN",
    "FEISHU_WORKER_CONNECTOR_ID",
    "FEISHU_WORKER_JIRA_CONNECTOR_ID",
    "FEISHU_WORKER_CREATOR_ID",
    "FEISHU_WORKER_BOT_OPEN_ID",
    "FEISHU_WORKER_BOT_NAME",
    "FEISHU_WORKER_APP_ID",
    "FEISHU_WORKER_APP_SECRET",
    "FEISHU_WORKER_ENABLED",
}

RELEASE_WORKER_REQUIRED_KEYS = (
    "FEISHU_WORKER_CONNECTOR_ID",
    "FEISHU_WORKER_JIRA_CONNECTOR_ID",
    "FEISHU_WORKER_CREATOR_ID",
    "FEISHU_WORKER_APP_ID",
    "FEISHU_WORKER_APP_SECRET",
    "FEISHU_REPLY_ACCESS_TOKEN",
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
)


@dataclass(frozen=True)
class EnvUpdateResult:
    env_file: Path
    backup_file: Path
    updated_keys: list[str]
    added_keys: list[str]
    unchanged_keys: list[str]
    value_labels: dict[str, str]

    def sanitized_details(self) -> dict[str, dict[str, str]]:
        return {
            "added": {key: self.value_labels.get(key, "<set>") for key in self.added_keys},
            "updated": {key: self.value_labels.get(key, "<set>") for key in self.updated_keys},
            "unchanged": {key: "<unchanged>" for key in self.unchanged_keys},
        }


def _result_value_label(value: str) -> str:
    return "<empty>" if value == "" else "<set>"


def _parse_patch_lines(content: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_no, raw_line in enumerate(content.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            raise ValueError(f"Line {line_no} is not KEY=value.")
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            raise ValueError(f"Line {line_no} has an empty key.")
        if key not in ALLOWED_KEYS:
            raise ValueError(f"Env key is not allowed for production patching: {key}")
        values[key] = value
    if not values:
        raise ValueError("No env values were provided on stdin.")
    return values


def _split_env_line(raw_line: str) -> tuple[str, str] | None:
    stripped = raw_line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    candidate = stripped[7:].strip() if stripped.startswith("export ") else stripped
    if "=" not in candidate:
        return None
    key, value = candidate.split("=", 1)
    key = key.strip()
    if not key:
        return None
    return key, value


def _backup_path(env_file: Path) -> Path:
    return env_file.with_suffix(env_file.suffix + ".bak")


def _format_summary(keys: list[str], values: dict[str, str], *, unchanged: bool = False) -> dict[str, str]:
    if unchanged:
        return {key: "<unchanged>" for key in keys}
    return {key: _result_value_label(values[key]) for key in keys}


def update_env_file(env_file: Path, stdin_content: str) -> EnvUpdateResult:
    if not env_file.is_file():
        raise FileNotFoundError(f"Env file does not exist: {env_file}")
    patch = _parse_patch_lines(stdin_content)
    original_lines = env_file.read_text(encoding="utf-8").splitlines(keepends=True)

    seen: set[str] = set()
    updated: list[str] = []
    unchanged: list[str] = []
    output_lines: list[str] = []
    for raw_line in original_lines:
        parsed = _split_env_line(raw_line)
        if parsed is None:
            output_lines.append(raw_line)
            continue
        key, current_value = parsed
        if key not in patch:
            output_lines.append(raw_line)
            continue
        seen.add(key)
        new_value = patch[key]
        if current_value == new_value:
            unchanged.append(key)
            output_lines.append(raw_line)
            continue
        updated.append(key)
        prefix = "export " if raw_line.lstrip().startswith("export ") else ""
        newline = "\n" if raw_line.endswith("\n") else ""
        output_lines.append(f"{prefix}{key}={new_value}{newline}")

    added = [key for key in patch if key not in seen]
    if added:
        if output_lines and not output_lines[-1].endswith("\n"):
            output_lines[-1] = output_lines[-1] + "\n"
        output_lines.append("\n# Added by update_prod_env_from_stdin.py\n")
        for key in added:
            output_lines.append(f"{key}={patch[key]}\n")

    backup = _backup_path(env_file)
    shutil.copy2(env_file, backup)
    env_file.write_text("".join(output_lines), encoding="utf-8")
    return EnvUpdateResult(
        env_file=env_file,
        backup_file=backup,
        updated_keys=updated,
        added_keys=added,
        unchanged_keys=unchanged,
        value_labels={key: _result_value_label(value) for key, value in patch.items()},
    )


def result_payload(result: EnvUpdateResult, patch_values: dict[str, str] | None = None) -> dict:
    details = result.sanitized_details()
    if patch_values is not None:
        details = {
            "added": _format_summary(result.added_keys, patch_values),
            "updated": _format_summary(result.updated_keys, patch_values),
            "unchanged": _format_summary(result.unchanged_keys, patch_values, unchanged=True),
        }
    return {
        "status": "updated",
        "envFile": str(result.env_file),
        "backupFile": str(result.backup_file),
        "details": details,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Update a production .env file from KEY=value lines on stdin without printing values.")
    parser.add_argument("--env-file", type=Path, required=True, help="Production env file to patch.")
    parser.add_argument("--json", action="store_true", help="Print JSON summary. Values are always redacted.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    stdin_content = sys.stdin.read()
    try:
        patch = _parse_patch_lines(stdin_content)
        result = update_env_file(args.env_file, stdin_content)
    except (FileNotFoundError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    payload = result_payload(result, patch)
    print(json.dumps(payload, ensure_ascii=False, indent=2 if args.json else None, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
