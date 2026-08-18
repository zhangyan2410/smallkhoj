"""Trellis Dashboard 快照采集器（只读）。

数据层原则:
    - 任务解析复用本仓库 .trellis/scripts/common 的实现（单一事实来源），
      Trellis 模板升级后仪表盘不会漂移。
    - 其余数据源（sessions、journal、spec）按 .trellis 的磁盘约定直接读取，
      所有函数接受显式 root 参数，便于单元测试用临时夹具验证。
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
_TRELLIS_SCRIPTS = REPO_ROOT / ".trellis" / "scripts"
if _TRELLIS_SCRIPTS.is_dir() and str(_TRELLIS_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_TRELLIS_SCRIPTS))

from common.git import run_git  # noqa: E402
from common.packages_context import get_context_packages_json  # noqa: E402
from common.paths import get_developer, get_tasks_dir  # noqa: E402
from common.task_queue import get_task_stats  # noqa: E402
from common.tasks import get_all_statuses, iter_active_tasks, load_task  # noqa: E402

SNAPSHOT_SCHEMA = "trellis.dashboard.v1"
ARTIFACT_PREVIEW_LIMIT_BYTES = 256 * 1024
ARCHIVED_RECENT_LIMIT = 200
JOURNAL_RECENT_LIMIT = 20
TEXT_FIELD_LIMIT = 400

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"}
IMAGE_RAW_LIMIT_BYTES = 4 * 1024 * 1024

_CANONICAL_ROOT_FILES = {"prd.md", "design.md", "implement.md", "research.md", "task.json"}
_CANONICAL_SUBDIRS = {"research"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _clip(text: str | None) -> str | None:
    if not text:
        return text or None
    text = " ".join(text.split())
    if len(text) <= TEXT_FIELD_LIMIT:
        return text
    return text[:TEXT_FIELD_LIMIT] + "…"


# ---------------------------------------------------------------------------
# Git / 项目
# ---------------------------------------------------------------------------

def _collect_git(root: Path) -> dict:
    def git(*args: str) -> str:
        code, out, _err = run_git(list(args), cwd=root)
        return out.strip() if code == 0 else ""

    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    head = git("rev-parse", "--short", "HEAD")
    status = git("status", "--porcelain")
    dirty_files = [line.strip() for line in status.splitlines() if line.strip()]
    recent = [line for line in git("log", "--oneline", "-5").splitlines() if line]
    return {
        "isRepo": bool(branch or head),
        "branch": branch or None,
        "head": head or None,
        "dirtyFiles": dirty_files,
        "recentCommits": recent,
    }


# ---------------------------------------------------------------------------
# 任务工件
# ---------------------------------------------------------------------------

def _parse_context_manifest(path: Path) -> dict:
    """解析 implement.jsonl / check.jsonl，统计真实条目（workflow.md 1.3/1.5 的 ready gate）。"""
    result = {"exists": path.is_file(), "curated": 0, "seedOnly": False, "invalidLines": 0}
    if not result["exists"]:
        return result
    saw_example = False
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            result["invalidLines"] += 1
            continue
        if isinstance(entry, dict) and entry.get("file"):
            result["curated"] += 1
        elif isinstance(entry, dict) and "_example" in entry:
            saw_example = True
    result["seedOnly"] = result["curated"] == 0 and saw_example
    return result


def _collect_artifacts(task_dir: Path) -> dict:
    artifacts: dict = {
        "prd": (task_dir / "prd.md").is_file(),
        "design": (task_dir / "design.md").is_file(),
        "implement": (task_dir / "implement.md").is_file(),
        "researchFiles": [],
        "extras": [],
        "extraDirs": [],
        "implementContext": _parse_context_manifest(task_dir / "implement.jsonl"),
        "checkContext": _parse_context_manifest(task_dir / "check.jsonl"),
    }
    if not task_dir.is_dir():
        return artifacts

    research_dir = task_dir / "research"
    if research_dir.is_dir():
        artifacts["researchFiles"] = sorted(
            p.name for p in research_dir.iterdir() if p.is_file() and p.suffix == ".md"
        )
    if (task_dir / "research.md").is_file():
        artifacts["researchFiles"] = ["research.md", *artifacts["researchFiles"]]

    for entry in sorted(task_dir.iterdir()):
        if entry.is_file() and entry.suffix == ".md" and entry.name not in _CANONICAL_ROOT_FILES:
            artifacts["extras"].append(entry.name)
        elif entry.is_dir() and entry.name not in _CANONICAL_SUBDIRS:
            # 递归收集（evidence/probes 常有多层嵌套），展示上限 10 个文件名
            files = sorted(
                str(p.relative_to(task_dir)) for p in entry.rglob("*") if p.is_file()
            )
            artifacts["extraDirs"].append({
                "name": entry.name,
                "fileCount": len(files),
                "files": files[:10],
            })
    return artifacts


def _readiness(status: str, artifacts: dict) -> dict:
    """workflow.md 1.5 Phase 1 完成标准的可观测投影。"""
    return {
        "prd": artifacts["prd"],
        "design": artifacts["design"],
        "implement": artifacts["implement"],
        "contextCurated": (
            artifacts["implementContext"]["curated"] > 0
            and artifacts["checkContext"]["curated"] > 0
        ),
    }


def _phase_hint(status: str) -> str | None:
    """workflow.md 状态机: planning→Phase 1；in_progress 覆盖 Phase 2+3（archive 才翻 completed）。"""
    if status == "planning":
        return "plan"
    if status == "in_progress":
        return "execute_finish"
    if status in ("completed", "done"):
        return "completed"
    return None


def _next_step(status: str, readiness: dict) -> str:
    if status == "planning":
        if not readiness["prd"]:
            return "补齐 prd.md（复杂任务还需 design.md + implement.md）"
        if not readiness["contextCurated"]:
            return "为 implement.jsonl / check.jsonl 各补充至少一条真实条目，然后 task.py start"
        return "评审规划工件后执行 task.py start 进入实现"
    if status == "in_progress":
        return "trellis-implement → trellis-check → trellis-update-spec → 提交 → /trellis:finish-work"
    if status == "review":
        return "评审中"
    if status in ("completed", "done"):
        return "已完成（done 视同 completed，等待归档或已归档）"
    return None


def _task_risks(status: str, readiness: dict, artifacts: dict) -> list[str]:
    risks: list[str] = []
    if status == "planning" and not readiness["prd"]:
        risks.append("MISSING_PRD")
    # ready gate 只在 task.py start 之前有意义；inline 平台（codex-inline 等）
    # 本来就跳过 jsonl 策展，in_progress 阶段不再视为风险。
    if status == "planning" and not readiness["contextCurated"]:
        risks.append("CONTEXT_NOT_CURATED")
    return risks


# ---------------------------------------------------------------------------
# 任务
# ---------------------------------------------------------------------------

def _build_task_item(task_dir: Path, statuses: dict[str, str]) -> dict | None:
    info = load_task(task_dir)
    if info is None:
        return None
    raw = info.raw

    children = []
    done = 0
    for child in raw.get("children", []) or []:
        child_status = statuses.get(child)
        child_done = child_status is None or child_status in ("completed", "done")
        if child_done:
            done += 1
        children.append({
            "dir": child,
            "status": child_status,
            "archived": child_status is None,
            "done": child_done,
        })

    artifacts = _collect_artifacts(task_dir)
    readiness = _readiness(info.status, artifacts)
    return {
        "dir": info.dir_name,
        "title": info.title,
        "description": _clip(raw.get("description", "")),
        "notes": _clip(raw.get("notes", "")),
        "status": info.status,
        "priority": info.priority,
        "creator": raw.get("creator"),
        "assignee": info.assignee or None,
        "createdAt": raw.get("createdAt"),
        "completedAt": raw.get("completedAt"),
        "branch": raw.get("branch"),
        "baseBranch": raw.get("base_branch"),
        "worktreePath": raw.get("worktree_path"),
        "commit": raw.get("commit"),
        "prUrl": raw.get("pr_url"),
        "scope": raw.get("scope"),
        "package": info.package,
        "parent": raw.get("parent"),
        "children": children,
        "childrenProgress": {"done": done, "total": len(children)} if children else None,
        "artifacts": artifacts,
        "readiness": readiness,
        "phase": _phase_hint(info.status),
        "nextStep": _next_step(info.status, readiness),
        "risks": _task_risks(info.status, readiness, artifacts),
        "needsDecision": (raw.get("meta") or {}).get("needsDecision"),
        "meta": raw.get("meta") or None,
    }


def _collect_active_tasks(root: Path) -> list[dict]:
    tasks_dir = get_tasks_dir(root)
    statuses = get_all_statuses(tasks_dir)
    items = []
    for entry in sorted(tasks_dir.iterdir(), reverse=True):
        if not entry.is_dir() or entry.name == "archive":
            continue
        item = _build_task_item(entry, statuses)
        if item is not None:
            items.append(item)
    return items


def _collect_archived_recent(root: Path) -> list[dict]:
    archive = get_tasks_dir(root) / "archive"
    if not archive.is_dir():
        return []
    items: list[tuple[str, dict]] = []
    for month_dir in archive.iterdir():
        if not month_dir.is_dir():
            continue
        for task_dir in month_dir.iterdir():
            if not task_dir.is_dir():
                continue
            info = load_task(task_dir)
            if info is None:
                continue
            raw = info.raw
            ref = f"archive/{month_dir.name}/{info.dir_name}"
            items.append((raw.get("completedAt") or month_dir.name, {
                "dir": info.dir_name,
                "ref": ref,
                "title": info.title,
                "status": info.status,
                "priority": info.priority,
                "assignee": info.assignee or None,
                "createdAt": raw.get("createdAt"),
                "completedAt": raw.get("completedAt"),
                "month": month_dir.name,
                "branch": raw.get("branch"),
                "commit": raw.get("commit"),
                "childCount": len(raw.get("children", []) or []),
                "needsDecision": (raw.get("meta") or {}).get("needsDecision"),
                "artifacts": _collect_artifacts(task_dir),
            }))
    items.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _key, item in items[:ARCHIVED_RECENT_LIMIT]]


def _count_archived(root: Path) -> int:
    archive = get_tasks_dir(root) / "archive"
    if not archive.is_dir():
        return 0
    return sum(1 for month in archive.iterdir() if month.is_dir()
               for task_dir in month.iterdir() if task_dir.is_dir())


def _collect_summary(root: Path, active_items: list[dict], git: dict,
                     archived_total: int, active_sessions: int) -> dict:
    by_status: dict[str, int] = {}
    for item in active_items:
        by_status[item["status"]] = by_status.get(item["status"], 0) + 1
    stats = get_task_stats(root)
    return {
        "activeTasks": len(active_items),
        "byStatus": by_status,
        "priority": {k: v for k, v in stats.items() if k != "Total"},
        "archivedTotal": archived_total,
        "dirtyFiles": len(git["dirtyFiles"]),
        "activeSessions": active_sessions,
    }


# ---------------------------------------------------------------------------
# 工件预览（有界读）
# ---------------------------------------------------------------------------

def _safe_join(base: Path, ref: str) -> Path | None:
    """ref 是 base 内的相对路径；拒绝绝对路径、反斜杠与穿越段。"""
    if not ref or ref.startswith("/") or "\\" in ref:
        return None
    if any(part in ("", ".", "..") for part in ref.split("/")):
        return None
    resolved = (base / ref).resolve()
    if base not in resolved.parents:
        return None
    return resolved


def resolve_artifact(root: Path, task_ref: str, file_ref: str) -> Path | None:
    """把工件引用解析为任务目录内的受控路径；非法或不存在返回 None。

    task_ref 形如 "08-16-foo"（活跃）或 "archive/2026-08/07-30-foo"（归档）。
    """
    tasks_root = get_tasks_dir(root).resolve()
    task_dir = _safe_join(tasks_root, task_ref)
    if task_dir is None or not task_dir.is_dir():
        return None
    artifact = _safe_join(task_dir, file_ref)
    if artifact is None or not artifact.is_file():
        return None
    return artifact


def read_artifact_preview(root: Path, task_ref: str, file_ref: str) -> dict | None:
    """读取任务工件的受限文本预览；路径非法或文件不存在返回 None。"""
    artifact = resolve_artifact(root, task_ref, file_ref)
    if artifact is None:
        return None
    size = artifact.stat().st_size
    with artifact.open("rb") as fh:
        data = fh.read(ARTIFACT_PREVIEW_LIMIT_BYTES + 1)
    truncated = len(data) > ARTIFACT_PREVIEW_LIMIT_BYTES
    return {
        "task": task_ref,
        "file": file_ref,
        "sizeBytes": size,
        "truncated": truncated,
        "content": data[:ARTIFACT_PREVIEW_LIMIT_BYTES].decode("utf-8", errors="replace"),
    }


# ---------------------------------------------------------------------------
# AI 会话指针（.trellis/.runtime/sessions/*.json）
# ---------------------------------------------------------------------------

def _collect_sessions(root: Path) -> list[dict]:
    """扫描全部会话窗口指针；不做 active_task.py 的"唯一会话回退"猜测，全部展示。"""
    sessions_dir = root / ".trellis" / ".runtime" / "sessions"
    if not sessions_dir.is_dir():
        return []
    sessions: list[dict] = []
    for path in sessions_dir.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (json.JSONDecodeError, OSError):
            continue
        if not isinstance(data, dict):
            continue
        current_task = data.get("current_task")
        stale = False
        if current_task:
            # 指针指向的任务目录已被归档/删除 → 失效指针
            stale = not (root / current_task).is_dir()
        sessions.append({
            "key": path.stem,
            "platform": data.get("platform") or path.stem.split("_", 1)[0],
            "lastSeenAt": data.get("last_seen_at"),
            "currentTask": current_task,
            "staleTask": stale,
        })
    sessions.sort(key=lambda s: s.get("lastSeenAt") or "", reverse=True)
    return sessions


# ---------------------------------------------------------------------------
# Workspace Journal（.trellis/workspace/<dev>/index.md 的 @@@auto 区块）
# ---------------------------------------------------------------------------

_STATUS_PATTERNS = {
    "activeFile": r"\*\*Active File\*\*:\s*`([^`]+)`",
    "totalSessions": r"\*\*Total Sessions\*\*:\s*(\d+)",
    "lastActive": r"\*\*Last Active\*\*:\s*([0-9-]+)",
}


def _parse_journal_status(index_md: str) -> dict:
    import re

    status: dict = {"activeFile": None, "totalSessions": 0, "lastActive": None}
    for key, pattern in _STATUS_PATTERNS.items():
        match = re.search(pattern, index_md)
        if match:
            status[key] = match.group(1) if key == "activeFile" else (
                int(match.group(1)) if key == "totalSessions" else match.group(1)
            )
    return status


def _split_table_row(line: str) -> list[str]:
    placeholder = "\x00"
    cells = line.replace("\\|", placeholder).strip().strip("|").split("|")
    return [cell.strip().replace(placeholder, "|") for cell in cells]


def _parse_active_documents(index_md: str, max_lines: int) -> list[dict]:
    """解析 @@@auto:active-documents 表（| File | Lines | Status |），用于 nearLimit 提示。"""
    files: list[dict] = []
    inside = False
    for line in index_md.splitlines():
        if "@@@auto:active-documents" in line:
            inside = True
            continue
        if inside and "@@@/auto" in line:
            break
        if not inside or not line.strip().startswith("|"):
            continue
        cells = _split_table_row(line)
        if len(cells) < 3 or not cells[0].strip("`").endswith(".md"):
            continue
        line_count = cells[1].lstrip("~").strip()
        files.append({
            "file": cells[0].strip("`"),
            "lines": int(line_count) if line_count.isdigit() else None,
            "nearLimit": bool(line_count.isdigit() and int(line_count) > max_lines * 0.8),
        })
    return files


def _parse_session_history(index_md: str, limit: int) -> list[dict]:
    """解析 @@@auto:session-history 表（| # | Date | Title | Commits | Branch |）。"""
    entries: list[dict] = []
    inside = False
    for line in index_md.splitlines():
        if "@@@auto:session-history" in line:
            inside = True
            continue
        if inside and "@@@/auto" in line:
            break
        if not inside or not line.strip().startswith("|"):
            continue
        cells = _split_table_row(line)
        if len(cells) < 5 or set(cells[0]) <= {"-", ":", " "} or not cells[0].isdigit():
            continue  # 表头或分隔行
        commits = [c.strip("` ") for c in cells[3].split(",") if c.strip()]
        entries.append({
            "n": int(cells[0]),
            "date": cells[1],
            "title": cells[2],
            "commits": commits,
            "branch": cells[4].strip("`"),
        })
    entries.reverse()  # 表内最新在上，翻转为时间正序后再取尾部
    return entries[-limit:][::-1] if limit else entries[::-1]


