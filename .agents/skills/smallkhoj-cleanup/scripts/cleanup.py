#!/usr/bin/env python3
"""Audit and safely remove a narrow allow-list of SmallKhoj dev artifacts."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable, Sequence


SCHEMA_VERSION = 1
LARGE_LOG_BYTES = 512 * 1024 * 1024
LARGE_LOG_AGE_SECONDS = 24 * 60 * 60
OLD_LOG_AGE_SECONDS = 14 * 24 * 60 * 60
CACHE_AGE_SECONDS = 24 * 60 * 60
PLAN_MAX_AGE_SECONDS = 60 * 60
FUTURE_CLOCK_SKEW_SECONDS = 5 * 60

UTC = timezone.utc
STATUS_ORDER = ("eligible", "blocked", "report_only", "active", "normal")
PROCESS_FIELDS = (
    "pid",
    "ppid",
    "rssKiB",
    "cpuPercent",
    "elapsed",
    "executable",
    "cwd",
    "worktree",
    "category",
)
VM_STAT_CURRENT_PAGE_KEYS = {
    "Pages free",
    "Pages active",
    "Pages inactive",
    "Pages speculative",
    "Pages throttled",
    "Pages wired down",
    "Pages purgeable",
    "File-backed pages",
    "Anonymous pages",
    "Pages occupied by compressor",
}


class CleanupError(RuntimeError):
    """Base class for expected, sanitized cleanup failures."""


class SafetyError(CleanupError):
    def __init__(self, message: str, *, reason_code: str = "unsafe-target") -> None:
        super().__init__(message)
        self.reason_code = reason_code


class PlanError(CleanupError):
    """Raised when a cleanup plan is malformed, tampered, or expired."""


class ConfirmationError(CleanupError):
    """Raised when apply confirmation does not match the exact plan id."""


@dataclass(frozen=True)
class OpenCheck:
    state: str
    detail: str = ""

    def __post_init__(self) -> None:
        if self.state not in {"closed", "open", "unavailable"}:
            raise ValueError(f"invalid open-check state: {self.state}")


@dataclass(frozen=True)
class WorktreeEvidence:
    path: str
    dirty: bool
    active_frontend: bool
    ownership_available: bool


def _absolute(path: Path | str) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _canonical_root(path: Path | str) -> Path:
    return Path(os.path.realpath(_absolute(path)))


def _canonical_without_leaf(path: Path | str) -> Path:
    """Resolve parent aliases without following the candidate leaf symlink."""
    absolute = _absolute(path)
    return Path(os.path.realpath(absolute.parent)) / absolute.name


def _is_lexically_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _age_seconds(now_ns: int, mtime_ns: int) -> float:
    return (now_ns - mtime_ns) / 1_000_000_000


def _allocated_bytes(file_stat: os.stat_result) -> int:
    return int(getattr(file_stat, "st_blocks", 0)) * 512


def _tree_fingerprint(path: Path, root_stat: os.stat_result) -> dict:
    digest = hashlib.sha256()
    tree_bytes = 0
    allocated_bytes = _allocated_bytes(root_stat)
    newest_mtime_ns = root_stat.st_mtime_ns
    entry_count = 0

    def visit(directory: Path, relative: Path) -> None:
        nonlocal tree_bytes, allocated_bytes, newest_mtime_ns, entry_count
        try:
            entries = sorted(os.scandir(directory), key=lambda item: item.name)
        except OSError as exc:
            raise SafetyError(
                f"cannot inspect directory candidate: {directory}: {exc}",
                reason_code="tree-unreadable",
            ) from exc

        for entry in entries:
            child = directory / entry.name
            child_relative = relative / entry.name
            try:
                child_stat = entry.stat(follow_symlinks=False)
            except OSError as exc:
                raise SafetyError(
                    f"cannot stat candidate entry: {child}: {exc}",
                    reason_code="tree-unreadable",
                ) from exc
            if stat.S_ISLNK(child_stat.st_mode):
                raise SafetyError(
                    f"candidate tree contains a symlink: {child}",
                    reason_code="tree-symlink",
                )
            if stat.S_ISDIR(child_stat.st_mode):
                entry_type = "directory"
            elif stat.S_ISREG(child_stat.st_mode):
                entry_type = "file"
                tree_bytes += child_stat.st_size
            else:
                raise SafetyError(
                    f"candidate tree contains a special entry: {child}",
                    reason_code="tree-special-entry",
                )

            newest_mtime_ns = max(newest_mtime_ns, child_stat.st_mtime_ns)
            allocated_bytes += _allocated_bytes(child_stat)
            entry_count += 1
            record = "\0".join(
                (
                    entry_type,
                    child_relative.as_posix(),
                    str(child_stat.st_dev),
                    str(child_stat.st_ino),
                    str(child_stat.st_size),
                    str(child_stat.st_mtime_ns),
                )
            )
            digest.update(record.encode("utf-8", errors="surrogateescape"))
            digest.update(b"\0")
            if entry_type == "directory":
                visit(child, child_relative)

    visit(path, Path())
    return {
        "type": "directory",
        "device": root_stat.st_dev,
        "inode": root_stat.st_ino,
        "size": root_stat.st_size,
        "mtimeNs": root_stat.st_mtime_ns,
        "treeHash": digest.hexdigest(),
        "treeBytes": tree_bytes,
        "allocatedBytes": allocated_bytes,
        "newestMtimeNs": newest_mtime_ns,
        "entryCount": entry_count,
    }


def fingerprint_path(path: Path | str) -> dict:
    candidate = _canonical_without_leaf(path)
    try:
        candidate_stat = os.lstat(candidate)
    except OSError as exc:
        raise SafetyError(
            f"cannot stat candidate: {candidate}: {exc}",
            reason_code="candidate-missing",
        ) from exc
    if stat.S_ISLNK(candidate_stat.st_mode):
        raise SafetyError(
            f"candidate is a symlink: {candidate}",
            reason_code="symlink",
        )
    if stat.S_ISREG(candidate_stat.st_mode):
        return {
            "type": "file",
            "device": candidate_stat.st_dev,
            "inode": candidate_stat.st_ino,
            "size": candidate_stat.st_size,
            "mtimeNs": candidate_stat.st_mtime_ns,
            "allocatedBytes": _allocated_bytes(candidate_stat),
        }
    if stat.S_ISDIR(candidate_stat.st_mode):
        return _tree_fingerprint(candidate, candidate_stat)
    raise SafetyError(
        f"candidate has an unsupported file type: {candidate}",
        reason_code="special-entry",
    )


def _base_finding(category: str, path: Path, worktree: Path) -> dict:
    return {
        "category": category,
        "status": "blocked",
        "path": str(path),
        "worktree": str(worktree),
        "bytes": 0,
        "reasonCodes": [],
        "evidence": {},
    }


def classify_log(
    path: Path | str,
    worktree: Path | str,
    *,
    now_ns: int,
    open_check: OpenCheck,
) -> dict:
    candidate = _canonical_without_leaf(path)
    root = _canonical_root(worktree)
    finding = _base_finding("inactive-log", candidate, root)
    allowed_parent = root / ".dev-logs"
    if candidate.parent != allowed_parent or not candidate.name.endswith(".log"):
        finding["reasonCodes"] = ["path-not-allowlisted"]
        return finding

    try:
        candidate_stat = os.lstat(candidate)
    except OSError:
        finding["reasonCodes"] = ["candidate-missing"]
        return finding
    if stat.S_ISLNK(candidate_stat.st_mode):
        finding["reasonCodes"] = ["symlink"]
        return finding
    if not stat.S_ISREG(candidate_stat.st_mode):
        finding["reasonCodes"] = ["not-regular-file"]
        return finding

    fingerprint = fingerprint_path(candidate)
    finding["bytes"] = candidate_stat.st_size
    finding["fingerprint"] = fingerprint
    age_seconds = _age_seconds(now_ns, candidate_stat.st_mtime_ns)
    finding["evidence"] = {
        "ageHours": round(age_seconds / 3600, 2),
        "openCheck": open_check.state,
    }
    if age_seconds < -FUTURE_CLOCK_SKEW_SECONDS:
        finding["reasonCodes"] = ["future-mtime"]
        return finding
    if open_check.state == "open":
        finding["status"] = "active"
        finding["reasonCodes"] = ["file-open"]
        return finding
    if open_check.state == "unavailable":
        finding["reasonCodes"] = ["open-check-unavailable"]
        return finding

    is_large_and_stale = (
        candidate_stat.st_size >= LARGE_LOG_BYTES
        and age_seconds >= LARGE_LOG_AGE_SECONDS
    )
    is_old = age_seconds >= OLD_LOG_AGE_SECONDS
    if is_large_and_stale or is_old:
        finding["status"] = "eligible"
        finding["reasonCodes"] = [
            "large-log-stale" if is_large_and_stale else "old-log"
        ]
    else:
        finding["status"] = "normal"
        finding["reasonCodes"] = ["log-below-stale-threshold"]
    return finding


def classify_cache(
    path: Path | str,
    worktree: WorktreeEvidence,
    *,
    now_ns: int,
    open_check: OpenCheck,
) -> dict:
    candidate = _canonical_without_leaf(path)
    root = _canonical_root(worktree.path)
    finding = _base_finding("turbopack-cache", candidate, root)
    allowed = root / "frontend" / ".next" / "dev" / "cache" / "turbopack"
    if candidate != allowed:
        finding["reasonCodes"] = ["path-not-allowlisted"]
        return finding

    try:
        candidate_stat = os.lstat(candidate)
    except OSError:
        finding["reasonCodes"] = ["candidate-missing"]
        return finding
    if stat.S_ISLNK(candidate_stat.st_mode):
        finding["reasonCodes"] = ["symlink"]
        return finding
    if not stat.S_ISDIR(candidate_stat.st_mode):
        finding["reasonCodes"] = ["not-directory"]
        return finding

    try:
        fingerprint = fingerprint_path(candidate)
    except SafetyError as exc:
        finding["reasonCodes"] = [exc.reason_code]
        return finding
    finding["fingerprint"] = fingerprint
    finding["bytes"] = fingerprint["treeBytes"]
    age_seconds = _age_seconds(now_ns, fingerprint["newestMtimeNs"])
    finding["evidence"] = {
        "ageHours": round(age_seconds / 3600, 2),
        "openCheck": open_check.state,
        "dirtyWorktree": worktree.dirty,
        "activeFrontend": worktree.active_frontend,
        "entryCount": fingerprint["entryCount"],
    }

    if not worktree.ownership_available:
        finding["reasonCodes"] = ["ownership-check-unavailable"]
        return finding
    if worktree.active_frontend:
        finding["status"] = "active"
        finding["reasonCodes"] = ["active-frontend-worktree"]
        return finding
    if worktree.dirty:
        finding["status"] = "report_only"
        finding["reasonCodes"] = ["dirty-worktree-cache"]
        return finding
    if open_check.state == "open":
        finding["status"] = "active"
        finding["reasonCodes"] = ["cache-open"]
        return finding
    if open_check.state == "unavailable":
        finding["reasonCodes"] = ["open-check-unavailable"]
        return finding
    if age_seconds < -FUTURE_CLOCK_SKEW_SECONDS:
        finding["reasonCodes"] = ["future-mtime"]
        return finding
    if age_seconds < CACHE_AGE_SECONDS:
        finding["status"] = "normal"
        finding["reasonCodes"] = ["cache-too-recent"]
        return finding

    finding["status"] = "eligible"
    finding["reasonCodes"] = ["inactive-turbopack-cache"]
    return finding


def summarize_findings(findings: Iterable[dict]) -> dict:
    summary = {status_name: {"count": 0, "bytes": 0} for status_name in STATUS_ORDER}
    for finding in findings:
        status_name = finding.get("status")
        if status_name not in summary:
            continue
        summary[status_name]["count"] += 1
        value = finding.get("bytes", 0)
        if isinstance(value, int) and value >= 0:
            summary[status_name]["bytes"] += value
    return summary


def _format_time(value: datetime) -> str:
    normalized = value.astimezone(UTC)
    return normalized.isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_time(value: object, field: str) -> datetime:
    if not isinstance(value, str):
        raise PlanError(f"plan field {field} must be a timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PlanError(f"plan field {field} is not a valid timestamp") from exc
    if parsed.tzinfo is None:
        raise PlanError(f"plan field {field} must include a timezone")
    return parsed.astimezone(UTC)


def canonical_plan_id(plan: dict) -> str:
    payload = copy.deepcopy(plan)
    payload.pop("planId", None)
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_plan_from_candidates(
    repository: dict,
    candidates: Sequence[dict],
    *,
    created_at: datetime | None = None,
    non_eligible: Sequence[dict] | None = None,
) -> dict:
    created = (created_at or datetime.now(UTC)).astimezone(UTC)
    expires = created + timedelta(seconds=PLAN_MAX_AGE_SECONDS)
    plan = {
        "schemaVersion": SCHEMA_VERSION,
        "createdAt": _format_time(created),
        "expiresAt": _format_time(expires),
        "repository": json.loads(json.dumps(repository)),
        "candidates": json.loads(json.dumps(list(candidates))),
        "nonEligible": json.loads(json.dumps(list(non_eligible or []))),
    }
    plan["planId"] = canonical_plan_id(plan)
    return plan


def build_plan(
    repository: dict,
    findings: Sequence[dict],
    *,
    created_at: datetime | None = None,
) -> dict:
    candidates = []
    non_eligible = []
    for finding in findings:
        compact = {
            key: copy.deepcopy(finding[key])
            for key in (
                "category",
                "path",
                "worktree",
                "bytes",
                "reasonCodes",
                "fingerprint",
            )
            if key in finding
        }
        if finding.get("status") == "eligible":
            candidates.append(compact)
        else:
            non_eligible.append(
                {
                    key: copy.deepcopy(finding[key])
                    for key in (
                        "category",
                        "status",
                        "path",
                        "bytes",
                        "reasonCodes",
                    )
                    if key in finding
                }
            )
    return build_plan_from_candidates(
        repository,
        candidates,
        created_at=created_at,
        non_eligible=non_eligible,
    )


def validate_plan_integrity(plan: object, *, now: datetime | None = None) -> None:
    if not isinstance(plan, dict):
        raise PlanError("plan must be a JSON object")
    if plan.get("schemaVersion") != SCHEMA_VERSION:
        raise PlanError("unsupported plan schema version")
    plan_id = plan.get("planId")
    if not isinstance(plan_id, str) or not re.fullmatch(r"[0-9a-f]{64}", plan_id):
        raise PlanError("plan id is missing or malformed")
    if canonical_plan_id(plan) != plan_id:
        raise PlanError("plan id does not match the plan contents")
    if not isinstance(plan.get("repository"), dict):
        raise PlanError("plan repository identity is missing")
    if not isinstance(plan.get("candidates"), list):
        raise PlanError("plan candidates must be a list")
    seen_paths = set()
    for candidate in plan["candidates"]:
        if not isinstance(candidate, dict):
            raise PlanError("plan candidate must be an object")
        candidate_path = candidate.get("path")
        if not isinstance(candidate_path, str) or not candidate_path:
            raise PlanError("plan candidate path is malformed")
        if candidate_path in seen_paths:
            raise PlanError("plan contains a duplicate candidate path")
        seen_paths.add(candidate_path)
    created = _parse_time(plan.get("createdAt"), "createdAt")
    expires = _parse_time(plan.get("expiresAt"), "expiresAt")
    if expires <= created:
        raise PlanError("plan expiry must be after creation")
    if (expires - created).total_seconds() > PLAN_MAX_AGE_SECONDS:
        raise PlanError("plan validity window exceeds policy")
    current = (now or datetime.now(UTC)).astimezone(UTC)
    if created > current + timedelta(seconds=FUTURE_CLOCK_SKEW_SECONDS):
        raise PlanError("plan creation time is in the future")
    if current > expires:
        raise PlanError("plan has expired; run a fresh audit")


def _repository_matches(planned: dict, current: dict) -> bool:
    keys = ("requestedRoot", "commonDir", "head", "branch")
    return all(planned.get(key) == current.get(key) for key in keys)


def remove_tree_no_symlinks(path: Path | str) -> None:
    root = _canonical_without_leaf(path)
    root_stat = os.lstat(root)
    if stat.S_ISLNK(root_stat.st_mode) or not stat.S_ISDIR(root_stat.st_mode):
        raise SafetyError("directory candidate changed type before deletion")
    entries = sorted(os.scandir(root), key=lambda item: item.name)
    for entry in entries:
        child = root / entry.name
        child_stat = entry.stat(follow_symlinks=False)
        if stat.S_ISLNK(child_stat.st_mode):
            raise SafetyError(
                f"symlink appeared during deletion: {child}",
                reason_code="tree-symlink",
            )
        if stat.S_ISDIR(child_stat.st_mode):
            remove_tree_no_symlinks(child)
        elif stat.S_ISREG(child_stat.st_mode):
            child.unlink()
        else:
            raise SafetyError(
                f"special entry appeared during deletion: {child}",
                reason_code="tree-special-entry",
            )
    root.rmdir()


def apply_plan_data(
    plan: dict,
    *,
    confirmation: str,
    repository: dict,
    worktrees: dict[str, WorktreeEvidence],
    open_probe: Callable[[Path, bool], OpenCheck],
    now: datetime | None = None,
) -> dict:
    current_time = (now or datetime.now(UTC)).astimezone(UTC)
    validate_plan_integrity(plan, now=current_time)
    if confirmation != plan["planId"]:
        raise ConfirmationError("confirmation token does not match this plan id")
    if not _repository_matches(plan["repository"], repository):
        raise SafetyError("repository identity changed after audit")

    now_ns = int(current_time.timestamp() * 1_000_000_000)
    preflighted = []
    for candidate in plan["candidates"]:
        if not isinstance(candidate, dict):
            raise PlanError("plan candidate must be an object")
        category = candidate.get("category")
        path_value = candidate.get("path")
        worktree_value = candidate.get("worktree")
        if category not in {"inactive-log", "turbopack-cache"}:
            raise SafetyError("plan contains a non-allowlisted category")
        if not isinstance(path_value, str) or not isinstance(worktree_value, str):
            raise PlanError("candidate path/worktree is malformed")
        path = _canonical_without_leaf(path_value)
        root = _canonical_root(worktree_value)
        evidence = worktrees.get(str(root))
        if evidence is None:
            raise SafetyError(f"candidate worktree is no longer registered: {root}")
        if _canonical_root(evidence.path) != root:
            raise SafetyError(f"candidate worktree identity changed: {root}")

        check = open_probe(path, category == "turbopack-cache")
        if category == "inactive-log":
            finding = classify_log(
                path,
                root,
                now_ns=now_ns,
                open_check=check,
            )
        else:
            finding = classify_cache(
                path,
                evidence,
                now_ns=now_ns,
                open_check=check,
            )
        if finding.get("status") != "eligible":
            reasons = ",".join(finding.get("reasonCodes", [])) or "not-eligible"
            raise SafetyError(f"candidate failed apply preflight: {path}: {reasons}")
        if finding.get("fingerprint") != candidate.get("fingerprint"):
            raise SafetyError(f"candidate fingerprint drifted after audit: {path}")
        if finding.get("bytes") != candidate.get("bytes"):
            raise SafetyError(f"candidate byte count drifted after audit: {path}")
        preflighted.append((candidate, path))

    deleted = []
    failed = []
    skipped = []
    for index, (candidate, path) in enumerate(preflighted):
        try:
            if candidate["category"] == "inactive-log":
                path.unlink()
            else:
                remove_tree_no_symlinks(path)
        except (OSError, SafetyError) as exc:
            failed.append({"path": str(path), "error": str(exc)})
            skipped.extend(
                {"path": str(remaining_path), "reason": "stopped-after-delete-failure"}
                for _, remaining_path in preflighted[index + 1 :]
            )
            break
        deleted.append(
            {
                "path": str(path),
                "category": candidate["category"],
                "bytes": candidate["bytes"],
                "absent": not os.path.lexists(path),
            }
        )

    return {
        "planId": plan["planId"],
        "expectedBytes": sum(
            candidate.get("bytes", 0)
            for candidate in plan["candidates"]
            if isinstance(candidate.get("bytes", 0), int)
        ),
        "reclaimedBytes": sum(item["bytes"] for item in deleted),
        "deletedCount": len(deleted),
        "failedCount": len(failed),
        "skippedCount": len(skipped),
        "deleted": deleted,
        "failed": failed,
        "skipped": skipped,
    }


def sanitize_process(raw: dict) -> dict:
    return {key: raw[key] for key in PROCESS_FIELDS if key in raw}


def _format_bytes(value: object) -> str:
    if not isinstance(value, int) or value < 0:
        return "unknown"
    units = ("B", "KiB", "MiB", "GiB", "TiB")
    amount = float(value)
    for unit in units:
        if amount < 1024 or unit == units[-1]:
            return f"{amount:.2f} {unit}"
        amount /= 1024
    return f"{value} B"


def render_human(report: dict) -> str:
    mode = str(report.get("mode", "unknown")).upper()
    lines = [f"SmallKhoj cleanup {mode}"]
    if report.get("mode") == "audit":
        summary = report.get("summary", {})
        for status_name in STATUS_ORDER:
            record = summary.get(status_name, {})
            lines.append(
                f"- {status_name}: {record.get('count', 0)} finding(s), "
                f"{_format_bytes(record.get('bytes', 0))}"
            )
        eligible = [
            finding
            for finding in report.get("findings", [])
            if finding.get("status") == "eligible"
        ]
        if eligible:
            lines.append("Eligible candidates:")
            for finding in eligible:
                lines.append(
                    f"- {finding.get('path')} ({_format_bytes(finding.get('bytes'))}; "
                    f"{','.join(finding.get('reasonCodes', []))})"
                )
        else:
            lines.append("Eligible candidates: none")
        plan = report.get("plan") or {}
        if plan.get("planId"):
            lines.append(f"Plan id: {plan['planId']}")
        lines.append("No cleanup targets were changed (audit-only).")
    elif report.get("mode") == "apply":
        result = report.get("applyResult", {})
        lines.append(
            f"- deleted: {result.get('deletedCount', 0)}; "
            f"failed: {result.get('failedCount', 0)}; "
            f"skipped: {result.get('skippedCount', 0)}"
        )
        lines.append(
            f"- expected: {_format_bytes(result.get('expectedBytes', 0))}; "
            f"deleted-candidate bytes: {_format_bytes(result.get('reclaimedBytes', 0))}"
        )
    limitations = report.get("limitations") or []
    if limitations:
        lines.append("Limitations:")
        lines.extend(f"- {item}" for item in limitations)
    return "\n".join(lines)


def _run_command(
    args: Sequence[str],
    *,
    cwd: Path | str | None = None,
    timeout: int = 45,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            list(args),
            cwd=os.fspath(cwd) if cwd is not None else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
            check=False,
            shell=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return subprocess.CompletedProcess(
            list(args),
            127,
            stdout="",
            stderr=type(exc).__name__,
        )


def _git(
    repo: Path | str, *args: str, timeout: int = 45
) -> subprocess.CompletedProcess[str]:
    return _run_command(("git", "-C", os.fspath(repo), *args), timeout=timeout)


def _parse_worktrees(output: str) -> list[dict]:
    records = []
    current: dict = {}
    for line in output.splitlines() + [""]:
        if not line:
            if current:
                if "branch" in current:
                    current["branch"] = current["branch"].removeprefix("refs/heads/")
                records.append(current)
                current = {}
            continue
        key, _, value = line.partition(" ")
        current[key] = True if key in {"bare", "detached"} else value
    return records


def discover_repository(repo_value: Path | str) -> dict:
    requested = _absolute(repo_value)
    if not requested.is_dir():
        raise SafetyError(f"repository path is not a local directory: {requested}")
    top = _git(requested, "rev-parse", "--show-toplevel")
    if top.returncode != 0 or not top.stdout.strip():
        raise SafetyError(f"path is not a Git worktree: {requested}")
    root = Path(top.stdout.strip()).resolve()
    for marker in (".trellis", "frontend", "backend"):
        if not (root / marker).exists():
            raise SafetyError(f"repository is missing SmallKhoj marker: {marker}")

    common_result = _git(root, "rev-parse", "--git-common-dir")
    head_result = _git(root, "rev-parse", "HEAD")
    branch_result = _git(root, "symbolic-ref", "--quiet", "--short", "HEAD")
    worktree_result = _git(root, "worktree", "list", "--porcelain")
    if any(
        result.returncode != 0
        for result in (common_result, head_result, worktree_result)
    ):
        raise SafetyError("cannot establish repository identity")
    common_value = Path(common_result.stdout.strip())
    common_dir = (
        common_value.resolve()
        if common_value.is_absolute()
        else (root / common_value).resolve()
    )
    worktrees = _parse_worktrees(worktree_result.stdout)
    canonical_roots = {str(Path(record["worktree"]).resolve()) for record in worktrees}
    if str(root) not in canonical_roots:
        raise SafetyError("requested worktree is not registered with the repository")
    return {
        "root": root,
        "identity": {
            "requestedRoot": str(root),
            "commonDir": str(common_dir),
            "head": head_result.stdout.strip(),
            "branch": branch_result.stdout.strip()
            if branch_result.returncode == 0
            else None,
        },
        "worktrees": worktrees,
    }


def _path_owner(path: str | None, worktree_roots: list[str]) -> str | None:
    if not path:
        return None
    candidate = _absolute(path)
    matches = []
    for root_value in worktree_roots:
        root = _absolute(root_value)
        if candidate == root or _is_lexically_within(candidate, root):
            matches.append(str(root))
    return max(matches, key=len) if matches else None


def _process_category(executable: str) -> str:
    name = Path(executable).name.lower()
    if any(token in name for token in ("node", "next", "npm", "pnpm", "yarn", "bun")):
        return "frontend"
    if any(token in name for token in ("python", "uvicorn", "gunicorn", "uv")):
        return "backend"
    if any(token in name for token in ("codex", "claude", "zcode", "gemini")):
        return "agent"
    return "other"


def _collect_processes(worktree_roots: list[str]) -> tuple[list[dict], bool, list[str]]:
    limitations = []
    ps_result = _run_command(
        ("ps", "-axo", "pid=,ppid=,rss=,%cpu=,etime=,comm="),
        timeout=30,
    )
    processes: dict[int, dict] = {}
    if ps_result.returncode != 0:
        limitations.append("process metrics unavailable: ps failed")
    else:
        for line in ps_result.stdout.splitlines():
            parts = line.strip().split(None, 5)
            if len(parts) != 6:
                continue
            pid_text, ppid_text, rss_text, cpu_text, elapsed, executable = parts
            try:
                pid = int(pid_text)
                processes[pid] = {
                    "pid": pid,
                    "ppid": int(ppid_text),
                    "rssKiB": int(rss_text),
                    "cpuPercent": float(cpu_text),
                    "elapsed": elapsed,
                    "executable": Path(executable).name,
                }
            except ValueError:
                continue

    if shutil.which("lsof") is None:
        limitations.append("process cwd/open-file ownership unavailable: lsof missing")
        return [], False, limitations
    lsof_result = _run_command(("lsof", "-d", "cwd", "-Fpn"), timeout=45)
    if lsof_result.returncode != 0:
        limitations.append("process cwd/open-file ownership unavailable: lsof failed")
        return [], False, limitations

    current_pid: int | None = None
    for line in lsof_result.stdout.splitlines():
        if line.startswith("p"):
            try:
                current_pid = int(line[1:])
            except ValueError:
                current_pid = None
        elif line.startswith("n") and current_pid is not None:
            record = processes.setdefault(
                current_pid,
                {
                    "pid": current_pid,
                    "ppid": 0,
                    "rssKiB": 0,
                    "cpuPercent": 0.0,
                    "elapsed": "unknown",
                    "executable": "unknown",
                },
            )
            record["cwd"] = line[1:]

    for record in processes.values():
        owner = _path_owner(record.get("cwd"), worktree_roots)
        if owner:
            record["worktree"] = owner
    changed = True
    while changed:
        changed = False
        for record in processes.values():
            if record.get("worktree"):
                continue
            parent = processes.get(record.get("ppid"))
            if parent and parent.get("worktree"):
                record["worktree"] = parent["worktree"]
                changed = True

    owned = []
    for record in processes.values():
        if not record.get("worktree"):
            continue
        record["category"] = _process_category(record.get("executable", ""))
        owned.append(sanitize_process(record))
    owned.sort(key=lambda item: item.get("pid", 0))
    return owned, True, limitations


def _du_bytes(path: Path) -> int | None:
    if shutil.which("du") is None:
        return None
    result = _run_command(("du", "-sk", str(path)), timeout=90)
    if result.returncode != 0:
        return None
    first = result.stdout.split(None, 1)
    try:
        return int(first[0]) * 1024
    except (IndexError, ValueError):
        return None


def _collect_worktree_evidence(
    repository: dict,
    processes: list[dict],
    *,
    ownership_available: bool,
) -> tuple[dict[str, WorktreeEvidence], list[dict], list[str]]:
    states = {}
    findings = []
    limitations = []
    for record in repository["worktrees"]:
        root = Path(record["worktree"]).resolve()
        status_result = _git(root, "status", "--porcelain=v1", "-uall", timeout=90)
        status_available = status_result.returncode == 0
        dirty_entries = (
            len(status_result.stdout.splitlines()) if status_available else None
        )
        if not status_available:
            limitations.append(f"Git status unavailable for worktree: {root}")
        owned = [item for item in processes if item.get("worktree") == str(root)]
        active_frontend = any(item.get("category") == "frontend" for item in owned)
        state = WorktreeEvidence(
            path=str(root),
            dirty=True if dirty_entries is None else dirty_entries > 0,
            active_frontend=active_frontend,
            ownership_available=ownership_available,
        )
        states[str(root)] = state
        size = _du_bytes(root)
        if size is None:
            limitations.append(f"worktree size unavailable: {root}")
        findings.append(
            {
                "category": "worktree",
                "status": "active" if owned else "report_only",
                "path": str(root),
                "worktree": str(root),
                "bytes": size or 0,
                "reasonCodes": ["active-worktree" if owned else "git-report-only"],
                "evidence": {
                    "branch": record.get("branch"),
                    "head": record.get("HEAD"),
                    "dirtyEntries": dirty_entries,
                    "activePids": [item.get("pid") for item in owned],
                },
            }
        )
    return states, findings, limitations


def _live_open_probe(path: Path, recursive: bool) -> OpenCheck:
    if shutil.which("lsof") is None:
        return OpenCheck("unavailable", "lsof-missing")
    args = ("lsof", "+D", str(path)) if recursive else ("lsof", "--", str(path))
    result = _run_command(args, timeout=45)
    if result.returncode == 1 and not result.stdout and not result.stderr:
        return OpenCheck("closed")
    if result.returncode == 0 and result.stdout:
        return OpenCheck("open", "opener-present")
    return OpenCheck("unavailable", "lsof-inconclusive")


def _discover_logs(worktree: Path) -> list[Path]:
    log_dir = worktree / ".dev-logs"
    if not log_dir.is_dir():
        return []
    try:
        return sorted(
            (
                log_dir / entry.name
                for entry in os.scandir(log_dir)
                if entry.name.endswith(".log")
            ),
            key=lambda path: path.name,
        )
    except OSError:
        return []


def parse_vm_stat(output: str) -> dict[str, int]:
    """Convert current macOS VM page-state fields to bytes, excluding counters."""
    page_match = re.search(r"page size of (\d+) bytes", output)
    page_size = int(page_match.group(1)) if page_match else 4096
    pages = {}
    for line in output.splitlines()[1:]:
        key, separator, value = line.partition(":")
        normalized_key = key.strip()
        if not separator or normalized_key not in VM_STAT_CURRENT_PAGE_KEYS:
            continue
        number = value.strip().rstrip(".")
        if number.isdigit():
            pages[normalized_key] = int(number) * page_size
    return pages


def _collect_memory_finding() -> tuple[dict, list[str]]:
    limitations = []
    evidence: dict = {"platform": platform.system()}
    if platform.system() == "Darwin":
        total = _run_command(("sysctl", "-n", "hw.memsize"), timeout=10)
        if total.returncode == 0 and total.stdout.strip().isdigit():
            evidence["totalBytes"] = int(total.stdout.strip())
        else:
            limitations.append("total memory unavailable: sysctl failed")
        vm = _run_command(("vm_stat",), timeout=10)
        if vm.returncode == 0:
            evidence["vmBytes"] = parse_vm_stat(vm.stdout)
        else:
            limitations.append("memory page statistics unavailable: vm_stat failed")
        swap = _run_command(("sysctl", "vm.swapusage"), timeout=10)
        if swap.returncode == 0:
            evidence["swapSummary"] = swap.stdout.strip()
        else:
            limitations.append("swap usage unavailable: sysctl failed")
        pressure = _run_command(("memory_pressure", "-Q"), timeout=10)
        if pressure.returncode == 0:
            match = re.search(r"(\d+)%", pressure.stdout)
            if match:
                evidence["freePercent"] = int(match.group(1))
        else:
            limitations.append("memory pressure unavailable")
    elif Path("/proc/meminfo").is_file():
        values = {}
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition(":")
            if not separator:
                continue
            match = re.match(r"\s*(\d+)\s+kB", value)
            if match:
                values[key] = int(match.group(1)) * 1024
        evidence["meminfoBytes"] = values
    else:
        limitations.append("memory metrics unavailable on this platform")
    return (
        {
            "category": "system-memory",
            "status": "report_only",
            "path": "system-memory",
            "bytes": 0,
            "reasonCodes": ["memory-report-only"],
            "evidence": evidence,
        },
        limitations,
    )


def _collect_disk_finding(root: Path) -> dict:
    usage = shutil.disk_usage(root)
    return {
        "category": "filesystem",
        "status": "report_only",
        "path": str(root),
        "bytes": 0,
        "reasonCodes": ["filesystem-report-only"],
        "evidence": {
            "totalBytes": usage.total,
            "usedBytes": usage.used,
            "freeBytes": usage.free,
        },
    }


def _collect_docker_finding() -> tuple[dict, list[str]]:
    limitations = []
    evidence: dict = {"available": False}
    if shutil.which("docker") is None:
        limitations.append("Docker report unavailable: docker CLI missing")
    else:
        result = _run_command(("docker", "system", "df"), timeout=30)
        if result.returncode == 0:
            evidence = {
                "available": True,
                "summary": [
                    line for line in result.stdout.splitlines() if line.strip()
                ],
            }
        else:
            limitations.append("Docker report unavailable: daemon or CLI failed")
    return (
        {
            "category": "docker",
            "status": "report_only",
            "path": "docker-system",
            "bytes": 0,
            "reasonCodes": ["docker-report-only"],
            "evidence": evidence,
        },
        limitations,
    )


def audit_repository(repo_value: Path | str, *, now: datetime | None = None) -> dict:
    current_time = (now or datetime.now(UTC)).astimezone(UTC)
    now_ns = int(current_time.timestamp() * 1_000_000_000)
    repository = discover_repository(repo_value)
    roots = [
        str(Path(record["worktree"]).resolve()) for record in repository["worktrees"]
    ]
    processes, ownership_available, limitations = _collect_processes(roots)
    states, worktree_findings, worktree_limits = _collect_worktree_evidence(
        repository,
        processes,
        ownership_available=ownership_available,
    )
    limitations.extend(worktree_limits)
    findings = list(worktree_findings)

    for root_value, evidence in states.items():
        root = Path(root_value)
        for log in _discover_logs(root):
            findings.append(
                classify_log(
                    log,
                    root,
                    now_ns=now_ns,
                    open_check=_live_open_probe(log, False),
                )
            )
        cache = root / "frontend" / ".next" / "dev" / "cache" / "turbopack"
        if os.path.lexists(cache):
            findings.append(
                classify_cache(
                    cache,
                    evidence,
                    now_ns=now_ns,
                    open_check=_live_open_probe(cache, True),
                )
            )

    for process in processes:
        findings.append(
            {
                "category": "process",
                "status": "active",
                "path": process.get("cwd")
                or process.get("worktree")
                or "owned-process",
                "worktree": process.get("worktree"),
                "bytes": 0,
                "reasonCodes": ["process-report-only"],
                "evidence": process,
            }
        )
    memory, memory_limits = _collect_memory_finding()
    docker, docker_limits = _collect_docker_finding()
    findings.extend((memory, _collect_disk_finding(repository["root"]), docker))
    limitations.extend(memory_limits)
    limitations.extend(docker_limits)

    plan = build_plan(repository["identity"], findings, created_at=current_time)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "mode": "audit",
        "repo": {
            **repository["identity"],
            "worktreeCount": len(repository["worktrees"]),
        },
        "summary": summarize_findings(findings),
        "findings": findings,
        "limitations": sorted(set(limitations)),
        "plan": plan,
    }


def _write_json_atomic(path: Path, value: object) -> None:
    destination = _absolute(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".tmp",
        dir=destination.parent,
        text=True,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, destination)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    raw = list(sys.argv[1:] if argv is None else argv)
    if not raw or raw[0] not in {"audit", "apply", "-h", "--help"}:
        raw.insert(0, "audit")
    parser = argparse.ArgumentParser(
        description="Audit and safely clean allow-listed SmallKhoj development artifacts."
    )
    subparsers = parser.add_subparsers(dest="mode", required=True)
    audit = subparsers.add_parser(
        "audit", help="Audit only; never delete cleanup targets."
    )
    audit.add_argument(
        "--repo", default=".", help="Registered SmallKhoj worktree to audit."
    )
    audit.add_argument("--plan-out", help="Optional JSON path for the generated plan.")
    audit.add_argument(
        "--json", action="store_true", help="Print machine-readable JSON."
    )
    apply_parser = subparsers.add_parser(
        "apply", help="Apply an exact, fresh, confirmed plan."
    )
    apply_parser.add_argument(
        "--repo", required=True, help="Same worktree used for audit."
    )
    apply_parser.add_argument("--plan", required=True, help="Audit plan JSON path.")
    apply_parser.add_argument(
        "--confirm", required=True, help="Exact plan id confirmation token."
    )
    apply_parser.add_argument(
        "--json", action="store_true", help="Print machine-readable JSON."
    )
    return parser.parse_args(raw)


def _error_output(mode: str, message: str, *, as_json: bool) -> None:
    if as_json:
        print(
            json.dumps(
                {
                    "schemaVersion": SCHEMA_VERSION,
                    "mode": mode,
                    "error": message,
                },
                ensure_ascii=False,
            )
        )
    else:
        print(
            f"SmallKhoj cleanup {mode.upper()} failed safely: {message}",
            file=sys.stderr,
        )


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "audit":
            report = audit_repository(args.repo)
            if args.plan_out:
                _write_json_atomic(Path(args.plan_out), report["plan"])
            print(
                json.dumps(report, ensure_ascii=False, indent=2)
                if args.json
                else render_human(report)
            )
            return 0

        plan_path = _absolute(args.plan)
        with plan_path.open("r", encoding="utf-8") as handle:
            plan = json.load(handle)
        repository = discover_repository(args.repo)
        roots = [
            str(Path(record["worktree"]).resolve())
            for record in repository["worktrees"]
        ]
        processes, ownership_available, limitations = _collect_processes(roots)
        states, _findings, state_limits = _collect_worktree_evidence(
            repository,
            processes,
            ownership_available=ownership_available,
        )
        limitations.extend(state_limits)
        result = apply_plan_data(
            plan,
            confirmation=args.confirm,
            repository=repository["identity"],
            worktrees=states,
            open_probe=_live_open_probe,
        )
        report = {
            "schemaVersion": SCHEMA_VERSION,
            "mode": "apply",
            "repo": repository["identity"],
            "summary": {
                "deleted": {
                    "count": result["deletedCount"],
                    "bytes": result["reclaimedBytes"],
                },
                "failed": {"count": result["failedCount"], "bytes": 0},
                "skipped": {"count": result["skippedCount"], "bytes": 0},
            },
            "findings": [],
            "limitations": sorted(set(limitations)),
            "applyResult": result,
        }
        print(
            json.dumps(report, ensure_ascii=False, indent=2)
            if args.json
            else render_human(report)
        )
        return 1 if result["failedCount"] else 0
    except (CleanupError, OSError, ValueError, json.JSONDecodeError) as exc:
        _error_output(args.mode, str(exc), as_json=args.json)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
