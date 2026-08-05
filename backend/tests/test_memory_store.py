import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services.memory_store import (
    MemoryConflict,
    MemoryScope,
    build_memory_context_manifest,
    content_sha256,
    ensure_scope_visible,
    normalize_memory_path,
    parse_memory_content_payload,
    require_matching_base_sha,
    search_memory_entries,
)


def _entry(path, content, *, scope_type="channel", scope_id=None, title=None, updated_at=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        scope_type=scope_type,
        scope_id=scope_id or uuid.uuid4(),
        path=path,
        title=title or path,
        content_text=content,
        content_sha256=content_sha256(content),
        version=1,
        updated_at=updated_at,
        metadata={},
    )


def test_normalize_memory_path_keeps_agent_usable_paths_safe():
    assert normalize_memory_path("MEMORY.md") == "MEMORY.md"
    assert normalize_memory_path("/decisions/channel-memory.md") == "decisions/channel-memory.md"
    assert normalize_memory_path("tasks//task-1/summary.md") == "tasks/task-1/summary.md"

    for unsafe in ("", ".", "../secret.md", "tasks/../../secret.md", "a/./b.md"):
        with pytest.raises(HTTPException) as exc:
            normalize_memory_path(unsafe)
        assert exc.value.status_code == 400


def test_require_matching_base_sha_hides_version_details_behind_cas():
    current = content_sha256("current text")

    require_matching_base_sha(current, current)
    require_matching_base_sha(current, None)

    with pytest.raises(MemoryConflict) as exc:
        require_matching_base_sha(current, content_sha256("older text"))

    assert exc.value.current_sha == current
    assert "re-read" in exc.value.agent_message


def test_parse_memory_content_payload_accepts_file_backed_artifacts_without_markdown_body():
    file_id = uuid.uuid4()

    payload = parse_memory_content_payload({
        "fileId": str(file_id),
        "mimeType": "image/png",
        "sizeBytes": 2048,
        "metadata": {"artifactKind": "screenshot"},
    })

    assert payload.content_text == ""
    assert payload.file_id == file_id
    assert payload.mime_type == "image/png"
    assert payload.size_bytes == 2048


def test_parse_memory_content_payload_still_requires_text_or_blob_reference():
    with pytest.raises(HTTPException) as exc:
        parse_memory_content_payload({})

    assert exc.value.status_code == 400


def test_ensure_scope_visible_enforces_private_channel_membership():
    member_id = uuid.uuid4()
    private_channel = SimpleNamespace(id=uuid.uuid4(), kind="private")
    public_channel = SimpleNamespace(id=uuid.uuid4(), kind="public")
    member = SimpleNamespace(id=member_id)

    ensure_scope_visible(MemoryScope("channel", public_channel.id), member, channel=public_channel, is_channel_member=False)
    ensure_scope_visible(MemoryScope("channel", private_channel.id), member, channel=private_channel, is_channel_member=True)

    with pytest.raises(HTTPException) as exc:
        ensure_scope_visible(MemoryScope("channel", private_channel.id), member, channel=private_channel, is_channel_member=False)

    assert exc.value.status_code == 403


def test_search_memory_entries_is_selective_and_ranks_title_path_and_content():
    entries = [
        _entry("MEMORY.md", "General channel overview"),
        _entry("decisions/channel-memory.md", "Server-owned channel memory CAS decision"),
        _entry("tasks/task-9/summary.md", "Task evidence and final screenshots"),
        _entry("references/files.md", "Blob storage and object references"),
    ]

    results = search_memory_entries(entries, "channel memory decision", limit=2)

    assert [item.path for item in results] == ["decisions/channel-memory.md", "MEMORY.md"]


def test_context_manifest_never_injects_full_channel_memory():
    channel_entries = [
        _entry("MEMORY.md", "Channel summary\n" + ("long " * 200)),
        _entry("decisions/channel-memory.md", "Use server-owned channel memory and CAS conflict checks."),
        _entry("references/blob-storage.md", "Screenshots, videos, and binary evidence live as blob references."),
    ]
    task_entries = [
        _entry("tasks/task-9/plan.md", "Break work into backend, daemon, frontend, and evidence slices.", scope_type="task"),
        _entry("tasks/task-9/evidence.md", "REAL_channel_memory marker screenshot and API proof.", scope_type="task"),
    ]

    manifest = build_memory_context_manifest(
        session_scope=MemoryScope("task", uuid.uuid4()),
        prompt="Need channel memory screenshots and task evidence",
        channel_entries=channel_entries,
        task_entries=task_entries,
        top_k=2,
    )

    assert manifest["policy"] == "selective"
    assert manifest["sessionScope"]["type"] == "task"
    assert len(manifest["channelMemories"]) == 2
    assert len(manifest["taskMemories"]) == 2
    assert all(len(item["snippet"]) <= 280 for item in manifest["channelMemories"])
    assert manifest["readMore"] == {
        "channel": "aura memory search --scope channel --query <terms>",
        "task": "aura memory read --scope task --path <path>",
    }
    assert "slock memory" not in str(manifest).lower()
    assert "raft memory" not in str(manifest).lower()
    assert "full channel memory" not in str(manifest).lower()
