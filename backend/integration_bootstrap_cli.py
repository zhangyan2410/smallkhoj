"""CLI entrypoint for initial-release integration bootstrap."""

import argparse
import asyncio
import json
import uuid

from models import async_session
from services.integration_bootstrap import (
    BootstrapError,
    IntegrationBootstrapRequest,
    bootstrap_initial_release_integrations,
    serialize_bootstrap_result,
)


def _uuid_arg(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"{value!r} is not a valid UUID") from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bootstrap Feishu/Jira records for the initial release live-run.")
    parser.add_argument("--server-id", required=True, type=_uuid_arg)
    parser.add_argument("--channel-id", required=True, type=_uuid_arg)
    parser.add_argument("--creator-id", required=True, type=_uuid_arg)
    parser.add_argument("--assignee-id", required=True, type=_uuid_arg)
    parser.add_argument("--feishu-chat-id", required=True)
    parser.add_argument("--feishu-chat-type", default="group", choices=("group", "p2p"))
    parser.add_argument("--feishu-app-id", required=True)
    parser.add_argument("--feishu-bot-open-id", default="")
    parser.add_argument("--feishu-bot-name", default="SmallKhoj")
    parser.add_argument("--jira-site-url", required=True)
    parser.add_argument("--feishu-connector-name", default="Initial release Feishu")
    parser.add_argument("--jira-connector-name", default="Initial release Jira")
    parser.add_argument("--feishu-route-name", default="Feishu Jira analysis")
    return parser


def _request_from_args(args: argparse.Namespace) -> IntegrationBootstrapRequest:
    return IntegrationBootstrapRequest(
        server_id=args.server_id,
        channel_id=args.channel_id,
        creator_id=args.creator_id,
        assignee_id=args.assignee_id,
        feishu_chat_id=args.feishu_chat_id,
        feishu_chat_type=args.feishu_chat_type,
        feishu_app_id=args.feishu_app_id,
        feishu_bot_open_id=args.feishu_bot_open_id,
        feishu_bot_name=args.feishu_bot_name,
        jira_site_url=args.jira_site_url,
        feishu_connector_name=args.feishu_connector_name,
        jira_connector_name=args.jira_connector_name,
        feishu_route_name=args.feishu_route_name,
    )


async def run(args: argparse.Namespace) -> dict:
    async with async_session() as db:
        try:
            result = await bootstrap_initial_release_integrations(db, _request_from_args(args))
            await db.commit()
            return serialize_bootstrap_result(result)
        except Exception:
            await db.rollback()
            raise


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        payload = asyncio.run(run(args))
    except BootstrapError as exc:
        parser.exit(2, json.dumps({"status": "failed", "code": exc.code, "reason": exc.reason}) + "\n")
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