def _collect_journal(root: Path) -> dict:
    workspace = root / ".trellis" / "workspace"
    journal: dict = {"developer": None, "developers": [], "recent": []}
    if not workspace.is_dir():
        return journal

    for dev_dir in sorted(workspace.iterdir()):
        index = dev_dir / "index.md"
        if not dev_dir.is_dir() or not index.is_file():
            continue
        text = index.read_text(encoding="utf-8", errors="replace")
        status = _parse_journal_status(text)
        journal["developers"].append({"name": dev_dir.name, **status})

    current = get_developer(root)
    chosen = current
    if chosen and not any(d["name"] == chosen for d in journal["developers"]):
        chosen = None
    if chosen is None and journal["developers"]:
        # .developer 缺失时回退到最近活跃的开发者
        chosen = max(journal["developers"], key=lambda d: d.get("lastActive") or "")["name"]
    if chosen:
        index = workspace / chosen / "index.md"
        text = index.read_text(encoding="utf-8", errors="replace") if index.is_file() else ""
        journal["developer"] = chosen
        journal["recent"] = _parse_session_history(text, JOURNAL_RECENT_LIMIT)
        journal["journalFiles"] = _parse_active_documents(text, 2000)
    return journal


# ---------------------------------------------------------------------------
# Spec 层
# ---------------------------------------------------------------------------

