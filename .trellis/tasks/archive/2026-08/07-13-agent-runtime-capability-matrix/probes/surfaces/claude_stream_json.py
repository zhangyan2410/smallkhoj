from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from lib.budget import CallBudgetLedger, Reservation
from lib.process_guard import OwnedProcessRegistry, ProcessRecord
from lib.runner import ManagedProcess, ObservedLine


class StreamJsonError(RuntimeError):
    """A malformed or timed-out Claude stream-json observation."""


@dataclass(frozen=True)
class StreamJsonEvent:
    at: str
    source: str
    type: str
    raw: dict[str, Any]
    reservation_id: str | None


class ClaudeStreamJsonProbe:
    """Minimal stream-json adapter for a disposable Claude capability probe."""

    def __init__(self, process: ManagedProcess) -> None:
        self._process = process
        self.session_id: str | None = None
        self.observations: list[ObservedLine] = []
        self.events: list[StreamJsonEvent] = []

    @classmethod
    def start(cls, argv: list[str], *, cwd: Path, registry: OwnedProcessRegistry) -> "ClaudeStreamJsonProbe":
        return cls(ManagedProcess.start(argv, cwd=cwd, registry=registry))

    @staticmethod
    def default_argv() -> list[str]:
        return [
            "claude",
            "--print",
            "--verbose",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--replay-user-messages",
            "--include-partial-messages",
            "--no-chrome",
            "--allowedTools",
            "",
        ]

    @property
    def record(self) -> ProcessRecord:
        return self._process.record

    def send_user_input(
        self,
        ledger: CallBudgetLedger,
        provider: str,
        case_id: str,
        text: str,
    ) -> Reservation:
        if not isinstance(text, str) or not text.strip():
            raise StreamJsonError("user input text must be non-empty")
        payload: dict[str, Any] = {
            "type": "user",
            "message": {"role": "user", "content": [{"type": "text", "text": text}]},
        }
        if self.session_id:
            payload["session_id"] = self.session_id
        return self._process.send_model_input(ledger, provider, case_id, payload)

    def wait_for_event(
        self,
        predicate: Callable[[StreamJsonEvent], bool],
        *,
        timeout_seconds: float,
    ) -> StreamJsonEvent:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        deadline = time.monotonic() + timeout_seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise StreamJsonError("timed out waiting for stream-json event")
            observed = self._process.read_until(lambda _: True, timeout_seconds=remaining)
            if not observed:
                raise StreamJsonError("timed out waiting for stream-json event")
            for line in observed:
                self.observations.append(line)
                event = self._parse(line)
                if event is None:
                    continue
                self.events.append(event)
                self._capture_session(event.raw)
                if predicate(event):
                    return event

    def terminate(self, *, grace_seconds: float = 1.0) -> ProcessRecord:
        return self._process.terminate(grace_seconds=grace_seconds)

    def drain_observations(self) -> list[ObservedLine]:
        for line in self._process.drain():
            self.observations.append(line)
            event = self._parse(line)
            if event is not None:
                self.events.append(event)
                self._capture_session(event.raw)
        return self.observations

    @staticmethod
    def _parse(line: ObservedLine) -> StreamJsonEvent | None:
        if line.source != "stdout":
            return None
        try:
            raw = json.loads(line.text)
        except json.JSONDecodeError:
            return None
        event_type = raw.get("type") if isinstance(raw, dict) else None
        if not isinstance(event_type, str) or not event_type:
            return None
        return StreamJsonEvent(
            at=line.at,
            source=line.source,
            type=event_type,
            raw=raw,
            reservation_id=line.reservation_id,
        )

    def _capture_session(self, raw: dict[str, Any]) -> None:
        for key in ("session_id", "sessionId"):
            value = raw.get(key)
            if isinstance(value, str) and value:
                self.session_id = value
                return
