from __future__ import annotations

from pathlib import Path
from typing import Any

from lib.budget import CallBudgetLedger
from lib.jsonrpc import JsonRpcClient, ProtocolSafetyError
from lib.process_guard import OwnedProcessRegistry, ProcessRecord
from lib.runner import ObservedLine


class CodexAppServerProbe:
    """Narrow wrapper for the app-server methods needed by this capability spike.

    It deliberately exposes only `initialize`, thread setup, two model-bearing
    turn methods, and non-model `turn/interrupt`. It is not a production
    SmallKhoj runtime adapter.
    """

    def __init__(self, client: JsonRpcClient) -> None:
        self._client = client

    @classmethod
    def start(cls, argv: list[str], *, cwd: Path, registry: OwnedProcessRegistry) -> "CodexAppServerProbe":
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
        return self._client.request_control(
            "initialize",
            {
                "clientInfo": {"name": "smallkhoj-capability-probe", "version": "1"},
                "capabilities": {"experimentalApi": True, "requestAttestation": False},
            },
            timeout_seconds=timeout_seconds,
        )

    def start_thread(self, cwd: Path, *, timeout_seconds: float) -> str:
        result = self._client.request_control(
            "thread/start",
            {
                "cwd": str(Path(cwd).resolve()),
                "ephemeral": True,
                "sandbox": "read-only",
                "approvalPolicy": "on-request",
            },
            timeout_seconds=timeout_seconds,
        )
        return self._require_nested_id(result, "thread", "thread/start")

    def start_turn(
        self,
        ledger: CallBudgetLedger,
        provider: str,
        case_id: str,
        thread_id: str,
        text: str,
        *,
        timeout_seconds: float,
    ) -> str:
        result = self._client.request_model(
            ledger,
            provider,
            case_id,
            "turn/start",
            {"threadId": self._identifier(thread_id, "thread_id"), "input": [self._text_input(text)]},
            timeout_seconds=timeout_seconds,
        )
        return self._require_nested_id(result, "turn", "turn/start")

    def steer_turn(
        self,
        ledger: CallBudgetLedger,
        provider: str,
        case_id: str,
        thread_id: str,
        expected_turn_id: str,
        text: str,
        *,
        timeout_seconds: float,
    ) -> str:
        result = self._client.request_model(
            ledger,
            provider,
            case_id,
            "turn/steer",
            {
                "threadId": self._identifier(thread_id, "thread_id"),
                "expectedTurnId": self._identifier(expected_turn_id, "expected_turn_id"),
                "input": [self._text_input(text)],
            },
            timeout_seconds=timeout_seconds,
        )
        turn_id = result.get("turnId")
        if not isinstance(turn_id, str) or not turn_id:
            raise ProtocolSafetyError("turn/steer response did not contain a non-empty turnId")
        return turn_id

    def interrupt_turn(self, thread_id: str, turn_id: str, *, timeout_seconds: float) -> dict[str, Any]:
        return self._client.request_control(
            "turn/interrupt",
            {
                "threadId": self._identifier(thread_id, "thread_id"),
                "turnId": self._identifier(turn_id, "turn_id"),
            },
            timeout_seconds=timeout_seconds,
        )

    def wait_for_turn_started(
        self,
        thread_id: str,
        turn_id: str,
        *,
        timeout_seconds: float,
    ) -> dict[str, Any]:
        expected_thread_id = self._identifier(thread_id, "thread_id")
        expected_turn_id = self._identifier(turn_id, "turn_id")

        def matches(notification: dict[str, Any]) -> bool:
            params = notification.get("params")
            if not isinstance(params, dict) or params.get("threadId") != expected_thread_id:
                return False
            observed_turn_id = params.get("turnId")
            if not isinstance(observed_turn_id, str):
                turn = params.get("turn")
                observed_turn_id = turn.get("id") if isinstance(turn, dict) else None
            return observed_turn_id == expected_turn_id

        return self._client.wait_for_notification(
            "turn/started",
            timeout_seconds=timeout_seconds,
            predicate=matches,
        )

    def terminate(self, *, grace_seconds: float = 1.0) -> ProcessRecord:
        return self._client.terminate(grace_seconds=grace_seconds)

    @staticmethod
    def _text_input(text: str) -> dict[str, str]:
        if not isinstance(text, str) or not text.strip():
            raise ProtocolSafetyError("turn input must be a non-empty string")
        return {"type": "text", "text": text}

    @staticmethod
    def _identifier(value: str, field: str) -> str:
        if not isinstance(value, str) or not value.strip() or "\n" in value or "\r" in value:
            raise ProtocolSafetyError(f"{field} must be a non-empty single-line string")
        return value

    @staticmethod
    def _require_nested_id(result: dict[str, Any], field: str, method: str) -> str:
        nested = result.get(field)
        value = nested.get("id") if isinstance(nested, dict) else None
        if not isinstance(value, str) or not value:
            raise ProtocolSafetyError(f"{method} response did not contain {field}.id")
        return value
