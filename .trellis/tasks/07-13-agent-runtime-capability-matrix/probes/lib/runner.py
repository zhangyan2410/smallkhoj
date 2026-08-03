from __future__ import annotations

import datetime as dt
import json
import queue
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .budget import CallBudgetLedger, Reservation
from .process_guard import OwnedProcessRegistry, ProcessRecord


class ProcessWriteError(RuntimeError):
    """Raised after a model-input reservation cannot be delivered to stdin."""


@dataclass(frozen=True)
class ObservedLine:
    at: str
    source: str
    text: str
    reservation_id: str | None


class ManagedProcess:
    """A process-group-owned stdin/stdout runner for task-local protocol drivers."""

    def __init__(
        self,
        process: subprocess.Popen[str],
        record: ProcessRecord,
        registry: OwnedProcessRegistry,
    ) -> None:
        self._process = process
        self.record = record
        self._registry = registry
        self._events: queue.Queue[ObservedLine] = queue.Queue()
        self._state_lock = threading.Lock()
        self._current_reservation_id: str | None = None
        self._threads = [
            self._start_reader(process.stdout, "stdout"),
            self._start_reader(process.stderr, "stderr"),
        ]

    @classmethod
    def start(cls, argv: list[str], *, cwd: Path, registry: OwnedProcessRegistry) -> "ManagedProcess":
        if (
            not isinstance(argv, list)
            or not argv
            or not isinstance(argv[0], str)
            or not argv[0]
            or any(not isinstance(arg, str) or "\x00" in arg for arg in argv)
        ):
            raise ValueError("argv must be a non-empty list of strings with a non-empty executable and no NUL bytes")
        cwd = Path(cwd).resolve(strict=True)
        process = subprocess.Popen(
            argv,
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
        record = registry.register(process, cwd=cwd)
        return cls(process, record, registry)

    def send_model_input(
        self,
        ledger: CallBudgetLedger,
        provider: str,
        case_id: str,
        payload: Any,
    ) -> Reservation:
        try:
            serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        except (TypeError, ValueError) as exc:
            raise ProcessWriteError("model input must be JSON serializable") from exc
        reservation = ledger.reserve(provider, case_id)
        # Once a write is about to be attempted, the reservation is never
        # refunded. A broken pipe cannot prove that the provider saw nothing.
        ledger.mark_input_attempted(reservation.id)
        with self._state_lock:
            self._current_reservation_id = reservation.id
        self._write_serialized(serialized, reserved=True)
        return reservation

    def send_control_frame(self, payload: Any) -> None:
        """Send a protocol control frame that is not permitted to contain model input.

        Surface adapters own the allowlist of control methods. This primitive
        deliberately clears prompt correlation so an initialize/interrupt
        response cannot be mislabelled as evidence for a model-bearing input.
        """
        try:
            serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        except (TypeError, ValueError) as exc:
            raise ProcessWriteError("control frame must be JSON serializable") from exc
        with self._state_lock:
            self._current_reservation_id = None
        self._write_serialized(serialized, reserved=False)

    def read_until(self, predicate: Callable[[ObservedLine], bool], *, timeout_seconds: float) -> list[ObservedLine]:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        deadline = time.monotonic() + timeout_seconds
        events: list[ObservedLine] = []
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return events
            try:
                event = self._events.get(timeout=remaining)
            except queue.Empty:
                return events
            events.append(event)
            if predicate(event):
                return events

    def drain(self) -> list[ObservedLine]:
        events: list[ObservedLine] = []
        while True:
            try:
                events.append(self._events.get_nowait())
            except queue.Empty:
                return events

    def is_running(self) -> bool:
        return self._process.poll() is None

    def terminate(self, *, grace_seconds: float = 1.0) -> ProcessRecord:
        result = self._registry.terminate(self.record, grace_seconds=grace_seconds)
        try:
            self._process.wait(timeout=max(grace_seconds * 3, 0.2))
        except subprocess.TimeoutExpired:
            # The registry already escalated to SIGKILL; leave the terminal
            # error visible rather than sending any untracked signal here.
            pass
        for stream in (self._process.stdin, self._process.stdout, self._process.stderr):
            if stream is not None and not stream.closed:
                stream.close()
        for thread in self._threads:
            thread.join(timeout=max(grace_seconds, 0.05))
        return result

    def _start_reader(self, stream: Any, source: str) -> threading.Thread:
        thread = threading.Thread(target=self._read_stream, args=(stream, source), daemon=True)
        thread.start()
        return thread

    def _read_stream(self, stream: Any, source: str) -> None:
        if stream is None:
            return
        for line in stream:
            with self._state_lock:
                reservation_id = self._current_reservation_id
            self._events.put(
                ObservedLine(
                    at=dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
                    source=source,
                    text=line.rstrip("\n"),
                    reservation_id=reservation_id,
                )
            )

    def _write_serialized(self, serialized: str, *, reserved: bool) -> None:
        if self._process.stdin is None:
            kind = "model input" if reserved else "control frame"
            raise ProcessWriteError(f"process stdin is unavailable for {kind}")
        try:
            self._process.stdin.write(serialized + "\n")
            self._process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            kind = "model input" if reserved else "control frame"
            raise ProcessWriteError(f"{kind} write failed{' after reservation' if reserved else ''}: {exc}") from exc
