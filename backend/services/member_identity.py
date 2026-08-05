"""Canonical member Name, Description, and Channel reference rules.

This module deliberately has no router or database dependency.  Signup, Agent
creation, Channel mention resolution, and the frontend contract fixture all
share these semantics.
"""

from __future__ import annotations

import re
import secrets
import unicodedata
from dataclasses import dataclass

CROCKFORD_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
SERVER_HANDLE_PATTERN = re.compile(r"^s[0-9abcdefghjkmnpqrstvwxyz]{4}$")
_RESERVED_QUALIFIER_PATTERN = re.compile(r"-s[0-9abcdefghjkmnpqrstvwxyz]{4}$")
MAX_HANDLE_CODEPOINTS = 32
MAX_DESCRIPTION_CODEPOINTS = 200
SERVER_HANDLE_RETRY_LIMIT = 8


class MemberIdentityError(ValueError):
    """Validation error with a stable reason code for API/UI translation."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class HandleValue:
    handle: str
    handle_key: str


@dataclass(frozen=True, slots=True)
class ParsedMemberReference:
    handle: str
    handle_key: str
    server_handle: str | None


def _raise(code: str, message: str) -> None:
    raise MemberIdentityError(code, message)


def normalize_handle(raw: object) -> HandleValue:
    """Validate a product Name and return its canonical value and lookup key."""

    if not isinstance(raw, str):
        _raise("NAME_REQUIRED", "Name must be a string")

    handle = unicodedata.normalize("NFC", raw.strip())
    length = len(handle)
    if length == 0:
        _raise("NAME_REQUIRED", "Name is required")
    if length > MAX_HANDLE_CODEPOINTS:
        _raise("NAME_TOO_LONG", f"Name must be at most {MAX_HANDLE_CODEPOINTS} characters")
    if handle.startswith("-") or handle.endswith("-"):
        _raise("NAME_INVALID_HYPHEN", "Hyphen may only appear inside a Name")

    for character in handle:
        if character == "-":
            continue
        category = unicodedata.category(character)
        if category.startswith("L") or category == "Nd":
            continue
        _raise("NAME_INVALID_CHARACTER", "Name contains an unsupported character")

    handle_key = unicodedata.normalize("NFKC", handle).casefold()
    if _RESERVED_QUALIFIER_PATTERN.search(handle_key):
        _raise("NAME_RESERVED_SERVER_SUFFIX", "Name ends with a reserved Server qualifier")

    return HandleValue(handle=handle, handle_key=handle_key)


def validate_handle_syntax(raw: object) -> None:
    normalize_handle(raw)


def normalize_description(raw: object) -> str | None:
    """Normalize optional Agent capability text while preserving inner newlines."""

    if raw is None:
        return None
    if not isinstance(raw, str):
        _raise("DESCRIPTION_INVALID", "Description must be a string")
    description = raw.strip()
    if not description:
        return None
    if len(description) > MAX_DESCRIPTION_CODEPOINTS:
        _raise(
            "DESCRIPTION_TOO_LONG",
            f"Description must be at most {MAX_DESCRIPTION_CODEPOINTS} characters",
        )
    return description


def generate_server_handle() -> str:
    return "s" + "".join(secrets.choice(CROCKFORD_ALPHABET) for _ in range(4))


def integrity_constraint_name(error: BaseException) -> str | None:
    """Read a PostgreSQL/asyncpg constraint name without string matching."""

    original = getattr(error, "orig", error)
    direct = getattr(original, "constraint_name", None)
    if direct:
        return str(direct)
    diagnostic = getattr(original, "diag", None)
    value = getattr(diagnostic, "constraint_name", None)
    return str(value) if value else None


def validate_server_handle(value: object) -> str:
    if not isinstance(value, str) or not SERVER_HANDLE_PATTERN.fullmatch(value):
        _raise("SERVER_HANDLE_INVALID", "Server handle has an invalid format")
    return value


def parse_member_reference(token: object) -> ParsedMemberReference:
    """Parse ``@name`` or ``@name-s7k2m`` using the reserved suffix grammar."""

    if not isinstance(token, str) or not token.startswith("@"):
        _raise("REFERENCE_INVALID", "Member reference must start with @")
    body = token[1:]
    if not body:
        _raise("REFERENCE_INVALID", "Member reference is empty")

    normalized_body = unicodedata.normalize("NFKC", body).casefold()
    qualifier_match = _RESERVED_QUALIFIER_PATTERN.search(normalized_body)
    if qualifier_match:
        suffix = qualifier_match.group(0)[1:]
        raw_name = body[: -len(qualifier_match.group(0))]
        handle = normalize_handle(raw_name)
        return ParsedMemberReference(
            handle=handle.handle,
            handle_key=handle.handle_key,
            server_handle=validate_server_handle(suffix),
        )

    handle = normalize_handle(body)
    return ParsedMemberReference(handle=handle.handle, handle_key=handle.handle_key, server_handle=None)
