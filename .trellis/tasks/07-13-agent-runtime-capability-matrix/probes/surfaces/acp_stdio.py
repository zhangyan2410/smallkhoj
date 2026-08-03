from __future__ import annotations

from pathlib import Path
from typing import Any

from lib.budget import CallBudgetLedger
from lib.jsonrpc import JsonRpcClient, ProtocolSafetyError
from lib.process_guard import OwnedProcessRegistry, ProcessRecord
from lib.runner import ObservedLine


class AcpStdioProbe:
    """Minimal ACP-over-stdio adapter for isolated capability probes.

    This is intentionally not a production ACP runtime. It only exposes the
    ACP baseline needed by the matrix: zero-input initialize/session setup,
    model-bearing ``session/prompt``, receive-only ``session/update`` events,
    and the non-model ``session/cancel`` control request.
    """

    def __init__(self, client: JsonRpcClient) -> None:
        self._client = client
        self.agent_capabilities: dict[str, Any] | None = None

    @classmethod
    def start(cls, argv: list[str], *, cwd: Path, registry: OwnedProcessRegistry) -> "AcpStdioProbe":
        return cls(JsonRpcClient.start(argv, cwd=cwd, registry=registry))

    @property
    def notifications(self) -> list[dict[str, Any]]:
        return self._client.notifications

    @property
    def observations(self) -> list[ObservedLine]:
        return self._client.observations

    @property
    def record(self) -> ProcessRecord:
        return self._client.record

    def initialize(self, *, timeout_seconds: float) -> dict[str, Any]:
        result = self._client.request_control(
            "initialize",
            {
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": {"readTextFile": False, "writeTextFile": False},
                    "terminal": False,
                    "auth": {"terminal": False},
                },
                "clientInfo": {"name": "smallkhoj-capability-probe", "version": "1"},
            },
            timeout_seconds=timeout_seconds,
        )
        version = result.get("protocolVersion")
        if not isinstance(version, int) or version <= 0:
            raise ProtocolSafetyError("ACP initialize response did not contain a positive protocolVersion")
        capabilities = result.get("agentCapabilities")
        self.agent_capabilities = capabilities if isinstance(capabilities, dict) else {}
        return result

    def new_session(self, cwd: Path, *, timeout_seconds: float) -> str:
        result = self._client.request_control(
            "session/new",
            {"cwd": str(Path(cwd).resolve()), "mcpServers": []},
            timeout_seconds=timeout_seconds,
        )
        return self._require_session_id(result, "session/new")

    def load_session(self, session_id: str, cwd: Path, *, timeout_seconds: float) -> str:
        result = self._client.request_control(
            "session/load",
            {"sessionId": self._session_id(session_id), "cwd": str(Path(cwd).resolve()), "mcpServers": []},
            timeout_seconds=timeout_seconds,
        )
        loaded = result.get("sessionId", session_id)
        return self._session_id(loaded)

    def set_config_option(
        self,
        session_id: str,
        config_id: str,
        value: str | bool,
        *,
        timeout_seconds: float,
    ) -> dict[str, Any]:
        if not isinstance(config_id, str) or not config_id.strip() or "\n" in config_id or "\r" in config_id:
            raise ProtocolSafetyError("ACP configId must be a non-empty single-line string")
        if not isinstance(value, (str, bool)) or (isinstance(value, str) and not value.strip()):
            raise ProtocolSafetyError("ACP config option value must be a non-empty string or boolean")
        return self._client.request_control(
            "session/set_config_option",
            {"sessionId": self._session_id(session_id), "configId": config_id, "value": value},
            timeout_seconds=timeout_seconds,
        )

    def prompt(
        self,
        ledger: CallBudgetLedger,
        provider: str,
        case_id: str,
        session_id: str,
        text: str,
        *,
        timeout_seconds: float,
    ) -> dict[str, Any]:
        if not isinstance(text, str) or not text.strip():
            raise ProtocolSafetyError("ACP prompt text must be a non-empty string")
        result = self._client.request_model(
            ledger,
            provider,
            case_id,
            "session/prompt",
            {
                "sessionId": self._session_id(session_id),
                "prompt": [{"type": "text", "text": text}],
            },
            timeout_seconds=timeout_seconds,
        )
        stop_reason = result.get("stopReason")
        if not isinstance(stop_reason, str) or not stop_reason:
            raise ProtocolSafetyError("ACP session/prompt response did not contain stopReason")
        return result

    def cancel(self, session_id: str, *, timeout_seconds: float) -> dict[str, Any]:
        return self._client.request_control(
            "session/cancel",
            {"sessionId": self._session_id(session_id)},
            timeout_seconds=timeout_seconds,
        )

    def wait_for_session_update(self, session_id: str, *, timeout_seconds: float) -> dict[str, Any]:
        expected_session_id = self._session_id(session_id)
        return self._client.wait_for_notification(
            "session/update",
            timeout_seconds=timeout_seconds,
            predicate=lambda notification: (
                isinstance(notification.get("params"), dict)
                and notification["params"].get("sessionId") == expected_session_id
            ),
        )

    def terminate(self, *, grace_seconds: float = 1.0) -> ProcessRecord:
        return self._client.terminate(grace_seconds=grace_seconds)

    @staticmethod
    def _require_session_id(result: dict[str, Any], method: str) -> str:
        return AcpStdioProbe._session_id(result.get("sessionId"), method=method)

    @staticmethod
    def _session_id(value: Any, *, method: str = "ACP") -> str:
        if not isinstance(value, str) or not value.strip() or "\n" in value or "\r" in value:
            raise ProtocolSafetyError(f"{method} requires a non-empty single-line sessionId")
        return value
