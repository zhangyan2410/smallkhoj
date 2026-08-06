#!/usr/bin/env python3
"""Create a no-secret .env.prod template for initial-release deployment."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


TEMPLATE = """# SmallKhoj initial-release production env
# Fill this file on the deployment host. Do not commit it.

# Public entrypoint. Use a real domain for HTTPS, or :80 for IP-only HTTP smoke.
SMALLKHOJ_SITE_ADDRESS=<domain-or-ip-site-address>

# Prebuilt backend/frontend images. Build these off-host or in CI.
SMALLKHOJ_BACKEND_IMAGE=<registry>/smallkhoj-backend:<tag>
SMALLKHOJ_FRONTEND_IMAGE=<registry>/smallkhoj-frontend:<tag>

# Caddy is built from deploy/caddy by default. Override only when using a pushed Caddy image.
SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:latest

# Required database and browser origin values.
POSTGRES_USER=smallkhoj
POSTGRES_DB=smallkhoj
POSTGRES_PASSWORD=<set-outside-repo>
DATABASE_POOL_SIZE=5
DATABASE_MAX_OVERFLOW=10
BETTER_AUTH_DATABASE_POOL_SIZE=10
BACKEND_WORKERS=1
POSTGRES_MAX_CONNECTIONS=100
POSTGRES_CONNECTION_HEADROOM=5
NOTIFY_PUBLISHER_POOL_SIZE=2
NOTIFY_CONNECT_TIMEOUT_SECONDS=3
NOTIFY_OPERATION_TIMEOUT_SECONDS=3
NOTIFY_RECONNECT_INITIAL_SECONDS=0.25
NOTIFY_RECONNECT_MAX_SECONDS=5
NOTIFY_SHUTDOWN_TIMEOUT_SECONDS=5
NOTIFY_PUBLISH_ATTEMPTS=2
BACKEND_CORS_ORIGINS=<public-origin>

# Required browser auth values. BETTER_AUTH_URL should match the public frontend origin.
PUBLIC_API_KEY=<set-outside-repo>
BETTER_AUTH_SECRET=<set-outside-repo>
BETTER_AUTH_URL=<public-origin>
AUTH_BRIDGE_SECRET=<set-outside-repo>

# Daemon compatibility policy and the exact published artifact advertised by
# onboarding/reconnect. DAEMON_RELEASE_VERSION is intentionally explicit;
# never rely on a historical Compose default or silently follow a source bump.
MINIMUM_DAEMON_VERSION=<compatibility-floor>
DAEMON_RELEASE_VERSION=<published-package-version>
DAEMON_DOWNLOAD_BASE_URL=https://<public-host>/downloads/smallkhoj-daemon

# Same-origin frontend defaults. Leave empty unless the browser must call another public host.
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_WS_BASE_URL=

# Optional LLM/runtime values.
LLM_API_KEY=<optional-set-outside-repo>
LLM_API_BASE=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini

# Optional Jira REST values.
JIRA_EMAIL=<optional-set-outside-repo>
JIRA_API_TOKEN=<optional-set-outside-repo>

# Optional Feishu reply and long-connection worker values.
FEISHU_REPLY_BASE_URL=https://open.feishu.cn
FEISHU_REPLY_ACCESS_TOKEN=<optional-set-outside-repo>
FEISHU_WORKER_CONNECTOR_ID=<bootstrap-output>
FEISHU_WORKER_JIRA_CONNECTOR_ID=<bootstrap-output>
FEISHU_WORKER_CREATOR_ID=<bootstrap-output>
FEISHU_WORKER_BOT_OPEN_ID=<bot-open-id>
FEISHU_WORKER_BOT_NAME=SmallKhoj
FEISHU_WORKER_APP_ID=<app-id>
FEISHU_WORKER_APP_SECRET=<optional-set-outside-repo>
"""


def render_template() -> str:
    return TEMPLATE


def write_template(output: Path, *, force: bool = False) -> Path:
    if output.exists() and not force:
        raise FileExistsError(f"Refusing to overwrite existing file: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render_template(), encoding="utf-8")
    return output


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create a no-secret SmallKhoj .env.prod template.")
    parser.add_argument("--output", type=Path, help="Output path. Omit to print the template to stdout.")
    parser.add_argument("--force", action="store_true", help="Overwrite --output if it already exists.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.output:
        try:
            output = write_template(args.output, force=args.force)
        except FileExistsError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        print(str(output))
        return 0
    print(render_template(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
