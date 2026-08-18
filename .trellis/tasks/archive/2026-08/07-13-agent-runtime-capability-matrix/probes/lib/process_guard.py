from __future__ import annotations

import contextlib
import datetime as dt
import fcntl
import json
import os
import signal
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator


class OwnershipError(RuntimeError):
    """Raised when a process cannot be proven to be owned by this probe run."""


@dataclass(frozen=True)
class ProcessRecord:
    id: str
    pid: int
    pgid: int
    cwd: str
    started_marker: str
    state: str
    registered_at: str
    terminated_at: str | None = None


_TERMINAL_STATES = frozenset({"terminated", "force_terminated"})


def _now() -> str:
    return dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")


class OwnedProcessRegistry:
    """Tracks only process groups started by the probe controller.

    A PID alone is unsafe because it may be reused. The registry combines PID,
    PGID, cwd, and the OS process start marker before any signal is emitted.
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.lock_path = self.path.with_name(f"{self.path.name}.lock")

    def register(self, process: subprocess.Popen[object], *, cwd: Path) -> ProcessRecord:
        if process.pid is None or process.poll() is not None:
            raise OwnershipError("cannot register a process that is not running")
        cwd = Path(cwd).resolve(strict=True)
        pid = process.pid
        try:
            pgid = os.getpgid(pid)
        except ProcessLookupError as exc:
            raise OwnershipError("process exited before registration") from exc
        marker = self._process_marker(pid)
        if marker is None:
            raise OwnershipError("cannot read process identity marker")
        record = ProcessRecord(
            id=uuid.uuid4().hex,
            pid=pid,
            pgid=pgid,
            cwd=str(cwd),
            started_marker=marker,
            state="running",
            registered_at=_now(),
        )
        with self._locked_data() as data:
            data["records"].append(self._to_raw(record))
            self._write_data(data)
        return record

    def terminate(
        self,
        record: ProcessRecord,
        *,
        cancel: Callable[[], None] | None = None,
        grace_seconds: float = 1.0,
    ) -> ProcessRecord:
        if grace_seconds <= 0:
            raise ValueError("grace_seconds must be positive")
        stored = self._get_stored(record.id)
        self._assert_same_record(record, stored)
        if stored.state in _TERMINAL_STATES:
            return stored
        if not self._identity_matches(stored):
            if not self._is_pid_alive(stored.pid):
                return self._mark_terminal(stored, "terminated")
            raise OwnershipError(f"refusing to signal process with mismatched identity: {stored.pid}")

        if cancel is not None:
            try:
                cancel()
            except Exception:
                # Protocol cancellation is best-effort. Ownership-safe OS cleanup
                # must still happen before a potentially token-consuming child leaks.
                pass

        self._mark_state(stored, "cancel_requested")
        if self._send_and_wait(stored, signal.SIGINT, grace_seconds):
            return self._mark_terminal(stored, "terminated")
        if self._send_and_wait(stored, signal.SIGTERM, grace_seconds):
            return self._mark_terminal(stored, "terminated")
        if self._send_and_wait(stored, signal.SIGKILL, grace_seconds):
            return self._mark_terminal(stored, "force_terminated")
        raise OwnershipError(f"owned process group did not terminate: pgid={stored.pgid}")

    def get(self, record_id: str) -> ProcessRecord:
        return self._get_stored(record_id)

    def _send_and_wait(self, record: ProcessRecord, sig: signal.Signals, grace_seconds: float) -> bool:
        if not self._identity_matches(record):
            return not self._is_pid_alive(record.pid)
        try:
            os.killpg(record.pgid, sig)
        except ProcessLookupError:
            return True
        deadline = time.monotonic() + grace_seconds
        while time.monotonic() < deadline:
            if not self._is_pid_alive(record.pid):
                return True
            time.sleep(min(0.02, max(0.001, deadline - time.monotonic())))
        return not self._is_pid_alive(record.pid)

    def _identity_matches(self, record: ProcessRecord) -> bool:
        try:
            if os.getpgid(record.pid) != record.pgid:
                return False
        except ProcessLookupError:
            return False
        return self._process_marker(record.pid) == record.started_marker

    @staticmethod
    def _is_pid_alive(pid: int) -> bool:
        try:
            result = subprocess.run(
                ["ps", "-o", "stat=", "-p", str(pid)],
                check=False,
                capture_output=True,
                text=True,
                timeout=2,
            )
        except (OSError, subprocess.TimeoutExpired):
            # If `ps` itself is unavailable we fail closed: do not assume a
            # process exited and accidentally reuse its budget/ownership state.
            return True
        if result.returncode != 0:
            return False
        state = result.stdout.strip()
        return bool(state) and not state.startswith("Z")

    @staticmethod
    def _process_marker(pid: int) -> str | None:
        try:
            result = subprocess.run(
                ["ps", "-o", "lstart=", "-p", str(pid)],
                check=False,
                capture_output=True,
                text=True,
                timeout=2,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        if result.returncode != 0:
            return None
        marker = result.stdout.strip()
        return marker or None

    def _get_stored(self, record_id: str) -> ProcessRecord:
        with self._locked_data() as data:
            for raw in data["records"]:
                if raw["id"] == record_id:
                    return self._from_raw(raw)
        raise OwnershipError(f"unknown owned process record: {record_id}")

    def _mark_state(self, record: ProcessRecord, state: str) -> ProcessRecord:
        return self._update(record, state=state, terminated_at=None)

    def _mark_terminal(self, record: ProcessRecord, state: str) -> ProcessRecord:
        return self._update(record, state=state, terminated_at=_now())

    def _update(self, record: ProcessRecord, *, state: str, terminated_at: str | None) -> ProcessRecord:
        with self._locked_data() as data:
            for raw in data["records"]:
                if raw["id"] != record.id:
                    continue
                raw["state"] = state
                if terminated_at is not None:
                    raw["terminatedAt"] = terminated_at
                self._write_data(data)
                return self._from_raw(raw)
        raise OwnershipError(f"unknown owned process record: {record.id}")

    @contextlib.contextmanager
    def _locked_data(self) -> Iterator[dict[str, object]]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.lock_path.open("a+", encoding="utf-8") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield self._read_data()
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def _read_data(self) -> dict[str, object]:
        if not self.path.exists():
            return {"schemaVersion": 1, "records": []}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise OwnershipError(f"cannot read owned-process registry: {exc}") from exc
        if not isinstance(data, dict) or data.get("schemaVersion") != 1 or not isinstance(data.get("records"), list):
            raise OwnershipError("owned-process registry has an unsupported schema")
        for raw in data["records"]:
            self._from_raw(raw)
        return data

    def _write_data(self, data: dict[str, object]) -> None:
        fd, temp_name = tempfile.mkstemp(prefix=f".{self.path.name}.", dir=self.path.parent, text=True)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, sort_keys=True, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, self.path)
        except OSError as exc:
            raise OwnershipError(f"cannot persist owned-process registry: {exc}") from exc
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    @staticmethod
    def _assert_same_record(provided: ProcessRecord, stored: ProcessRecord) -> None:
        identity = ("pid", "pgid", "cwd", "started_marker")
        if any(getattr(provided, field) != getattr(stored, field) for field in identity):
            raise OwnershipError("provided process record does not match registry identity")

    @staticmethod
    def _to_raw(record: ProcessRecord) -> dict[str, object]:
        result: dict[str, object] = {
            "id": record.id,
            "pid": record.pid,
            "pgid": record.pgid,
            "cwd": record.cwd,
            "startedMarker": record.started_marker,
            "state": record.state,
            "registeredAt": record.registered_at,
        }
        if record.terminated_at is not None:
            result["terminatedAt"] = record.terminated_at
        return result

    @staticmethod
    def _from_raw(raw: object) -> ProcessRecord:
        if not isinstance(raw, dict):
            raise OwnershipError("process record must be an object")
        required_strings = ("id", "cwd", "startedMarker", "state", "registeredAt")
        required_ints = ("pid", "pgid")
        if any(not isinstance(raw.get(key), str) or not raw[key] for key in required_strings):
            raise OwnershipError("process record is missing a required string field")
        if any(not isinstance(raw.get(key), int) or raw[key] <= 0 for key in required_ints):
            raise OwnershipError("process record is missing a required positive integer field")
        terminated_at = raw.get("terminatedAt")
        if terminated_at is not None and (not isinstance(terminated_at, str) or not terminated_at):
            raise OwnershipError("terminatedAt must be a non-empty string when present")
        return ProcessRecord(
            id=raw["id"],
            pid=raw["pid"],
            pgid=raw["pgid"],
            cwd=raw["cwd"],
            started_marker=raw["startedMarker"],
            state=raw["state"],
            registered_at=raw["registeredAt"],
            terminated_at=terminated_at,
        )
