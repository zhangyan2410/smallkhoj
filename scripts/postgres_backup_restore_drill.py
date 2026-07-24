#!/usr/bin/env python3
"""Run or plan a no-secret Postgres backup/restore drill for production compose."""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_COMPOSE_FILE = "docker-compose.prod.yml"
DEFAULT_ENV_FILE = ".env.prod"
DEFAULT_SERVICE = "db"
DEFAULT_DB = "smallkhoj"
DEFAULT_USER = "smallkhoj"


@dataclass(frozen=True)
class DrillStep:
    name: str
    command: list[str]


@dataclass(frozen=True)
class DrillResult:
    ready: bool
    dry_run: bool
    backup_file: Path
    restore_database: str
    steps: list[dict[str, Any]]


def timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def compose_prefix(*, env_file: Path, compose_file: Path) -> list[str]:
    return [
        "docker",
        "compose",
        "--env-file",
        str(env_file),
        "-f",
        str(compose_file),
    ]


def build_steps(
    *,
    env_file: Path,
    compose_file: Path,
    service: str,
    db_name: str,
    user: str,
    backup_file: Path,
    restore_database: str,
) -> list[DrillStep]:
    prefix = compose_prefix(env_file=env_file, compose_file=compose_file)
    return [
        DrillStep(
            "backup",
            [
                *prefix,
                "exec",
                "-T",
                service,
                "pg_dump",
                "-U",
                user,
                "-d",
                db_name,
                "--format=custom",
                "--no-owner",
                "--no-privileges",
            ],
        ),
        DrillStep(
            "create-restore-db",
            [*prefix, "exec", "-T", service, "createdb", "-U", user, restore_database],
        ),
        DrillStep(
            "restore",
            [*prefix, "exec", "-T", service, "pg_restore", "-U", user, "-d", restore_database, "--no-owner", "--no-privileges"],
        ),
        DrillStep(
            "verify-restore",
            [*prefix, "exec", "-T", service, "psql", "-U", user, "-d", restore_database, "-tAc", "SELECT 1"],
        ),
        DrillStep(
            "drop-restore-db-after",
            [*prefix, "exec", "-T", service, "dropdb", "-U", user, "--if-exists", restore_database],
        ),
    ]


def shell_join(command: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in command)


def run_capture_to_file(command: list[str], output_file: Path, *, cwd: Path, timeout: int) -> dict[str, Any]:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open("wb") as handle:
        completed = subprocess.run(command, cwd=cwd, check=False, stdout=handle, stderr=subprocess.PIPE, timeout=timeout)
    return {
        "command": command,
        "exitCode": completed.returncode,
        "stderrTail": completed.stderr.decode("utf-8", errors="replace")[-2000:],
    }


def run_with_input_file(command: list[str], input_file: Path, *, cwd: Path, timeout: int) -> dict[str, Any]:
    with input_file.open("rb") as handle:
        completed = subprocess.run(command, cwd=cwd, check=False, stdin=handle, capture_output=True, timeout=timeout)
    return {
        "command": command,
        "exitCode": completed.returncode,
        "stdoutTail": completed.stdout.decode("utf-8", errors="replace")[-2000:],
        "stderrTail": completed.stderr.decode("utf-8", errors="replace")[-2000:],
    }


def run_command(command: list[str], *, cwd: Path, timeout: int) -> dict[str, Any]:
    completed = subprocess.run(command, cwd=cwd, check=False, capture_output=True, timeout=timeout)
    return {
        "command": command,
        "exitCode": completed.returncode,
        "stdoutTail": completed.stdout.decode("utf-8", errors="replace")[-2000:],
        "stderrTail": completed.stderr.decode("utf-8", errors="replace")[-2000:],
    }


