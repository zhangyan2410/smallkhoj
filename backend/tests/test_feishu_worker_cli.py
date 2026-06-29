import json
from types import SimpleNamespace

import pytest

from services.feishu_channel_transport import (
    FEISHU_CHANNEL_TRANSPORT_CONFIG_FAILED,
    FEISHU_CHANNEL_TRANSPORT_STARTED,
)


@pytest.mark.asyncio
async def test_worker_cli_prints_started_json_waits_and_disconnects():
    import feishu_worker_cli

    emitted = []
    calls = {"waited": False}
    transport = SimpleNamespace(disconnected=False)

    async def disconnect():
        transport.disconnected = True

    transport.disconnect = disconnect

    async def fake_worker_runner(**kwargs):
        return SimpleNamespace(
            status="started",
            reason_code=FEISHU_CHANNEL_TRANSPORT_STARTED,
            reason="started",
            transport=transport,
        )

    async def fake_wait():
        calls["waited"] = True

    code = await feishu_worker_cli.run_worker_process(
        worker_runner=fake_worker_runner,
        wait=fake_wait,
        emit=emitted.append,
    )

    payload = json.loads(emitted[0])
    assert code == 0
    assert calls["waited"] is True
    assert transport.disconnected is True
    assert payload == {
        "status": "started",
        "reasonCode": FEISHU_CHANNEL_TRANSPORT_STARTED,
        "reason": "started",
    }


@pytest.mark.asyncio
async def test_worker_cli_returns_nonzero_for_startup_failure_without_waiting():
    import feishu_worker_cli

    emitted = []

    async def fake_worker_runner(**kwargs):
        return SimpleNamespace(
            status="failed",
            reason_code=FEISHU_CHANNEL_TRANSPORT_CONFIG_FAILED,
            reason="missing connector id",
            transport=None,
        )

    async def should_not_wait():
        raise AssertionError("wait should not run on startup failure")

    code = await feishu_worker_cli.run_worker_process(
        worker_runner=fake_worker_runner,
        wait=should_not_wait,
        emit=emitted.append,
    )

    payload = json.loads(emitted[0])
    assert code == 2
    assert payload["status"] == "failed"
    assert payload["reasonCode"] == FEISHU_CHANNEL_TRANSPORT_CONFIG_FAILED
    assert payload["reason"] == "missing connector id"


@pytest.mark.asyncio
async def test_worker_cli_disconnects_after_keyboard_interrupt():
    import feishu_worker_cli

    emitted = []
    transport = SimpleNamespace(disconnected=False)

    async def disconnect():
        transport.disconnected = True

    transport.disconnect = disconnect

    async def fake_worker_runner(**kwargs):
        return SimpleNamespace(
            status="started",
            reason_code=FEISHU_CHANNEL_TRANSPORT_STARTED,
            reason="started",
            transport=transport,
        )

    async def interrupted_wait():
        raise KeyboardInterrupt

    code = await feishu_worker_cli.run_worker_process(
        worker_runner=fake_worker_runner,
        wait=interrupted_wait,
        emit=emitted.append,
    )

    assert code == 0
    assert transport.disconnected is True


@pytest.mark.asyncio
async def test_worker_cli_reports_disconnect_failure():
    import feishu_worker_cli

    emitted = []
    transport = SimpleNamespace()

    async def disconnect():
        raise RuntimeError("disconnect failed")

    transport.disconnect = disconnect

    async def fake_worker_runner(**kwargs):
        return SimpleNamespace(
            status="started",
            reason_code=FEISHU_CHANNEL_TRANSPORT_STARTED,
            reason="started",
            transport=transport,
        )

    async def fake_wait():
        return None

    code = await feishu_worker_cli.run_worker_process(
        worker_runner=fake_worker_runner,
        wait=fake_wait,
        emit=emitted.append,
    )

    payload = json.loads(emitted[-1])
    assert code == 1
    assert payload["status"] == "failed"
    assert payload["reasonCode"] == "FEISHU_WORKER_CLI_DISCONNECT_FAILED"
    assert payload["reason"] == "disconnect failed"


def test_worker_cli_parser_does_not_accept_secret_arguments():
    import feishu_worker_cli

    parser = feishu_worker_cli.build_parser()

    with pytest.raises(SystemExit):
        parser.parse_args(["--feishu-app-secret", "should-not-be-accepted"])

    with pytest.raises(SystemExit):
        parser.parse_args(["--jira-api-token", "should-not-be-accepted"])