def _collect_spec(root: Path) -> dict:
    try:
        info = get_context_packages_json(root)
    except Exception:  # noqa: BLE001 - spec 结构异常不应拖垮整个快照
        return {}
    return info if isinstance(info, dict) else {}


# ---------------------------------------------------------------------------
# Spec 沉淀台账（.trellis/spec/capture-ledger.json）
# ---------------------------------------------------------------------------

def _collect_spec_capture(root: Path) -> dict:
    """读取 spec 沉淀审计台账；文件不存在时返回空结构（tab 隐藏）。"""
    ledger_path = root / ".trellis" / "spec" / "capture-ledger.json"
    result: dict = {"auditedAt": None, "items": [], "counts": {}}
    if not ledger_path.is_file():
        return result
    try:
        data = json.loads(ledger_path.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, OSError):
        return result
    if not isinstance(data, dict) or data.get("schema") != "trellis.spec-capture.v1":
        return result
    counts: dict[str, int] = {}
    items = []
    for entry in data.get("items", []):
        if not isinstance(entry, dict) or not entry.get("id"):
            continue
        item = dict(entry)
        # 任务条目补标题（从归档 task.json）
        if item.get("kind") == "task" and item.get("month"):
            task_json = (
                root / ".trellis" / "tasks" / "archive" / item["month"] / item["id"] / "task.json"
            )
            if task_json.is_file():
                try:
                    item["title"] = json.loads(
                        task_json.read_text(encoding="utf-8", errors="replace")
                    ).get("title")
                except (json.JSONDecodeError, OSError):
                    pass
        counts[item.get("status", "?")] = counts.get(item.get("status", "?"), 0) + 1
        items.append(item)
    # 时间线倒序（skill 无月份，作为"最新"排在最前）
    def sort_key(entry: dict):
        if entry.get("kind") == "skill":
            return ("9999-99", "0" + entry["id"])
        return (entry.get("month") or "", "1" + entry["id"])
    items.sort(key=sort_key, reverse=True)
    result["auditedAt"] = data.get("auditedAt")
    result["items"] = items
    result["counts"] = counts
    return result


