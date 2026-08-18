"""Trellis Dashboard 的 DSH agent 运行器。

设计:
- 工作流 = tools/trellis-dashboard/agents/workflows/*.md（frontmatter 元数据 +
  正文即自包含 prompt）。注册表是数据文件，agent 对话也能往里加新工作流。
- 运行 = spawn `dsh --profile headless <prompt>`（cwd=仓库根），输出与状态
  落在 .trellis/.runtime/agent-runs/<runId>/，索引追加到 agent-runs.jsonl。
- 单飞锁：同一时刻只允许一个 agent run（防并发写仓库）。
- 不自动 git commit；改动由用户审查后提交。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS_DIR = Path(__file__).resolve().parent / "agents" / "workflows"
RUNS_DIR_NAME = ".trellis/.runtime/agent-runs"
INDEX_NAME = "agent-runs.jsonl"
OUTPUT_TAIL_CHARS = 2000
DSH_BIN = os.environ.get("TRELLIS_DASHBOARD_DSH_BIN", "dsh")

_frontmatter_re = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def list_workflows() -> list[dict]:
    """解析工作流注册表（frontmatter 元数据 + prompt 长度）。"""
    workflows: list[dict] = []
    if not WORKFLOWS_DIR.is_dir():
        return workflows
    for md in sorted(WORKFLOWS_DIR.glob("*.md")):
        text = md.read_text(encoding="utf-8", errors="replace")
        meta: dict[str, str] = {"id": md.stem}
        match = _frontmatter_re.match(text)
        if match:
            for line in match.group(1).splitlines():
                if ":" in line:
                    key, _, value = line.partition(":")
                    meta[key.strip()] = value.strip()
        prompt = text[match.end():].strip() if match else text.strip()
        workflows.append({
            "id": meta.get("id", md.stem),
            "name": meta.get("name", md.stem),
            "description": meta.get("description", ""),
            "timeoutMinutes": int(meta["timeoutMinutes"]) if meta.get("timeoutMinutes", "").isdigit() else None,
            "promptChars": len(prompt),
        })
    return workflows


def read_workflow_prompt(workflow_id: str) -> str | None:
    md = WORKFLOWS_DIR / f"{workflow_id}.md"
    if not md.is_file():
        return None
    text = md.read_text(encoding="utf-8", errors="replace")
    match = _frontmatter_re.match(text)
    return text[match.end():].strip() if match else text.strip()


class RunState:
    """进程内单飞锁 + 运行注册（dashboard 服务器单进程，够用）。"""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.running: dict | None = None


run_state = RunState()


def _runs_root(root: Path) -> Path:
    return root / RUNS_DIR_NAME


def _index_path(root: Path) -> Path:
    return _runs_root(root) / INDEX_NAME


def list_runs(root: Path, limit: int = 20) -> list[dict]:
    path = _index_path(root)
    if not path.is_file():
        return []
    runs: list[dict] = []
    for line in reversed(path.read_text(encoding="utf-8", errors="replace").splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            runs.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(runs) >= limit:
            break
    # 运行中的那条以内存状态为准（重启后以磁盘 running 标记 + 存活探测兜底）
    if run_state.running:
        for run in runs:
            if run.get("runId") == run_state.running.get("runId"):
                run.update(run_state.running)
    return runs


def start_run(root: Path, workflow_id: str) -> dict:
    """启动一个工作流 run；已在跑则抛 RuntimeError（API 层转 409）。"""
    with run_state.lock:
        if run_state.running and run_state.running.get("status") == "running":
            raise RuntimeError(f"已有 agent 在运行: {run_state.running.get('workflowId')}")
        prompt = read_workflow_prompt(workflow_id)
        if prompt is None:
            raise KeyError(f"未知工作流: {workflow_id}")

        runs_root = _runs_root(root)
        runs_root.mkdir(parents=True, exist_ok=True)
        run_id = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        run_dir = runs_root / run_id
        run_dir.mkdir()
        record = {
            "runId": run_id,
            "workflowId": workflow_id,
            "startedAt": _now_iso(),
            "finishedAt": None,
            "status": "running",
            "exitCode": None,
            "durationSeconds": None,
            "outputTail": None,
        }
        (run_dir / "meta.json").write_text(json.dumps(record, ensure_ascii=False, indent=1))
        with _index_path(root).open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")

        env = dict(os.environ)
        log_file = (run_dir / "output.log").open("w", encoding="utf-8")
        try:
            proc = subprocess.Popen(
                [DSH_BIN, "--profile", "headless", prompt],
                cwd=str(root),
                stdout=log_file,
                stderr=subprocess.STDOUT,
                env=env,
                start_new_session=True,
            )
        except FileNotFoundError:
            log_file.close()
            record["status"] = "failed"
            record["finishedAt"] = _now_iso()
            record["outputTail"] = f"{DSH_BIN} 不可用（未安装或不在 PATH）"
            _finish_record(root, record)
            raise RuntimeError(record["outputTail"])

        run_state.running = record
        started_at = datetime.now(timezone.utc)

        def _reap() -> None:
            try:
                code = proc.wait()
            except Exception:
                code = -1
            log_file.close()
            log_path = run_dir / "output.log"
            tail = log_path.read_text(encoding="utf-8", errors="replace")[-OUTPUT_TAIL_CHARS:]
            record["status"] = "done" if code == 0 else "failed"
            record["exitCode"] = code
            record["finishedAt"] = _now_iso()
            record["durationSeconds"] = int((datetime.now(timezone.utc) - started_at).total_seconds())
            record["outputTail"] = tail
            _finish_record(root, record)
            with run_state.lock:
                if run_state.running and run_state.running.get("runId") == run_id:
                    run_state.running = None

        threading.Thread(target=_reap, daemon=True).start()
        return dict(record)


def _finish_record(root: Path, record: dict) -> None:
    """以 runId 为键重写索引中该条（索引小，整读整写）。"""
    path = _index_path(root)
    lines = []
    if path.is_file():
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if item.get("runId") == record["runId"]:
                item = record
            lines.append(json.dumps(item, ensure_ascii=False))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
