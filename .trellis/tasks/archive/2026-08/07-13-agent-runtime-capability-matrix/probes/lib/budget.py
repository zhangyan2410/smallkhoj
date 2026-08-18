from __future__ import annotations

import contextlib
import datetime as dt
import fcntl
import json
import os
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


class BudgetLedgerError(RuntimeError):
    """Base error for persistent model-input budget accounting."""


class BudgetExceeded(BudgetLedgerError):
    """Raised before a third model-bearing input can be sent to a provider."""


@dataclass(frozen=True)
class Reservation:
    id: str
    provider: str
    case_id: str
    state: str
    created_at: str
    attempted_at: str | None = None


_ACTIVE_STATES = frozenset({"reserved", "consumed", "consumed_unknown"})
_ALL_STATES = _ACTIVE_STATES


def _now() -> str:
    return dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")


class CallBudgetLedger:
    """A fail-closed, per-provider cap for model-bearing user input.

    The ledger deliberately records only a provider and a task-local case id.
    It must never contain prompt text, credentials, or provider output.
    """

    def __init__(self, path: Path, *, per_provider_limit: int = 2) -> None:
        if per_provider_limit <= 0:
            raise ValueError("per_provider_limit must be positive")
        self.path = Path(path)
        self.lock_path = self.path.with_name(f"{self.path.name}.lock")
        self.per_provider_limit = per_provider_limit

    def reserve(self, provider: str, case_id: str) -> Reservation:
        provider = self._required_identifier(provider, "provider")
        case_id = self._required_identifier(case_id, "case_id")
        with self._locked_data() as data:
            used = self._count(data, provider)
            if used >= self.per_provider_limit:
                raise BudgetExceeded(
                    f"{provider} has already reserved or consumed {used}/{self.per_provider_limit} model inputs"
                )
            raw = {
                "id": uuid.uuid4().hex,
                "provider": provider,
                "caseId": case_id,
                "state": "reserved",
                "createdAt": _now(),
            }
            data["reservations"].append(raw)
            self._write_data(data)
            return self._reservation_from_raw(raw)

    def mark_input_attempted(self, reservation_id: str) -> Reservation:
        return self._transition(reservation_id, expected="reserved", target="consumed")

    def mark_unsettled_as_unknown(self) -> list[Reservation]:
        changed: list[Reservation] = []
        with self._locked_data() as data:
            for raw in data["reservations"]:
                if raw["state"] == "reserved":
                    raw["state"] = "consumed_unknown"
                    raw["attemptedAt"] = _now()
                    changed.append(self._reservation_from_raw(raw))
            if changed:
                self._write_data(data)
        return changed

    def get(self, reservation_id: str) -> Reservation:
        with self._locked_data() as data:
            for raw in data["reservations"]:
                if raw["id"] == reservation_id:
                    return self._reservation_from_raw(raw)
        raise BudgetLedgerError(f"unknown reservation id: {reservation_id}")

    def count_reserved_or_consumed(self, provider: str) -> int:
        provider = self._required_identifier(provider, "provider")
        with self._locked_data() as data:
            return self._count(data, provider)

    def summary(self) -> dict[str, dict[str, int]]:
        with self._locked_data() as data:
            providers = sorted({raw["provider"] for raw in data["reservations"]})
            return {
                provider: {
                    "limit": self.per_provider_limit,
                    "reservedOrConsumed": self._count(data, provider),
                    "remaining": self.per_provider_limit - self._count(data, provider),
                }
                for provider in providers
            }

    def _transition(self, reservation_id: str, *, expected: str, target: str) -> Reservation:
        with self._locked_data() as data:
            for raw in data["reservations"]:
                if raw["id"] != reservation_id:
                    continue
                if raw["state"] != expected:
                    raise BudgetLedgerError(
                        f"reservation {reservation_id} cannot transition from {raw['state']} to {target}"
                    )
                raw["state"] = target
                raw["attemptedAt"] = _now()
                self._write_data(data)
                return self._reservation_from_raw(raw)
        raise BudgetLedgerError(f"unknown reservation id: {reservation_id}")

    def _count(self, data: dict[str, object], provider: str) -> int:
        reservations = data["reservations"]
        assert isinstance(reservations, list)
        return sum(
            1
            for raw in reservations
            if isinstance(raw, dict) and raw.get("provider") == provider and raw.get("state") in _ACTIVE_STATES
        )

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
            return {"schemaVersion": 1, "perProviderLimit": self.per_provider_limit, "reservations": []}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise BudgetLedgerError(f"cannot read budget ledger: {exc}") from exc
        if not isinstance(raw, dict) or raw.get("schemaVersion") != 1:
            raise BudgetLedgerError("budget ledger has an unsupported schema")
        if raw.get("perProviderLimit") != self.per_provider_limit:
            raise BudgetLedgerError("budget ledger limit differs from the requested limit")
        if not isinstance(raw.get("reservations"), list):
            raise BudgetLedgerError("budget ledger reservations must be a list")
        for reservation in raw["reservations"]:
            self._reservation_from_raw(reservation)
        return raw

    def _write_data(self, data: dict[str, object]) -> None:
        serialized = json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        fd, temp_name = tempfile.mkstemp(prefix=f".{self.path.name}.", dir=self.path.parent, text=True)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(serialized)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, self.path)
        except OSError as exc:
            raise BudgetLedgerError(f"cannot persist budget ledger: {exc}") from exc
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    @staticmethod
    def _required_identifier(value: str, field: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise BudgetLedgerError(f"{field} must be a non-empty string")
        if "\n" in value or "\r" in value:
            raise BudgetLedgerError(f"{field} must not contain newlines")
        return value

    @staticmethod
    def _reservation_from_raw(raw: object) -> Reservation:
        if not isinstance(raw, dict):
            raise BudgetLedgerError("reservation must be an object")
        required = ("id", "provider", "caseId", "state", "createdAt")
        if any(not isinstance(raw.get(field), str) or not raw[field] for field in required):
            raise BudgetLedgerError("reservation is missing a required string field")
        if raw["state"] not in _ALL_STATES:
            raise BudgetLedgerError(f"reservation has unsupported state: {raw['state']}")
        attempted_at = raw.get("attemptedAt")
        if attempted_at is not None and (not isinstance(attempted_at, str) or not attempted_at):
            raise BudgetLedgerError("reservation attemptedAt must be a non-empty string when present")
        return Reservation(
            id=raw["id"],
            provider=raw["provider"],
            case_id=raw["caseId"],
            state=raw["state"],
            created_at=raw["createdAt"],
            attempted_at=attempted_at,
        )
