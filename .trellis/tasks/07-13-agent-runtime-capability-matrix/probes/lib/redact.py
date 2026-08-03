from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class RedactionResult:
    text: str
    count: int


_BEARER_HEADER = re.compile(r"(?i)(authorization\s*:\s*bearer\s+)[A-Za-z0-9._~+/=-]+")
_BEARER_VALUE = re.compile(r"(?i)(?<!authorization:\s)(\bbearer\s+)[A-Za-z0-9._~+/=-]+")
_SLOCK_KEY = re.compile(r"\b(?:sk_(?:agent|machine|connect|session)|sap)_[A-Za-z0-9_-]+\b")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}\b")
_NAMED_SECRET = re.compile(
    r"(?i)\b(api[_-]?key|access[_-]?token|client[_-]?secret|secret|password)\b(\s*[:=]\s*)([^\s&,'\"]+)"
)
_URL_CREDENTIAL = re.compile(r"(?i)([?&](?:access_)?(?:token|code|signature|api[_-]?key)=)[^&#\s]+")
_UUID = re.compile(r"\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b")
_OPAQUE_ID_KEYS = frozenset(
    {
        "threadid",
        "turnid",
        "sessionid",
        "providersessionid",
        "providersessionids",
        "installationid",
        "environmentid",
        "reservationid",
        "requestid",
    }
)


def stable_id(value: str) -> str:
    """Preserve cross-record correlation without persisting an opaque provider id."""

    return "id_" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def redact_text(
    text: str,
    *,
    home: Path | None = None,
    redact_opaque_ids: bool = True,
) -> RedactionResult:
    """Redact credential-shaped values while preserving non-sensitive diagnostics."""

    if not isinstance(text, str):
        raise TypeError("text must be a string")
    count = 0

    def replace(pattern: re.Pattern[str], replacement: str | Any) -> None:
        nonlocal text, count
        text, replaced = pattern.subn(replacement, text)
        count += replaced

    if home is not None:
        home_text = str(Path(home))
        if home_text and home_text in text:
            text = text.replace(home_text, "<HOME>")
            count += 1

    replace(_BEARER_HEADER, r"\1<redacted>")
    replace(_BEARER_VALUE, r"\1<redacted>")
    replace(_SLOCK_KEY, "<redacted>")
    replace(_JWT, "<redacted>")
    replace(_NAMED_SECRET, r"\1\2<redacted>")
    replace(_URL_CREDENTIAL, r"\1<redacted>")
    if redact_opaque_ids:
        replace(_UUID, lambda match: stable_id(match.group(0)))
    return RedactionResult(text=text, count=count)


def sanitize_payload(payload: Any, *, max_string_bytes: int = 2048, home: Path | None = None) -> Any:
    """Recursively sanitize protocol payloads before they can enter task evidence.

    Unknown long strings become a digest of their *redacted* form. This keeps
    evidence useful for equality/shape checks without saving full provider logs.
    """

    if max_string_bytes <= 0:
        raise ValueError("max_string_bytes must be positive")
    if payload is None or isinstance(payload, (bool, int, float)):
        return payload
    if isinstance(payload, str):
        redacted = redact_text(payload, home=home).text
        encoded = redacted.encode("utf-8")
        if len(encoded) <= max_string_bytes:
            return redacted
        return {
            "kind": "digest",
            "sha256": hashlib.sha256(encoded).hexdigest(),
            "bytes": len(encoded),
        }
    if isinstance(payload, list):
        return [sanitize_payload(item, max_string_bytes=max_string_bytes, home=home) for item in payload]
    if isinstance(payload, tuple):
        return [sanitize_payload(item, max_string_bytes=max_string_bytes, home=home) for item in payload]
    if isinstance(payload, dict):
        result: dict[str, Any] = {}
        for key, value in payload.items():
            normalized_key = str(key).replace("_", "").lower()
            if normalized_key in _OPAQUE_ID_KEYS:
                result[str(key)] = _sanitize_opaque_id(value, max_string_bytes=max_string_bytes, home=home)
            else:
                result[str(key)] = sanitize_payload(value, max_string_bytes=max_string_bytes, home=home)
        return result
    return {"kind": "unsupported", "type": type(payload).__name__}


def _sanitize_opaque_id(value: Any, *, max_string_bytes: int, home: Path | None) -> Any:
    if isinstance(value, str):
        redacted = redact_text(value, home=home, redact_opaque_ids=False).text
        return stable_id(redacted)
    if isinstance(value, list):
        return [_sanitize_opaque_id(item, max_string_bytes=max_string_bytes, home=home) for item in value]
    return sanitize_payload(value, max_string_bytes=max_string_bytes, home=home)
