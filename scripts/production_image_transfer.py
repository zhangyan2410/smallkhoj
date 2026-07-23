#!/usr/bin/env python3
"""Build, archive, upload, and load production images for first-release hosts."""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_BACKEND_IMAGE = "smallkhoj-backend:local-release"
DEFAULT_FRONTEND_IMAGE = "smallkhoj-frontend:local-release"
DEFAULT_CADDY_IMAGE = "smallkhoj-caddy:local-release"
DEFAULT_OUTPUT_ARCHIVE = Path("/tmp/smallkhoj-production-images.tar")
DEFAULT_REMOTE_DIR = "/opt/smallkhoj-deploy"
DEFAULT_PROXY_URL = "http://host.docker.internal:7897"


@dataclass(frozen=True)
class TransferOptions:
    host: str
    user: str | None = None
    port: int | None = None
    identity_file: Path | None = None
    remote_dir: str = DEFAULT_REMOTE_DIR
    output_archive: Path = DEFAULT_OUTPUT_ARCHIVE
    backend_image: str = DEFAULT_BACKEND_IMAGE
    frontend_image: str = DEFAULT_FRONTEND_IMAGE
    caddy_image: str = DEFAULT_CADDY_IMAGE
    skip_build: bool = False
    platform: str | None = None
    use_vpn_proxy: bool = False
    proxy_url: str = DEFAULT_PROXY_URL
    next_public_api_base_url: str = ""
    next_public_ws_base_url: str = ""


@dataclass(frozen=True)
class PlanStep:
    label: str
    argv: list[str]
    remote: bool = False


@dataclass(frozen=True)
class CommandPlan:
    steps: list[PlanStep]


def remote_target(options: TransferOptions) -> str:
    return f"{options.user}@{options.host}" if options.user else options.host


def ssh_base(options: TransferOptions) -> list[str]:
    argv = ["ssh"]
    if options.identity_file:
        argv.extend(["-i", str(options.identity_file)])
    if options.port:
        argv.extend(["-p", str(options.port)])
    argv.append(remote_target(options))
    return argv


def scp_base(options: TransferOptions) -> list[str]:
    argv = ["scp"]
    if options.identity_file:
        argv.extend(["-i", str(options.identity_file)])
    if options.port:
        argv.extend(["-P", str(options.port)])
    return argv


def shell_join(argv: list[str]) -> str:
    return " ".join(shlex.quote(item) for item in argv)


def build_proxy_args(options: TransferOptions) -> list[str]:
    if not options.use_vpn_proxy:
        return []
    args: list[str] = []
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        args.extend(["--build-arg", f"{key}={options.proxy_url}"])
    return args


def build_platform_args(options: TransferOptions) -> list[str]:
    return ["--platform", options.platform] if options.platform else []


def remote_shell(options: TransferOptions, command: str) -> list[str]:
    return [*ssh_base(options), command]


def build_steps(options: TransferOptions) -> list[PlanStep]:
    if options.skip_build:
        return []

    proxy_args = build_proxy_args(options)
    platform_args = build_platform_args(options)
    return [
        PlanStep("build-backend-image", [
            "docker",
            "build",
            *platform_args,
            *proxy_args,
            "-f",
            "backend/Dockerfile",
            "-t",
            options.backend_image,
            ".",
        ]),
        PlanStep("build-frontend-image", [
            "docker",
            "build",
            *platform_args,
            *proxy_args,
            "--build-arg",
            f"NEXT_PUBLIC_API_BASE_URL={options.next_public_api_base_url}",
            "--build-arg",
            f"NEXT_PUBLIC_WS_BASE_URL={options.next_public_ws_base_url}",
            "--build-arg",
            "NEXT_PUBLIC_DEPLOYMENT_ENV=production",
            "--secret",
            "id=public_api_key,env=PUBLIC_API_KEY",
            "-t",
            options.frontend_image,
            "./frontend",
        ]),
        PlanStep("build-caddy-image", [
            "docker",
            "build",
            *platform_args,
            *proxy_args,
            "-t",
            options.caddy_image,
            "./deploy/caddy",
        ]),
    ]


