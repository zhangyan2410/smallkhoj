"""CLI entrypoint for initial-release live-run readiness checks."""

import argparse
import asyncio
import json

from models import async_session
from services.live_run_preflight import (
    LiveRunPreflightRequest,
    run_initial_release_preflight,
    serialize_preflight_report,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run no-network readiness checks for the initial release live-run.")
    parser.add_argument("--feishu-chat-id", required=True)
    parser.add_argument("--feishu-chat-type", default="group", choices=("group", "p2p"))
    parser.add_argument("--command", default="jira_analysis")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print readiness JSON.")
    return parser


async def run(args: argparse.Namespace) -> dict:
    async with async_session() as db:
        report = await run_initial_release_preflight(
            db,
            LiveRunPreflightRequest(
                feishu_chat_id=args.feishu_chat_id,
                feishu_chat_type=args.feishu_chat_type,
                command=args.command,
            ),
        )
        return serialize_preflight_report(report)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        payload = asyncio.run(run(args))
    except Exception as exc:
        print(json.dumps({"ready": False, "error": str(exc)}, ensure_ascii=False, sort_keys=True))
        return 1
    print(json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=True))
    return 0 if payload.get("ready") is True else 2


if __name__ == "__main__":
    raise SystemExit(main())
