"""CLI entrypoint for the Feishu Channel SDK worker process."""

import argparse
import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any

from models import async_session
from services.feishu_channel_transport import run_feishu_channel_worker

FEISHU_WORKER_CLI_FAILED = "FEISHU_WORKER_CLI_FAILED"
FEISHU_WORKER_CLI_DISCONNECT_FAILED = "FEISHU_WORKER_CLI_DISCONNECT_FAILED"

Emit = Callable[[str], None]
Waiter = Callable[[], Awaitable[None]]
WorkerRunner = Callable[..., Awaitable[Any]]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Feishu long-connection worker from runtime env.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print startup JSON.")
    return parser


def _json_payload(*, status: str, reason_code: str, reason: str, pretty: bool = False) -> str:
    payload = {
        "status": status,
        "reasonCode": reason_code,
        "reason": reason,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2 if pretty else None, sort_keys=True)


async def _wait_forever() -> None:
    await asyncio.Event().wait()


async def _disconnect_transport(transport: Any) -> None:
    disconnect = getattr(transport, "disconnect", None)
    if disconnect is not None:
        await disconnect()


async def run_worker_process(
    *,
    worker_runner: WorkerRunner = run_feishu_channel_worker,
    wait: Waiter = _wait_forever,
    emit: Emit = print,
    pretty: bool = False,
) -> int:
    try:
        outcome = await worker_runner(db_factory=lambda: async_session())
    except Exception as exc:
        emit(_json_payload(status="failed", reason_code=FEISHU_WORKER_CLI_FAILED, reason=str(exc), pretty=pretty))
        return 1

    emit(
        _json_payload(
            status=getattr(outcome, "status", "failed"),
            reason_code=getattr(outcome, "reason_code", FEISHU_WORKER_CLI_FAILED),
            reason=getattr(outcome, "reason", "Feishu worker startup failed."),
            pretty=pretty,
        )
    )
    if getattr(outcome, "status", None) != "started":
        return 2

    try:
        await wait()
    except KeyboardInterrupt:
        pass

    try:
        await _disconnect_transport(getattr(outcome, "transport", None))
    except Exception as exc:
        emit(
            _json_payload(
                status="failed",
                reason_code=FEISHU_WORKER_CLI_DISCONNECT_FAILED,
                reason=str(exc),
                pretty=pretty,
            )
        )
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return asyncio.run(run_worker_process(pretty=args.pretty))


if __name__ == "__main__":
    raise SystemExit(main())
