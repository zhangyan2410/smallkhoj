#!/usr/bin/env python3
"""Guarded release-worker rollout over SSH without putting secrets in argv."""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_HOST = "124.222.40.40"
DEFAULT_USER = "ubuntu"
DEFAULT_REMOTE_DIR = "/home/ubuntu/smallkhoj-deploy"
DEFAULT_BUNDLE_PREFIX = "smallkhoj-deploy"
DEFAULT_REMOTE_ENV_FILE = ".env.prod"
DEFAULT_LOCAL_ENV_FILE = Path("/Volumes/ORICO/smallkhoj-secrets/release-worker.env")
DEFAULT_FEISHU_CHAT_TYPE = "group"
DEFAULT_COMMAND = "jira_analysis"


@dataclass(frozen=True)
class RolloutOptions:
    host: str = DEFAULT_HOST
    user: str | None = DEFAULT_USER
    port: int | None = None
    identity_file: Path | None = None
    remote_dir: str = DEFAULT_REMOTE_DIR
    bundle_prefix: str = DEFAULT_BUNDLE_PREFIX
    remote_env_file: str = DEFAULT_REMOTE_ENV_FILE
    local_env_file: Path = DEFAULT_LOCAL_ENV_FILE
    feishu_chat_id: str = ""
    feishu_chat_type: str = DEFAULT_FEISHU_CHAT_TYPE
    command: str = DEFAULT_COMMAND
    apply: bool = False
    start_worker: bool = False


@dataclass(frozen=True)
class PlanStep:
    label: str
    argv: list[str]
    display_command: str
    stdin_file: Path | None = None
    remote: bool = False


@dataclass(frozen=True)
class CommandResult:
    label: str
    command: str
    returncode: int
    stdout: str
    stderr: str


@dataclass(frozen=True)
class RolloutPlan:
    steps: list[PlanStep]


def shell_join(argv: list[str]) -> str:
    return " ".join(shlex.quote(item) for item in argv)


def remote_target(options: RolloutOptions) -> str:
    return f"{options.user}@{options.host}" if options.user else options.host


def ssh_base(options: RolloutOptions) -> list[str]:
    argv = ["ssh"]
    if options.identity_file:
        argv.extend(["-i", str(options.identity_file)])
    if options.port:
        argv.extend(["-p", str(options.port)])
    argv.append(remote_target(options))
    return argv


def remote_bundle_dir(options: RolloutOptions) -> str:
    return f"{options.remote_dir.rstrip('/')}/{options.bundle_prefix}"


def remote_shell(options: RolloutOptions, label: str, command: str) -> PlanStep:
    bundle_dir = shlex.quote(remote_bundle_dir(options))
    argv = [*ssh_base(options), f"cd {bundle_dir} && {command}"]
    return PlanStep(label=label, argv=argv, display_command=shell_join(argv), remote=True)


def build_plan(options: RolloutOptions) -> RolloutPlan:
    env_file = str(options.local_env_file)
    steps = [
        PlanStep(
            label="validate-release-worker-env",
            argv=["python3", "scripts/validate_release_worker_env.py", "--json", env_file],
            display_command=shell_join(["python3", "scripts/validate_release_worker_env.py", "--json", env_file]),
        )
    ]

    updater_command = (
        f"python3 scripts/update_prod_env_from_stdin.py --env-file {shlex.quote(options.remote_env_file)} --json"
    )
    apply_argv = [*ssh_base(options), f"cd {shlex.quote(remote_bundle_dir(options))} && {updater_command}"]
    steps.append(PlanStep(
        label="apply-release-worker-env",
        argv=apply_argv,
        display_command=f"{shell_join(apply_argv)} < {env_file}",
        stdin_file=options.local_env_file,
        remote=True,
    ))

    compose = f"docker compose --env-file {shlex.quote(options.remote_env_file)} -f docker-compose.prod.yml"
    steps.append(remote_shell(
        options,
        "restart-backend",
        f"{compose} up -d --no-deps --force-recreate backend",
    ))

    live_preflight = (
        f"{compose} exec -T backend uv run python -m live_run_preflight_cli "
        f"--feishu-chat-id {shlex.quote(options.feishu_chat_id)} "
        f"--feishu-chat-type {shlex.quote(options.feishu_chat_type)} "
        f"--command {shlex.quote(options.command)} "
        "--pretty"
    )
    steps.append(remote_shell(options, "live-run-preflight", live_preflight))

    if options.start_worker:
        steps.append(remote_shell(
            options,
            "start-feishu-worker",
            f"{compose} --profile feishu-worker up -d feishu-worker",
        ))

    return RolloutPlan(steps=steps)


