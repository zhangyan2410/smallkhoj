"""Server-owned memory store helpers.

The route layer owns HTTP shape; this module keeps path, permission, conflict,
search, and retrieval-manifest contracts testable without a database session.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import posixpath
import re
import uuid
from typing import Iterable, Sequence

from fastapi import HTTPException

SAFE_MEMORY_SEGMENT_RE = re.compile(r"^[^/\x00]+$")
SUPPORTED_SCOPE_TYPES = {"agent", "channel", "task", "thread"}


@dataclass(frozen=True)
class MemoryScope:
    type: str
    id: uuid.UUID | str

    def as_dict(self) -> dict:
        return {"type": self.type, "id": str(self.id)}


@dataclass(frozen=True)
class MemoryContentPayload:
    content_text: str
    blob_key: str | None
    file_id: uuid.UUID | None
    mime_type: str
    size_bytes: int


class MemoryConflict(Exception):
    def __init__(self, *, current_sha: str, agent_message: str | None = None) -> None:
        self.current_sha = current_sha
        self.agent_message = agent_message or (
            "Memory changed since you read it. re-read the latest memory, "
            "merge your update, then retry or create a proposal."
        )
        super().__init__(self.agent_message)


def content_sha256(content: str | bytes | None) -> str:
    if content is None:
        content = ""
    if isinstance(content, str):
        content = content.encode("utf-8")
    return hashlib.sha256(content).hexdigest()


def normalize_memory_path(path: str) -> str:
    raw = re.sub(r"/+", "/", (path or "").strip().replace("\\", "/"))
    if not raw:
        raise HTTPException(400, "Missing memory path")
    if raw.startswith("/"):
        raw = raw.lstrip("/")
    cleaned = posixpath.normpath(raw)
    if cleaned in {"", "."}:
        raise HTTPException(400, "Invalid memory path")
    parts = cleaned.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise HTTPException(400, "Unsafe memory path")
    if cleaned != raw:
        raise HTTPException(400, "Unsafe memory path")
    if any(not SAFE_MEMORY_SEGMENT_RE.match(part) for part in parts):
        raise HTTPException(400, "Unsafe memory path")
    return cleaned


def require_matching_base_sha(current_sha: str, base_sha: str | None) -> None:
    if not base_sha:
        return
    if current_sha != base_sha:
        raise MemoryConflict(current_sha=current_sha)


def parse_memory_content_payload(body: dict) -> MemoryContentPayload:
    content_text = body.get("contentText")
    if content_text is None:
        content_text = body.get("content")
    blob_key = _optional_text(body.get("blobKey") or body.get("blob_key"))
    file_id = _optional_uuid(body.get("fileId") or body.get("file_id"), "fileId")
    if content_text is None:
        content_text = ""
    if not isinstance(content_text, str):
        raise HTTPException(400, "contentText must be a string")
    if not content_text and not blob_key and not file_id:
        raise HTTPException(400, "Missing contentText or file/blob reference")
    mime_type = _optional_text(body.get("mimeType") or body.get("mime_type")) or "text/markdown"
    size_bytes = _size_bytes(body.get("sizeBytes") or body.get("size_bytes"), content_text)
    return MemoryContentPayload(
        content_text=content_text,
        blob_key=blob_key,
        file_id=file_id,
        mime_type=mime_type,
        size_bytes=size_bytes,
    )


def ensure_scope_visible(
    scope: MemoryScope,
    member,
    *,
    channel=None,
    task=None,
    is_channel_member: bool = False,
    is_task_visible: bool | None = None,
) -> None:
    if scope.type not in SUPPORTED_SCOPE_TYPES:
        raise HTTPException(400, f"Unsupported memory scope: {scope.type}")

    if scope.type == "agent":
        if str(scope.id) != str(getattr(member, "id", "")):
            raise HTTPException(403, "Agent memory is private")
        return

    if scope.type == "channel":
        if channel is None:
            raise HTTPException(404, "Channel not found")
        if getattr(channel, "kind", None) in {"private", "dm"} and not is_channel_member:
            raise HTTPException(403, "Channel memory is private to channel members")
        return

    if scope.type in {"task", "thread"}:
        if is_task_visible is False:
            raise HTTPException(403, "Task memory is not visible to this member")
        if task is None and is_task_visible is None:
            raise HTTPException(404, "Task not found")
        return


def _entry_text(entry) -> str:
    return " ".join(
        str(value or "")
        for value in (
            getattr(entry, "title", None),
            getattr(entry, "path", None),
            getattr(entry, "content_text", None),
        )
    ).lower()


def _score_entry(entry, terms: Sequence[str]) -> int:
    title = str(getattr(entry, "title", "") or "").lower()
    path = str(getattr(entry, "path", "") or "").lower()
    content = str(getattr(entry, "content_text", "") or "").lower()
    score = 0
    for term in terms:
        if not term:
            continue
        if term in title:
            score += 8
        if term in path:
            score += 5
        if term in content:
            score += 2
    if path == "memory.md":
        score += 1
    return score


def search_memory_entries(entries: Iterable, query: str, *, limit: int = 5) -> list:
    terms = [term.lower() for term in re.findall(r"[\w.-]+", query or "") if term]
    if not terms:
        return list(entries)[:limit]
    scored = [
        (entry, _score_entry(entry, terms))
        for entry in entries
        if any(term in _entry_text(entry) for term in terms)
    ]
    scored.sort(key=lambda item: (-item[1], str(getattr(item[0], "path", ""))))
    return [entry for entry, score in scored if score > 0][:limit]


def _optional_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_uuid(value, label: str) -> uuid.UUID | None:
    text = _optional_text(value)
    if not text:
        return None
    try:
        return uuid.UUID(text)
    except (TypeError, ValueError):
        raise HTTPException(400, f"Invalid {label}")


def _size_bytes(value, content_text: str) -> int:
    if value is None:
        return len(content_text.encode("utf-8"))
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise HTTPException(400, "sizeBytes must be an integer")
    if parsed < 0:
        raise HTTPException(400, "sizeBytes must be non-negative")
    return parsed


def _snippet(content: str | None, *, max_chars: int = 280) -> str:
    text = re.sub(r"\s+", " ", content or "").strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def _manifest_item(entry) -> dict:
    return {
        "id": str(getattr(entry, "id", "")),
        "scopeType": getattr(entry, "scope_type", None),
        "scopeId": str(getattr(entry, "scope_id", "")),
        "path": getattr(entry, "path", None),
        "title": getattr(entry, "title", None),
        "contentSha256": getattr(entry, "content_sha256", None),
        "updatedAt": getattr(getattr(entry, "updated_at", None), "isoformat", lambda: None)(),
        "snippet": _snippet(getattr(entry, "content_text", None)),
    }


def build_memory_context_manifest(
    *,
    session_scope: MemoryScope,
    prompt: str,
    channel_entries: Sequence,
    task_entries: Sequence = (),
    top_k: int = 3,
) -> dict:
    channel_matches = search_memory_entries(channel_entries, prompt, limit=top_k)
    task_matches = search_memory_entries(task_entries, prompt, limit=max(top_k, len(task_entries)))
    return {
        "policy": "selective",
        "sessionScope": session_scope.as_dict(),
        "channelMemories": [_manifest_item(entry) for entry in channel_matches[:top_k]],
        "taskMemories": [_manifest_item(entry) for entry in task_matches[:top_k]],
        "readMore": {
            "channel": "slock memory search --scope channel --query <terms>",
            "task": "slock memory read --scope task --path <path>",
        },
    }