# ---------------------------------------------------------------------------
# Spec 文件清单 + 时效性审计（.trellis/spec/spec-audit.json）
# ---------------------------------------------------------------------------

def read_spec_file(root: Path, rel_path: str) -> dict | None:
    """读取 spec 目录内 Markdown 的受限预览（256KiB 截断，防穿越）。"""
    spec_root = (root / ".trellis" / "spec").resolve()
    artifact = _safe_join(spec_root, rel_path)
    if artifact is None or not artifact.is_file() or artifact.suffix != ".md":
        return None
    size = artifact.stat().st_size
    with artifact.open("rb") as fh:
        data = fh.read(ARTIFACT_PREVIEW_LIMIT_BYTES + 1)
    truncated = len(data) > ARTIFACT_PREVIEW_LIMIT_BYTES
    return {
        "path": rel_path,
        "sizeBytes": size,
        "truncated": truncated,
        "content": data[:ARTIFACT_PREVIEW_LIMIT_BYTES].decode("utf-8", errors="replace"),
    }


def _collect_spec_files(root: Path) -> dict:
    """磁盘 spec 清单 × 时效性审计结论合并。"""
    spec_root = root / ".trellis" / "spec"
    audit: dict = {"auditedAt": None, "byPath": {}, "counts": {}}
    audit_path = spec_root / "spec-audit.json"
    if audit_path.is_file():
        try:
            data = json.loads(audit_path.read_text(encoding="utf-8", errors="replace"))
            if isinstance(data, dict) and data.get("schema") == "trellis.spec-audit.v1":
                audit["auditedAt"] = data.get("auditedAt")
                counts: dict[str, int] = {}
                for entry in data.get("files", []):
                    if isinstance(entry, dict) and entry.get("path"):
                        audit["byPath"][entry["path"]] = entry
                        for key in ("current", "partial", "stale"):
                            counts[key] = counts.get(key, 0) + (entry.get("sections") or {}).get(key, 0)
                audit["counts"] = counts
        except (json.JSONDecodeError, OSError):
            pass

    files = []
    if spec_root.is_dir():
        for md in sorted(spec_root.rglob("*.md")):
            rel = md.relative_to(spec_root).as_posix()
            entry = audit["byPath"].get(rel, {})
            sections = entry.get("sections") or {}
            findings = entry.get("findings") or []
            files.append({
                "path": rel,
                "layer": rel.split("/", 1)[0] if "/" in rel else "other",
                "lines": sum(1 for _ in md.open("rb")),
                "sections": sections or None,
                "findings": findings or None,
            })
    return {"auditedAt": audit["auditedAt"], "counts": audit["counts"], "files": files}


# ---------------------------------------------------------------------------
# 快照
# ---------------------------------------------------------------------------

def collect_snapshot(root: Path) -> dict:
    root = Path(root).resolve()
    git = _collect_git(root)
    active = _collect_active_tasks(root)
    sessions = _collect_sessions(root)
    return {
        "schema": SNAPSHOT_SCHEMA,
        "generatedAt": _now_iso(),
        "project": {
            "root": str(root),
            "name": root.name,
            "git": git,
        },
        "developer": get_developer(root),
        "summary": _collect_summary(root, active, git, _count_archived(root), len(sessions)),
        "tasks": {
            "active": active,
            "archivedRecent": _collect_archived_recent(root),
        },
        "sessions": sessions,
        "journal": _collect_journal(root),
        "spec": _collect_spec(root),
        "specCapture": _collect_spec_capture(root),
        "specFiles": _collect_spec_files(root),
    }