def plan_to_payload(plan: RolloutPlan) -> dict[str, Any]:
    return {
        "steps": [
            {
                "label": step.label,
                "command": step.display_command,
                "remote": step.remote,
                "usesStdinFile": step.stdin_file is not None,
            }
            for step in plan.steps
        ],
    }


def run_step(step: PlanStep) -> CommandResult:
    stdin_handle = None
    try:
        if step.stdin_file is not None:
            stdin_handle = step.stdin_file.open("rb")
        completed = subprocess.run(
            step.argv,
            check=False,
            capture_output=True,
            text=True,
            stdin=stdin_handle,
        )
        return CommandResult(
            label=step.label,
            command=step.display_command,
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )
    finally:
        if stdin_handle is not None:
            stdin_handle.close()


def execute_plan(plan: RolloutPlan, *, apply: bool) -> list[CommandResult]:
    results: list[CommandResult] = []
    for index, step in enumerate(plan.steps):
        if not apply and index > 0:
            break
        result = run_step(step)
        results.append(result)
        if result.returncode != 0:
            break
    return results


def results_to_payload(results: list[CommandResult]) -> dict[str, Any]:
    return {
        "results": [
            {
                "label": result.label,
                "command": result.command,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            for result in results
        ],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Guarded initial-release Feishu worker rollout.")
    parser.add_argument("--host", default=DEFAULT_HOST, help="SSH host or IP address.")
    parser.add_argument("--user", default=DEFAULT_USER, help="SSH username.")
    parser.add_argument("--port", type=int, help="SSH port.")
    parser.add_argument("--identity-file", type=Path, help="SSH private key path.")
    parser.add_argument("--remote-dir", default=DEFAULT_REMOTE_DIR, help="Remote deployment parent directory.")
    parser.add_argument("--bundle-prefix", default=DEFAULT_BUNDLE_PREFIX, help="Remote deployment bundle directory.")
    parser.add_argument("--remote-env-file", default=DEFAULT_REMOTE_ENV_FILE, help="Remote production env file.")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_LOCAL_ENV_FILE, help="Local repo-external release-worker env file.")
    parser.add_argument("--feishu-chat-id", required=True, help="Feishu chat id to validate with live-run preflight.")
    parser.add_argument("--feishu-chat-type", default=DEFAULT_FEISHU_CHAT_TYPE, help="Feishu chat type.")
    parser.add_argument("--command", default=DEFAULT_COMMAND, help="Live-run command shape to validate.")
    parser.add_argument("--apply", action="store_true", help="Apply env, restart backend, and run preflight. Without this, print the plan.")
    parser.add_argument("--start-worker", action="store_true", help="Start feishu-worker after live-run preflight succeeds.")
    parser.add_argument("--dry-run", action="store_true", help="Print the command plan without executing mutations.")
    parser.add_argument("--json", action="store_true", help="Print JSON output.")
    return parser


def options_from_args(args: argparse.Namespace) -> RolloutOptions:
    return RolloutOptions(
        host=args.host,
        user=args.user,
        port=args.port,
        identity_file=args.identity_file,
        remote_dir=args.remote_dir,
        bundle_prefix=args.bundle_prefix,
        remote_env_file=args.remote_env_file,
        local_env_file=args.env_file,
        feishu_chat_id=args.feishu_chat_id,
        feishu_chat_type=args.feishu_chat_type,
        command=args.command,
        apply=args.apply,
        start_worker=args.start_worker,
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.start_worker and not args.apply:
        print("--start-worker requires --apply so preflight can gate worker startup.", file=sys.stderr)
        return 2

    plan = build_plan(options_from_args(args))
    if args.dry_run or not args.apply:
        payload = plan_to_payload(plan)
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        else:
            for step in plan.steps:
                print(f"[{step.label}] {step.display_command}")
        return 0

    results = execute_plan(plan, apply=True)
    payload = results_to_payload(results)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        for result in results:
            print(f"[{result.label}] exit={result.returncode}")
            if result.stdout:
                print(result.stdout, end="")
            if result.stderr:
                print(result.stderr, end="", file=sys.stderr)
    return 0 if results and all(result.returncode == 0 for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
