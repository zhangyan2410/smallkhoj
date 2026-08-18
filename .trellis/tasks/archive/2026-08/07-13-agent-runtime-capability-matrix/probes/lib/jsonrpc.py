from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

from .budget import CallBudgetLedger, Reservation
from .process_guard import OwnedProcessRegistry, ProcessRecord
from .runner import ManagedProcess, ObservedLine


class JsonRpcError(RuntimeError):
    """A terminal JSON-RPC response or protocol error."""


class JsonRpcTimeout(JsonRpcError):
    """No matching response arrived before the caller's bounded deadline."""


class ProtocolSafetyError(JsonRpcError):
    """A caller attempted to bypass the model-input budget boundary."""


_CONTROL_METHODS = frozenset(
    {
        "initialize",
        "thread/start",
        "thread/resume",
        "turn/interrupt",
        "session/new",
        "session/load",
        "session/cancel",
        "session/set_config_option",
    }
)
_MODEL_METHODS = frozenset({"turn/start", "turn/steer", "session/prompt"})


class JsonRpcClient:
    """JSON-RPC-over-stdio client with a hard model-input/control split."""

    def __init__(self, process: ManagedProcess) -> None:
        self._process = process
        self._next_id = 1
        self.notifications: list[dict[str, Any]] = []
        self.observations: list[ObservedLine] = []

    @classmethod
    def start(cls, argv: list[str], *, cwd: Path, registry: OwnedProcessRegistry) -> "JsonRpcClient":
        return cls(ManagedProcess.start(argv, cwd=cwd, registry=registry))

    @property
    def record(self) -> ProcessRecord:
        return self._process.record

    def request_control(self, method: str, params: dict[str, Any], *, timeout_seconds: float) -> dict[str, Any]:
        if method not in _CONTROL_METHODS:
            raise ProtocolSafetyError(f"{method} is not an allowlisted non-model control method")
        request_id, frame = self._request_frame(method, params)
        self._process.send_control_frame(frame)
        return self._wait_for_response(request_id, timeout_seconds=timeout_seconds)

    def request_model(
        self,
        ledger: CallBudgetLedger,
        provider: str,
        case_id: str,
        method: str,
        params: dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> dict[str, Any]:
        if method not in _MODEL_METHODS:
            raise ProtocolSafetyError(f"{method} is not an allowlisted model-bearing method")
        request_id, frame = self._request_frame(method, params)
        self._process.send_model_input(ledger, provider, case_id, frame)
        return self._wait_for_response(request_id, timeout_seconds=timeout_seconds)

    def terminate(self, *, grace_seconds: float = 1.0) -> ProcessRecord:
        return self._process.terminate(grace_seconds=grace_seconds)

    def is_running(self) -> bool:
        return self._process.is_running()

    def wait_for_notification(
        self,
        method: str,
        *,
        timeout_seconds: float,
        predicate: Callable[[dict[str, Any]], bool] | None = None,
    ) -> dict[str, Any]:
        """Wait for a recorded or future JSON-RPC notification without input.

        This is deliberately a receive-only control path: waiting for a
        provider lifecycle notification must never reserve a model input.
        """
        if not isinstance(method, str) or not method:
            raise ValueError("notification method must be a non-empty string")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")

        def matches(notification: dict[str, Any]) -> bool:
            return notification.get("method") == method and (predicate is None or predicate(notification))

        for notification in self.notifications:
            if matches(notification):
                return notification

        deadline = time.monotonic() + timeout_seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise JsonRpcTimeout(f"timed out waiting for JSON-RPC notification {method}")
            events = self._process.read_until(lambda _: True, timeout_seconds=remaining)
            if not events:
                raise JsonRpcTimeout(f"timed out waiting for JSON-RPC notification {method}")
            for event in events:
                self.observations.append(event)
                message = self._parse_event(event)
                if message is None or "method" not in message or "id" in message:
                    continue
                self.notifications.append(message)
                if matches(message):
                    return message

    def _request_frame(self, method: str, params: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        if not isinstance(params, dict):
            raise JsonRpcError("JSON-RPC params must be an object")
        request_id = self._next_id
        self._next_id += 1
        return request_id, {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}

    def _wait_for_response(self, request_id: int, *, timeout_seconds: float) -> dict[str, Any]:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        deadline = time.monotonic() + timeout_seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise JsonRpcTimeout(f"timed out waiting for JSON-RPC response {request_id}")
            events = self._process.read_until(lambda _: True, timeout_seconds=remaining)
            if not events:
                raise JsonRpcTimeout(f"timed out waiting for JSON-RPC response {request_id}")
            for event in events:
                self.observations.append(event)
                message = self._parse_event(event)
                if message is None:
                    continue
                if "method" in message and "id" not in message:
                    self.notifications.append(message)
                    continue
                if message.get("id") != request_id:
                    continue
                if "error" in message:
                    raise JsonRpcError(f"JSON-RPC {request_id} returned error: {message['error']}")
                result = message.get("result")
                if not isinstance(result, dict):
                    raise JsonRpcError(f"JSON-RPC {request_id} returned a non-object result")
                return result

    @staticmethod
    def _parse_event(event: ObservedLine) -> dict[str, Any] | None:
        if event.source != "stdout":
            return None
        try:
            message = json.loads(event.text)
        except json.JSONDecodeError:
            return None
        return message if isinstance(message, dict) else None