def build_plan(options: TransferOptions) -> CommandPlan:
    remote_dir = options.remote_dir.rstrip("/")
    archive_name = options.output_archive.name
    remote_archive = f"{remote_dir}/{archive_name}"
    image_tags = [options.backend_image, options.frontend_image, options.caddy_image]

    steps: list[PlanStep] = [
        *build_steps(options),
        PlanStep("save-image-archive", [
            "docker",
            "save",
            "-o",
            str(options.output_archive),
            *image_tags,
        ]),
        PlanStep("prepare-remote-dir", remote_shell(options, f"mkdir -p {shlex.quote(remote_dir)}"), remote=True),
        PlanStep("upload-image-archive", [
            *scp_base(options),
            str(options.output_archive),
            f"{remote_target(options)}:{remote_dir}/",
        ]),
        PlanStep("load-image-archive", remote_shell(
            options,
            f"docker load -i {shlex.quote(remote_archive)}",
        ), remote=True),
    ]
    return CommandPlan(steps=steps)


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


def run_plan(plan: CommandPlan) -> int:
    for step in plan.steps:
        print(f"[{step.label}] {shell_join(step.argv)}", flush=True)
        completed = subprocess.run(step.argv, check=False)
        if completed.returncode != 0:
            return completed.returncode
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build, archive, upload, and docker-load SmallKhoj production images over SSH.")
    parser.add_argument("--host", required=True, help="SSH host or IP address.")
    parser.add_argument("--user", help="SSH username. If omitted, SSH default user resolution is used.")
    parser.add_argument("--port", type=int, help="SSH port.")
    parser.add_argument("--identity-file", type=Path, help="SSH private key path.")
    parser.add_argument("--remote-dir", default=DEFAULT_REMOTE_DIR, help=f"Remote directory for the image archive. Default: {DEFAULT_REMOTE_DIR}")
    parser.add_argument("--output-archive", type=Path, default=DEFAULT_OUTPUT_ARCHIVE, help=f"Local docker save archive. Default: {DEFAULT_OUTPUT_ARCHIVE}")
    parser.add_argument("--backend-image", default=DEFAULT_BACKEND_IMAGE, help=f"Backend image tag. Default: {DEFAULT_BACKEND_IMAGE}")
    parser.add_argument("--frontend-image", default=DEFAULT_FRONTEND_IMAGE, help=f"Frontend image tag. Default: {DEFAULT_FRONTEND_IMAGE}")
    parser.add_argument("--caddy-image", default=DEFAULT_CADDY_IMAGE, help=f"Caddy image tag. Default: {DEFAULT_CADDY_IMAGE}")
    parser.add_argument("--skip-build", action="store_true", help="Skip docker build and only save/upload/load existing local images.")
    parser.add_argument("--platform", help="Docker build target platform, for example linux/amd64 or linux/arm64. Omit to use the local Docker default.")
    parser.add_argument("--use-vpn-proxy", action="store_true", help=f"Add Docker build proxy args for the local VPN proxy. Default proxy: {DEFAULT_PROXY_URL}")
    parser.add_argument("--proxy-url", default=DEFAULT_PROXY_URL, help=f"Docker build-container proxy URL. Default: {DEFAULT_PROXY_URL}")
    parser.add_argument("--next-public-api-base-url", default="", help="Frontend NEXT_PUBLIC_API_BASE_URL build arg. Default: empty same-origin mode.")
    parser.add_argument("--next-public-ws-base-url", default="", help="Frontend NEXT_PUBLIC_WS_BASE_URL build arg. Default: empty same-origin mode.")
    parser.add_argument("--dry-run", action="store_true", help="Print the command plan without executing it.")
    parser.add_argument("--json", action="store_true", help="Print the command plan as JSON. Implies dry-run.")
    return parser


def options_from_args(args: argparse.Namespace) -> TransferOptions:
    return TransferOptions(
        host=args.host,
        user=args.user,
        port=args.port,
        identity_file=args.identity_file,
        remote_dir=args.remote_dir,
        output_archive=args.output_archive,
        backend_image=args.backend_image,
        frontend_image=args.frontend_image,
        caddy_image=args.caddy_image,
        skip_build=args.skip_build,
        platform=args.platform,
        use_vpn_proxy=args.use_vpn_proxy,
        proxy_url=args.proxy_url,
        next_public_api_base_url=args.next_public_api_base_url,
        next_public_ws_base_url=args.next_public_ws_base_url,
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
    return run_plan(plan)


if __name__ == "__main__":
    raise SystemExit(main())