def run_drill(
    *,
    root: Path,
    env_file: Path,
    compose_file: Path,
    backup_dir: Path,
    service: str = DEFAULT_SERVICE,
    db_name: str = DEFAULT_DB,
    user: str = DEFAULT_USER,
    restore_database: str | None = None,
    dry_run: bool = False,
    timeout: int = 120,
) -> DrillResult:
    root = root.resolve()
    resolved_env = env_file if env_file.is_absolute() else root / env_file
    resolved_compose = compose_file if compose_file.is_absolute() else root / compose_file
    resolved_backup_dir = backup_dir if backup_dir.is_absolute() else root / backup_dir
    restore_db = restore_database or f"{db_name}_restore_drill_{timestamp()}"
    backup_file = resolved_backup_dir / f"{db_name}_backup_{timestamp()}.dump"
    steps = build_steps(
        env_file=resolved_env,
        compose_file=resolved_compose,
        service=service,
        db_name=db_name,
        user=user,
        backup_file=backup_file,
        restore_database=restore_db,
    )

    if dry_run:
        return DrillResult(
            ready=True,
            dry_run=True,
            backup_file=backup_file,
            restore_database=restore_db,
            steps=[{"name": step.name, "command": step.command, "shell": shell_join(step.command)} for step in steps],
        )

    if not resolved_env.is_file():
        raise FileNotFoundError(f"Env file does not exist: {resolved_env}")
    if not resolved_compose.is_file():
        raise FileNotFoundError(f"Compose file does not exist: {resolved_compose}")

    results: list[dict[str, Any]] = []
    backup_step = steps[0]
    backup_result = run_capture_to_file(backup_step.command, backup_file, cwd=root, timeout=timeout)
    results.append({"name": backup_step.name, **backup_result})
    if backup_result["exitCode"] != 0:
        return DrillResult(False, False, backup_file, restore_db, results)

    for step in steps[1:]:
        if step.name == "restore":
            result = run_with_input_file(step.command, backup_file, cwd=root, timeout=timeout)
        else:
            result = run_command(step.command, cwd=root, timeout=timeout)
        results.append({"name": step.name, **result})
        if result["exitCode"] != 0:
            return DrillResult(False, False, backup_file, restore_db, results)

    verify = next((step for step in results if step["name"] == "verify-restore"), {})
    ready = str(verify.get("stdoutTail", "")).strip().endswith("1")
    return DrillResult(ready, False, backup_file, restore_db, results)


def report_to_dict(result: DrillResult) -> dict[str, Any]:
    return {
        "ready": result.ready,
        "dryRun": result.dry_run,
        "backupFile": str(result.backup_file),
        "restoreDatabase": result.restore_database,
        "steps": result.steps,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a SmallKhoj Postgres backup/restore drill without printing secrets.")
    parser.add_argument("--root", default=".", help="Project/deployment root. Defaults to current directory.")
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE, help="Compose env file. Defaults to .env.prod.")
    parser.add_argument("--compose-file", default=DEFAULT_COMPOSE_FILE, help="Compose file. Defaults to docker-compose.prod.yml.")
    parser.add_argument("--backup-dir", default="./backups", help="Directory for dump files.")
    parser.add_argument("--service", default=DEFAULT_SERVICE, help="Postgres compose service name.")
    parser.add_argument("--db", default=DEFAULT_DB, help="Database name.")
    parser.add_argument("--user", default=DEFAULT_USER, help="Postgres user.")
    parser.add_argument("--restore-database", help="Temporary restore database name.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned commands without running them.")
    parser.add_argument("--timeout", type=int, default=120, help="Per-step timeout in seconds.")
    parser.add_argument("--json", action="store_true", help="Print JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run_drill(
            root=Path(args.root),
            env_file=Path(args.env_file),
            compose_file=Path(args.compose_file),
            backup_dir=Path(args.backup_dir),
            service=args.service,
            db_name=args.db,
            user=args.user,
            restore_database=args.restore_database,
            dry_run=args.dry_run,
            timeout=args.timeout,
        )
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(report_to_dict(result), ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(f"ready={str(result.ready).lower()} backupFile={result.backup_file} restoreDatabase={result.restore_database}")
        for step in result.steps:
            print(f"{step['name']}: {step.get('shell') or shell_join(step['command'])}")
    return 0 if result.ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
