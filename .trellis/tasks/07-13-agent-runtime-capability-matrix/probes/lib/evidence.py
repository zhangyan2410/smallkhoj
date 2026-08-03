from __future__ import annotations

import datetime as dt
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .redact import redact_text, sanitize_payload


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def normalize_sanitized_evidence(path: Path, *, home: Path | None = None) -> int:
    """Apply newer protocol-content redaction to an already-sanitized file.

    Raw transcripts are intentionally deleted after the first finalization, so
    this function only removes information from an existing task-local evidence
    file. It never reconstructs or consults provider output outside that file.
    """
    path = Path(path).absolute()
    if path.name != "evidence.json":
        raise ValueError("only an evidence.json file may be normalized")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read sanitized evidence: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("observations"), list):
        raise ValueError("sanitized evidence must contain an observations list")

    # The recorder is used only for its pure in-memory structural sanitizer;
    # this /tmp root is never opened or populated by this operation.
    normalizer = EvidenceRecorder(
        raw_root=Path("/tmp/smallkhoj-agent-runtime-capability-matrix/_normalizer"),
        evidence_root=path.parent,
        home=home,
    )
    observations = data["observations"]
    if not all(isinstance(entry, dict) for entry in observations):
        raise ValueError("sanitized evidence observations must contain only objects")
    normalized, summarized_count = normalizer._sanitize_observations(observations, already_sanitized=True)
    session_update_summary_changed = 0
    legacy_update_kinds = data.get("sessionUpdateKinds")
    if isinstance(legacy_update_kinds, list) and all(isinstance(kind, str) for kind in legacy_update_kinds):
        counts: dict[str, int] = {}
        for kind in legacy_update_kinds:
            counts[kind] = counts.get(kind, 0) + 1
        data["sessionUpdateKinds"] = dict(sorted(counts.items()))
        session_update_summary_changed = len(legacy_update_kinds)
    if summarized_count == 0 and session_update_summary_changed == 0:
        return 0

    data["observations"] = normalized
    redaction = data.get("redaction")
    if not isinstance(redaction, dict):
        redaction = {"version": 1, "count": 0, "rawTranscript": "deleted_after_sanitization"}
        data["redaction"] = redaction
    existing_count = redaction.get("count")
    total_change_count = summarized_count + session_update_summary_changed
    redaction["count"] = (existing_count if isinstance(existing_count, int) and existing_count >= 0 else 0) + total_change_count
    data["posthocEvidenceNormalization"] = {
        "protocolFramesSummarized": summarized_count,
        "sessionUpdateChunksAggregated": session_update_summary_changed,
    }
    EvidenceRecorder._atomic_write_json(path, data)
    return total_change_count


@dataclass(frozen=True)
class RawEvidenceHandle:
    run_id: str
    case_id: str
    raw_path: Path


