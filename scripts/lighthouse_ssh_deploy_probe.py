#!/usr/bin/env python3
"""SSH runner for no-secret initial-release Lighthouse deployment probes."""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_BUNDLE = Path("/tmp/smallkhoj-deploy-bundle.tar.gz")
DEFAULT_REMOTE_DIR = "/opt/smallkhoj-deploy"
DEFAULT_PREFIX = "smallkhoj-deploy"


@dataclass(frozen=True)
class RunOptions:
    host: str
    user: str | None = None
    port: int | None = None
    identity_file: Path | None = None
    remote_dir: str = DEFAULT_REMOTE_DIR
    local_bundle: Path = DEFAULT_BUNDLE
    bundle_prefix: str = DEFAULT_PREFIX
    remote_env_file: str | None = None
    runtime_preflight: bool = False
    compose_up: bool = False
    use_loaded_images: bool = False
    public_base_url: str | None = None
    allow_http: bool = False


@dataclass(frozen=True)
class PlanStep:
    label: str
    argv: list[str]
    remote: bool = False


@dataclass(frozen=True)
class CommandPlan:
    steps: list[PlanStep]


def remote_target(options: RunOptions) -> str:
    return f"{options.user}@{options.host}" if options.user else options.host


def ssh_base(options: RunOptions) -> list[str]:
    argv = ["ssh"]
    if options.identity_file:
        argv.extend(["-i", str(options.identity_file)])
    if options.port:
        argv.extend(["-p", str(options.port)])
    argv.append(remote_target(options))
    return argv


def scp_base(options: RunOptions) -> list[str]:
    argv = ["scp"]
    if options.identity_file:
        argv.extend(["-i", str(options.identity_file)])
    if options.port:
        argv.extend(["-P", str(options.port)])
    return argv


def remote_shell(options: RunOptions, command: str) -> list[str]:
    return [*ssh_base(options), command]


def shell_join(argv: list[str]) -> str:
    return " ".join(shlex.quote(item) for item in argv)


def remote_command_for_bundle(options: RunOptions, command: str) -> str:
    deploy_dir = f"{options.remote_dir.rstrip('/')}/{options.bundle_prefix}"
    return f"cd {shlex.quote(deploy_dir)} && {command}"


def build_plan(options: RunOptions) -> CommandPlan:
    if options.compose_up and not options.remote_env_file:
        raise ValueError("--compose-up requires --remote-env-file")
    if options.runtime_preflight and not options.remote_env_file:
        raise ValueError("--runtime-preflight requires --remote-env-file")

    remote_dir = options.remote_dir.rstrip("/")
    remote_bundle = f"{remote_dir}/{options.local_bundle.name}"
    steps: list[PlanStep] = [
        PlanStep("create-bundle", [
            "python3",
            "scripts/make_deployment_bundle.py",
            "--output",
            str(options.local_bundle),
            "--prefix",
            options.bundle_prefix,
        ]),
        PlanStep("prepare-remote-dir", remote_shell(options, f"mkdir -p {shlex.quote(remote_dir)}"), remote=True),
        PlanStep("upload-bundle", [
            *scp_base(options),
            str(options.local_bundle),
            f"{remote_target(options)}:{remote_dir}/",
        ]),
        PlanStep("unpack-bundle", remote_shell(
            options,
            f"cd {shlex.quote(remote_dir)} && tar -xzf {shlex.quote(Path(remote_bundle).name)}",
        ), remote=True),
        PlanStep("host-probe", remote_shell(
            options,
            remote_command_for_bundle(options, "python3 scripts/lighthouse_host_probe.py --json"),
        ), remote=True),
    ]

    preflight_command = "python3 scripts/initial_release_deploy_preflight.py"
    if options.remote_env_file:
        preflight_command += f" --env-file {shlex.quote(options.remote_env_file)}"
    if options.runtime_preflight:
        preflight_command += " --runtime"
    preflight_command += " --json"
    steps.append(PlanStep("repo-preflight", remote_shell(
        options,
        remote_command_for_bundle(options, preflight_command),
    ), remote=True))

    if options.compose_up:
        env_file = shlex.quote(options.remote_env_file or "")
        compose = f"docker compose --env-file {env_file} -f docker-compose.prod.yml"
        if options.use_loaded_images:
            commands = [
                f"{compose} pull db",
                f"{compose} up -d db backend frontend caddy",
            ]
        else:
            commands = [
                f"{compose} pull db backend frontend",
                f"{compose} build caddy",
                f"{compose} up -d db backend frontend caddy",
            ]
        steps.append(PlanStep("compose-up", remote_shell(
            options,
            remote_command_for_bundle(options, " && ".join(commands)),
        ), remote=True))

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


