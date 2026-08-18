from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


class SchemaError(ValueError):
    """Raised when persisted capability evidence does not meet the v1 contract."""


_LEVELS = frozenset({"verified", "conditional", "unsupported", "unverified", "blocked"})
_UNSUPPORTED_BASES = frozenset({"protocol", "documented", "reproducible_rejection"})


def _non_empty_strings(value: object, field: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise SchemaError(f"{field} must be a non-empty list of strings")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise SchemaError(f"{field} must contain only non-empty strings")
    return list(value)


def _optional_non_empty_string(value: object, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise SchemaError(f"{field} must be a non-empty string when present")
    return value


@dataclass
class CapabilitySupport:
    """A conservative, evidence-backed capability assessment for one surface."""

    level: str
    evidence_ids: list[str] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    fallback: str | None = None
    basis: str | None = None
    reason: str | None = None

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "CapabilitySupport":
        if not isinstance(raw, Mapping):
            raise SchemaError("capability support must be an object")

        level = raw.get("level")
        if level not in _LEVELS:
            raise SchemaError(f"level must be one of: {', '.join(sorted(_LEVELS))}")

        if level == "verified":
            return cls(level=level, evidence_ids=_non_empty_strings(raw.get("evidenceIds"), "evidenceIds"))

        if level == "conditional":
            evidence_ids = _non_empty_strings(raw.get("evidenceIds"), "evidenceIds")
            constraints = _non_empty_strings(raw.get("constraints"), "constraints")
            return cls(
                level=level,
                evidence_ids=evidence_ids,
                constraints=constraints,
                fallback=_optional_non_empty_string(raw.get("fallback"), "fallback"),
            )

        if level == "unsupported":
            evidence_ids = _non_empty_strings(raw.get("evidenceIds"), "evidenceIds")
            basis = raw.get("basis")
            if basis not in _UNSUPPORTED_BASES:
                raise SchemaError(
                    "unsupported basis must be one of: " + ", ".join(sorted(_UNSUPPORTED_BASES))
                )
            return cls(level=level, evidence_ids=evidence_ids, basis=basis)

        reason = _optional_non_empty_string(raw.get("reason"), "reason")
        if reason is None:
            raise SchemaError(f"{level} support requires a reason")
        if level == "blocked":
            evidence_value = raw.get("evidenceIds")
            evidence_ids = [] if evidence_value is None else _non_empty_strings(evidence_value, "evidenceIds")
            return cls(level=level, evidence_ids=evidence_ids, reason=reason)
        return cls(level=level, reason=reason)

    def to_dict(self) -> dict[str, object]:
        result: dict[str, object] = {"level": self.level}
        if self.evidence_ids:
            result["evidenceIds"] = list(self.evidence_ids)
        if self.constraints:
            result["constraints"] = list(self.constraints)
        if self.fallback is not None:
            result["fallback"] = self.fallback
        if self.basis is not None:
            result["basis"] = self.basis
        if self.reason is not None:
            result["reason"] = self.reason
        return result