class EvidenceRecorder:
    """Writes raw diagnostics only under `/tmp`, then persists a redacted copy."""

    def __init__(self, *, raw_root: Path, evidence_root: Path, home: Path | None = None) -> None:
        self.raw_root = Path(raw_root).absolute()
        self.evidence_root = Path(evidence_root).absolute()
        self.home = Path.home() if home is None else Path(home)
        tmp_root = Path("/tmp").resolve()
        if not self.raw_root.resolve(strict=False).is_relative_to(tmp_root):
            raise ValueError("raw evidence root must be below /tmp")

    def begin(self, run_id: str, case_id: str) -> RawEvidenceHandle:
        run_id = self._identifier(run_id, "run_id")
        case_id = self._identifier(case_id, "case_id")
        raw_path = self.raw_root / run_id / f"{case_id}.jsonl"
        if raw_path.exists() or raw_path.is_symlink():
            raise ValueError(f"raw evidence path already exists: {raw_path}")
        raw_path.parent.mkdir(parents=True, mode=0o700)
        raw_path.touch(mode=0o600)
        return RawEvidenceHandle(run_id=run_id, case_id=case_id, raw_path=raw_path)

    def append(self, handle: RawEvidenceHandle, *, source: str, kind: str, payload: Any, at: str | None = None) -> None:
        self._assert_handle(handle)
        entry = {
            "at": at or dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
            "source": self._identifier(source, "source"),
            "kind": self._identifier(kind, "kind"),
            "payload": payload,
        }
        try:
            encoded = json.dumps(entry, ensure_ascii=False, sort_keys=True)
        except (TypeError, ValueError) as exc:
            raise ValueError("raw evidence payload must be JSON serializable") from exc
        with handle.raw_path.open("a", encoding="utf-8") as raw_file:
            raw_file.write(encoded)
            raw_file.write("\n")
            raw_file.flush()
            os.fsync(raw_file.fileno())

    def finalize(self, handle: RawEvidenceHandle, evidence: dict[str, Any]) -> Path:
        self._assert_handle(handle)
        if not isinstance(evidence, dict):
            raise ValueError("evidence must be an object")
        raw_text = handle.raw_path.read_text(encoding="utf-8")
        raw_entries = self._parse_jsonl(raw_text)
        evidence_text = json.dumps(evidence, ensure_ascii=False, sort_keys=True)
        redaction_count = redact_text(raw_text, home=self.home).count + redact_text(
            evidence_text, home=self.home
        ).count
        sanitized = sanitize_payload(evidence, home=self.home)
        assert isinstance(sanitized, dict)
        sanitized_observations, structural_redaction_count = self._sanitize_observations(raw_entries)
        sanitized["observations"] = sanitized_observations
        sanitized["redaction"] = {
            "version": 1,
            "count": redaction_count + structural_redaction_count,
            "rawTranscript": "deleted_after_sanitization",
        }
        output_path = self.evidence_root / handle.run_id / handle.case_id / "evidence.json"
        self._atomic_write_json(output_path, sanitized)
        handle.raw_path.unlink()
        self._remove_empty_parents(handle.raw_path.parent, stop_at=self.raw_root)
        return output_path

    def _assert_handle(self, handle: RawEvidenceHandle) -> None:
        if not isinstance(handle, RawEvidenceHandle):
            raise ValueError("handle must be a RawEvidenceHandle")
        expected = self.raw_root / handle.run_id / f"{handle.case_id}.jsonl"
        if handle.raw_path != expected or not handle.raw_path.is_file():
            raise ValueError("raw evidence handle is not owned by this recorder")

    @staticmethod
    def _parse_jsonl(raw_text: str) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for line_number, line in enumerate(raw_text.splitlines(), start=1):
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"raw evidence JSONL is malformed at line {line_number}") from exc
            if not isinstance(parsed, dict):
                raise ValueError(f"raw evidence JSONL line {line_number} must be an object")
            entries.append(parsed)
        return entries

    def _sanitize_observations(
        self,
        entries: list[dict[str, Any]],
        *,
        already_sanitized: bool = False,
    ) -> tuple[list[dict[str, Any]], int]:
        """Keep protocol structure while excluding model text and hook payloads.

        Providers often emit a long sequence of individually short reasoning or
        assistant chunks. A per-string byte cap cannot catch that stream, so
        protocol observations are summarized before regular recursive
        redaction. The full frames remain only in the temporary raw JSONL.
        """
        sanitized_entries: list[dict[str, Any]] = []
        structural_redaction_count = 0
        chunk_counts: dict[tuple[str, str], dict[str, Any]] = {}
        for entry in entries:
            candidate = entry
            kind = entry.get("kind")
            payload = entry.get("payload")
            summary: dict[str, Any] | None = None
            summarized_from_text = False
            if kind in {"acp-frame", "jsonrpc-frame", "stream-json-frame"} and isinstance(payload, dict):
                text = payload.get("text")
                summary = self._protocol_frame_summary(text)
                summarized_from_text = summary is not None
                existing_frame = payload.get("frame")
                if summary is None and isinstance(existing_frame, dict):
                    summary = existing_frame
                if summary is not None:
                    update_kind = summary.get("sessionUpdate")
                    if update_kind in {"agent_thought_chunk", "agent_message_chunk"}:
                        source = entry.get("source") if isinstance(entry.get("source"), str) else "controller"
                        key = (source, update_kind)
                        aggregate = chunk_counts.setdefault(
                            key,
                            {"count": 0, "lastAt": entry.get("at")},
                        )
                        chunk_count = summary.get("chunksRedacted")
                        aggregate["count"] += chunk_count if isinstance(chunk_count, int) and chunk_count > 0 else 1
                        aggregate["lastAt"] = entry.get("at")
                        structural_redaction_count += 1
                        continue
                    if summarized_from_text:
                        candidate = dict(entry)
                        summarized_payload = dict(payload)
                        summarized_payload.pop("text", None)
                        summarized_payload["frame"] = summary
                        candidate["payload"] = summarized_payload
                        structural_redaction_count += 1
            if already_sanitized and not summarized_from_text:
                sanitized_entry = candidate
            else:
                sanitized_entry = sanitize_payload(candidate, home=self.home)
            assert isinstance(sanitized_entry, dict)
            sanitized_entries.append(sanitized_entry)
        for (source, update_kind), aggregate in sorted(chunk_counts.items()):
            summary_entry = {
                "at": aggregate["lastAt"] if isinstance(aggregate["lastAt"], str) else dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
                "source": source,
                "kind": "protocol-summary",
                "payload": {
                    "frame": {
                        "protocol": "jsonrpc",
                        "kind": "aggregate",
                        "sessionUpdate": update_kind,
                        "content": "redacted",
                        "chunksRedacted": aggregate["count"],
                    }
                },
            }
            sanitized_entry = sanitize_payload(summary_entry, home=self.home)
            assert isinstance(sanitized_entry, dict)
            sanitized_entries.append(sanitized_entry)
        return sanitized_entries, structural_redaction_count

    @staticmethod
    def _protocol_frame_summary(text: Any) -> dict[str, Any] | None:
        if not isinstance(text, str):
            return None
        try:
            frame = json.loads(text)
        except json.JSONDecodeError:
            return None
        if not isinstance(frame, dict):
            return None

        method = frame.get("method")
        if isinstance(method, str):
            summary: dict[str, Any] = {
                "protocol": "jsonrpc",
                "kind": "notification" if "id" not in frame else "request",
                "method": method,
            }
            params = frame.get("params")
            if method == "session/update" and isinstance(params, dict):
                update = params.get("update")
                update_kind = update.get("sessionUpdate") if isinstance(update, dict) else None
                if isinstance(update_kind, str):
                    summary["sessionUpdate"] = update_kind
                if isinstance(update, dict) and "content" in update:
                    summary["content"] = "redacted"
            elif method in {"hook/started", "hook/completed"} and isinstance(params, dict):
                run = params.get("run")
                source = run.get("source") if isinstance(run, dict) else None
                if isinstance(source, str):
                    summary["hookSource"] = source
                summary["payload"] = "redacted"
            elif isinstance(params, dict):
                summary["paramsKeys"] = sorted(str(key) for key in params.keys())[:16]
            return summary

        if "id" in frame:
            summary = {"protocol": "jsonrpc", "kind": "response"}
            request_id = frame.get("id")
            if isinstance(request_id, (int, str)):
                summary["requestId"] = request_id
            result = frame.get("result")
            if isinstance(result, dict):
                summary["resultKeys"] = sorted(str(key) for key in result.keys())[:16]
                if isinstance(result.get("stopReason"), str):
                    summary["stopReason"] = result["stopReason"]
                if isinstance(result.get("protocolVersion"), int):
                    summary["protocolVersion"] = result["protocolVersion"]
            error = frame.get("error")
            if isinstance(error, dict):
                summary["errorKeys"] = sorted(str(key) for key in error.keys())[:16]
                if isinstance(error.get("code"), int):
                    summary["errorCode"] = error["code"]
            return summary
        return {"protocol": "jsonrpc", "kind": "unclassified"}

    @staticmethod
    def _identifier(value: str, field: str) -> str:
        if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
            raise ValueError(f"{field} must match {_IDENTIFIER.pattern}")
        return value

    @staticmethod
    def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(data, output, ensure_ascii=False, sort_keys=True, indent=2)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp_name, path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    @staticmethod
    def _remove_empty_parents(path: Path, *, stop_at: Path) -> None:
        while path != stop_at and path.is_dir():
            try:
                path.rmdir()
            except OSError:
                return
            path = path.parent
