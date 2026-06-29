#!/usr/bin/env python3
"""Collect no-secret remote deployment evidence over SSH."""

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


DEFAULT_REMOTE_DIR = "/opt/smallkhoj-deploy"
DEFAULT_PREFIX = "smallkhoj-deploy"
DEFAULT_OUTPUT = Path("/tmp/smallkhoj-remote-deploy-evidence.json")


@dataclass(frozen=True)
class CollectOptions:
    host: str
    user: str | None = None
    port: int | None = None
    identity_file: Path | None = None
    remote_dir: str = DEFAULT_REMOTE_DIR
    bundle_prefix: str = DEFAULT_PREFIX
    remote_env_file: str | None = None
    public_base_url: str | None = None
    allow_http: bool = False
    output: Path = DEFAULT_OUTPUT


@dataclass(frozen=True)
class PlanStep:
    label: str
    argv: list[str]
    remote: bool = False


@dataclass(frozen=True)
class CommandPlan:
    steps: list[PlanStep]


@dataclass(frozen=True)
class CommandResult:
    label: str
    command: str
    returncode: int
    stdout: str
    stderr: str


def remote_target(options: CollectOptions) -> str:
    return f"{options.user}@{options.host}" if options.user else options.host


def ssh_base(options: CollectOptions) -> list[str]:
    argv = ["ssh"]
    if options.identity_file:
        argv.extend(["-i", str(options.identity_file)])
    if options.port:
        argv.extend(["-p", str(options.port)])
    argv.append(remote_target(options))
    return argv


def shell_join(argv: list[str]) -> str:
    return " ".join(shlex.quote(item) for item in argv)


def remote_bundle_dir(options: CollectOptions) -> str:
    return f"{options.remote_dir.rstrip('/')}/{options.bundle_prefix}"


def remote_shell(options: CollectOptions, label: str, command: str) -> PlanStep:
    bundle_dir = shlex.quote(remote_bundle_dir(options))
    return PlanStep(label, [*ssh_base(options), f"cd {bundle_dir} && {command}"], remote=True)


def build_plan(options: CollectOptions) -> CommandPlan:
    steps: list[PlanStep] = [
        remote_shell(options, "host-probe", "python3 scripts/lighthouse_host_probe.py --json"),
        remote_shell(options, "repo-preflight", "python3 scripts/initial_release_deploy_preflight.py --json"),
    ]
    if options.remote_env_file:
        env_file = shlex.quote(options.remote_env_file)
        steps.append(remote_shell(
            options,
            "runtime-preflight",
            f"python3 scripts/initial_release_deploy_preflight.py --env-file {env_file} --runtime --json",
        ))

    compose_env = f"--env-file {shlex.quote(options.remote_env_file)} " if options.remote_env_file else ""
    compose = f"docker compose {compose_env}-f docker-compose.prod.yml"
    steps.extend([
        remote_shell(options, "compose-services", f"{compose} config --services"),
        remote_shell(options, "compose-ps", f"{compose} ps"),
        remote_shell(options, "compose-logs-core", f"{compose} logs --tail=160 db backend frontend caddy"),
        remote_shell(
            options,
            "docker-stats",
            "docker stats --no-stream --format 'table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.MemPerc}}\\t{{.NetIO}}\\t{{.BlockIO}}'",
        ),
        remote_shell(options, "docker-ps", "docker ps -a --format '{{json .}}'"),
        remote_shell(options, "docker-system-df", "docker system df"),
        remote_shell(options, "memory-snapshot", "free -h || vm_stat || true"),
        remote_shell(options, "disk-snapshot", "df -h . / || df -h"),
        remote_shell(
            options,
            "top-memory-processes",
            "ps -eo pid,ppid,pcpu,pmem,rss,comm,args --sort=-rss | head -20",
        ),
    ])

    if options.public_base_url:
        smoke = [
            "python3",
            "scripts/post_deploy_smoke.py",
            "--base-url",
            options.public_base_url,
            "--json",
        ]
        if options.allow_http:
            smoke.append("--allow-http")
        steps.append(PlanStep("public-smoke", smoke))

    return CommandPlan(steps=steps)


def run_plan(plan: CommandPlan) -> list[CommandResult]:
    results: list[CommandResult] = []
    for step in plan.steps:
        command = shell_join(step.argv)
        print(f"[{step.label}] {command}", flush=True)
        completed = subprocess.run(step.argv, check=False, capture_output=True, text=True)
        results.append(CommandResult(
            label=step.label,
            command=command,
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        ))
    return results


def results_to_payload(results: list[CommandResult]) -> dict[str, Any]:
    return {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
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


def plan_to_payload(plan: CommandPlan) -> dict[str, Any]:
    return {
        "steps": [
            {
                "label": step.label,
                "command": shell_join(step.argv),
                "argv": step.argv,
                "remote": step.remote,
            }
            for step in plan.steps
        ],
    }


def write_payload(output: Path, payload: dict[str, Any]) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return output


def exit_code_for(results: list[CommandResult]) -> int:
    return 0 if all(result.returncode == 0 for result in results) else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect no-secret SmallKhoj remote deployment evidence over SSH.")
    parser.add_argument("--host", required=True, help="SSH host or IP address.")
    parser.add_argument("--user", help="SSH username. If omitted, SSH default user resolution is used.")
    parser.add_argument("--port", type=int, help="SSH port.")
    parser.add_argument("--identity-file", type=Path, help="SSH private key path.")
    parser.add_argument("--remote-dir", default=DEFAULT_REMOTE_DIR, help=f"Remote parent directory. Default: {DEFAULT_REMOTE_DIR}")
    parser.add_argument("--bundle-prefix", default=DEFAULT_PREFIX, help=f"Unpacked bundle directory name. Default: {DEFAULT_PREFIX}")
    parser.add_argument("--remote-env-file", help="Remote env file path relative to the unpacked bundle directory for runtime preflight.")
    parser.add_argument("--public-base-url", help="Run local public post-deploy smoke and capture its output.")
    parser.add_argument("--allow-http", action="store_true", help="Pass --allow-http to local post-deploy smoke.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help=f"Local JSON evidence output path. Default: {DEFAULT_OUTPUT}")
    parser.add_argument("--dry-run", action="store_true", help="Print the evidence command plan without executing it.")
    parser.add_argument("--json", action="store_true", help="Print the command plan as JSON. Implies dry-run.")
    return parser


def options_from_args(args: argparse.Namespace) -> CollectOptions:
    return CollectOptions(
        host=args.host,
        user=args.user,
        port=args.port,
        identity_file=args.identity_file,
        remote_dir=args.remote_dir,
        bundle_prefix=args.bundle_prefix,
        remote_env_file=args.remote_env_file,
        public_base_url=args.public_base_url,
        allow_http=args.allow_http,
        output=args.output,
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    plan = build_plan(options_from_args(args))
    if args.json:
        print(json.dumps(plan_to_payload(plan), ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    if args.dry_run:
        for step in plan.steps:
            print(f"[{step.label}] {shell_join(step.argv)}")
        return 0

    results = run_plan(plan)
    output = write_payload(args.output, results_to_payload(results))
    print(f"Wrote evidence: {output}")
    return exit_code_for(results)


if __name__ == "__main__":
    raise SystemExit(main())