def plan_to_dict(plan: CommandPlan) -> dict[str, Any]:
    return {
        "steps": [
            {
                "label": step.label,
                "argv": step.argv,
                "command": shell_join(step.argv),
                "remote": step.remote,
            }
            for step in plan.steps
        ],
    }


def run_plan(plan: CommandPlan) -> int:
    for step in plan.steps:
        print(f"[{step.label}] {shell_join(step.argv)}", flush=True)
        completed = subprocess.run(step.argv, check=False)
        if completed.returncode != 0:
            return completed.returncode
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Upload the no-secret SmallKhoj deployment bundle and run remote Lighthouse probes over SSH.")
    parser.add_argument("--host", required=True, help="SSH host or IP address.")
    parser.add_argument("--user", help="SSH username. If omitted, SSH default user resolution is used.")
    parser.add_argument("--port", type=int, help="SSH port.")
    parser.add_argument("--identity-file", type=Path, help="SSH private key path.")
    parser.add_argument("--remote-dir", default=DEFAULT_REMOTE_DIR, help=f"Remote parent directory. Default: {DEFAULT_REMOTE_DIR}")
    parser.add_argument("--local-bundle", type=Path, default=DEFAULT_BUNDLE, help=f"Local bundle output path. Default: {DEFAULT_BUNDLE}")
    parser.add_argument("--bundle-prefix", default=DEFAULT_PREFIX, help=f"Top-level directory inside the bundle. Default: {DEFAULT_PREFIX}")
    parser.add_argument("--remote-env-file", help="Remote env file path relative to the unpacked bundle directory, for env/runtime preflight or compose startup.")
    parser.add_argument("--runtime-preflight", action="store_true", help="Run remote deploy preflight with --runtime. Requires --remote-env-file.")
    parser.add_argument("--compose-up", action="store_true", help="Pull/build/start db/backend/frontend/caddy remotely. Requires --remote-env-file.")
    parser.add_argument("--use-loaded-images", action="store_true", help="When using --compose-up, assume backend/frontend/caddy images were loaded on the host and only pull db.")
    parser.add_argument("--public-base-url", help="Run local post-deploy smoke against this public base URL after remote steps.")
    parser.add_argument("--allow-http", action="store_true", help="Pass --allow-http to local post-deploy smoke.")
    parser.add_argument("--dry-run", action="store_true", help="Print the command plan without executing it.")
    parser.add_argument("--json", action="store_true", help="Print the command plan as JSON. Implies dry-run.")
    return parser


def options_from_args(args: argparse.Namespace) -> RunOptions:
    return RunOptions(
        host=args.host,
        user=args.user,
        port=args.port,
        identity_file=args.identity_file,
        remote_dir=args.remote_dir,
        local_bundle=args.local_bundle,
        bundle_prefix=args.bundle_prefix,
        remote_env_file=args.remote_env_file,
        runtime_preflight=args.runtime_preflight,
        compose_up=args.compose_up,
        use_loaded_images=args.use_loaded_images,
        public_base_url=args.public_base_url,
        allow_http=args.allow_http,
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        plan = build_plan(options_from_args(args))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(plan_to_dict(plan), ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    if args.dry_run:
        for step in plan.steps:
            print(f"[{step.label}] {shell_join(step.argv)}")
        return 0
    return run_plan(plan)


if __name__ == "__main__":
    raise SystemExit(main())
